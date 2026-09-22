import { beforeEach, describe, expect, it } from 'vitest';
import type { PageSection } from '@/shared/types/page';
import type { ExecutionOutcome } from '@/actions/executor';
import { WORKFLOW_LIMITS } from '../limits';
import { WorkflowEngine } from '../orchestrator';
import { workflowSessionStore } from '../state';
import { workflowSessions } from '../session';
import { WorkflowStatus, WorkflowStepStatus, type Workflow } from '../types';
import {
  executionOutcomeFor,
  FakeWorkflowEnv,
  FIXTURE_TAB_ID,
  FIXTURE_URL,
  makePageContext,
  sample,
  type FakeEnvOptions,
} from './fixtures';

const FIXED = Date.parse('2026-01-01T00:00:00.000Z');
const clock = { now: FIXED };

const READ_GOAL = 'find "React documentation" and read the page';
const OPEN_GOAL = 'find "React documentation" and open it';

interface ScriptedOptions extends FakeEnvOptions {
  /** Execution indices (0-based) that fail instead of succeeding. */
  failExecutions?: number[];
  /** Runs before one step executes (pause/cancel hooks, call counting). */
  onExecute?: (index: number) => void | Promise<void>;
  /** Observations allowed; later captures return null (unverifiable). */
  stopObservingAfter?: number;
}

class ScriptedEnv extends FakeWorkflowEnv {
  readonly failExecutions: Set<number>;
  readonly onExecute?: (index: number) => void | Promise<void>;
  readonly stopObservingAfter?: number;
  captureCount = 0;

  constructor(options: ScriptedOptions = {}) {
    const { failExecutions, onExecute, stopObservingAfter, ...rest } = options;
    super(rest);
    this.failExecutions = new Set(failExecutions ?? []);
    this.onExecute = onExecute;
    this.stopObservingAfter = stopObservingAfter;
  }

  override async capture(sections: readonly PageSection[]) {
    this.captureCount += 1;
    if (
      this.stopObservingAfter !== undefined &&
      this.captureCount > this.stopObservingAfter
    ) {
      return null;
    }
    return super.capture(sections);
  }

  override async executeStep(
    planId: string,
    planHash: string,
  ): Promise<ExecutionOutcome> {
    const index = this.executedPlans.length;
    await this.onExecute?.(index);
    const outcome = await super.executeStep(planId, planHash);
    if (!outcome.ok) return outcome;
    if (this.failExecutions.has(index)) {
      const plan = this.executedPlans[this.executedPlans.length - 1];
      if (plan) return executionOutcomeFor(plan, 'failed');
    }
    return outcome;
  }
}

function makeEngine(
  env: ScriptedEnv,
  options: { replanner?: null } = {},
): WorkflowEngine {
  return new WorkflowEngine({
    env,
    store: workflowSessionStore,
    sessions: workflowSessions,
    now: () => clock.now,
    replanner: options.replanner ?? null,
    stepTimeoutMs: WORKFLOW_LIMITS.STEP_TIMEOUT_MS,
  });
}

function createWorkflow(
  engine: WorkflowEngine,
  goal: string,
  context = makePageContext(),
): Workflow {
  const outcome = engine.create({
    requestId: 'req-1',
    goal,
    context,
    tabId: FIXTURE_TAB_ID,
  });
  if (!outcome.workflow) {
    throw new Error(`expected a workflow, got ${outcome.error?.code ?? 'none'}`);
  }
  return outcome.workflow;
}

function statusOf(workflowId: string): WorkflowStatus | undefined {
  return workflowSessionStore.get(workflowId)?.workflow.status;
}

beforeEach(() => {
  clock.now = FIXED;
  workflowSessionStore.clear();
  workflowSessionStore.setClock(() => clock.now);
  workflowSessions.clear();
  workflowSessions.setClock(() => clock.now);
});

