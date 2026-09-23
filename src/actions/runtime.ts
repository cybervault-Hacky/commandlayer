/**
 * Phase 4 — content-side action runtime.
 *
 * Runs in the content script against the LIVE document. Everything here
 * is bounded, deterministic, and untrusted-input-proof:
 * - requests are re-validated before any DOM access
 * - targets are resolved through the safe target model only (no CSS/
 *   XPath selectors, no AI-generated anything)
 * - DOM work is capped (candidate and text-node scan limits)
 * - sensitive fields are blocked before any typing
 * - responses never carry typed values, passwords, or secrets — only
 *   statuses, counts, and booleans
 */
import { ACTION_LIMITS } from './limits';
import { isSensitiveField, SENSITIVE_FIELD_MESSAGE } from './sensitive';
import { parseActionCandidate } from './validator';
import {
  ActionErrorCode,
  type ClickElementAction,
  type ContentActionResponse,
  type ElementTarget,
  type FindTextData,
  type FindTextMatch,
  type SelectOptionAction,
  type StepVerification,
  type TypeTextAction,
} from './types';

type SuccessResult = Extract<ContentActionResponse, { ok: true }>['result'];

function ok(result: SuccessResult): ContentActionResponse {
  return { ok: true, result };
}

function fail(code: ActionErrorCode): ContentActionResponse {
  return { ok: false, error: code };
}

/**
 * Execute one VALIDATED step against the live document. The request has
 * already crossed the wire validator; we re-validate anyway because the
 * content script must never trust any message.
 */
export function executeActionStep(
  rawAction: unknown,
  doc: Document = document,
): ContentActionResponse {
  const action = parseActionCandidate(rawAction);
  if (action === null) return fail(ActionErrorCode.ACTION_INVALID);

  try {
    switch (action.type) {
      case 'SCROLL':
        return runScroll(action.direction, action.distancePx, doc);
      case 'FIND_TEXT':
        return runFindText(action.query, action.caseSensitive ?? false, doc);
      case 'CLICK_ELEMENT':
        return runClick(action, doc);
      case 'TYPE_TEXT':
        return runTypeText(action, doc);
      case 'SELECT_OPTION':
        return runSelectOption(action, doc);
      case 'READ_PAGE':
        // READ_PAGE executes in the background against PageContext.
        return fail(ActionErrorCode.ACTION_UNSUPPORTED);
      case 'NAVIGATE_GITHUB':
        // GitHub navigation executes in the background (chrome.tabs.update
        // with a URL built from a validated typed target). The content script
        // never navigates the tab.
        return fail(ActionErrorCode.ACTION_UNSUPPORTED);
    }
  } catch {
    return fail(ActionErrorCode.ACTION_EXECUTION_FAILED);
  }
}

/* ----------------------------- SCROLL ------------------------------ */

function runScroll(
  direction: 'up' | 'down' | 'top' | 'bottom',
  distancePx: number | undefined,
  doc: Document,
): ContentActionResponse {
  const win = doc.defaultView;
  if (!win) return fail(ActionErrorCode.ACTION_EXECUTION_FAILED);

  const before = win.scrollY;
  const maxDoc = Math.max(0, doc.documentElement.scrollHeight - win.innerHeight);

  let target: number;
  switch (direction) {
    case 'top':
      target = 0;
      break;
    case 'bottom':
      // Bounded: the document height, never Infinity.
      target = maxDoc;
      break;
    default: {
      const distance = Math.min(
        distancePx ?? 600,
        ACTION_LIMITS.MAX_SCROLL_DISTANCE_PX,
      );
      target = direction === 'down' ? before + distance : before - distance;
    }
  }
  target = Math.max(0, Math.min(target, maxDoc));

  win.scrollTo({ top: target, behavior: 'auto' });
  const moved = Math.abs(win.scrollY - before);

  return ok({
    status: 'success',
    message: `Scrolled ${Math.round(moved)}px ${direction}.`,
    verification: { ok: true, detail: `Position changed by ${Math.round(moved)}px` },
  });
}

/* ---------------------------- FIND_TEXT ---------------------------- */

