/**
 * Strict parsing of untrusted PageContext payloads.
 *
 * The background NEVER trusts content-script messages blindly: this
 * validator type-checks every field, re-sanitizes every string, enforces
 * the centralized limits, and rejects anything out of contract — including
 * any `value` key on a form field (a hard privacy invariant).
 * Returns null on ANY violation; callers respond with a safe fallback.
 */
import type {
  PageContext,
  PageContextReason,
  PageContextState,
  PageForm,
  PageFormField,
  PageHeading,
  PageLink,
  PageTable,
} from '@/shared/types/page';
import { sanitizeText } from '@/shared/security/sanitize';
import { parseSafeUrl } from '@/shared/security/url';
import { PAGE_LIMITS } from './limits';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value.length > maxLength) return null;
  return sanitizeText(value, maxLength);
}

/** Like str(), but empty strings are legitimate (empty cells, icon links). */
function cellStr(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value.length > maxLength) return null;
  if (value.length === 0) return '';
  return sanitizeText(value, maxLength);
}

function int(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 0 || value > max) return null;
  return value;
}

function onlyKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(record).every((key) => allowed.has(key));
}

const VALID_STATES: ReadonlySet<string> = new Set([
  'ready',
  'partial',
  'unsupported',
  'unavailable',
  'permission-required',
]);
const VALID_REASONS: ReadonlySet<string> = new Set([
  'browser-page',
  'no-tab',
  'no-content-script',
  'permission',
  'error',
]);
const VALID_METHODS: ReadonlySet<string> = new Set([
  'get',
  'post',
  'put',
  'delete',
  'patch',
]);
const VALID_FIELD_TYPES: ReadonlySet<string> = new Set([
  'text',
  'email',
  'number',
  'tel',
  'url',
  'search',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
  'password',
  'checkbox',
  'radio',
  'range',
  'color',
  'hidden',
  'select',
  'textarea',
  'button',
]);

function parseHeading(value: unknown): PageHeading | null {
  if (!isRecord(value)) return null;
  if (value.level !== 1 && value.level !== 2 && value.level !== 3 && value.level !== 4) {
    return null;
  }
  const text = str(value.text, PAGE_LIMITS.MAX_HEADING_LENGTH);
  if (!text) return null;
  return { level: value.level, text };
}

function parseLink(value: unknown): PageLink | null {
  if (!isRecord(value)) return null;
  const safe = parseSafeUrl(value.url);
  if (!safe) return null;
  const text = cellStr(value.text, PAGE_LIMITS.MAX_LINK_TEXT_LENGTH) ?? '';
  const hostname = str(value.hostname, PAGE_LIMITS.MAX_HOSTNAME) ?? safe.hostname;
  let rel: string | undefined;
  if (value.rel !== undefined) {
    const parsedRel = str(value.rel, 64);
    if (!parsedRel) return null;
    rel = parsedRel;
  }
  return { text, url: safe.href, hostname, ...(rel ? { rel } : {}) };
}

function parseTable(value: unknown): PageTable | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.headers) || value.headers.length > PAGE_LIMITS.MAX_TABLE_COLUMNS) {
    return null;
  }
  const headers: string[] = [];
  for (const header of value.headers) {
    const s = cellStr(header, PAGE_LIMITS.MAX_CELL_LENGTH);
    if (s === null) return null;
    headers.push(s);
  }
  if (!Array.isArray(value.rows) || value.rows.length > PAGE_LIMITS.MAX_TABLE_ROWS) {
    return null;
  }
  const rows: string[][] = [];
  for (const row of value.rows) {
    if (!Array.isArray(row) || row.length > PAGE_LIMITS.MAX_TABLE_COLUMNS) return null;
    const cells: string[] = [];
    for (const cell of row) {
      const s = cellStr(cell, PAGE_LIMITS.MAX_CELL_LENGTH);
      if (s === null) return null;
      cells.push(s);
    }
    rows.push(cells);
  }
  return { headers, rows, truncated: value.truncated === true };
}

