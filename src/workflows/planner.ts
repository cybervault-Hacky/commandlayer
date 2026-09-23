/**
 * Phase 5 — deterministic workflow planner.
 *
 * The planner turns a multi-step goal into a BOUNDED workflow of Phase 4
 * actions. It reuses the Phase 4 planner per clause (no second action
 * parser) and adds exactly one workflow-only capability: resolving a
 * result-reference clause ("…and open the relevant result") against the
 * captured Page Intelligence links.
 *
 * Everything here is deterministic:
 * - same goal + same page context → same steps, same order, same risk
 * - no model, no randomness, and no AI output is required
 * - every planned step has planning-time evidence (the query appears in
 *   the captured context; the referenced link exists and is unique) —
 *   when that evidence is missing the workflow is refused instead of
 *   guessing (TARGET_NOT_FOUND / TARGET_AMBIGUOUS)
 *
 * AI proposals may suggest the ACTION SHAPE of a workflow, but they are
 * untrusted data: `planWorkflowWithProposal` only accepts a proposal
 * whose action sequence matches the deterministic plan. An AI can never
 * add a step, change a target, change risk, or introduce an action.
 */
import { ACTION_LIMITS } from '@/actions/limits';
import { pageContentDigest } from '@/page-intelligence/hash';
import { planAction, type PlanContext } from '@/actions/planner';
import { isSensitiveField } from '@/actions/sensitive';
import { parseSafeUrl } from '@/shared/security/url';
import { createRequestId } from '@/shared/messaging/envelope';
import type { PageContext, PageLink } from '@/shared/types/page';
import { computeWorkflowHash } from './hash';
import { WORKFLOW_LIMITS } from './limits';
import { workflowError, type WorkflowError } from './errors';
import {
  analyzeGoalText,
  contextRequirementsForIntents,
  describeOutcomeForIntents,
  TaskKind,
  type GoalClause,
  type TaskUnderstanding,
} from './understanding';
import {
  buildWorkflowStep,
  combinedWorkflowRisk,
  parseWorkflowProposal,
  validateWorkflowSteps,
  type StepBuildOptions,
} from './validator';
import {
  WorkflowOutcomeKind,
  WorkflowStatus,
  type Workflow,
  type WorkflowIntent,
  type WorkflowOutcomeSpec,
  type WorkflowStep,
} from './types';

export interface WorkflowPlanInput {
  /** The user's own words. */
  goal: string;
  requestId: string;
  context: PageContext;
  tabId: number;
  now?: Date;
}

export interface WorkflowPlanOutcome {
  understanding: TaskUnderstanding;
  workflow?: Workflow;
  error?: WorkflowError;
  /** Proposal diagnostics (only set by the proposal-aware entry point). */
  proposalApplied?: boolean;
  proposalRejected?: WorkflowError;
}

/* ------------------------------ entry ------------------------------ */

/** Deterministic planning entry point (no AI involved). */
export function planWorkflow(input: WorkflowPlanInput): WorkflowPlanOutcome {
  const now = input.now ?? new Date();
  const analysis = analyzeGoalText(input.goal);

  const baseUnderstanding: TaskUnderstanding = {
    goal: analysis.goal,
    kind: TaskKind.Reasoning,
    intents: [],
    expectedOutcome: '',
    contextRequirements: contextRequirementsForIntents([]),
    supported: false,
  };

  if (analysis.refusal) {
    return {
      understanding: {
        ...baseUnderstanding,
        kind: TaskKind.Unsupported,
        reason: analysis.refusal.message,
        errorCode: analysis.refusal.code,
      },
      error: analysis.refusal,
    };
  }

  // A workflow needs at least two clauses and a bounded goal.
  if (analysis.oversized || analysis.clauses.length < 2) {
    return {
      understanding: {
        ...baseUnderstanding,
        kind: analysis.mentionsAction ? TaskKind.Action : TaskKind.Reasoning,
      },
    };
  }

  // Sensitive goals are refused before any step is built: workflows that
  // involve sensitive fields never exist, so nothing can later "try
  // another selector" against them.
  if (hasSensitiveDescriptor(analysis.goal)) {
    const refusal = workflowError('WORKFLOW_SENSITIVE_ACTION');
    return {
      understanding: {
        ...baseUnderstanding,
        kind: TaskKind.Unsupported,
        reason: refusal.message,
        errorCode: refusal.code,
      },
      error: refusal,
    };
  }

  const built = buildStepsFromClauses(analysis.clauses, input, now);
  if (built.error) {
    return {
      understanding: {
        ...baseUnderstanding,
        kind: built.errorCode ? TaskKind.Unsupported : TaskKind.Action,
        reason: built.error.message,
        errorCode: built.error.code,
      },
      error: built.error,
    };
  }
  if (built.fallbackToAction) {
    // Mixed or unsupported phrasing: preserve Phase 4 behavior exactly —
    // the single-action planner (or the reasoning engine) handles it.
    return { understanding: { ...baseUnderstanding, kind: TaskKind.Action } };
  }

  const validated = validateWorkflowSteps(built.steps, input.context);
  if (!validated.ok) {
    const error = validated.error ?? workflowError('WORKFLOW_INVALID');
    return {
      understanding: {
        ...baseUnderstanding,
        kind: TaskKind.Unsupported,
        reason: error.message,
        errorCode: error.code,
      },
      error,
    };
  }

  const workflow = buildWorkflow(built.steps, input, now);
  return {
    understanding: {
      goal: analysis.goal,
      kind: TaskKind.Workflow,
      intents: built.intents,
      expectedOutcome: workflow.expectedOutcome.description,
      contextRequirements: contextRequirementsForIntents(built.intents),
      supported: true,
    },
    workflow,
  };
}

