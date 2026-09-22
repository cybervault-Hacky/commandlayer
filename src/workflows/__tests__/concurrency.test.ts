import { beforeEach, describe, expect, it } from 'vitest';
import { ACTION_LIMITS } from '@/actions/limits';
import { WORKFLOW_LIMITS } from '../limits';
import { WorkflowEngine } from '../orchestrator';
import { workflowSessionStore } from '../state';
import { workflowSessions } from '../session';
import type { WorkflowEnvironment } from '../orchestrator';
import { WorkflowStatus, type Workflow } from '../types';
import {
  FakeWorkflowEnv,
  FIXTURE_TAB_ID,
  FIXTURE_URL,
  makePageContext,
  sample,
} from './fixtures';

const FIXED = Date.parse('2026-01-01T00:00:00.000Z');
const clock = { now: FIXED };

const READ_GOAL = 'find "React documentation" and read the page';

/** Wrap an environment so a hook runs right before each step executes. */
function withExecuteHook(
  env: FakeWorkflowEnv,
  hook: () => void,
): WorkflowEnvironment {
  return {
    getActiveTab: () => env.getActiveTab(),
    capture: (sections) => env.capture(sections),
    authorizeStep: (plan) => env.authorizeStep(plan),
    executeStep: async (planId, planHash) => {
      hook();
      return env.executeStep(planId, planHash);
    },
  };
}

let workflowIdToPause = '';

function makeEngine(env: FakeWorkflowEnv): WorkflowEngine {
  return new WorkflowEngine({
    env,
    store: workflowSessionStore,
    sessions: workflowSessions,
    now: () => clock.now,
    replanner: null,
  });
}

function createWorkflow(engine: WorkflowEngine, goal: string): Workflow {
  const outcome = engine.create({
    requestId: 'req-1',
    goal,
    context: makePageContext(),
    tabId: FIXTURE_TAB_ID,
  });
  if (!outcome.workflow) throw new Error('expected a workflow');
  return outcome.workflow;
}

beforeEach(() => {
  clock.now = FIXED;
  workflowSessionStore.clear();
  workflowSessionStore.setClock(() => clock.now);
  workflowSessions.clear();
  workflowSessions.setClock(() => clock.now);
  workflowIdToPause = '';
});

describe('one workflow per tab', () => {
  it('refuses a second workflow while another holds the tab', async () => {
    const env = new FakeWorkflowEnv({
      observations: [sample(FIXTURE_URL, 'h1'), sample(FIXTURE_URL, 'h2')],
    });
    const engine = makeEngine(env);
    const first = createWorkflow(engine, READ_GOAL);
    workflowIdToPause = first.workflowId;

    // Pause the first workflow during its first step: it keeps the tab.
    const pausing = new WorkflowEngine({
      env: withExecuteHook(env, () => {
        engine.pause(workflowIdToPause);
      }),
      store: workflowSessionStore,
      sessions: workflowSessions,
      now: () => clock.now,
      replanner: null,
    });

    const paused = await pausing.approve({
      workflowId: first.workflowId,
      workflowHash: first.workflowHash,
    });
    expect(paused.ok && paused.snapshot.workflow.status).toBe(WorkflowStatus.Paused);

    const second = createWorkflow(engine, READ_GOAL);
    const conflict = await pausing.approve({
      workflowId: second.workflowId,
      workflowHash: second.workflowHash,
    });

    expect(conflict).toMatchObject({ ok: false, error: { code: 'WORKFLOW_CONFLICT' } });
    expect(workflowSessionStore.get(second.workflowId)?.workflow.status).toBe(
      WorkflowStatus.AwaitingApproval,
    );
    // Only the find step of the first workflow ran; nothing of the second.
    expect(env.executedPlans).toHaveLength(1);
  });

  it('rejects a control message that arrives twice', async () => {
    const env = new FakeWorkflowEnv({
      observations: [sample(FIXTURE_URL, 'h1'), sample(FIXTURE_URL, 'h2')],
    });
    const engine = makeEngine(env);
    const workflow = createWorkflow(engine, READ_GOAL);
    await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });

    // A replayed approval (double tap, retry, duplicated message) is
    // rejected rather than re-run.
    const replay = await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });
    expect(replay).toMatchObject({
      ok: false,
      error: { code: 'WORKFLOW_ALREADY_COMPLETED' },
    });
    expect(env.executedPlans).toHaveLength(2);

    const cancelAfterFinish = engine.cancel(workflow.workflowId);
    expect(cancelAfterFinish).toMatchObject({
      ok: false,
      error: { code: 'WORKFLOW_ALREADY_COMPLETED' },
    });
  });
});

