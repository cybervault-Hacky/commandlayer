/**
 * Phase 4 — deterministic action planner.
 *
 * The planner maps explicit user phrasing to a structured, validated
 * action plan. It is fully deterministic (keyword rules + quoted target
 * extraction) — the AI reasoning engine never produces plans and never
 * chooses risk levels.
 *
 * Nothing proposed here executes: plans are previewed, approved, and
 * re-validated before the executor will touch them.
 */
import { createRequestId } from '@/shared/messaging/envelope';
import { ACTION_LIMITS } from './limits';
import { computePlanHash } from './planHash';
import { actionRegistry } from './registry';
import { parseActionListCandidate } from './validator';
import {
  ActionKind,
  ActionRisk,
  type Action,
  type ActionPlan,
  type PlannedAction,
  type ScrollDirection,
} from './types';

export interface PlanContext {
  requestId: string;
  tabId: number;
  url: string;
  contentHash: string;
}

/**
 * Cheap deterministic pre-filter (same vocabulary as planAction). Used
 * by the pipeline to choose the capture profile; planAction remains the
 * single source of truth for whether a plan is actually produced.
 */
export function looksLikeActionRequest(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    /\bscroll\b/.test(t) ||
    /\b(find|search for|look for|locate)\b/.test(t) ||
    /\b(click|press|tap|hit)\b/.test(t) ||
    /\b(type|enter|fill in|fill|write)\b/.test(t) ||
    /\b(select|choose)\b/.test(t) ||
    /\bread (this |the )?page\b/.test(t)
  );
}

export interface PlanOutcome {
  /** Present when a plan could be built and validated. */
  plan?: ActionPlan;
  /** User-safe reason when planning was not possible. */
  reason?: string;
}

const QUOTED = /["“”']([^"“”']{1,200})["“”']/;
const QUOTED_GLOBAL = /["“”']([^"“”']{1,200})["“”']/g;

/**
 * Decide whether a command is an action request, and build the plan.
 * Returns `{ }` (no plan) when the command is not action-shaped — the
 * caller then routes to the reasoning engine.
 */
export function planAction(
  text: string,
  context: PlanContext,
  now: Date = new Date(),
): PlanOutcome {
  const t = text.trim();
  const actions =
    parseScrollRequest(t) ??
    parseFindTextRequest(t) ??
    parseSelectOptionRequest(t) ??
    parseTypeTextRequest(t) ??
    parseClickRequest(t) ??
    parseReadPageRequest(t);

  if (actions === null) return {};

  return finalizePlan(actions, context, now);
}

/**
 * Validation gate + plan construction shared by every planner (Phase 4
 * phrasing rules and the Phase 7 developer change planner). Even trusted
 * planner output must pass the strict allowlist/limits validator here —
 * there is no privileged path into the action session store.
 */
export function finalizePlan(
  actions: Action[],
  context: PlanContext,
  now: Date = new Date(),
): PlanOutcome {
  const validated = parseActionListCandidate(actions);
  if (validated === null) {
    return { reason: 'The requested action exceeds CommandLayer safety limits.' };
  }

  const planned: PlannedAction[] = validated.map((action) => ({
    stepId: createRequestId('step'),
    action,
    preview: actionRegistry.definition(action.type).preview(action),
  }));

  const risk = actionRegistry.combinedRisk(validated);
  const createdAt = now.toISOString();
  const partial = {
    planId: createRequestId('plan'),
    requestId: context.requestId,
    tabId: context.tabId,
    url: context.url,
    contentHash: context.contentHash,
    actions: planned,
    risk,
    requiresConfirmation: risk === ActionRisk.Confirmation,
    planHash: '',
    createdAt,
    expiresAt: new Date(now.getTime() + ACTION_LIMITS.PLAN_TTL_MS).toISOString(),
  };
  partial.planHash = computePlanHash(partial);

  return { plan: partial };
}

/* ------------------------------------------------------------------ */

