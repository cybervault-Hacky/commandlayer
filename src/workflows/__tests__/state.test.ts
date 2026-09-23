import { beforeEach, describe, expect, it } from 'vitest';
import { WORKFLOW_LIMITS } from '../limits';
import { WorkflowEvent } from '../machine';
import { toWorkflowView, WorkflowStore } from '../state';
import { WorkflowStatus, WorkflowStepStatus, WorkflowEventType } from '../types';
import { planFor, requireWorkflow, FIXTURE_TAB_ID } from './fixtures';

const FIXED = Date.parse('2026-01-01T00:00:00.000Z');
const clock = { now: FIXED };

function makeStore(): WorkflowStore {
  const store = new WorkflowStore();
  store.setClock(() => clock.now);
  return store;
}

function workflowFor(goal = 'find "React documentation" and read the page') {
  return requireWorkflow(planFor(goal));
}

beforeEach(() => {
  clock.now = FIXED;
});

describe('session-scoped workflow store', () => {
  it('validates a new workflow into AWAITING_APPROVAL with a bounded transcript', () => {
    const store = makeStore();
    const workflow = workflowFor();
    const record = store.create(workflow);

    expect(record.workflow.status).toBe(WorkflowStatus.AwaitingApproval);
    expect(record.events.map((event) => event.type)).toEqual([
      WorkflowEventType.Created,
      WorkflowEventType.Validated,
      WorkflowEventType.Previewed,
    ]);
    // The stored record is a copy: caller mutations cannot retarget it.
    expect(record.workflow).not.toBe(workflow);
  });

  it('binds exactly one approval hash, once', () => {
    const store = makeStore();
    const workflow = workflowFor();
    const record = store.create(workflow);

    expect(record.approvedHash).toBeUndefined();
    expect(store.approve(workflow.workflowId, workflow.workflowHash)).toBe(true);
    expect(store.approvalFor(workflow.workflowId)).toMatchObject({
      hash: workflow.workflowHash,
      at: FIXED,
    });
    expect(record.workflow.approvedAt).toBeDefined();
    // Single use: a second approval (or a different hash) is refused.
    expect(store.approve(workflow.workflowId, workflow.workflowHash)).toBe(false);
    expect(store.approve(workflow.workflowId, 'other-hash')).toBe(false);
  });

  it('refuses illegal transitions instead of applying them', () => {
    const store = makeStore();
    const workflow = workflowFor();
    store.create(workflow);

    // No path from PR... AWAITING_APPROVAL straight to RUNNING.
    expect(store.apply(workflow.workflowId, WorkflowEvent.Start)).toBe(false);
    expect(store.get(workflow.workflowId)?.workflow.status).toBe(
      WorkflowStatus.AwaitingApproval,
    );
    expect(store.apply('unknown-workflow', WorkflowEvent.Start)).toBe(false);
  });

  it('marks terminal statuses with a finish time', () => {
    const store = makeStore();
    const workflow = workflowFor();
    store.create(workflow);
    expect(store.apply(workflow.workflowId, WorkflowEvent.Cancel)).toBe(true);
    const record = store.get(workflow.workflowId);
    expect(record?.workflow.status).toBe(WorkflowStatus.Cancelled);
    expect(record?.workflow.finishedAt).toBeDefined();
  });

  it('keeps one running workflow per tab', () => {
    const store = makeStore();
    const first = workflowFor();
    const second = workflowFor('find "Getting started" and read the page');
    store.create(first);
    store.create(second);

    expect(store.claimTab(first.workflowId, FIXTURE_TAB_ID)).toEqual({ ok: true });
    store.apply(first.workflowId, WorkflowEvent.Approve);
    store.apply(first.workflowId, WorkflowEvent.Start);

    expect(store.runningWorkflowForTab(FIXTURE_TAB_ID)?.workflow.workflowId).toBe(
      first.workflowId,
    );
    expect(store.claimTab(second.workflowId, FIXTURE_TAB_ID)).toEqual({
      ok: false,
      conflictWorkflowId: first.workflowId,
    });

    store.releaseTab(first.workflowId);
    expect(store.runningWorkflowForTab(FIXTURE_TAB_ID)).toBeUndefined();
    expect(store.claimTab(second.workflowId, FIXTURE_TAB_ID)).toEqual({ ok: true });
  });

  it('expires workflows that outlive their session budget', () => {
    const store = makeStore();
    const workflow = workflowFor();
    store.create(workflow);

    clock.now = FIXED + WORKFLOW_LIMITS.WORKFLOW_TTL_MS + 1;
    const record = store.get(workflow.workflowId);
    expect(record?.workflow.status).toBe(WorkflowStatus.Expired);
    expect(record?.events.at(-1)?.message).toContain('expired');
    // Nothing can be approved after expiry.
    expect(store.approvalFor(workflow.workflowId)).toBeUndefined();
  });

  it('bounds the transcript ring', () => {
    const store = makeStore();
    const workflow = workflowFor();
    store.create(workflow);
    for (let i = 0; i < WORKFLOW_LIMITS.MAX_EVENTS + 20; i += 1) {
      store.appendEvent(workflow.workflowId, {
        type: WorkflowEventType.Observation,
        at: new Date(clock.now).toISOString(),
        message: `observation ${i}`,
      });
    }
    const events = store.events(workflow.workflowId);
    expect(events.length).toBe(WORKFLOW_LIMITS.MAX_EVENTS);
    expect(events.at(-1)?.message).toBe(`observation ${WORKFLOW_LIMITS.MAX_EVENTS + 19}`);
  });

  it('keeps the record count bounded', () => {
    const store = makeStore();
    for (let i = 0; i < 40; i += 1) {
      const workflow = workflowFor();
      workflow.workflowId = `wf-${i}`;
      store.create(workflow);
    }
    expect(store.size()).toBeLessThanOrEqual(25);
    expect(store.pendingCount()).toBeLessThanOrEqual(
      WORKFLOW_LIMITS.MAX_PENDING_WORKFLOWS,
    );
  });

  it('disposes records without keeping history', () => {
    const store = makeStore();
    const workflow = workflowFor();
    store.create(workflow);
    expect(store.has(workflow.workflowId)).toBe(true);
    store.dispose(workflow.workflowId);
    expect(store.has(workflow.workflowId)).toBe(false);
    expect(store.size()).toBe(0);
    store.clear();
    expect(store.pendingCount()).toBe(0);
  });
});