function runFindText(
  query: string,
  caseSensitive: boolean,
  doc: Document,
): ContentActionResponse {
  const matches = findTextMatches(query, caseSensitive, doc);
  const data: FindTextData = {
    kind: 'FIND_TEXT',
    matchCount: matches.length,
    matches: matches.slice(0, ACTION_LIMITS.MAX_FIND_MATCHES),
  };
  return ok({
    status: 'success',
    message:
      matches.length === 0
        ? `No matches for the query.`
        : `Found ${matches.length} match${matches.length === 1 ? '' : 'es'}.`,
    data,
  });
}

/** Bounded text-node walk. Read-only: the page is never mutated. */
export function findTextMatches(
  query: string,
  caseSensitive: boolean,
  doc: Document,
): FindTextMatch[] {
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: FindTextMatch[] = [];
  const walker = doc.createTreeWalker(
    doc.body ?? doc.documentElement,
    4 /* NodeFilter.SHOW_TEXT */,
    {
      acceptNode(node: Node): number {
        const el = node.parentElement;
        if (!el) return 2;
        const tag = el.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') {
          return 2;
        }
        return 1;
      },
    },
  );

  let scanned = 0;
  let node = walker.nextNode();
  while (node !== null && scanned < ACTION_LIMITS.FIND_MAX_NODES_SCANNED) {
    scanned += 1;
    const text = node.nodeValue ?? '';
    const haystack = caseSensitive ? text : text.toLowerCase();
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      if (matches.length >= ACTION_LIMITS.MAX_FIND_MATCHES) return matches;
      matches.push({
        index: matches.length + 1,
        snippet: makeSnippet(text, index),
      });
      index = haystack.indexOf(needle, index + needle.length);
    }
    node = walker.nextNode();
  }
  return matches;
}

function makeSnippet(text: string, at: number): string {
  const budget = ACTION_LIMITS.FIND_SNIPPET_LENGTH;
  const start = Math.max(0, at - Math.floor(budget / 3));
  const raw = text.slice(start, start + budget).replace(/\s+/g, ' ').trim();
  return raw;
}

/* --------------------------- CLICK_ELEMENT -------------------------- */

function runClick(
  action: ClickElementAction,
  doc: Document,
): ContentActionResponse {
  const resolution = resolveTarget(action.target, doc);
  if (!resolution.ok) return resolution.response;
  const element = resolution.element;

  // Revalidation: the target must be visible and enabled right now.
  if (!isInteractiveCandidate(element, doc)) {
    return fail(ActionErrorCode.ACTION_TARGET_NOT_FOUND);
  }

  const before = describeState(element);
  element.click();
  const after = describeState(element);

  const verification: StepVerification = {
    ok: true,
    detail:
      before !== after
        ? 'Target state changed after the click.'
        : 'Click dispatched on the revalidated target.',
  };
  return ok({
    status: 'success',
    message: `Clicked ${describeKind(element)}.`,
    verification,
  });
}

/* ----------------------------- TYPE_TEXT ---------------------------- */

function runTypeText(
  action: TypeTextAction,
  doc: Document,
): ContentActionResponse {
  const resolution = resolveTarget(action.target, doc);
  if (!resolution.ok) return resolution.response;
  const element = resolution.element;

  const field = asTypeableField(element);
  if (field === null) {
    return fail(ActionErrorCode.ACTION_TARGET_NOT_FOUND);
  }
  if (field.disabled || field.readOnly) {
    return fail(ActionErrorCode.ACTION_TARGET_NOT_FOUND);
  }

  // Sensitive-field gate: BLOCK, never bypass, never log the value.
  if (isSensitiveField(fieldSignals(field, doc))) {
    return {
      ok: true,
      result: {
        status: 'blocked',
        message: SENSITIVE_FIELD_MESSAGE,
      },
    };
  }

  setFieldValue(field, action.text);
  // Verification compares expected vs actual WITHOUT returning the value.
  const matches = field.value === action.text;
  return ok({
    status: matches ? 'success' : 'failed',
    message: matches
      ? 'Entered the requested text.'
      : 'The field did not accept the text as expected.',
    verification: {
      ok: matches,
      detail: matches
        ? 'Field contains the expected value.'
        : 'Field value does not match the request.',
    },
  });
}

