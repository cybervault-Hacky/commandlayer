/**
 * Phase 4 — background ↔ content wire protocol for action execution.
 *
 * Trust boundaries in BOTH directions:
 * - background → content: only plans that survived validation, approval,
 *   freshness, and hash binding are serialized here — one validated step
 *   at a time, never a whole plan, never code.
 * - content → background: responses are re-parsed structurally
 *   (isContentActionResponse) and mapped onto the typed result model.
 *
 * The wire shape deliberately cannot carry executable content: actions
 * are the closed typed union, and the content script re-validates them
 * before touching the DOM.
 */
import { isActionKind } from './types';
import type { Action, ContentActionResponse, PlannedAction } from './types';

export const ACTION_PROTOCOL_VERSION = 1 as const;
export const EXECUTE_ACTION_REQUEST_TYPE = 'cl:execute-action-request';

export interface ExecuteActionRequest {
  v: typeof ACTION_PROTOCOL_VERSION;
  type: typeof EXECUTE_ACTION_REQUEST_TYPE;
  /** Correlates the step result (never used for authorization). */
  stepId: string;
  planId: string;
  /** One validated action from an approved plan. */
  action: Action;
}

export function buildExecuteActionRequest(
  planId: string,
  step: PlannedAction,
): ExecuteActionRequest {
  return {
    v: ACTION_PROTOCOL_VERSION,
    type: EXECUTE_ACTION_REQUEST_TYPE,
    stepId: step.stepId,
    planId,
    action: step.action,
  };
}

const TARGET_KINDS: ReadonlySet<string> = new Set([
  'text',
  'role',
  'stable-id',
]);

/** Structural check for an inbound action request (content side). */
export function isExecuteActionRequest(
  value: unknown,
): value is ExecuteActionRequest {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  if (r.v !== ACTION_PROTOCOL_VERSION) return false;
  if (r.type !== EXECUTE_ACTION_REQUEST_TYPE) return false;
  if (typeof r.stepId !== 'string' || r.stepId.length === 0) return false;
  if (typeof r.planId !== 'string' || r.planId.length === 0) return false;

  const action = r.action;
  if (typeof action !== 'object' || action === null) return false;
  const a = action as Record<string, unknown>;
  if (!isActionKind(a.type)) return false;

  // Target shape must be one of the closed kinds when present.
  if (a.target !== undefined) {
    if (typeof a.target !== 'object' || a.target === null) return false;
    const target = a.target as Record<string, unknown>;
    if (typeof target.kind !== 'string' || !TARGET_KINDS.has(target.kind)) {
      return false;
    }
    // No selector-ish keys may ever appear.
    for (const key of Object.keys(target)) {
      if (!['kind', 'text', 'role', 'name', 'id', 'occurrence'].includes(key)) {
        return false;
      }
    }
  }

  // Executable-content keys are rejected at the wire boundary.
  for (const key of Object.keys(a)) {
    if (['javascript', 'script', 'code', 'eval', 'selector', 'xpath', 'command', 'html'].includes(key)) {
      return false;
    }
  }
  return true;
}

/** Structural check for an outbound step response (background side). */
export function isContentActionResponse(
  value: unknown,
): value is ContentActionResponse {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  if (r.ok === false) {
    return typeof r.error === 'string';
  }
  if (r.ok !== true) return false;
  const result = r.result;
  if (typeof result !== 'object' || result === null) return false;
  const res = result as Record<string, unknown>;
  return typeof res.status === 'string' && typeof res.message === 'string';
}