describe('UI projection', () => {
  it('exposes progress, capability flags, and no executable internals', () => {
    const store = makeStore();
    const workflow = workflowFor();
    const record = store.create(workflow);
    const view = toWorkflowView(record);

    expect(view.status).toBe(WorkflowStatus.AwaitingApproval);
    expect(view.canApprove).toBe(true);
    expect(view.canPause).toBe(false);
    expect(view.canResume).toBe(false);
    expect(view.canCancel).toBe(true);
    expect(view.progress).toEqual({ completed: 0, total: 2 });
    expect(view.workflowHash).toBe(workflow.workflowHash);
    expect(view.steps[0]?.kind).toBe('FIND_TEXT');
    expect(view.steps.every((step) => step.status === WorkflowStepStatus.Pending)).toBe(
      true,
    );

    // Views are projections: no plans, no actions, no page text.
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('actionPlan');
    expect(serialized).not.toContain('planHash');
    expect(serialized).not.toContain('quick');

    store.approve(workflow.workflowId, workflow.workflowHash);
    const approved = toWorkflowView(store.get(workflow.workflowId)!);
    expect(approved.approved).toBe(true);
    expect(approved.canApprove).toBe(true);

    store.apply(workflow.workflowId, WorkflowEvent.Approve);
    store.apply(workflow.workflowId, WorkflowEvent.Start);
    const running = toWorkflowView(store.get(workflow.workflowId)!);
    expect(running.canPause).toBe(true);
    expect(running.canApprove).toBe(false);

    store.apply(workflow.workflowId, WorkflowEvent.Cancel);
    const cancelled = toWorkflowView(store.get(workflow.workflowId)!);
    expect(cancelled.canCancel).toBe(false);
    expect(cancelled.status).toBe(WorkflowStatus.Cancelled);
  });
});