describe('approval gates execution', () => {
  it('prepares a workflow without executing anything', () => {
    const env = new ScriptedEnv();
    const engine = makeEngine(env);
    const workflow = createWorkflow(engine, READ_GOAL);

    expect(env.executedPlans).toHaveLength(0);
    expect(env.authorizedPlans).toHaveLength(0);
    expect(statusOf(workflow.workflowId)).toBe(WorkflowStatus.AwaitingApproval);
  });

  it('runs an approved workflow step by step to a verified completion', async () => {
    const env = new ScriptedEnv({
      observations: [
        sample(FIXTURE_URL, 'digest-1'),
        sample(FIXTURE_URL, 'digest-2'),
      ],
    });
    const engine = makeEngine(env);
    const workflow = createWorkflow(engine, READ_GOAL);

    const result = await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { workflow: view, run } = result.snapshot;
    expect(view.status).toBe(WorkflowStatus.Completed);
    expect(view.progress).toEqual({ completed: 2, total: 2 });
    expect(view.steps.map((step) => step.status)).toEqual([
      WorkflowStepStatus.Completed,
      WorkflowStepStatus.Completed,
    ]);
    expect(run?.status).toBe(WorkflowStatus.Completed);
    expect(run?.outcome?.verified).toBe(true);
    expect(run?.summary).toContain('Workflow completed');
    expect(env.executedPlans).toHaveLength(2);
    // Every executed plan was authorized under this workflow, one at a time.
    expect(env.authorizedPlans).toHaveLength(2);
    expect(env.authorizedPlans[0]?.actions[0]?.action.type).toBe('FIND_TEXT');
    expect(env.authorizedPlans[1]?.actions[0]?.action.type).toBe('READ_PAGE');
    // Bounded observation: one checkpoint before the first step, one at the
    // final verification — never continuous surveillance.
    expect(env.captureCount).toBe(2);
    expect(env.captureCount).toBeLessThanOrEqual(WORKFLOW_LIMITS.MAX_CONTEXT_REFRESHES);
  });

  it('records a bounded step transcript for the UI', async () => {
    const env = new ScriptedEnv({
      observations: [sample(FIXTURE_URL, 'digest-1'), sample(FIXTURE_URL, 'digest-2')],
    });
    const engine = makeEngine(env);
    const workflow = createWorkflow(engine, READ_GOAL);
    await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });

    const view = workflowSessionStore.get(workflow.workflowId);
    const types = view?.events.map((event) => event.type) ?? [];
    expect(types).toContain('WORKFLOW_APPROVED');
    expect(types).toContain('STEP_STARTED');
    expect(types).toContain('STEP_COMPLETED');
    expect(types).toContain('WORKFLOW_OBSERVATION');
    expect(types).toContain('WORKFLOW_COMPLETED');
    expect(types.length).toBeLessThanOrEqual(WORKFLOW_LIMITS.MAX_EVENTS);
  });

  it('rejects a workflow hash the user did not review', async () => {
    const env = new ScriptedEnv({ observations: [sample(FIXTURE_URL, 'h1')] });
    const engine = makeEngine(env);
    const workflow = createWorkflow(engine, READ_GOAL);

    const result = await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: 'not-the-reviewed-hash',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'WORKFLOW_APPROVAL_MISMATCH' },
    });
    expect(env.executedPlans).toHaveLength(0);
    expect(statusOf(workflow.workflowId)).toBe(WorkflowStatus.AwaitingApproval);
  });

  it('refuses a duplicate approval of a finished workflow', async () => {
    const env = new ScriptedEnv({
      observations: [sample(FIXTURE_URL, 'h1'), sample(FIXTURE_URL, 'h2')],
    });
    const engine = makeEngine(env);
    const workflow = createWorkflow(engine, READ_GOAL);
    const input = {
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    };

    await engine.approve(input);
    const again = await engine.approve(input);

    expect(again).toMatchObject({ ok: false, error: { code: 'WORKFLOW_ALREADY_COMPLETED' } });
    expect(env.executedPlans).toHaveLength(2);
  });

  it('expires a stale approval instead of replaying it', async () => {
    const env = new ScriptedEnv({ observations: [sample(FIXTURE_URL, 'h1')] });
    const engine = makeEngine(env);
    const workflow = createWorkflow(engine, READ_GOAL);

    clock.now = FIXED + WORKFLOW_LIMITS.APPROVAL_TTL_MS + 1;
    const result = await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'WORKFLOW_APPROVAL_EXPIRED' },
    });
    expect(statusOf(workflow.workflowId)).toBe(WorkflowStatus.Expired);
    expect(env.executedPlans).toHaveLength(0);
  });

  it('expires workflows past their session lifetime', async () => {
    const env = new ScriptedEnv({ observations: [sample(FIXTURE_URL, 'h1')] });
    const engine = makeEngine(env);
    const workflow = createWorkflow(engine, READ_GOAL);

    clock.now = FIXED + WORKFLOW_LIMITS.WORKFLOW_TTL_MS + 1;
    const result = await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'WORKFLOW_EXPIRED' } });
    expect(env.executedPlans).toHaveLength(0);
  });
});

