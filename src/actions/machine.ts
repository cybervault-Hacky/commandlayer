/**
 * Phase 4 — explicit action session state machine.
 *
 * The ONLY legal path to EXECUTING is:
 *   PLANNING → PREVIEW → AWAITING_PERMISSION → APPROVED → EXECUTING
 *
 * Every transition is checked against the table below; anything else is
 * rejected. In particular there is no edge from PLANNING/PREVIEW to
 * EXECUTING — AI output can never reach execution directly.
 */
import { ActionSessionState as S } from './types';

export const ActionEvent = {
  PlanCreated: 'PLAN_CREATED',
  PresentPreview: 'PRESENT_PREVIEW',
  RequestPermission: 'REQUEST_PERMISSION',
  Approve: 'APPROVE',
  BeginExecution: 'BEGIN_EXECUTION',
  BeginVerification: 'BEGIN_VERIFICATION',
  Complete: 'COMPLETE',
  Fail: 'FAIL',
  Block: 'BLOCK',
  Stale: 'STALE',
  Cancel: 'CANCEL',
} as const;

export type ActionEvent = (typeof ActionEvent)[keyof typeof ActionEvent];

const TRANSITIONS: Partial<Record<S, Partial<Record<ActionEvent, S>>>> = {
  [S.Idle]: {
    [ActionEvent.PlanCreated]: S.Planning,
  },
  [S.Planning]: {
    [ActionEvent.PresentPreview]: S.Preview,
    [ActionEvent.Fail]: S.Failed,
    [ActionEvent.Cancel]: S.Cancelled,
  },
  [S.Preview]: {
    [ActionEvent.RequestPermission]: S.AwaitingPermission,
    [ActionEvent.Cancel]: S.Cancelled,
    [ActionEvent.Stale]: S.Stale,
  },
  [S.AwaitingPermission]: {
    [ActionEvent.Approve]: S.Approved,
    [ActionEvent.Cancel]: S.Cancelled,
    [ActionEvent.Stale]: S.Stale,
    [ActionEvent.Fail]: S.Failed,
  },
  [S.Approved]: {
    [ActionEvent.BeginExecution]: S.Executing,
    [ActionEvent.Cancel]: S.Cancelled,
    [ActionEvent.Stale]: S.Stale,
  },
  [S.Executing]: {
    [ActionEvent.BeginVerification]: S.Verifying,
    [ActionEvent.Complete]: S.Completed,
    [ActionEvent.Fail]: S.Failed,
    [ActionEvent.Block]: S.Blocked,
    [ActionEvent.Stale]: S.Stale,
    [ActionEvent.Cancel]: S.Cancelled,
  },
  [S.Verifying]: {
    [ActionEvent.Complete]: S.Completed,
    [ActionEvent.Fail]: S.Failed,
    [ActionEvent.Block]: S.Blocked,
    [ActionEvent.Stale]: S.Stale,
  },
  // Terminal states: no outgoing transitions.
  [S.Completed]: {},
  [S.Cancelled]: {},
  [S.Failed]: {},
  [S.Blocked]: {},
  [S.Stale]: {},
};

/**
 * Attempt a transition. Returns the new state, or null when the
 * transition is invalid (callers must treat that as a hard stop).
 */
export function transition(
  state: S,
  event: ActionEvent,
): S | null {
  return TRANSITIONS[state]?.[event] ?? null;
}

export function isTerminalState(state: S): boolean {
  return (
    state === S.Completed ||
    state === S.Cancelled ||
    state === S.Failed ||
    state === S.Blocked ||
    state === S.Stale
  );
}