/**
 * Proposal-aware entry point. AI output is schema-validated and may only
 * CONFIRM the deterministic plan's action sequence — anything else is
 * rejected and the deterministic plan (or a typed refusal) is used
 * instead. No AI output ever reaches a preview unchecked.
 */
export function planWorkflowWithProposal(
  proposal: unknown,
  input: WorkflowPlanInput,
): WorkflowPlanOutcome {
  const outcome = planWorkflow(input);
  const rejection = workflowError('WORKFLOW_INVALID');
  const parsed = parseWorkflowProposal(proposal);

  if (parsed === null || !outcome.workflow) {
    return { ...outcome, proposalApplied: false, proposalRejected: rejection };
  }

  const proposedKinds = parsed.steps.map((step) => step.action);
  const plannedKinds = outcome.workflow.steps.map(
    (step) => step.actionPlan.actions[0]?.action.type,
  );
  const matches =
    proposedKinds.length === plannedKinds.length &&
    proposedKinds.every((kind, index) => kind === plannedKinds[index]);

  if (!matches) {
    return { ...outcome, proposalApplied: false, proposalRejected: rejection };
  }
  return { ...outcome, proposalApplied: true };
}

/* ------------------------- clause → steps ------------------------- */

interface BuiltSteps {
  steps: WorkflowStep[];
  intents: WorkflowIntent[];
  error?: WorkflowError;
  /** True when the phrasing is not a supported workflow (fall through). */
  fallbackToAction?: boolean;
  /** True when the error is a refusal that should be surfaced to the user. */
  errorCode?: boolean;
}

function buildStepsFromClauses(
  clauses: readonly GoalClause[],
  input: WorkflowPlanInput,
  now: Date,
): BuiltSteps {
  const steps: WorkflowStep[] = [];
  const intents: WorkflowIntent[] = [];
  let previousQuery: string | null = null;
  let unplannable = 0;

  for (const clause of clauses) {
    if (clause.isReference) {
      const resolution = resolveReferenceStep(previousQuery, input, now, steps.length);
      if (resolution.error) {
        return { steps: [], intents: [], error: resolution.error, errorCode: true };
      }
      if (resolution.step) {
        steps.push(resolution.step);
        intents.push(resolution.step.intent);
        continue;
      }
    }

    const planned = planClause(clause.text, input, now, steps.length);
    if (planned.error) {
      if (planned.hardFailure) {
        return { steps: [], intents: [], error: planned.error, errorCode: true };
      }
      unplannable += 1;
      continue;
    }
    if (planned.step) {
      if (planned.findQuery !== null) previousQuery = planned.findQuery;
      steps.push(planned.step);
      intents.push(planned.step.intent);
    }
  }

  if (unplannable > 0 || steps.length < 2) {
    // Mixed/unsupported phrasing: preserve Phase 4 single-action behavior.
    return { steps: [], intents: [], fallbackToAction: true };
  }

  return { steps, intents };
}

interface ClausePlan {
  step?: WorkflowStep;
  /** The FIND_TEXT query of this clause, when it has one. */
  findQuery: string | null;
  error?: WorkflowError;
  /** True when the clause was action-shaped but invalid (refuse). */
  hardFailure?: boolean;
}