function parseScrollRequest(t: string): Action[] | null {
  const m = t.match(/\bscroll\b/i);
  if (!m) return null;
  const lower = t.toLowerCase();

  if (/\bto (the )?top\b/.test(lower)) {
    return [{ type: ActionKind.Scroll, direction: 'top' }];
  }
  if (/\b(to (the )?bottom|to the end)\b/.test(lower)) {
    return [{ type: ActionKind.Scroll, direction: 'bottom' }];
  }

  const direction: ScrollDirection = /\bup\b/.test(lower) ? 'up' : 'down';
  const px = lower.match(/(\d{1,5})\s*(px|pixels?)?/);
  const distance = px ? Math.min(Number(px[1]), ACTION_LIMITS.MAX_SCROLL_DISTANCE_PX) : 600;
  return [
    { type: ActionKind.Scroll, direction, distancePx: distance },
  ];
}

function parseFindTextRequest(t: string): Action[] | null {
  if (!/\b(find|search for|look for|locate)\b/i.test(t)) return null;
  // A FIND_TEXT request must carry a quoted query — no fuzzy guessing.
  const quoted = t.match(QUOTED);
  if (!quoted || !quoted[1]) return null;
  return [{ type: ActionKind.FindText, query: quoted[1].trim() }];
}

function parseSelectOptionRequest(t: string): Action[] | null {
  if (!/\b(select|choose)\b/i.test(t)) return null;
  const quotedAll = [...t.matchAll(QUOTED_GLOBAL)]
    .map((m) => m[1]?.trim() ?? '')
    .filter((s) => s.length > 0);
  if (quotedAll.length < 2) return null;
  const option = quotedAll[0]!;
  const targetText = quotedAll[1]!;
  return [
    {
      type: ActionKind.SelectOption,
      target: { kind: 'text', text: targetText },
      option,
    },
  ];
}

function parseTypeTextRequest(t: string): Action[] | null {
  if (!/\b(type|enter|fill in|fill|write)\b/i.test(t)) return null;
  const quotedAll = [...t.matchAll(QUOTED_GLOBAL)]
    .map((m) => m[1]?.trim() ?? '')
    .filter((s) => s.length > 0);
  if (quotedAll.length < 2) return null;

  // "type X into Y" — value first, target second.
  const value = quotedAll[0]!;
  const targetText = quotedAll[1]!;
  const target = resolveTypedTarget(t, targetText);
  if (target === null) return null;
  return [{ type: ActionKind.TypeText, target, text: value }];
}

function parseClickRequest(t: string): Action[] | null {
  if (!/\b(click|press|tap|hit)\b/i.test(t)) return null;
  const quoted = t.match(QUOTED);
  if (!quoted || !quoted[1]) return null;
  const target = resolveTypedTarget(t, quoted[1].trim());
  if (target === null) return null;
  return [{ type: ActionKind.ClickElement, target }];
}

function parseReadPageRequest(t: string): Action[] | null {
  if (/\bread (this |the )?page\b/i.test(t)) {
    return [{ type: ActionKind.ReadPage }];
  }
  return null;
}

/**
 * Prefer a role hint when the phrasing names one ("the X button/link/
 * tab"), otherwise target by visible text. Occurrence index when the
 * user says "second ...".
 */
function resolveTypedTarget(
  t: string,
  text: string,
):
  | { kind: 'role'; role: string; name: string }
  | { kind: 'text'; text: string; occurrence?: number }
  | null {
  const lower = t.toLowerCase();
  const occurrenceMatch = lower.match(
    /\b(first|second|third)\b/,
  );
  const occurrence =
    occurrenceMatch === null
      ? undefined
      : occurrenceMatch[1] === 'first'
        ? 1
        : occurrenceMatch[1] === 'second'
          ? 2
          : 3;

  const roles: ReadonlyArray<readonly [RegExp, string]> = [
    [/\bbutton\b/, 'button'],
    [/\blink\b|\banchor\b/, 'link'],
    [/\bcheckbox\b/, 'checkbox'],
    [/\bradio button\b|\bradio\b/, 'radio'],
    [/\btab\b/, 'tab'],
    [/\bmenu item\b/, 'menuitem'],
    [/\bdropdown\b|\bselect\b|\blistbox\b/, 'listbox'],
    [/\btext ?(field|box|input)\b|\bsearch ?box\b|\binput\b/, 'textbox'],
  ];
  for (const [pattern, role] of roles) {
    if (pattern.test(lower)) {
      return { kind: 'role', role, name: text };
    }
  }
  return occurrence === undefined
    ? { kind: 'text', text }
    : { kind: 'text', text, occurrence };
}
