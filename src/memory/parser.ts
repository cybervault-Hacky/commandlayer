/**
 * Phase 6 — deterministic memory command parsing.
 *
 * A memory command is recognized by explicit phrasing only ("remember …",
 * "forget …", "what do you remember …"). There is no model in this path
 * and no fuzzy classification: the same sentence always parses the same
 * way, which is what makes "the user asked for this" a meaningful claim.
 *
 * Nothing here writes anything. Parsing produces a typed operation that
 * still has to pass the policy and be confirmed by the user.
 */
import {
  MemoryIntent,
  MemoryScope,
  type ParsedMemoryCommand,
} from './types';
import { MEMORY_LIMITS } from './limits';
import { cleanMemoryText, changeMarker } from './sanitizer';
import { cleanProjectLabel } from './policy';

/** Quoted project label: `for project "CommandLayer"` / `for the "X" project`. */
const PROJECT_QUOTED = [
  /\b(?:for|in|on)\s+(?:the\s+|my\s+|our\s+)?project\s+"([^"]{1,40})"/i,
  /\b(?:for|in|on)\s+(?:the\s+|my\s+|our\s+)?project\s+([A-Za-z0-9._+-]{1,40})\b/i,
  /\b(?:for|in|on)\s+(?:the\s+|my\s+|our\s+)?(?:"([^"]{1,40})"|([A-Za-z0-9._+-]{1,40}))\s+project\b/i,
];