/** The action a clause's leading verb asks for (null = no verb). */
function leadingVerb(clause: string): string | null {
  const lower = clause.toLowerCase().replace(/^please\s+/, '');
  if (/^(find|search for|search|look for|locate)\b/.test(lower)) return 'FIND_TEXT';
  if (/^(scroll)\b/.test(lower)) return 'SCROLL';
  if (/^(read)\b/.test(lower)) return 'READ_PAGE';
  if (/^(click|press|tap|open|follow|go to|visit|navigate to)\b/.test(lower)) {
    return 'CLICK_ELEMENT';
  }
  if (/^(type|enter|fill in|fill|write)\b/.test(lower)) return 'TYPE_TEXT';
  if (/^(select|choose)\b/.test(lower)) return 'SELECT_OPTION';
  return null;
}

/**
 * Plan one clause. Phase 4's planner owns the parsing; the leading verb
 * must agree with the planned action so a workflow step can never come
 * from a mis-parsed clause.
 */
function planClause(
  clause: string,
  input: WorkflowPlanInput,
  now: Date,
  index: number,
): ClausePlan {
  const verb = leadingVerb(clause);
  if (verb === null) return { findQuery: null };

  const planContext: PlanContext = {
    requestId: input.requestId,
    tabId: input.tabId,
    url: input.context.url ?? '',
    contentHash: pageContentDigest(input.context),
  };
  const outcome = planAction(clause, planContext, now);
  const action = outcome.plan?.actions[0]?.action;

  if (outcome.plan && action && action.type === verb) {
    const intent = intentForAction(action.type);
    const step = buildWorkflowStep(action, stepOptions(input, now, index, intent));
    if (step === null) {
      return {
        findQuery: null,
        error: workflowError('WORKFLOW_ACTION_NOT_ALLOWED'),
        hardFailure: true,
      };
    }
    if (
      action.type === 'FIND_TEXT' &&
      !hasEvidenceForQuery(action.query, input.context)
    ) {
      return {
        findQuery: action.query,
        error: workflowError('WORKFLOW_TARGET_NOT_FOUND'),
        hardFailure: true,
      };
    }
    return {
      step,
      findQuery: action.type === 'FIND_TEXT' ? action.query : null,
    };
  }

  // Workflow-only clause: an unquoted find/search goal.
  if (verb === 'FIND_TEXT') {
    const find = parseFindClause(clause);
    if (!find) return { findQuery: null };
    if (!hasEvidenceForQuery(find.query, input.context)) {
      return {
        findQuery: find.query,
        error: workflowError('WORKFLOW_TARGET_NOT_FOUND'),
        hardFailure: true,
      };
    }
    const step = buildWorkflowStep(
      { type: 'FIND_TEXT', query: find.query },
      stepOptions(input, now, index, 'FIND'),
    );
    if (step === null) {
      return {
        findQuery: find.query,
        error: workflowError('WORKFLOW_ACTION_NOT_ALLOWED'),
        hardFailure: true,
      };
    }
    return { step, findQuery: find.query };
  }

  // Not plannable (e.g. an incomplete click clause): not workflow material.
  return { findQuery: null };
}

function stepOptions(
  input: WorkflowPlanInput,
  now: Date,
  index: number,
  intent: WorkflowIntent,
  extras: Partial<StepBuildOptions> = {},
): StepBuildOptions {
  return {
    index,
    intent,
    requestId: input.requestId,
    tabId: input.tabId,
    url: input.context.url ?? '',
    contentHash: pageContentDigest(input.context),
    now,
    ...extras,
  };
}

/**
 * Resolve a result-reference clause ("…and open the relevant result")
 * against the captured links. Requires a unique best match — ties are
 * reported as ambiguous; nothing is ever chosen at random.
 */
function resolveReferenceStep(
  previousQuery: string | null,
  input: WorkflowPlanInput,
  now: Date,
  index: number,
): { step?: WorkflowStep; error?: WorkflowError } {
  if (previousQuery === null || previousQuery.length === 0) {
    return { error: workflowError('WORKFLOW_TARGET_NOT_FOUND') };
  }

  const resolution = resolveLinkForQuery(previousQuery, input.context.links);
  if (resolution.kind === 'none') {
    return { error: workflowError('WORKFLOW_TARGET_NOT_FOUND') };
  }
  if (resolution.kind === 'ambiguous') {
    return { error: workflowError('WORKFLOW_TARGET_AMBIGUOUS') };
  }

  return referenceStepFor(resolution.link, input, now, index);
}

