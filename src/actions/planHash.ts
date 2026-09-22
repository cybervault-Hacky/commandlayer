/**
 * Phase 4 — deterministic plan identity.
 *
 * The plan the user approves MUST be exactly the plan that executes.
 * `computePlanHash` derives a stable identity from the plan's immutable
 * fields; the executor compares it against the approved hash and stops
 * with ACTION_PLAN_CHANGED on any mismatch.
 */
import { fnv1a32 } from '@/page-intelligence/hash';
import type { ActionPlan, PlannedAction } from './types';

/** Canonical JSON: sorted keys, no whitespace, no volatile fields. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(record[k])}`);
  return `{${parts.join(',')}}`;
}

/** The hashable identity of a step list (targets + values included). */
export function hashActions(actions: ReadonlyArray<Pick<PlannedAction, 'action'>>): string {
  return fnv1a32(canonicalize(actions.map((a) => a.action)));
}

/**
 * Deterministic hash of the plan's binding fields: steps, tab, URL, and
 * the content hash captured at planning time. Changing any of them
 * changes the hash — an approved Plan A can never execute as Plan B.
 */
export function computePlanHash(
  plan: Pick<ActionPlan, 'actions' | 'tabId' | 'url' | 'contentHash'>,
): string {
  return fnv1a32(
    canonicalize({
      actions: plan.actions.map((a) => a.action),
      tabId: plan.tabId,
      url: plan.url,
      contentHash: plan.contentHash,
    }),
  );
}