describe('stop conditions', () => {
  it('stops before the first step when the tab moved on', async () => {
    const env = new ScriptedEnv({ observations: [sample(FIXTURE_URL, 'h1')] });
    env.tabChanged = true;
    const engine = makeEngine(env);
    const workflow = createWorkflow(engine, READ_GOAL);

    const result = await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'WORKFLOW_TAB_CHANGED' } });
    expect(statusOf(workflow.workflowId)).toBe(WorkflowStatus.Stale);
    expect(env.executedPlans).toHaveLength(0);
  });

  it('stops before the first step when the page changed', async () => {
    const env = new ScriptedEnv({
      observations: [sample('https://elsewhere.example/other', 'h1')],
    });
    const engine = makeEngine(env);
    const workflow = createWorkflow(engine, READ_GOAL);

    const result = await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });

    expect(result.ok && result.snapshot.workflow.status).toBe(WorkflowStatus.Stale);
    if (result.ok) {
      expect(result.snapshot.run?.outcome?.verified).toBe(false);
      expect(result.snapshot.workflow.summary).toContain('page');
    }
    expect(env.executedPlans).toHaveLength(0);
  });

  it('stops when a navigation lands somewhere unexpected', async () => {
    const env = new ScriptedEnv({
      observations: [
        sample(FIXTURE_URL, 'h1'),
        sample('https://evil.example/phish', 'h2'),
      ],
    });
    const engine = makeEngine(env);
    const workflow = createWorkflow(engine, OPEN_GOAL);

    const result = await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.workflow.status).toBe(WorkflowStatus.Stale);
    expect(result.snapshot.workflow.summary).toContain('other than the approved');
    // The workflow never continues past an unexpected navigation.
    expect(env.executedPlans).toHaveLength(2);
    expect(result.snapshot.run?.outcome?.verified).toBe(false);
  });

  it('stops when an expected navigation never happens', async () => {
    const env = new ScriptedEnv({
      observations: [sample(FIXTURE_URL, 'h1'), sample(FIXTURE_URL, 'h2')],
    });
    const engine = makeEngine(env);
    const workflow = createWorkflow(engine, OPEN_GOAL);

    const result = await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.workflow.status).toBe(WorkflowStatus.Stale);
    expect(result.snapshot.workflow.summary).toContain('did not navigate');
  });

  it('stops and keeps completed steps when a step fails', async () => {
    const env = new ScriptedEnv({
      observations: [sample(FIXTURE_URL, 'h1'), sample(FIXTURE_URL, 'h2')],
      failExecutions: [1, 2],
    });
    const engine = makeEngine(env);
    const workflow = createWorkflow(engine, READ_GOAL);

    const result = await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { workflow: view, run } = result.snapshot;
    expect(view.status).toBe(WorkflowStatus.Partial);
    expect(view.progress).toEqual({ completed: 1, total: 2 });
    expect(view.steps[1]?.status).toBe(WorkflowStepStatus.Failed);
    expect(view.steps[1]?.attempts).toBe(2); // one bounded retry, then stop
    expect(run?.stoppedAt).toBe(1);
    expect(run?.outcome?.verified).toBe(false);
    expect(view.summary).toContain('Nothing after it ran');
    // The failed step is never retried past the bound.
    expect(env.executedPlans).toHaveLength(3);
  });

  it('reports PARTIAL when every step ran but the outcome is unverified', async () => {
    const env = new ScriptedEnv({
      observations: [sample(FIXTURE_URL, 'h1'), sample('https://react.dev/', 'h2')],
      stopObservingAfter: 2,
    });
    const engine = makeEngine(env);
    const workflow = createWorkflow(engine, OPEN_GOAL);

    const result = await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { workflow: view, run } = result.snapshot;
    // Never reported as success: actions executed, outcome unverified.
    expect(view.status).toBe(WorkflowStatus.Partial);
    expect(view.status).not.toBe(WorkflowStatus.Completed);
    expect(run?.outcome?.verified).toBe(false);
    expect(view.summary).toContain('could not be verified');
    expect(view.progress.completed).toBe(2);
  });
});

describe('bounded retries', () => {
  it('never retries a step the registry marked NEVER', async () => {
    const env = new ScriptedEnv({
      observations: [sample(FIXTURE_URL, 'h1'), sample(FIXTURE_URL, 'h2')],
      failExecutions: [1],
    });
    const engine = makeEngine(env);
    const workflow = createWorkflow(engine, OPEN_GOAL);

    const result = await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.workflow.steps[1]?.attempts).toBe(1);
    expect(env.executedPlans).toHaveLength(2);
    expect(workflowSessions.get(workflow.workflowId)).toBeUndefined();
  });

  it('retries a retry-safe step exactly once', async () => {
    const env = new ScriptedEnv({
      observations: [sample(FIXTURE_URL, 'h1'), sample(FIXTURE_URL, 'h2')],
      failExecutions: [0],
    });
    const engine = makeEngine(env);
    const workflow = createWorkflow(engine, READ_GOAL);

    const result = await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.workflow.steps[0]?.attempts).toBe(2);
    expect(result.snapshot.workflow.steps[0]?.status).toBe(
      WorkflowStepStatus.Completed,
    );
    expect(result.snapshot.workflow.status).toBe(WorkflowStatus.Completed);
    expect(env.executedPlans).toHaveLength(3);
  });
});