/** Build the navigation step for a resolved reference (exported for replan). */
export function referenceStepFor(
  link: PageLink,
  input: WorkflowPlanInput,
  now: Date,
  index: number,
): { step?: WorkflowStep; error?: WorkflowError } {
  const expected = parseSafeUrl(link.url);
  if (expected === null) {
    return { error: workflowError('WORKFLOW_TARGET_NOT_FOUND') };
  }
  const step = buildWorkflowStep(
    {
      type: 'CLICK_ELEMENT',
      target: { kind: 'role', role: 'link', name: link.text },
    },
    stepOptions(input, now, index, 'OPEN', {
      label: `Open “${link.text}”`,
      expectsNavigation: true,
      expectedUrl: expected.href,
    }),
  );
  if (step === null) {
    return { error: workflowError('WORKFLOW_ACTION_NOT_ALLOWED') };
  }
  return { step };
}

/* --------------------------- link matching -------------------------- */

export type LinkResolution =
  | { kind: 'resolved'; link: PageLink }
  | { kind: 'none' }
  | { kind: 'ambiguous' };

const GENERIC_QUERY_NOUNS: ReadonlySet<string> = new Set([
  'link',
  'links',
  'result',
  'results',
  'match',
  'matches',
  'item',
  'items',
  'button',
  'tab',
  'page',
  'element',
  'text',
  'one',
]);

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deterministic link resolution: unique strongest match or nothing.
 * Matching is tiered so an exact match always beats a partial one, and
 * only safe http/https links are ever considered.
 */
export function resolveLinkForQuery(
  query: string,
  links: readonly PageLink[],
): LinkResolution {
  const normalizedQuery = normalize(query);
  if (normalizedQuery.length === 0) return { kind: 'none' };
  const tokens = normalizedQuery
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !GENERIC_QUERY_NOUNS.has(token));

  const scored: Array<{ link: PageLink; score: number }> = [];

  for (const link of links) {
    if (link.text.trim().length === 0) continue;
    if (parseSafeUrl(link.url) === null) continue; // no javascript:/data: links

    const text = normalize(link.text);
    const url = normalize(link.url);
    const matchedTokens = tokens.filter(
      (token) => text.includes(token) || url.includes(token),
    ).length;

    let tier = 0;
    if (text === normalizedQuery) tier = 4;
    else if (text.includes(normalizedQuery)) tier = 3;
    else if (tokens.length > 0 && matchedTokens === tokens.length) tier = 3;
    else if (matchedTokens > 0) tier = 2;

    if (tier === 0) continue;
    scored.push({ link, score: tier * 10 + matchedTokens });
  }

  if (scored.length === 0) return { kind: 'none' };
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  if (!best) return { kind: 'none' };
  if (second && second.score === best.score) return { kind: 'ambiguous' };
  return { kind: 'resolved', link: best.link };
}

/** Planning-time evidence: does the query appear in the captured page? */
export function hasEvidenceForQuery(
  query: string,
  context: PageContext,
): boolean {
  const needle = normalize(query);
  if (needle.length < 2) return false;
  const haystacks: string[] = [
    context.title ?? '',
    context.description ?? '',
    ...context.headings.map((heading) => heading.text),
    ...context.paragraphs,
    context.selectedText ?? '',
    ...context.links.map((link) => `${link.text} ${link.url}`),
  ];
  return haystacks.some((value) => normalize(value).includes(needle));
}

/** Sensitive-goal check (delegates to the Phase 4 classifier). */
function hasSensitiveDescriptor(text: string): boolean {
  return isSensitiveField({ descriptors: text });
}

/* --------------------------- find clauses --------------------------- */

/** Workflow-only find clause: 'Find the React documentation on this page'. */
export function parseFindClause(clause: string): { query: string } | null {
  const match =
    /^(?:please\s+)?(?:find|search for|search|look for|locate)\s+(.+)$/i.exec(
      clause,
    );
  if (!match) return null;
  let rest = match[1] ?? '';

  const quoted = /["“'‘]([^"”'’]{1,200})["”'’]/.exec(rest);
  if (quoted?.[1]) {
    const query = quoted[1].trim();
    return query.length >= 2 && query.length <= ACTION_LIMITS.MAX_FIND_QUERY
      ? { query }
      : null;
  }

  rest = rest
    .replace(
      /\s+(?:on|in|from|within|across)\s+(?:this|the|my|current)\s+(?:page|site|website|document|screen|tab)\b.*$/i,
      '',
    )
    .replace(/\s+(?:here|on this page|on the page)\b.*$/i, '')
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/[.!?]+$/, '')
    .trim();

  // Drop a trailing generic noun ("the pricing link" → "pricing") so the
  // find step matches real page text rather than UI vocabulary.
  const words = rest.split(' ');
  while (words.length > 1) {
    const last = words[words.length - 1] ?? '';
    if (!GENERIC_QUERY_NOUNS.has(normalize(last))) break;
    words.pop();
  }
  const query = words.join(' ').trim();

  if (query.length < 2 || query.length > ACTION_LIMITS.MAX_FIND_QUERY) return null;
  return { query };
}

