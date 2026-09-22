/**
 * Phase 5 test fixtures: deterministic page contexts, a fake browser
 * environment for the workflow engine, and typed step-result builders.
 *
 * Nothing here touches a real page, a real browser, or a network: the
 * workflow engine is exercised through its injected seams only.
 */
import { actionRegistry } from '@/actions/registry';
import { computePlanHash } from '@/actions/planHash';
import { createRequestId } from '@/shared/messaging/envelope';
import type {
  Action,
  ActionPlan,
  ActionStepResult,
} from '@/actions/types';
import type { ExecutionOutcome } from '@/actions/executor';
import type { PageContext, PageSection } from '@/shared/types/page';
import type { WorkflowEnvironment } from '@/workflows/orchestrator';
import type { ObservationSample } from '@/workflows/observer';
import { planWorkflow, type WorkflowPlanOutcome } from '@/workflows/planner';
import type { Workflow, WorkflowStep } from '@/workflows/types';

export const FIXTURE_TAB_ID = 7;
export const FIXTURE_URL = 'https://example.org/docs';
export const FIXTURE_TARGET_URL = 'https://react.dev/';

export function emptyStats() {
  return {
    textLength: 0,
    wordCount: 0,
    paragraphCount: 0,
    headingCount: 0,
    linkCount: 0,
    tableCount: 0,
    formCount: 0,
    selectedTextLength: 0,
  };
}

/** A small documentation-like page the planner can ground steps against. */
export function makePageContext(
  overrides: Partial<PageContext> = {},
): PageContext {
  const base: PageContext = {
    state: 'ready',
    title: 'React documentation',
    url: FIXTURE_URL,
    hostname: 'example.org',
    description: 'React documentation for building user interfaces.',
    language: 'en',
    headings: [
      { level: 1, text: 'React documentation' },
      { level: 2, text: 'Getting started' },
    ],
    paragraphs: [
      'React documentation for building user interfaces.',
      'Getting started with React is quick.',
    ],
    links: [
      {
        text: 'React documentation',
        url: FIXTURE_TARGET_URL,
        hostname: 'react.dev',
      },
      { text: 'Vue guide', url: 'https://vuejs.org/', hostname: 'vuejs.org' },
    ],
    selectedText: null,
    tables: [],
    forms: [],
    contentStats: {
      textLength: 320,
      wordCount: 48,
      paragraphCount: 2,
      headingCount: 2,
      linkCount: 2,
      tableCount: 0,
      formCount: 0,
      selectedTextLength: 0,
    },
    truncated: false,
    contentHash: 'digest-fixture',
    capturedAt: '2026-01-01T00:00:00.000Z',
  };
  return { ...base, ...overrides };
}

export function planFor(
  goal: string,
  context: PageContext = makePageContext(),
  tabId = FIXTURE_TAB_ID,
): WorkflowPlanOutcome {
  return planWorkflow({
    goal,
    requestId: createRequestId('wreq'),
    context,
    tabId,
    now: new Date('2026-01-01T00:00:00.000Z'),
  });
}

export function requireWorkflow(outcome: WorkflowPlanOutcome): Workflow {
  if (!outcome.workflow) {
    throw new Error(
      `expected a workflow, got error ${outcome.error?.code ?? 'none'} / kind ${outcome.understanding.kind}`,
    );
  }
  return outcome.workflow;
}

/** Build a plan for an arbitrary action list (test-local, real hashes). */
export function makePlan(
  actions: Action[],
  overrides: Partial<ActionPlan> = {},
): ActionPlan {
  const partial: ActionPlan = {
    planId: createRequestId('plan'),
    requestId: 'req-test',
    tabId: FIXTURE_TAB_ID,
    url: FIXTURE_URL,
    contentHash: 'digest-fixture',
    actions: actions.map((action) => ({
      stepId: createRequestId('step'),
      action,
      preview: actionRegistry.definition(action.type).preview(action),
    })),
    risk: actionRegistry.combinedRisk(actions),
    requiresConfirmation: false,
    planHash: '',
    createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    expiresAt: new Date('2026-01-01T00:02:00.000Z').toISOString(),
    ...overrides,
  };
  partial.planHash = computePlanHash(partial);
  return partial;
}

export function stepResult(
  plan: ActionPlan,
  status: ActionStepResult['status'] = 'success',
  data?: ActionStepResult['data'],
): ActionStepResult {
  const planned = plan.actions[0];
  return {
    actionId: planned?.stepId ?? plan.planId,
    kind: planned?.action.type ?? 'READ_PAGE',
    status,
    message:
      status === 'success' ? 'Step completed.' : 'The step did not complete.',
    ...(data ? { data } : {}),
    ...(status === 'success'
      ? { verification: { ok: true, detail: 'Verified.' } }
      : {}),
    durationMs: 3,
  };
}

