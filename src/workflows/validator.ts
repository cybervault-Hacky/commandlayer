/**
 * Phase 5 — workflow validation: the trust boundary for workflow data.
 *
 * EVERY workflow step — whether produced by the deterministic planner or
 * proposed by an AI model — passes through this module before it may
 * enter a preview:
 *
 *   untrusted candidate
 *     ↓ schema validation      (closed field sets, exact types, bounds)
 *     ↓ action validation      (Phase 4 parseActionCandidate + registry)
 *     ↓ workflow validation    (step count, one action per step, risk
 *                               propagation, sensitive-field blocking)
 *     ↓ preview                (user-facing, nothing executed)
 *
 * There is no bypass: the planner uses the same functions, and the
 * validator refuses anything the Phase 4 action model cannot express.
 * No step may carry code, a selector, or an unregistered action.
 */
import { ACTION_LIMITS } from '@/actions/limits';
import { computePlanHash, hashActions } from '@/actions/planHash';
import { actionRegistry } from '@/actions/registry';
import { isSensitiveField } from '@/actions/sensitive';
import { describeTarget } from '@/actions/targets';
import {
  ActionRisk,
  type Action,
  type ActionPlan,
  type PlannedAction,
} from '@/actions/types';
import { createRequestId } from '@/shared/messaging/envelope';
import type { PageContext } from '@/shared/types/page';
import { WORKFLOW_LIMITS } from './limits';
import { workflowError, type WorkflowError } from './errors';
import { parseActionCandidate } from '@/actions/validator';
import { hashStepActions } from './hash';
import {
  WorkflowStepStatus,
  type ProposedStep,
  type WorkflowProposal,
  type WorkflowIntent,
  type WorkflowStep,
} from './types';

/** Fields a proposal may carry. Anything else rejects the whole proposal. */
const PROPOSAL_FIELDS: ReadonlySet<string> = new Set(['goal', 'steps']);
const PROPOSED_STEP_FIELDS: ReadonlySet<string> = new Set(['action', 'label']);

/**
 * Keys that must never appear anywhere in a workflow payload — these are
 * the shapes executable-content smuggling takes. Their presence rejects
 * the candidate outright.
 */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  'code',
  'script',
  'javascript',
  'selector',
  'xpath',
  'css',
  'eval',
  'exec',
  'command',
  'shell',
  'html',
  'url',
  'href',
  'src',
  'function',
  'payload',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse an UNTRUSTED workflow proposal (e.g. AI output) into a strict
 * proposal shape, or null. Schema validation only — a parsed proposal is
 * still not executable: it must also pass action-registry validation and
 * workflow validation (see `planWorkflowWithProposal`).
 */
export function parseWorkflowProposal(value: unknown): WorkflowProposal | null {
  if (!isRecord(value)) return null;
  for (const key of Object.keys(value)) {
    if (!PROPOSAL_FIELDS.has(key)) return null;
    if (FORBIDDEN_KEYS.has(key)) return null;
  }

  const goal = value.goal;
  if (typeof goal !== 'string') return null;
  const trimmedGoal = goal.replace(/\s+/g, ' ').trim();
  if (
    trimmedGoal.length === 0 ||
    trimmedGoal.length > WORKFLOW_LIMITS.MAX_GOAL_LENGTH
  ) {
    return null;
  }

  const steps = value.steps;
  if (!Array.isArray(steps)) return null;
  if (steps.length === 0 || steps.length > WORKFLOW_LIMITS.MAX_WORKFLOW_STEPS) {
    return null;
  }

  const parsed: ProposedStep[] = [];
  for (const step of steps) {
    if (!isRecord(step)) return null;
    for (const key of Object.keys(step)) {
      if (!PROPOSED_STEP_FIELDS.has(key)) return null;
    }
    const action = step.action;
    if (typeof action !== 'string') return null;
    // Action-registry validation: unknown kinds are refused here, before
    // any plan exists. This is what makes EXECUTE_JAVASCRIPT impossible.
    if (!actionRegistry.isRegistered(action)) return null;
    if (step.label !== undefined) {
      if (
        typeof step.label !== 'string' ||
        step.label.trim().length === 0 ||
        step.label.length > WORKFLOW_LIMITS.MAX_STEP_LABEL
      ) {
        return null;
      }
      parsed.push({ action, label: step.label.trim() });
      continue;
    }
    parsed.push({ action });
  }

  return { goal: trimmedGoal, steps: parsed };
}

/** Options shared by every step builder. */
export interface StepBuildOptions {
  index: number;
  intent: WorkflowIntent;
  /** Preview label; generated deterministically from the action. */
  label?: string;
  requestId: string;
  tabId: number;
  url: string;
  contentHash: string;
  expectsNavigation?: boolean;
  expectedUrl?: string;
  now: Date;
}

/**
 * Build one workflow step from an action, through the full validation
 * chain. Returns null when the action is not a registered, valid,
 * limit-respecting Phase 4 action.
 */