describe('run budgets', () => {
  it('bounds context refreshes across a run', () => {
    workflowSessions.begin('wf-budget', FIXTURE_TAB_ID);
    for (let i = 0; i < WORKFLOW_LIMITS.MAX_CONTEXT_REFRESHES; i += 1) {
      expect(workflowSessions.consumeRefresh('wf-budget')).toEqual({ ok: true });
    }
    expect(workflowSessions.consumeRefresh('wf-budget')).toEqual({
      ok: false,
      reason: 'CONTEXT_REFRESH_LIMIT',
    });
  });

  it('bounds retries and replans across a run', () => {
    workflowSessions.begin('wf-budget', FIXTURE_TAB_ID);
    expect(workflowSessions.consumeRetry('wf-budget')).toEqual({ ok: true });
    expect(workflowSessions.consumeRetry('wf-budget')).toEqual({
      ok: false,
      reason: 'RETRY_LIMIT',
    });
    expect(workflowSessions.canReplan('wf-budget')).toBe(true);
    workflowSessions.recordReplan('wf-budget');
    expect(workflowSessions.canReplan('wf-budget')).toBe(false);
  });

  it('bounds the wall-clock lifetime of a run', () => {
    workflowSessions.begin('wf-clock', FIXTURE_TAB_ID);
    expect(workflowSessions.withinDeadline('wf-clock')).toBe(true);
    clock.now = FIXED + WORKFLOW_LIMITS.MAX_WORKFLOW_DURATION_MS + 1;
    expect(workflowSessions.withinDeadline('wf-clock')).toBe(false);
    expect(workflowSessions.consumeRefresh('unknown-workflow')).toEqual({
      ok: false,
      reason: 'UNKNOWN_WORKFLOW',
    });
  });

  it('stops the run when the refresh budget is exhausted', async () => {
    const env = new FakeWorkflowEnv({
      observations: [sample(FIXTURE_URL, 'h1')],
    });
    const engine = makeEngine(env);
    const workflow = createWorkflow(engine, READ_GOAL);

    // Pre-exhaust the run budget, then approve: the engine must refuse to
    // observe and stop instead of continuing blind.
    const guard = workflowSessions.begin(workflow.workflowId, FIXTURE_TAB_ID);
    for (let i = 0; i < WORKFLOW_LIMITS.MAX_CONTEXT_REFRESHES; i += 1) {
      workflowSessions.consumeRefresh(workflow.workflowId);
    }
    expect(guard.contextRefreshes).toBe(WORKFLOW_LIMITS.MAX_CONTEXT_REFRESHES);

    const result = await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });

    expect(result.ok && result.snapshot.workflow.status).toBe(WorkflowStatus.Stale);
    expect(env.executedPlans).toHaveLength(0);
  });

  it('stops the run when the wall-clock budget runs out mid-step', async () => {
    const env = new FakeWorkflowEnv({
      observations: [sample(FIXTURE_URL, 'h1')],
    });
    const engine = new WorkflowEngine({
      env: withExecuteHook(env, () => {
        clock.now = FIXED + WORKFLOW_LIMITS.MAX_WORKFLOW_DURATION_MS + 1;
      }),
      store: workflowSessionStore,
      sessions: workflowSessions,
      now: () => clock.now,
      replanner: null,
    });
    const workflow = createWorkflow(engine, READ_GOAL);

    const result = await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.workflow.status).toBe(WorkflowStatus.Expired);
    expect(result.snapshot.workflow.summary).toContain('expired');
    // The second step never started.
    expect(env.executedPlans).toHaveLength(1);
  });

  it('keeps Phase 4 plan limits as the execution ceiling', () => {
    // The workflow may not widen what the Action Engine accepts.
    expect(WORKFLOW_LIMITS.MAX_ACTIONS_PER_STEP).toBe(1);
    expect(WORKFLOW_LIMITS.STEP_TIMEOUT_MS).toBeGreaterThanOrEqual(
      ACTION_LIMITS.STEP_TIMEOUT_MS,
    );
    expect(WORKFLOW_LIMITS.MAX_STEP_RETRIES).toBe(1);
    expect(WORKFLOW_LIMITS.MAX_WORKFLOW_REPLANS).toBeLessThanOrEqual(1);
  });
});
