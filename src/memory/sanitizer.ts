/**
 * Phase 6 — memory text hygiene and normalization.
 *
 * Two different jobs live here, both purely textual:
 *
 * 1. `cleanMemoryText` — make an untrusted string safe and readable:
 *    line breaks collapse to spaces, control characters are dropped,
 *    surrounding quotes are removed. It NEVER truncates and NEVER
 *    decides whether something is allowed to be stored (that is the
 *    policy's job) and it never inspects secrets.
 *
 * 2. Normalization helpers used by the matcher (`normalizeWords`,
 *    `memoryTokens`, `changeMarker`, `frameOf`) — deterministic, so
 *    duplicate detection, updates, and retrieval never vary between runs.
 */

// Intentional: stripping control characters is the purpose of this helper.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F\u2028\u2029]/g;
const LINE_BREAKS = /[\t\r\n\u2028\u2029]/g;

/** Trim + collapse whitespace and strip surrounding quotation marks. */
export function cleanMemoryText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(LINE_BREAKS, ' ')
    .replace(CONTROL_CHARACTERS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”‘’]+/, '')
    .replace(/["'“”‘’]+$/, '')
    .replace(/[.;,]+$/, '')
    .trim();
  return cleaned.length === 0 ? null : cleaned;
}

/** Defensive display truncation for values read back from storage. */
export function truncateForView(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/** Light, deterministic stem/synonym folding (no NLP, no randomness). */
const TOKEN_ALIASES: Record<string, string> = {
  prefers: 'prefer',
  preferred: 'prefer',
  preferring: 'prefer',
  preference: 'prefer',
  preferences: 'prefer',
  likes: 'like',
  liked: 'like',
  using: 'use',
  uses: 'use',
  used: 'use',
  projects: 'project',
  languages: 'language',
  works: 'work',
  working: 'work',
  codebases: 'codebase',
  frontends: 'frontend',
  backends: 'backend',
  always: 'always',
};

/**
 * Fold a token to its comparison form: lowercase, possessive-free, plural
 * and simple verb endings removed, aliases applied.
 */
export function normalizeWord(word: string): string {
  const base = word
    .toLowerCase()
    .replace(/['’]s$/, '')
    .replace(/[^a-z0-9+#.-]/g, '');
  if (base.length === 0) return '';
  const alias = TOKEN_ALIASES[base];
  if (alias) return alias;
  if (base.length > 4 && base.endsWith('s') && !base.endsWith('ss')) {
    const singular = base.slice(0, -1);
    return TOKEN_ALIASES[singular] ?? singular;
  }
  return base;
}

/** Non-semantic words removed before comparison/retrieval scoring. */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'does',
  'for', 'from', 'has', 'have', 'i', 'if', 'in', 'is', 'it', 'its', 'me',
  'my', 'of', 'on', 'or', 'our', 'so', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'this', 'to', 'user', 'users', 'was', 'we',
  'were', 'when', 'which', 'who', 'will', 'with', 'you', 'your',
]);

export function isStopword(token: string): boolean {
  return STOPWORDS.has(token);
}

/** All normalized non-empty tokens (stopwords included). */
export function normalizeWords(text: string): string[] {
  return text
    .split(/[\s,/]+/)
    .map((word) => normalizeWord(word))
    .filter((word) => word.length > 0);
}

/** Salient tokens: normalized, stopwords removed, de-duplicated. */
export function memoryTokens(text: string): string[] {
  const out: string[] = [];
  for (const token of normalizeWords(text)) {
    if (isStopword(token)) continue;
    if (!out.includes(token)) out.push(token);
  }
  return out;
}

/** Phrases that signal "this replaces what I said before". */
const CHANGE_MARKER =
  /\b(now|instead|no longer|actually|currently|these days|from now on|updated|changed|switched|switch to|anymore)\b/i;

export function changeMarker(text: string): boolean {
  return CHANGE_MARKER.test(text);
}

/**
 * The leading predicate of a memory sentence, from a closed set. Used only
 * for the conservative conflict heuristic: two memories share a frame when
 * they talk about the same attribute ("prefer X" vs "prefer Y").
 */
const FRAME_VERBS: readonly string[] = [
  'prefer',
  'use',
  'like',
  'want',
  'need',
  'work',
  'learn',
  'avoid',
  'write',
  'speak',
];

export function frameOf(text: string): string | null {
  const words = normalizeWords(text).filter((word) => !isStopword(word));
  for (const word of words) {
    if (FRAME_VERBS.includes(word)) return word;
  }
  return null;
}

/**
 * Tokens after the frame verb, used to detect a "single value" attribute
 * ("prefer TypeScript" vs "prefer JavaScript") — the only shape where the
 * conflict heuristic is applied.
 */
export function objectOf(text: string): string[] {
  const words = normalizeWords(text).filter((word) => !isStopword(word));
  const frameIndex = words.findIndex((word) => FRAME_VERBS.includes(word));
  const tail = frameIndex >= 0 ? words.slice(frameIndex + 1) : words;
  return tail.filter((word) => !CHANGE_MARKER_NOUNS.has(word));
}

const CHANGE_MARKER_NOUNS: ReadonlySet<string> = new Set([
  'now',
  'instead',
  'actually',
  'currently',
]);

/** Context prepositions that qualify a value ("… for frontend work"). */
const OBJECT_PREPOSITIONS: ReadonlySet<string> = new Set([
  'for',
  'on',
  'in',
  'at',
  'when',
  'with',
  'under',
  'during',
  'about',
]);

export type AttributeShape = 'noun' | 'qualified';

/**
 * The shape of a memory's value: a simple value ("prefer TypeScript") or a
 * context-qualified one ("prefer TypeScript for frontend work"). Only
 * memories of the same shape can describe the same attribute, which keeps
 * qualified preferences from being treated as replacements for each other.
 */
export function attributeShape(text: string): AttributeShape | null {
  const object = objectOf(text);
  if (object.length === 0) return null;
  if (normalizeWords(text).some((word) => OBJECT_PREPOSITIONS.has(word))) {
    return 'qualified';
  }
  return object.length <= 2 ? 'noun' : 'qualified';
}
