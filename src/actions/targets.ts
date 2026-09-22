/**
 * Phase 4 — safe element target model.
 *
 * There is no raw-selector targeting by design. Elements are addressed
 * by visible text, accessible role + name, or a strict stable id — the
 * same descriptors the deterministic planner can produce and the
 * content script can resolve without executing arbitrary CSS/XPath.
 */
import { ACTION_LIMITS } from './limits';
import type { ElementTarget } from './types';

/** ARIA roles a target may reference (closed list, not free-form). */
const ALLOWED_ROLES: ReadonlySet<string> = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'tab',
  'menuitem',
  'option',
  'combobox',
  'textbox',
  'searchbox',
  'switch',
  'listbox',
]);

/**
 * Stable ids must be plain identifiers. This keeps the runtime lookup a
 * single `getElementById` and rejects anything selector-shaped.
 */
const STABLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (t.length === 0 || t.length > max) return null;
  return t;
}

/**
 * Strict structural validation of an untrusted target descriptor.
 * Returns a normalized target or null. No field beyond the closed shape
 * is permitted.
 */
const TEXT_KEYS: ReadonlySet<string> = new Set(['kind', 'text', 'occurrence']);
const ROLE_KEYS: ReadonlySet<string> = new Set(['kind', 'role', 'name', 'occurrence']);
const STABLE_ID_KEYS: ReadonlySet<string> = new Set(['kind', 'id']);

function onlyAllowedKeys(keys: string[], allowed: ReadonlySet<string>): boolean {
  return keys.every((key) => allowed.has(key));
}

export function parseElementTarget(value: unknown): ElementTarget | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);

  if (value.kind === 'text') {
    // Closed key set: ANY unknown field rejects the target outright.
    if (!onlyAllowedKeys(keys, TEXT_KEYS)) return null;
    const text = boundedText(value.text, ACTION_LIMITS.MAX_TARGET_TEXT);
    if (text === null) return null;
    const occurrence = parseOccurrence(value.occurrence);
    if (occurrence === false) return null;
    return occurrence === undefined
      ? { kind: 'text', text }
      : { kind: 'text', text, occurrence };
  }

  if (value.kind === 'role') {
    if (!onlyAllowedKeys(keys, ROLE_KEYS)) return null;
    const role = boundedText(value.role, 32);
    if (role === null || !ALLOWED_ROLES.has(role)) return null;
    const name = boundedText(value.name, ACTION_LIMITS.MAX_TARGET_TEXT);
    if (name === null) return null;
    const occurrence = parseOccurrence(value.occurrence);
    if (occurrence === false) return null;
    return occurrence === undefined
      ? { kind: 'role', role, name }
      : { kind: 'role', role, name, occurrence };
  }

  if (value.kind === 'stable-id') {
    if (!onlyAllowedKeys(keys, STABLE_ID_KEYS)) return null;
    if (typeof value.id !== 'string' || !STABLE_ID_PATTERN.test(value.id)) {
      return null;
    }
    return { kind: 'stable-id', id: value.id };
  }

  return null;
}

function parseOccurrence(value: unknown): number | undefined | false {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 50
  ) {
    return false;
  }
  return value;
}

/** Human-readable description for previews (no raw selectors exist). */
export function describeTarget(target: ElementTarget): string {
  switch (target.kind) {
    case 'text':
      return `“${target.text}”${target.occurrence !== undefined ? ` (#${target.occurrence})` : ''}`;
    case 'role':
      return `${target.role} “${target.name}”${target.occurrence !== undefined ? ` (#${target.occurrence})` : ''}`;
    case 'stable-id':
      return `element #${target.id}`;
  }
}