export function buildWorkflowStep(
  candidate: unknown,
  options: StepBuildOptions,
): WorkflowStep | null {
  const action = parseActionCandidate(candidate);
  if (action === null) return null;
  if (!actionRegistry.isRegistered(action.type)) return null;

  const planned: PlannedAction = {
    stepId: createRequestId('wstep'),
    action,
    preview: actionRegistry.definition(action.type).preview(action),
  };

  const risk = actionRegistry.combinedRisk([action]);
  const partial: ActionPlan = {
    planId: createRequestId('wplan'),
    requestId: options.requestId,
    tabId: options.tabId,
    url: options.url,
    contentHash: options.contentHash,
    actions: [planned],
    risk,
    requiresConfirmation: risk === ActionRisk.Confirmation,
    planHash: '',
    createdAt: options.now.toISOString(),
    expiresAt: new Date(
      options.now.getTime() + ACTION_LIMITS.PLAN_TTL_MS,
    ).toISOString(),
  };
  partial.planHash = computePlanHash(partial);

  const label = (
    options.label && options.label.length > 0
      ? options.label
      : actionRegistry.definition(action.type).preview(action)
  ).slice(0, WORKFLOW_LIMITS.MAX_STEP_LABEL);

  return {
    stepId: planned.stepId,
    index: options.index,
    intent: options.intent,
    label,
    actionPlan: partial,
    actionsHash: hashStepActions({ actionPlan: partial }),
    retryPolicy: actionRegistry.retryPolicyOf(action),
    expectsNavigation: options.expectsNavigation === true,
    ...(options.expectedUrl ? { expectedUrl: options.expectedUrl } : {}),
    status: WorkflowStepStatus.Pending,
    attempts: 0,
    // Computed from the action kind: read-only steps are never re-observed.
    mutated:
      action.type !== 'READ_PAGE' && action.type !== 'FIND_TEXT',
  };
}

/**
 * Sensitive-field propagation: a workflow that touches a sensitive field
 * is BLOCKED as a whole — it never runs, and no "try another selector"
 * fallback exists. Descriptors come from the user's own target wording
 * (never from page content).
 */
export function describeSensitiveSurface(step: WorkflowStep): string {
  const action = step.actionPlan.actions[0]?.action;
  if (!action) return '';
  switch (action.type) {
    case 'TYPE_TEXT':
      return `${describeTarget(action.target)} ${action.text}`;
    case 'SELECT_OPTION':
      return `${describeTarget(action.target)} ${action.option}`;
    case 'CLICK_ELEMENT':
      return describeTarget(action.target);
    default:
      return '';
  }
}

export function findSensitiveStep(
  steps: readonly WorkflowStep[],
): WorkflowStep | undefined {
  return steps.find((step) => {
    const action = step.actionPlan.actions[0]?.action;
    if (!action) return false;
    if (
      action.type === 'TYPE_TEXT' ||
      action.type === 'SELECT_OPTION' ||
      action.type === 'CLICK_ELEMENT'
    ) {
      return isSensitiveField({ descriptors: describeSensitiveSurface(step) });
    }
    return false;
  });
}

export interface WorkflowValidationResult {
  ok: boolean;
  error?: WorkflowError;
}

/**
 * Workflow-level validation: bounded step count, one action per step,
 * integrity of every step's action identity, and sensitive-field
 * propagation. Applied to planner output AND to AI proposals.
 */
export function validateWorkflowSteps(
  steps: readonly WorkflowStep[],
  context?: PageContext | null,
): WorkflowValidationResult {
  if (steps.length < 2) {
    return {
      ok: false,
      error: workflowError('WORKFLOW_TASK_NOT_SUPPORTED'),
    };
  }
  if (steps.length > WORKFLOW_LIMITS.MAX_WORKFLOW_STEPS) {
    return { ok: false, error: workflowError('WORKFLOW_TOO_MANY_STEPS') };
  }

  for (const step of steps) {
    const actions = step.actionPlan.actions;
    if (actions.length === 0 || actions.length > WORKFLOW_LIMITS.MAX_ACTIONS_PER_STEP) {
      return { ok: false, error: workflowError('WORKFLOW_INVALID') };
    }
    for (const planned of actions) {
      if (!actionRegistry.isRegistered(planned.action.type)) {
        return {
          ok: false,
          error: workflowError('WORKFLOW_ACTION_NOT_ALLOWED'),
        };
      }
    }
    // Integrity: the step's stored action identity must match its plan.
    if (hashActions(actions) !== step.actionsHash) {
      return { ok: false, error: workflowError('WORKFLOW_INVALID') };
    }
    if (computePlanHash(step.actionPlan) !== step.actionPlan.planHash) {
      return { ok: false, error: workflowError('WORKFLOW_INVALID') };
    }
  }

  if (findSensitiveStep(steps)) {
    return { ok: false, error: workflowError('WORKFLOW_SENSITIVE_ACTION') };
  }

  // Page bindings must be consistent (all steps planned against one page).
  if (context) {
    for (const step of steps) {
      if (step.actionPlan.tabId !== steps[0]?.actionPlan.tabId) {
        return { ok: false, error: workflowError('WORKFLOW_INVALID') };
      }
    }
  }

  return { ok: true };
}

/**
 * Highest risk across steps. A workflow can only ever propagate risk
 * upward: read-only + low → low, anything + confirmation → confirmation.
 */
export function combinedWorkflowRisk(
  steps: readonly WorkflowStep[],
): ActionRisk {
  const actions: Action[] = steps.flatMap((step) =>
    step.actionPlan.actions.map((planned) => planned.action),
  );
  if (actions.length === 0) return ActionRisk.ReadOnly;
  return actionRegistry.combinedRisk(actions);
}
