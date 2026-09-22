import { describe, expect, it } from 'vitest';
import { ActionEvent, isTerminalState, transition } from '../machine';
import { ActionSessionState as S } from '../types';

describe('action session state machine (Phase 4)', () => {
  it('follows the only legal path to execution', () => {
    let state: S = S.Idle;
    state = transition(state, ActionEvent.PlanCreated)!;
    expect(state).toBe(S.Planning);
    state = transition(state, ActionEvent.PresentPreview)!;
    expect(state).toBe(S.Preview);
    state = transition(state, ActionEvent.RequestPermission)!;
    expect(state).toBe(S.AwaitingPermission);
    state = transition(state, ActionEvent.Approve)!;
    expect(state).toBe(S.Approved);
    state = transition(state, ActionEvent.BeginExecution)!;
    expect(state).toBe(S.Executing);
    state = transition(state, ActionEvent.BeginVerification)!;
    expect(state).toBe(S.Verifying);
    state = transition(state, ActionEvent.Complete)!;
    expect(state).toBe(S.Completed);
  });

  it('rejects every shortcut toward execution', () => {
    // No path may skip PREVIEW / PERMISSION.
    expect(transition(S.Idle, ActionEvent.BeginExecution)).toBeNull();
    expect(transition(S.Planning, ActionEvent.Approve)).toBeNull();
    expect(transition(S.Planning, ActionEvent.BeginExecution)).toBeNull();
    expect(transition(S.Preview, ActionEvent.Approve)).toBeNull();
    expect(transition(S.Preview, ActionEvent.BeginExecution)).toBeNull();
    expect(transition(S.AwaitingPermission, ActionEvent.BeginExecution)).toBeNull();
    expect(transition(S.AwaitingPermission, ActionEvent.Complete)).toBeNull();
    // AI output maps to no event at all — BeginExecution only works from
    // APPROVED, which only the explicit approval flow can reach.
    expect(transition(S.Approved, ActionEvent.Complete)).toBeNull();
  });

  it('rejects events in terminal states', () => {
    for (const terminal of [S.Completed, S.Cancelled, S.Failed, S.Blocked, S.Stale]) {
      expect(isTerminalState(terminal)).toBe(true);
      expect(transition(terminal, ActionEvent.Approve)).toBeNull();
      expect(transition(terminal, ActionEvent.BeginExecution)).toBeNull();
      expect(transition(terminal, ActionEvent.Cancel)).toBeNull();
    }
    expect(isTerminalState(S.Executing)).toBe(false);
  });

  it('supports cancel and failure from active states', () => {
    expect(transition(S.AwaitingPermission, ActionEvent.Cancel)).toBe(S.Cancelled);
    expect(transition(S.Executing, ActionEvent.Fail)).toBe(S.Failed);
    expect(transition(S.Executing, ActionEvent.Block)).toBe(S.Blocked);
    expect(transition(S.Executing, ActionEvent.Stale)).toBe(S.Stale);
    expect(transition(S.Preview, ActionEvent.Stale)).toBe(S.Stale);
  });
});