/* --------------------------- SELECT_OPTION -------------------------- */

function runSelectOption(
  action: SelectOptionAction,
  doc: Document,
): ContentActionResponse {
  const resolution = resolveTarget(action.target, doc);
  if (!resolution.ok) return resolution.response;
  const element = resolution.element;

  if (tagName(element) !== 'SELECT') {
    return fail(ActionErrorCode.ACTION_TARGET_NOT_FOUND);
  }
  const select = element as HTMLSelectElement;
  if (select.disabled) {
    return fail(ActionErrorCode.ACTION_TARGET_NOT_FOUND);
  }

  // Match by visible option label — never by bare index.
  const options = Array.from(select.options);
  const match = options.find(
    (o) => o.label.trim() === action.option || o.text.trim() === action.option,
  );
  if (!match) {
    return fail(ActionErrorCode.ACTION_TARGET_NOT_FOUND);
  }

  select.value = match.value;
  dispatchInputEvents(select);

  const selectedLabel =
    select.selectedOptions[0]?.label.trim() ?? '';
  const matches = selectedLabel === action.option;
  return ok({
    status: matches ? 'success' : 'failed',
    message: matches
      ? `Selected “${action.option}”.`
      : 'The option could not be selected.',
    verification: {
      ok: matches,
      detail: matches
        ? 'Selected option matches the request.'
        : 'Selected option does not match the request.',
    },
  });
}

/* --------------------------- target model --------------------------- */

type Resolution =
  | { ok: true; element: HTMLElement }
  | { ok: false; response: ContentActionResponse };

/**
 * Structural element checks. We deliberately avoid `instanceof
 * HTMLElement` / `instanceof HTMLInputElement`: the runtime may inspect
 * elements from a different JS realm (isolated content-script world,
 * cross-origin frames), where constructor identity does not hold.
 * tagName / nodeType are realm-safe.
 */
function isElement(value: unknown): value is HTMLElement {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Node).nodeType === 1 &&
    typeof (value as Element).tagName === 'string'
  );
}

function tagName(el: HTMLElement): string {
  return el.tagName.toUpperCase();
}

function resolveTarget(
  target: ElementTarget,
  doc: Document,
): Resolution {
  if (target.kind === 'stable-id') {
    const el = doc.getElementById(target.id);
    if (isElement(el)) return { ok: true, element: el };
    return { ok: false, response: fail(ActionErrorCode.ACTION_TARGET_NOT_FOUND) };
  }

  const candidates = collectCandidates(doc);
  const occurrence = target.occurrence ?? 1;
  let seen = 0;

  for (const el of candidates) {
    if (matchesTarget(el, target, doc)) {
      seen += 1;
      if (seen === occurrence) return { ok: true, element: el };
    }
  }

  if (seen === 0) {
    return { ok: false, response: fail(ActionErrorCode.ACTION_TARGET_NOT_FOUND) };
  }
  // Fewer matches than the requested occurrence — ambiguous enough to stop.
  return { ok: false, response: fail(ActionErrorCode.ACTION_TARGET_AMBIGUOUS) };
}

/**
 * Bounded candidate collection: interactive and text-bearing elements
 * only, capped so a hostile page cannot force an unbounded scan.
 */
function collectCandidates(doc: Document): HTMLElement[] {
  const selector = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="textbox"]',
    '[role="searchbox"]',
    '[role="switch"]',
    '[onclick]',
    'summary',
    'label',
  ].join(',');

  let nodes: HTMLElement[];
  try {
    nodes = Array.from(doc.querySelectorAll(selector)) as HTMLElement[];
  } catch {
    return [];
  }
  return nodes.slice(0, ACTION_LIMITS.TARGET_MAX_CANDIDATES_SCANNED);
}

function matchesTarget(
  el: HTMLElement,
  target: ElementTarget,
  doc: Document,
): boolean {
  if (target.kind === 'text') {
    const tag = tagName(el);
    // Form fields have no visible text of their own — their identity is
    // the label / aria-label / placeholder (the accessible name).
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      return normalize(accessibleName(el, doc)) === normalize(target.text);
    }
    return normalize(visibleText(el)) === normalize(target.text);
  }
  if (target.kind !== 'role') return false;
  // role target
  const role = explicitRole(el);
  if (role !== target.role) return false;
  return normalize(accessibleName(el, doc)) === normalize(target.name);
}