/* ---------------------------- workflow ----------------------------- */

function intentForAction(kind: string): WorkflowIntent {
  switch (kind) {
    case 'FIND_TEXT':
      return 'FIND';
    case 'CLICK_ELEMENT':
      return 'OPEN';
    case 'TYPE_TEXT':
      return 'TYPE';
    case 'SELECT_OPTION':
      return 'SELECT';
    case 'SCROLL':
      return 'SCROLL';
    default:
      return 'READ';
  }
}

/** Human description of what the workflow promises to achieve. */
export function describeExpectedOutcome(
  steps: readonly WorkflowStep[],
): WorkflowOutcomeSpec {
  const openStep = steps.find((step) => step.expectsNavigation);
  if (openStep) {
    const action = openStep.actionPlan.actions[0]?.action;
    const name =
      action && action.type === 'CLICK_ELEMENT' && action.target.kind === 'role'
        ? action.target.name
        : null;
    const url = parseSafeUrl(openStep.expectedUrl ?? '');
    const description = name
      ? `Open “${name}”${url ? ` on ${url.hostname}` : ''}.`
      : 'Open the identified result.';
    return {
      kind: WorkflowOutcomeKind.Navigation,
      description: description.slice(0, WORKFLOW_LIMITS.MAX_OUTCOME_DESCRIPTION),
      ...(url ? { expectedUrl: url.href } : {}),
    };
  }

  const findStep = steps.find((step) => step.intent === 'FIND');
  const readStep = steps.find((step) => step.intent === 'READ');
  if (findStep) {
    const action = findStep.actionPlan.actions[0]?.action;
    const query = action && action.type === 'FIND_TEXT' ? action.query : '';
    const description = readStep
      ? `Find “${query}” and read the page.`
      : `Find “${query}” on the page.`;
    return {
      kind: WorkflowOutcomeKind.Content,
      description: description.slice(0, WORKFLOW_LIMITS.MAX_OUTCOME_DESCRIPTION),
      ...(query ? { expectedText: query } : {}),
    };
  }

  const mutating = steps.some(
    (step) =>
      step.intent === 'TYPE' || step.intent === 'SELECT' || step.intent === 'SCROLL',
  );
  return {
    kind: mutating ? WorkflowOutcomeKind.Interaction : WorkflowOutcomeKind.ReadOnly,
    description: (readStep
      ? 'Read the requested page content.'
      : mutating
        ? 'Complete the requested page actions.'
        : describeOutcomeForIntents('this page', steps.map((s) => s.intent))
    ).slice(0, WORKFLOW_LIMITS.MAX_OUTCOME_DESCRIPTION),
  };
}

/** Build the bounded, hashed workflow record from validated steps. */
export function buildWorkflow(
  steps: readonly WorkflowStep[],
  input: WorkflowPlanInput,
  now: Date,
): Workflow {
  const orderedSteps = steps.map((step, index) => ({ ...step, index }));
  const risk = combinedWorkflowRisk(orderedSteps);
  const expectedOutcome = describeExpectedOutcome(orderedSteps);
  const url = input.context.url ?? '';
  const contentHash = pageContentDigest(input.context);
  const goal = analyzeGoalText(input.goal).goal;

  const hashInput = {
    goal,
    steps: orderedSteps,
    risk,
    tabId: input.tabId,
    url,
    contentHash,
    expectedOutcome,
  };

  return {
    workflowId: createRequestId('wf'),
    requestId: input.requestId,
    goal,
    steps: orderedSteps,
    currentStepIndex: 0,
    // Stored as DRAFT; the store validates it into PREVIEW and then into
    // AWAITING_APPROVAL through the state machine.
    status: WorkflowStatus.Draft,
    risk,
    // Every workflow needs explicit approval — there is no trust switch.
    requiresConfirmation: true,
    maxSteps: WORKFLOW_LIMITS.MAX_WORKFLOW_STEPS,
    expectedOutcome,
    tabId: input.tabId,
    url,
    contentHash,
    workflowHash: computeWorkflowHash(hashInput),
    createdAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + WORKFLOW_LIMITS.WORKFLOW_TTL_MS,
    ).toISOString(),
    revision: 0,
  };
}
