import { describe, expect, it } from 'vitest';
import {
  applyWorkflowEvent,
  canApplyWorkflowEvent,
  isTerminalWorkflowStatus,
  nextWorkflowStatus,
  transition,
  WorkflowEvent,
} from '../machine';
import { TERMINAL_WORKFLOW_STATUSES, WorkflowStatus } from '../types';

const ALL_STATUSES = Object.values(WorkflowStatus);

describe('workflow state machine', () => {
  it('drives the happy path from draft to completed', () => {
    const workflow = { status: WorkflowStatus.Draft as WorkflowStatus };
    const path: Array<[WorkflowEvent, WorkflowStatus]> = [
      [WorkflowEvent.Validate, WorkflowStatus.Preview],
      [WorkflowEvent.Present, WorkflowStatus.AwaitingApproval],
      [WorkflowEvent.Approve, WorkflowStatus.Approved],
      [WorkflowEvent.Start, WorkflowStatus.Running],
      [WorkflowEvent.BeginVerification, WorkflowStatus.Verifying],
      [WorkflowEvent.Complete, WorkflowStatus.Completed],
    ];
    for (const [event, expected] of path) {
      expect(applyWorkflowEvent(workflow, event)).toBe(true);
      expect(workflow.status).toBe(expected);
    }
  });

  it('can never reach RUNNING without passing approval', () => {
    for (const status of [
      WorkflowStatus.Draft,
      WorkflowStatus.Preview,
      WorkflowStatus.AwaitingApproval,
    ]) {
      expect(nextWorkflowStatus(status, WorkflowEvent.Start)).toBeNull();
      expect(canApplyWorkflowEvent(status, WorkflowEvent.Start)).toBe(false);
    }
    expect(transition(WorkflowStatus.Approved, WorkflowEvent.Start)).toBe(
      WorkflowStatus.Running,
    );
  });

  it('supports pause and resume without losing the approval', () => {
    const workflow = { status: WorkflowStatus.Running as WorkflowStatus };
    expect(applyWorkflowEvent(workflow, WorkflowEvent.Pause)).toBe(true);
    expect(workflow.status).toBe(WorkflowStatus.Paused);
    expect(applyWorkflowEvent(workflow, WorkflowEvent.Resume)).toBe(true);
    expect(workflow.status).toBe(WorkflowStatus.Running);
    // A paused workflow can also be cancelled or expire.
    expect(
      nextWorkflowStatus(WorkflowStatus.Paused, WorkflowEvent.Cancel),
    ).toBe(WorkflowStatus.Cancelled);
    expect(
      nextWorkflowStatus(WorkflowStatus.Paused, WorkflowEvent.Expire),
    ).toBe(WorkflowStatus.Expired);
  });

  it('allows stop conditions from a running workflow', () => {
    const stops: Array<[WorkflowEvent, WorkflowStatus]> = [
      [WorkflowEvent.PartiallyComplete, WorkflowStatus.Partial],
      [WorkflowEvent.Fail, WorkflowStatus.Failed],
      [WorkflowEvent.Block, WorkflowStatus.Blocked],
      [WorkflowEvent.Cancel, WorkflowStatus.Cancelled],
      [WorkflowEvent.Stale, WorkflowStatus.Stale],
      [WorkflowEvent.Expire, WorkflowStatus.Expired],
    ];
    for (const [event, expected] of stops) {
      expect(nextWorkflowStatus(WorkflowStatus.Running, event)).toBe(expected);
      expect(nextWorkflowStatus(WorkflowStatus.Verifying, event)).toBe(expected);
    }
  });

  it('treats every stop status as terminal with no outgoing edges', () => {
    expect(TERMINAL_WORKFLOW_STATUSES).toEqual([
      WorkflowStatus.Completed,
      WorkflowStatus.Partial,
      WorkflowStatus.Failed,
      WorkflowStatus.Blocked,
      WorkflowStatus.Cancelled,
      WorkflowStatus.Stale,
      WorkflowStatus.Expired,
    ]);
    for (const status of TERMINAL_WORKFLOW_STATUSES) {
      expect(isTerminalWorkflowStatus(status)).toBe(true);
      const workflow = { status };
      for (const event of Object.values(WorkflowEvent)) {
        expect(canApplyWorkflowEvent(status, event)).toBe(false);
        expect(applyWorkflowEvent(workflow, event)).toBe(false);
      }
      expect(workflow.status).toBe(status);
    }
  });

  it('leaves the status untouched when a transition is invalid', () => {
    const workflow = { status: WorkflowStatus.Preview as WorkflowStatus };
    expect(applyWorkflowEvent(workflow, WorkflowEvent.Start)).toBe(false);
    expect(workflow.status).toBe(WorkflowStatus.Preview);
    expect(canApplyWorkflowEvent(WorkflowStatus.Draft, WorkflowEvent.Resume)).toBe(
      false,
    );
  });

  it('knows every status in the vocabulary', () => {
    expect(ALL_STATUSES).toHaveLength(14);
    // Running and Verifying are not terminal; Paused is not terminal.
    expect(isTerminalWorkflowStatus(WorkflowStatus.Running)).toBe(false);
    expect(isTerminalWorkflowStatus(WorkflowStatus.Verifying)).toBe(false);
    expect(isTerminalWorkflowStatus(WorkflowStatus.Paused)).toBe(false);
  });
});