function explicitRole(el: HTMLElement): string {
  const attr = el.getAttribute('role');
  if (attr) return attr.toLowerCase();
  const tag = el.tagName;
  if (tag === 'BUTTON') return 'button';
  if (tag === 'A' && el.hasAttribute('href')) return 'link';
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
    if (type === 'search') return 'searchbox';
    return 'textbox';
  }
  if (tag === 'SELECT') return 'listbox';
  if (tag === 'TEXTAREA') return 'textbox';
  return '';
}

function accessibleName(el: HTMLElement, doc: Document): string {
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) return aria;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (parts) return parts;
  }
  const tag = tagName(el);
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
    const formField = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (formField.labels && formField.labels.length > 0) {
      const labelText = Array.from(formField.labels)
        .map((l) => l.textContent ?? '')
        .join(' ')
        .trim();
      if (labelText) return labelText;
    }
    const placeholder = formField.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return placeholder;
  }
  return visibleText(el);
}

function visibleText(el: HTMLElement): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function isInteractiveCandidate(el: HTMLElement, doc: Document): boolean {
  // Realm-safe disabled check (structural, not instanceof).
  const tag = tagName(el);
  if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
    if ((el as HTMLButtonElement | HTMLInputElement).disabled === true) return false;
  }
  const win = doc.defaultView;
  if (!win) return true;
  // Visibility check (cheap and bounded — one rect query).
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  return true;
}

function describeState(el: HTMLElement): string {
  const parts = [
    el.getAttribute('aria-expanded') ?? '',
    el.getAttribute('aria-selected') ?? '',
    el.getAttribute('aria-checked') ?? '',
    el.classList.toString(),
  ];
  return parts.join('|');
}

function describeKind(el: HTMLElement): string {
  const role = explicitRole(el);
  return role || el.tagName.toLowerCase();
}

/* ------------------------- field helpers ---------------------------- */

function asTypeableField(
  el: HTMLElement,
): HTMLInputElement | HTMLTextAreaElement | null {
  const tag = tagName(el);
  if (tag === 'INPUT') return el as HTMLInputElement;
  if (tag === 'TEXTAREA') return el as HTMLTextAreaElement;
  return null;
}

/** Collect coarse signals for the sensitive-field classifier. Never reads values. */
function fieldSignals(
  field: HTMLInputElement | HTMLTextAreaElement,
  doc: Document,
): { inputType?: string; autocomplete?: string; descriptors?: string } {
  const descriptorParts: string[] = [
    field.id,
    field.name,
    field.getAttribute('placeholder') ?? '',
    field.getAttribute('aria-label') ?? '',
  ];
  if (field.labels) {
    for (const label of Array.from(field.labels)) {
      descriptorParts.push(label.textContent ?? '');
    }
  }
  const labelledBy = field.getAttribute('aria-labelledby');
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) {
      descriptorParts.push(doc.getElementById(id)?.textContent ?? '');
    }
  }
  return {
    inputType: tagName(field) === 'INPUT' ? (field as HTMLInputElement).type : 'textarea',
    autocomplete: field.getAttribute('autocomplete') ?? '',
    descriptors: descriptorParts.join(' ').toLowerCase(),
  };
}

function setFieldValue(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  // Walk the field's OWN prototype chain to find the native `value`
  // setter — realm-safe (no constructor identity), and it bypasses any
  // page-level override of `.value`, so framework state stays in sync
  // once we dispatch the input/change events.
  let proto: object | null = Object.getPrototypeOf(field);
  let descriptor: PropertyDescriptor | undefined;
  while (proto !== null && descriptor === undefined) {
    descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    proto = Object.getPrototypeOf(proto);
  }
  const setter = descriptor?.set;
  if (setter) {
    setter.call(field, value);
  } else {
    field.value = value;
  }
  dispatchInputEvents(field);
}

function dispatchInputEvents(el: HTMLElement): void {
  try {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } catch {
    // Event dispatch failure must not mask the primary outcome.
  }
}
