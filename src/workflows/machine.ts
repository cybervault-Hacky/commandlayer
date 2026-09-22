/**
 * Phase 5 — explicit workflow state machine.
 *
 * The table below is the ONLY way a workflow's status changes. There is
 * no edge from DRAFT/PREVIEW to RUNNING, so nothing can execute without
 * passing AWAITING_APPROVAL → APPROVED first. Terminal statuses have no
 * outgoing edges at all: a finished workflow can never be resumed.
 */
import {
  WorkflowStatus,
  isTerminalWorkflowStatus,
} from './types';

export { isTerminalWorkflowStatus };

export const WorkflowEvent = {
  /** Draft → Preview: schema + registry + limits validated. */
  Validate: 'VALIDATE',
  /** Preview → AwaitingApproval: preview is ready for the user. */
  Present: 'PRESENT',
  /** AwaitingApproval → Approved: hash-bound, single-use approval. */
  Approve: 'APPROVE',
  /** Approved → Running. */
  Start: 'START',
  /** Running/Verifying → Paused (no new step starts). */
  Pause: 'PAUSE',
  /** Paused → Running (same approval, unchanged hash). */
  Resume: 'RESUME',
  /** Running → Verifying (all steps done). */
  BeginVerification: 'BEGIN_VERIFICATION',
  /** Verifying → Completed (declared outcome verified). */
  Complete: 'COMPLETE',
  /** → Partial (some or all steps ran; outcome not verified). */
  PartiallyComplete: 'PARTIALLY_COMPLETE',
  /** → Failed. */
  Fail: 'FAIL',
  /** → Blocked (a security boundary stopped the run). */
  Block: 'BLOCK',
  /** → Cancelled (the user's stop wins; no future step starts). */
  Cancel: 'CANCEL',
  /** → Stale (page context or tab changed). */
  Stale: 'STALE',
  /** → Expired (TTL elapsed). */
  Expire: 'EXPIRE',
} as const;

export type WorkflowEvent = (typeof WorkflowEvent)[keyof typeof WorkflowEvent];

type Transitions = Partial<Record<WorkflowEvent, WorkflowStatus>>;

const TRANSITIONS: Record<WorkflowStatus, Transitions> = {
  [WorkflowStatus.Draft]: {
    [WorkflowEvent.Validate]: WorkflowStatus.Preview,
    [WorkflowEvent.Fail]: WorkflowStatus.Failed,
    [WorkflowEvent.Block]: WorkflowStatus.Blocked,
    [WorkflowEvent.Cancel]: WorkflowStatus.Cancelled,
  },
  [WorkflowStatus.Preview]: {
    [WorkflowEvent.Present]: WorkflowStatus.AwaitingApproval,
    [WorkflowEvent.Fail]: WorkflowStatus.Failed,
    [WorkflowEvent.Block]: WorkflowStatus.Blocked,
    [WorkflowEvent.Cancel]: WorkflowStatus.Cancelled,
    [WorkflowEvent.Expire]: WorkflowStatus.Expired,
  },
  [WorkflowStatus.AwaitingApproval]: {
    [WorkflowEvent.Approve]: WorkflowStatus.Approved,
    [WorkflowEvent.Cancel]: WorkflowStatus.Cancelled,
    [WorkflowEvent.Expire]: WorkflowStatus.Expired,
    [WorkflowEvent.Stale]: WorkflowStatus.Stale,
    [WorkflowEvent.Block]: WorkflowStatus.Blocked,
  },
  [WorkflowStatus.Approved]: {
    [WorkflowEvent.Start]: WorkflowStatus.Running,
    [WorkflowEvent.Cancel]: WorkflowStatus.Cancelled,
    [WorkflowEvent.Expire]: WorkflowStatus.Expired,
    [WorkflowEvent.Stale]: WorkflowStatus.Stale,
    [WorkflowEvent.Block]: WorkflowStatus.Blocked,
    [WorkflowEvent.Fail]: WorkflowStatus.Failed,
  },
  [WorkflowStatus.Running]: {
    [WorkflowEvent.Pause]: WorkflowStatus.Paused,
    [WorkflowEvent.BeginVerification]: WorkflowStatus.Verifying,
    [WorkflowEvent.PartiallyComplete]: WorkflowStatus.Partial,
    [WorkflowEvent.Fail]: WorkflowStatus.Failed,
    [WorkflowEvent.Block]: WorkflowStatus.Blocked,
    [WorkflowEvent.Cancel]: WorkflowStatus.Cancelled,
    [WorkflowEvent.Stale]: WorkflowStatus.Stale,
    [WorkflowEvent.Expire]: WorkflowStatus.Expired,
  },
  [WorkflowStatus.Paused]: {
    [WorkflowEvent.Resume]: WorkflowStatus.Running,
    [WorkflowEvent.PartiallyComplete]: WorkflowStatus.Partial,
    [WorkflowEvent.Fail]: WorkflowStatus.Failed,
    [WorkflowEvent.Block]: WorkflowStatus.Blocked,
    [WorkflowEvent.Cancel]: WorkflowStatus.Cancelled,
    [WorkflowEvent.Stale]: WorkflowStatus.Stale,
    [WorkflowEvent.Expire]: WorkflowStatus.Expired,
  },
  [WorkflowStatus.Verifying]: {
    [WorkflowEvent.Complete]: WorkflowStatus.Completed,
    [WorkflowEvent.PartiallyComplete]: WorkflowStatus.Partial,
    [WorkflowEvent.Fail]: WorkflowStatus.Failed,
    [WorkflowEvent.Block]: WorkflowStatus.Blocked,
    [WorkflowEvent.Cancel]: WorkflowStatus.Cancelled,
    [WorkflowEvent.Stale]: WorkflowStatus.Stale,
    [WorkflowEvent.Expire]: WorkflowStatus.Expired,
  },
  /* Terminal statuses: no outgoing edges. */
  [WorkflowStatus.Completed]: {},
  [WorkflowStatus.Partial]: {},
  [WorkflowStatus.Failed]: {},
  [WorkflowStatus.Blocked]: {},
  [WorkflowStatus.Cancelled]: {},
  [WorkflowStatus.Stale]: {},
  [WorkflowStatus.Expired]: {},
};

export function canApplyWorkflowEvent(
  status: WorkflowStatus,
  event: WorkflowEvent,
): boolean {
  if (isTerminalWorkflowStatus(status)) return false;
  return TRANSITIONS[status][event] !== undefined;
}

/** The next status, or null when the transition is not allowed. */
export function nextWorkflowStatus(
  status: WorkflowStatus,
  event: WorkflowEvent,
): WorkflowStatus | null {
  if (isTerminalWorkflowStatus(status)) return null;
  return TRANSITIONS[status][event] ?? null;
}

/** Alias used by the store: transition(status, event) → status | null. */
export const transition = nextWorkflowStatus;

/**
 * Apply an event to a workflow record (mutates `status` only). Returns
 * false — leaving the status untouched — when the transition would be
 * illegal. This is what guarantees no path skips approval.
 */
export function applyWorkflowEvent(
  workflow: { status: WorkflowStatus },
  event: WorkflowEvent,
): boolean {
  const next = nextWorkflowStatus(workflow.status, event);
  if (next === null) return false;
  workflow.status = next;
  return true;
}