describe('user control', () => {
  it('pauses between steps and resumes exactly where it stopped', async () => {
    let workflowId = '';
    const env = new ScriptedEnv({
      observations: [sample(FIXTURE_URL, 'h1'), sample(FIXTURE_URL, 'h2')],
      onExecute: (index) => {
        if (index === 0) engine.pause(workflowId);
      },
    });
    const engine = makeEngine(env);
    const workflow = createWorkflow(engine, READ_GOAL);
    workflowId = workflow.workflowId;

    const paused = await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });

    expect(paused.ok).toBe(true);
    if (!paused.ok) return;
    expect(paused.snapshot.workflow.status).toBe(WorkflowStatus.Paused);
    expect(paused.snapshot.workflow.progress).toEqual({ completed: 1, total: 2 });
    expect(env.executedPlans).toHaveLength(1);

    const resumed = await engine.resume({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });

    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.snapshot.workflow.status).toBe(WorkflowStatus.Completed);
    // The completed step was never executed again.
    expect(env.executedPlans).toHaveLength(2);
    expect(env.executedPlans[1]?.actions[0]?.action.type).toBe('READ_PAGE');
  });

  it('cancels and prevents every future step', async () => {
    let workflowId = '';
    const env = new ScriptedEnv({
      observations: [sample(FIXTURE_URL, 'h1'), sample(FIXTURE_URL, 'h2')],
      onExecute: (index) => {
        if (index === 0) engine.cancel(workflowId);
      },
    });
    const engine = makeEngine(env);
    const workflow = createWorkflow(engine, READ_GOAL);
    workflowId = workflow.workflowId;

    const result = await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.workflow.status).toBe(WorkflowStatus.Cancelled);
    expect(result.snapshot.workflow.summary).toContain('Cancelled');
    expect(env.executedPlans).toHaveLength(1);
    expect(env.executedPlans[0]?.actions[0]?.action.type).toBe('FIND_TEXT');
    // A cancelled workflow can never be resumed.
    const resume = await engine.resume({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });
    expect(resume).toMatchObject({
      ok: false,
      error: { code: 'WORKFLOW_ALREADY_COMPLETED' },
    });
  });

  it('rejects control messages for unknown workflows', () => {
    const engine = makeEngine(new ScriptedEnv());
    expect(engine.pause('nope')).toMatchObject({
      ok: false,
      error: { code: 'WORKFLOW_UNKNOWN' },
    });
    expect(engine.cancel('nope')).toMatchObject({
      ok: false,
      error: { code: 'WORKFLOW_UNKNOWN' },
    });
    expect(engine.view('nope')).toMatchObject({
      ok: false,
      error: { code: 'WORKFLOW_UNKNOWN' },
    });
  });
});

describe('privacy', () => {
  it('keeps page content, plans, and typed values out of every projection', async () => {
    const env = new ScriptedEnv({
      observations: [sample(FIXTURE_URL, 'h1'), sample(FIXTURE_URL, 'h2')],
    });
    const engine = makeEngine(env);
    const workflow = createWorkflow(engine, READ_GOAL);
    const result = await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = JSON.stringify(result.snapshot);
    expect(serialized).not.toContain('actionPlan');
    expect(serialized).not.toContain('planHash');
    // Unrelated page prose is never captured or echoed.
    expect(serialized).not.toContain('quick');
    for (const step of result.snapshot.workflow.steps) {
      expect(step).not.toHaveProperty('actionPlan');
    }
  });
});

describe('untrusted proposals through the engine', () => {
  it('accepts a proposal only when it matches the deterministic plan', async () => {
    const env = new ScriptedEnv({ observations: [sample(FIXTURE_URL, 'h1')] });
    const engine = makeEngine(env);

    const good = await engine.createFromProposal({
      requestId: 'req-1',
      goal: READ_GOAL,
      context: makePageContext(),
      tabId: FIXTURE_TAB_ID,
      proposal: {
        goal: READ_GOAL,
        steps: [{ action: 'FIND_TEXT' }, { action: 'READ_PAGE' }],
      },
    });
    expect(good.workflow).toBeDefined();

    const evil = await engine.createFromProposal({
      requestId: 'req-2',
      goal: READ_GOAL,
      context: makePageContext(),
      tabId: FIXTURE_TAB_ID,
      proposal: {
        goal: READ_GOAL,
        steps: [{ action: 'EXECUTE_JAVASCRIPT' }],
      },
    });
    // The attack changes nothing: the deterministic plan is still used.
    expect(evil.workflow?.steps.map((step) => step.actionPlan.actions[0]?.action.type)).toEqual(
      ['FIND_TEXT', 'READ_PAGE'],
    );
    expect(env.executedPlans).toHaveLength(0);
  });
});