function parseFormField(value: unknown): PageFormField | null {
  if (!isRecord(value)) return null;
  // Hard invariant: ONLY structural keys are allowed. A `value` key (or any
  // other unknown key) fails validation and the whole payload is rejected.
  if (
    !onlyKeys(value, new Set(['name', 'type', 'label', 'required'])) ||
    value.value !== undefined
  ) {
    return null;
  }
  const type = str(value.type, 32);
  if (!type || !VALID_FIELD_TYPES.has(type)) return null;

  let name: string | undefined;
  if (value.name !== undefined) {
    const parsedName = str(value.name, PAGE_LIMITS.MAX_FIELD_NAME_LENGTH);
    if (!parsedName) return null;
    name = parsedName;
  }
  let label: string | undefined;
  if (value.label !== undefined) {
    const parsedLabel = str(value.label, PAGE_LIMITS.MAX_FIELD_LABEL_LENGTH);
    if (!parsedLabel) return null;
    label = parsedLabel;
  }
  return {
    ...(name ? { name } : {}),
    type,
    ...(label ? { label } : {}),
    required: value.required === true,
  };
}

function parseForm(value: unknown): PageForm | null {
  if (!isRecord(value)) return null;
  if (!onlyKeys(value, new Set(['action', 'method', 'fields', 'truncated']))) {
    return null;
  }
  const method = str(value.method, 8);
  if (!method || !VALID_METHODS.has(method)) return null;

  let action: string | undefined;
  if (value.action !== undefined) {
    const parsedAction = str(value.action, PAGE_LIMITS.MAX_URL);
    if (!parsedAction) return null;
    action = parsedAction;
  }
  if (!Array.isArray(value.fields) || value.fields.length > PAGE_LIMITS.MAX_FORM_FIELDS) {
    return null;
  }
  const fields: PageFormField[] = [];
  for (const field of value.fields) {
    const parsed = parseFormField(field);
    if (!parsed) return null;
    fields.push(parsed);
  }
  return {
    ...(action ? { action } : {}),
    method,
    fields,
    truncated: value.truncated === true,
  };
}

function parseStats(value: unknown): PageContext['contentStats'] | null {
  if (!isRecord(value)) return null;
  const stats: PageContext['contentStats'] = {
    textLength: 0,
    wordCount: 0,
    paragraphCount: 0,
    headingCount: 0,
    linkCount: 0,
    tableCount: 0,
    formCount: 0,
    selectedTextLength: 0,
  };
  const keys = Object.keys(stats) as Array<keyof PageContext['contentStats']>;
  for (const key of keys) {
    const n = int(value[key], PAGE_LIMITS.MAX_TEXT_CHARACTERS);
    if (n === null) return null;
    stats[key] = n;
  }
  return stats;
}