/** A faithful success/failure outcome for one executed step. */
export function executionOutcomeFor(
  plan: ActionPlan,
  status: ActionStepResult['status'] = 'success',
): ExecutionOutcome {
  const step = plan.actions[0];
  const kind = step?.action.type ?? 'READ_PAGE';
  const data: ActionStepResult['data'] | undefined =
    kind === 'FIND_TEXT'
      ? {
          kind: 'FIND_TEXT',
          matchCount: status === 'success' ? 2 : 0,
          matches: [{ index: 1, snippet: 'React documentation' }],
        }
      : kind === 'READ_PAGE'
        ? {
            kind: 'READ_PAGE',
            title: 'React documentation',
            url: FIXTURE_URL,
            stats: '2 headings · 2 paragraphs · 2 links',
            topHeadings: ['React documentation'],
          }
        : undefined;

  return {
    ok: true,
    result: {
      planId: plan.planId,
      planHash: plan.planHash,
      status: status === 'success' ? 'completed' : 'failed',
      steps: [
        {
          actionId: step?.stepId ?? plan.planId,
          kind,
          status,
          message: status === 'success' ? 'Step completed.' : 'Step failed.',
          ...(data ? { data } : {}),
          ...(status === 'success'
            ? { verification: { ok: true, detail: 'Verified in-page.' } }
            : {}),
          durationMs: 2,
        },
      ],
      ...(status === 'success' ? {} : { stoppedAt: 0 }),
      summary: status === 'success' ? 'Completed one step.' : 'Step failed.',
      startedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      finishedAt: new Date('2026-01-01T00:00:01.000Z').toISOString(),
    },
  };
}

export interface FakeEnvOptions {
  tabId?: number;
  url?: string;
  /** Observations returned in order; the last one repeats. */
  observations?: ObservationSample[];
  /** Page context handed to bounded replans. */
  replanContext?: PageContext | null;
  /** Force a step execution failure. */
  failStep?: boolean;
  /** Block execution of the plan on the first N calls. */
  unauthorized?: boolean;
}

/** A fully in-memory WorkflowEnvironment (no chrome, no DOM). */
export class FakeWorkflowEnv implements WorkflowEnvironment {
  tabId: number;
  url: string;
  observations: ObservationSample[];
  replanContext: PageContext | null;
  failStep: boolean;
  readonly executedPlans: ActionPlan[] = [];
  readonly authorizedPlans: ActionPlan[] = [];
  readonly captureRequests: PageSection[][] = [];
  private observationIndex = 0;
  /** When true, the tab has wandered off (tab binding failure). */
  tabChanged = false;

  constructor(options: FakeEnvOptions = {}) {
    this.tabId = options.tabId ?? FIXTURE_TAB_ID;
    this.url = options.url ?? FIXTURE_URL;
    this.observations = options.observations ?? [];
    this.replanContext = options.replanContext ?? null;
    this.failStep = options.failStep ?? false;
  }

  async getActiveTab(): Promise<{ id: number; url?: string } | null> {
    if (this.tabChanged) return { id: this.tabId + 1, url: this.url };
    return { id: this.tabId, url: this.url };
  }

  async capture(sections: readonly PageSection[]): Promise<PageContext | null> {
    this.captureRequests.push([...sections]);
    if (this.observationIndex >= this.observations.length) {
      return this.replanContext;
    }
    const sample = this.observations[this.observationIndex];
    this.observationIndex += 1;
    if (!sample) return null;
    return makePageContext({ url: sample.url });
  }

  authorizeStep(plan: ActionPlan): boolean {
    this.authorizedPlans.push(plan);
    return true;
  }

  async executeStep(planId: string, planHash: string): Promise<ExecutionOutcome> {
    const plan = this.authorizedPlans.find((entry) => entry.planId === planId);
    if (!plan) {
      return {
        ok: false,
        error: {
          code: 'ACTION_PLAN_UNKNOWN',
          message: 'Unknown plan.',
        },
      };
    }
    if (plan.planHash !== planHash) {
      return {
        ok: false,
        error: {
          code: 'ACTION_PLAN_CHANGED',
          message: 'Plan changed.',
        },
      };
    }
    this.executedPlans.push(plan);
    return executionOutcomeFor(plan, this.failStep ? 'failed' : 'success');
  }
}

/** Convenience: one observation sample for a URL/digest. */
export function sample(
  url: string,
  contentHash: string,
  extra: Partial<ObservationSample> = {},
): ObservationSample {
  return { url, contentHash, headings: ['React documentation'], ...extra };
}

/** Steps as a compact list of action kinds (for order assertions). */
export function kindsOf(workflow: Workflow): string[] {
  return workflow.steps.map((step) => step.actionPlan.actions[0]?.action.type ?? '?');
}

export function stepAt(workflow: Workflow, index: number): WorkflowStep {
  const step = workflow.steps[index];
  if (!step) throw new Error(`no step at index ${index}`);
  return step;
}