function stripProjectClause(text: string): {
  text: string;
  scope: MemoryScope;
  project: string | null;
} {
  for (const pattern of PROJECT_QUOTED) {
    const match = pattern.exec(text);
    if (!match) continue;
    const label = cleanProjectLabel(match[1] ?? match[2] ?? null);
    if (label === null) continue;
    const stripped = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`;
    return {
      text: stripped.replace(/\s+/g, ' ').trim(),
      scope: MemoryScope.Project,
      project: label,
    };
  }
  return { text, scope: MemoryScope.Global, project: null };
}

/** Leading connectives left behind after a clause is removed. */
function stripConnectives(text: string): string {
  return text
    .replace(/^[\s,;:]+/, '')
    .replace(/^(?:that|which)\s+/i, '')
    .trim();
}

/**
 * A phrase made only of scaffolding ("that", "this", "it") is not a
 * memory: "Remember that" must not store the word "that".
 */
function isBareConnective(text: string): boolean {
  return /^(?:that|which|this|it|them|those|these)$/i.test(text.trim());
}

interface Pattern {
  pattern: RegExp;
  intent: MemoryIntent;
  /** Group that carries the stored phrase (REMEMBER/UPDATE). */
  contentGroup?: number;
  /** Group that carries the lookup query (FORGET/LIST/UPDATE). */
  queryGroup?: number;
  /** Explicit "update … to …" phrasing (requires a target memory). */
  explicitUpdate?: boolean;
}

/**
 * Order matters:
 * 1. listing questions (they contain the word "remember"),
 * 2. forgetting,
 * 3. explicit updates,
 * 4. remembering.
 */
const PATTERNS: readonly Pattern[] = [
  {
    intent: MemoryIntent.ListMemory,
    pattern: /^(?:what|which)\s+(?:do\s+)?you\s+(?:remember|know)\b\s*(?:about\s+)?(.*)$/i,
    queryGroup: 1,
  },
  {
    intent: MemoryIntent.ListMemory,
    pattern: /^(?:please\s+)?(?:list|show|display)\s+(?:me\s+)?(?:my\s+|all\s+|the\s+)?(?:saved\s+)?memor(?:y|ies)\b\s*(?:about\s+)?(.*)$/i,
    queryGroup: 1,
  },
  {
    intent: MemoryIntent.ListMemory,
    pattern: /^(?:my|saved)\s+memor(?:y|ies)$/i,
  },
  {
    intent: MemoryIntent.Forget,
    pattern: /^(?:please\s+)?forget\s+(?:about\s+|that\s+|the\s+memory\s+(?:about|of|that)\s+|my\s+)?(.+)$/i,
    queryGroup: 1,
  },
  {
    intent: MemoryIntent.Forget,
    pattern: /^(?:please\s+)?(?:delete|remove)\s+(?:the\s+|my\s+)?(?:saved\s+)?memor(?:y|ies)\s+(?:about\s+|of\s+|for\s+|that\s+)?(.+)$/i,
    queryGroup: 1,
  },
  {
    intent: MemoryIntent.Forget,
    pattern: /^(?:please\s+)?stop\s+remembering\s+(.+)$/i,
    queryGroup: 1,
  },
  {
    intent: MemoryIntent.UpdateMemory,
    pattern: /^(?:please\s+)?(?:update|change|replace|correct)\s+(?:my\s+|the\s+)?(?:saved\s+)?memory\s+(?:about\s+|of\s+|for\s+|on\s+)?(.+?)\s+(?:to|with|saying|so\s+it\s+says)\s+(.+)$/i,
    queryGroup: 1,
    contentGroup: 2,
    explicitUpdate: true,
  },
  {
    intent: MemoryIntent.Remember,
    pattern: /^(?:please\s+)?remember\s+(?:that\s+)?(.+)$/i,
    contentGroup: 1,
  },
  {
    intent: MemoryIntent.Remember,
    pattern: /^(?:please\s+)?keep\s+in\s+mind\s+(?:that\s+)?(.+)$/i,
    contentGroup: 1,
  },
];

/**
 * Parse one command text into a typed memory operation, or null when the
 * text is not a memory command (it then flows to the normal pipeline).
 */
export function parseMemoryCommand(raw: unknown): ParsedMemoryCommand | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text.length === 0 || text.length > MEMORY_LIMITS.MAX_MEMORY_COMMAND_LENGTH) {
    return null;
  }

  const withScope = stripProjectClause(text);
  const body = withScope.text;

  for (const entry of PATTERNS) {
    const match = entry.pattern.exec(body);
    if (!match) continue;

    const content =
      entry.contentGroup !== undefined
        ? cleanMemoryText(stripConnectives(match[entry.contentGroup] ?? ''))
        : null;
    const query =
      entry.queryGroup !== undefined
        ? cleanMemoryText(stripConnectives(match[entry.queryGroup] ?? '')) ?? ''
        : '';

    if (entry.intent === MemoryIntent.Remember && content === null) continue;
    if (entry.intent === MemoryIntent.UpdateMemory && content === null) continue;
    if (entry.intent === MemoryIntent.ListMemory && content !== null) continue;
    if (content !== null && isBareConnective(content)) continue;

    const resolvedIntent =
      entry.intent === MemoryIntent.Remember && changeMarker(content ?? '')
        ? MemoryIntent.UpdateMemory
        : entry.intent;

    return {
      intent: resolvedIntent,
      content: content ?? '',
      query,
      scope: withScope.scope,
      project: withScope.project,
      explicitChange: changeMarker(content ?? query),
      explicitUpdate: entry.explicitUpdate === true,
    };
  }

  return null;
}

/** True when the text is a memory command (used before planning/AI). */
export function isMemoryCommand(raw: unknown): boolean {
  return parseMemoryCommand(raw) !== null;
}

/**
 * Map a listing question to a category filter ("what do you remember
 * about my preferences?" → PREFERENCE). Deterministic keyword mapping.
 */
export function kindFilterFromQuery(query: string): ParsedMemoryKindFilter {
  const text = query.toLowerCase();
  if (/\bpreferences?\b/.test(text)) return 'PREFERENCE';
  if (/\bwork\s?styles?\b/.test(text)) return 'WORK_STYLE';
  if (/\bprojects?\b/.test(text)) return 'PROJECT_CONTEXT';
  if (/\b(?:instructions?|rules?|standing orders?)\b/.test(text)) {
    return 'EXPLICIT_INSTRUCTION';
  }
  if (/\b(?:facts?|about me|know about me)\b/.test(text)) return 'USER_FACT';
  return null;
}

export type ParsedMemoryKindFilter =
  | 'PREFERENCE'
  | 'USER_FACT'
  | 'WORK_STYLE'
  | 'PROJECT_CONTEXT'
  | 'EXPLICIT_INSTRUCTION'
  | null;
