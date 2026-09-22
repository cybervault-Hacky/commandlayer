/**
 * Phase 4 — action validation: the trust boundary for action payloads.
 *
 * EVERY action candidate (planner-built or wire-carried) passes through
 * here before it may enter a plan or reach the executor. Policy:
 * - only the closed ActionKind allowlist is accepted
 * - only the exact typed payload fields are accepted (unknown fields
 *   reject the whole candidate — including `javascript`, `script`,
 *   `code`, `selector`, `xpath`, `command`, ...)
 * - every string is length-capped; targets go through parseElementTarget
 * - there is NO selector kind and NO executable payload of any kind
 *
 * Parsing grants nothing; validation grants nothing; only an explicit
 * user approval of a stored, hashed plan can start execution.
 */
import { ACTION_LIMITS } from './limits';
import { parseElementTarget } from './targets';
import {
  ActionKind,
  isActionKind,
  type Action,
  type ElementTarget,
  type ScrollDirection,
} from './types';

const SCROLL_DIRECTIONS: ReadonlySet<string> = new Set([
  'up',
  'down',
  'top',
  'bottom',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value !== 'undefined' && typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (t.length === 0 || t.length > max) return null;
  return t;
}

/** Exact field sets per action kind (closed contract). */
const ALLOWED_FIELDS: Record<ActionKind, ReadonlySet<string>> = {
  [ActionKind.ReadPage]: new Set(['type']),
  [ActionKind.Scroll]: new Set(['type', 'direction', 'distancePx']),
  [ActionKind.FindText]: new Set(['type', 'query', 'caseSensitive']),
  [ActionKind.ClickElement]: new Set(['type', 'target']),
  [ActionKind.TypeText]: new Set(['type', 'target', 'text']),
  [ActionKind.SelectOption]: new Set(['type', 'target', 'option']),
};

/**
 * Parse an untrusted candidate into a typed Action, or null. Any
 * violation — unknown type, unknown field, missing target, oversized
 * text, invalid direction, arbitrary selector — yields null.
 */
export function parseActionCandidate(value: unknown): Action | null {
  if (!isRecord(value)) return null;
  const type = value.type;
  if (!isActionKind(type)) return null;

  // Closed field check FIRST: unknown fields (e.g. `javascript`,
  // `selector`, `command`) reject the candidate outright.
  for (const key of Object.keys(value)) {
    if (!ALLOWED_FIELDS[type].has(key)) return null;
  }

  switch (type) {
    case ActionKind.ReadPage:
      return { type };

    case ActionKind.Scroll: {
      const direction = value.direction;
      if (
        typeof direction !== 'string' ||
        !SCROLL_DIRECTIONS.has(direction)
      ) {
        return null;
      }
      const action: Action = {
        type,
        direction: direction as ScrollDirection,
      };
      if (value.distancePx !== undefined) {
        if (
          typeof value.distancePx !== 'number' ||
          !Number.isFinite(value.distancePx) ||
          value.distancePx <= 0 ||
          value.distancePx > ACTION_LIMITS.MAX_SCROLL_DISTANCE_PX
        ) {
          return null;
        }
        return { ...action, distancePx: Math.floor(value.distancePx) };
      }
      return action;
    }

    case ActionKind.FindText: {
      const query = boundedText(value.query, ACTION_LIMITS.MAX_FIND_QUERY);
      if (query === null) return null;
      if (
        value.caseSensitive !== undefined &&
        typeof value.caseSensitive !== 'boolean'
      ) {
        return null;
      }
      return value.caseSensitive === undefined
        ? { type, query }
        : { type, query, caseSensitive: value.caseSensitive };
    }

    case ActionKind.ClickElement: {
      const target = parseElementTarget(value.target);
      if (target === null) return null;
      return { type, target };
    }

    case ActionKind.TypeText: {
      const target = parseElementTarget(value.target);
      if (target === null) return null;
      const text = boundedText(value.text, ACTION_LIMITS.MAX_TEXT_LENGTH);
      if (text === null) return null;
      return { type, target, text };
    }

    case ActionKind.SelectOption: {
      const target = parseElementTarget(value.target);
      if (target === null) return null;
      const option = boundedText(value.option, ACTION_LIMITS.MAX_TARGET_TEXT);
      if (option === null) return null;
      return { type, target, option };
    }
  }
}

/** Validate a full candidate list (plan steps) against all limits. */
export function parseActionListCandidate(
  value: unknown,
): Action[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return null;
  if (value.length > ACTION_LIMITS.MAX_ACTIONS_PER_PLAN) return null;

  const actions: Action[] = [];
  let scrollOperations = 0;
  let scrollTotalPx = 0;

  for (const item of value) {
    const action = parseActionCandidate(item);
    if (action === null) return null;
    if (action.type === ActionKind.Scroll) {
      scrollOperations += 1;
      scrollTotalPx +=
        action.distancePx ?? ACTION_LIMITS.MAX_SCROLL_DISTANCE_PX;
      if (
        scrollOperations > ACTION_LIMITS.MAX_SCROLL_OPERATIONS_PER_PLAN ||
        scrollTotalPx > ACTION_LIMITS.MAX_SCROLL_TOTAL_PX
      ) {
        return null;
      }
    }
    actions.push(action);
  }
  return actions;
}

/** Re-export for call sites validating single targets. */
export { parseElementTarget };
export type { ElementTarget };