/** Parse + validate an untrusted payload into a safe PageContext, or null. */
export function parsePageContext(payload: unknown): PageContext | null {
  if (!isRecord(payload)) return null;

  if (typeof payload.state !== 'string' || !VALID_STATES.has(payload.state)) {
    return null;
  }
  const state = payload.state as PageContextState;

  let reason: PageContextReason | undefined;
  if (payload.reason !== undefined) {
    if (typeof payload.reason !== 'string' || !VALID_REASONS.has(payload.reason)) {
      return null;
    }
    reason = payload.reason as PageContextReason;
  }

  const capturedAt = payload.capturedAt;
  if (
    typeof capturedAt !== 'string' ||
    capturedAt.length > 40 ||
    !Number.isFinite(Date.parse(capturedAt))
  ) {
    return null;
  }

  const result: PageContext = {
    state,
    headings: [],
    paragraphs: [],
    links: [],
    selectedText: null,
    tables: [],
    forms: [],
    contentStats: {
      textLength: 0,
      wordCount: 0,
      paragraphCount: 0,
      headingCount: 0,
      linkCount: 0,
      tableCount: 0,
      formCount: 0,
      selectedTextLength: 0,
    },
    truncated: false,
    capturedAt,
  };
  if (reason) result.reason = reason;

  if (payload.title !== undefined) {
    const s = str(payload.title, PAGE_LIMITS.MAX_TITLE);
    if (!s) return null;
    result.title = s;
  }

  if (payload.url !== undefined) {
    const safe = parseSafeUrl(payload.url);
    if (!safe) return null;
    result.url = safe.href;
    result.hostname = safe.hostname;
  }
  if (payload.hostname !== undefined) {
    const s = str(payload.hostname, PAGE_LIMITS.MAX_HOSTNAME);
    if (!s) return null;
    result.hostname = s;
  }
  if (payload.description !== undefined) {
    const s = str(payload.description, PAGE_LIMITS.MAX_DESCRIPTION);
    if (!s) return null;
    result.description = s;
  }
  if (payload.language !== undefined) {
    const s = str(payload.language, PAGE_LIMITS.MAX_LANGUAGE);
    if (!s) return null;
    result.language = s;
  }
  if (payload.canonicalUrl !== undefined) {
    const safe = parseSafeUrl(payload.canonicalUrl);
    if (!safe) return null;
    result.canonicalUrl = safe.href;
  }

  if (payload.headings !== undefined) {
    if (!Array.isArray(payload.headings) || payload.headings.length > PAGE_LIMITS.MAX_HEADINGS) {
      return null;
    }
    const headings: PageHeading[] = [];
    for (const h of payload.headings) {
      const parsed = parseHeading(h);
      if (!parsed) return null;
      headings.push(parsed);
    }
    result.headings = headings;
  }

  if (payload.paragraphs !== undefined) {
    if (!Array.isArray(payload.paragraphs) || payload.paragraphs.length > PAGE_LIMITS.MAX_PARAGRAPHS) {
      return null;
    }
    const paragraphs: string[] = [];
    let total = 0;
    for (const p of payload.paragraphs) {
      const s = str(p, PAGE_LIMITS.MAX_PARAGRAPH_LENGTH);
      if (s === null) return null;
      total += s.length;
      if (total > PAGE_LIMITS.MAX_TEXT_CHARACTERS) return null;
      paragraphs.push(s);
    }
    result.paragraphs = paragraphs;
  }

  if (payload.links !== undefined) {
    if (!Array.isArray(payload.links) || payload.links.length > PAGE_LIMITS.MAX_LINKS) {
      return null;
    }
    const links: PageLink[] = [];
    for (const l of payload.links) {
      const parsed = parseLink(l);
      if (!parsed) return null;
      links.push(parsed);
    }
    result.links = links;
  }

  if (payload.selectedText !== undefined) {
    if (payload.selectedText !== null) {
      const s = str(payload.selectedText, PAGE_LIMITS.MAX_SELECTED_TEXT);
      if (!s) return null;
      result.selectedText = s;
    }
  }

  if (payload.tables !== undefined) {
    if (!Array.isArray(payload.tables) || payload.tables.length > PAGE_LIMITS.MAX_TABLES) {
      return null;
    }
    const tables: PageTable[] = [];
    for (const t of payload.tables) {
      const parsed = parseTable(t);
      if (!parsed) return null;
      tables.push(parsed);
    }
    result.tables = tables;
  }

  if (payload.forms !== undefined) {
    if (!Array.isArray(payload.forms) || payload.forms.length > PAGE_LIMITS.MAX_FORMS) {
      return null;
    }
    const forms: PageForm[] = [];
    for (const f of payload.forms) {
      const parsed = parseForm(f);
      if (!parsed) return null;
      forms.push(parsed);
    }
    result.forms = forms;
  }

  if (payload.contentStats !== undefined) {
    const stats = parseStats(payload.contentStats);
    if (!stats) return null;
    result.contentStats = stats;
  }

  result.truncated = payload.truncated === true;

  if (payload.contentHash !== undefined) {
    const s = str(payload.contentHash, 16);
    if (!s || !/^[0-9a-f]{8}$/.test(s)) return null;
    result.contentHash = s;
  }

  return result;
}
