/**
 * Phase 6 — the centralized memory safety policy.
 *
 * This is the single gate every memory write passes through, whether the
 * proposal came from a command, the management UI, or a confirmation of an
 * earlier preview. Nothing is stored that this module did not accept, and
 * the same policy runs again on every record read back from storage
 * (defense in depth against tampering or corruption).
 *
 * The classifier is deliberately CONSERVATIVE: when it is uncertain, it
 * BLOCKS. Memory is never a secret vault — passwords, codes, card data,
 * keys, tokens, seed phrases, and authentication material are refused with
 * a safe message, and the refused text is never echoed back.
 */
import { MemoryScope, isMemoryKind } from './types';
import type { MemoryInput, MemoryKind } from './types';
import { MEMORY_LIMITS } from './limits';
import { cleanMemoryText } from './sanitizer';

export type MemoryPolicyCode =
  | 'EMPTY'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'SENSITIVE'
  | 'INVALID_KIND'
  | 'INVALID_SCOPE'
  | 'INVALID_PROJECT';

export type MemoryPolicyResult =
  | {
      ok: true;
      content: string;
      kind: MemoryKind;
      scope: MemoryScope;
      project: string | null;
    }
  | { ok: false; code: MemoryPolicyCode; reason: string };

/**
 * Keyword families that always block. Word-boundary anchored so a short
 * token like `pin` cannot match inside `shipping` or `pinned`.
 */
const SENSITIVE_KEYWORD_PATTERNS: readonly RegExp[] = [
  /\bpasswords?\b/i,
  /\bpasswd\b/i,
  /\bpass\s?phrases?\b/i,
  /\bcredentials?\b/i,
  /\blogin\s+(?:details|credentials)\b/i,
  /\bmy\s+login\b/i,
  /\b(?:one[\s-]?time|otp|sms|login|auth(?:entication)?|verification|security)\s+code\b/i,
  /\botp\b/i,
  /\b2fa\b/i,
  /\btwo[\s-]?factor\b/i,
  /\b(?:backup|recovery)\s+codes?\b/i,
  /\bsecurity\s+questions?\b/i,
  /\bcredit\s?cards?\b/i,
  /\bdebit\s?cards?\b/i,
  /\bcard\s+(?:number|no|expiry|expiration|verification)\b/i,
  /\bcvv\b/i,
  /\bcvc\b/i,
  /\bcsc\b/i,
  /\biban\b/i,
  /\bswift\s+code\b/i,
  /\b(?:routing|account)\s+number\b/i,
  /\bbank\s+(?:account|details|credentials)\b/i,
  /\bssn\b/i,
  /\bsocial\s+security\b/i,
  /\bapi[\s_-]?keys?\b/i,
  /\b(?:secret|private|signing|encryption|ssh)\s+keys?\b/i,
  /\baccess\s+tokens?\b/i,
  /\brefresh\s+tokens?\b/i,
  /\bauth(?:entication)?\s+tokens?\b/i,
  /\bsession\s+(?:token|id|cookie)s?\b/i,
  /\bbearer\s+tokens?\b/i,
  /\bclient\s+secrets?\b/i,
  /\boauth\b/i,
  /\bjwt\b/i,
  /\bseed\s+phrases?\b/i,
  /\brecovery\s+phrases?\b/i,
  /\bmnemonics?\b/i,
  /\bauthorization\s+headers?\b/i,
  /\bcookies?\b/i,
  // A bare "token" is harmless ("tokens of appreciation"), but "token is X"
  // is a credential assignment — block it.
  /\b(?:tokens?|secrets?)\b\s*(?:is|are|was|were|:|=)\s*\S+/i,
  /\b(?:password|passwd|pin|api[_-]?key)\b\s*(?:is|are|was|were|:|=)\s*\S+/i,
];

/**
 * Value shapes that block regardless of wording: card-length digit runs,
 * JWTs, prefixed key material, long mixed-case secret blobs, and
 * credential-bearing headers/URLs.
 */
const SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  /\b(?:\d[ -]?){13,19}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{4,})?\b/,
  /\b(?:sk|pk|rk|ghp|gho|ghs|ghu|xox[baprs]|AKIA|AIza)[-_A-Za-z0-9]{12,}\b/,
  /\b(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*\d)[A-Za-z0-9+/]{32,}={0,2}\b/,
  /\b(?:authorization|proxy-authorization|x-api-key)\s*[:=]\s*\S+/i,
  /\b(?:set-)?cookie\s*[:=]\s*\S+/i,
  /\bhttps?:\/\/[^\s/@]+:[^\s/@]+@/i,
];

/** True when the text looks like secret material (conservative). */
export function containsSensitiveMemoryContent(content: string): boolean {
  for (const pattern of SENSITIVE_KEYWORD_PATTERNS) {
    if (pattern.test(content)) return true;
  }
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    if (pattern.test(content)) return true;
  }
  return false;
}

const PROJECT_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._+-]*$/;

/** Validate + sanitize a project label (PROJECT scope only). */
export function cleanProjectLabel(raw: unknown): string | null {
  const cleaned = cleanMemoryText(raw);
  if (cleaned === null) return null;
  if (cleaned.length > MEMORY_LIMITS.MAX_MEMORY_PROJECT_LENGTH) return null;
  if (!PROJECT_LABEL_PATTERN.test(cleaned)) return null;
  if (containsSensitiveMemoryContent(cleaned)) return null;
  return cleaned;
}

const TOO_SHORT_REASON = 'That is too short to remember as a useful note.';
const TOO_LONG_REASON = `Memories are short by design — keep it under ${MEMORY_LIMITS.MAX_MEMORY_CONTENT_LENGTH} characters.`;
const SENSITIVE_REASON =
  'Passwords, codes, payment details, keys, and tokens are never saved as memory.';

/**
 * The single policy gate. Returns the sanitized, validated memory or a
 * typed refusal — never throws, never echoes sensitive input.
 */
export function evaluateMemoryContent(
  raw: unknown,
  kind: unknown,
  scope: unknown = MemoryScope.Global,
  project: unknown = null,
): MemoryPolicyResult {
  if (!isMemoryKind(kind)) {
    return { ok: false, code: 'INVALID_KIND', reason: 'Unknown memory category.' };
  }
  const resolvedScope: MemoryScope =
    scope === MemoryScope.Project ? MemoryScope.Project : MemoryScope.Global;
  if (scope !== undefined && scope !== null && scope !== MemoryScope.Global && scope !== MemoryScope.Project) {
    return { ok: false, code: 'INVALID_SCOPE', reason: 'Unknown memory scope.' };
  }

  const content = cleanMemoryText(raw);
  if (content === null) {
    return { ok: false, code: 'EMPTY', reason: 'There was nothing to save.' };
  }
  if (content.length < MEMORY_LIMITS.MIN_MEMORY_CONTENT_LENGTH) {
    return { ok: false, code: 'TOO_SHORT', reason: TOO_SHORT_REASON };
  }
  if (content.length > MEMORY_LIMITS.MAX_MEMORY_CONTENT_LENGTH) {
    return { ok: false, code: 'TOO_LONG', reason: TOO_LONG_REASON };
  }
  if (containsSensitiveMemoryContent(content)) {
    return { ok: false, code: 'SENSITIVE', reason: SENSITIVE_REASON };
  }

  let resolvedProject: string | null = null;
  if (resolvedScope === MemoryScope.Project) {
    resolvedProject = cleanProjectLabel(project);
    if (resolvedProject === null) {
      return {
        ok: false,
        code: 'INVALID_PROJECT',
        reason: 'That project name could not be used.',
      };
    }
  }

  return {
    ok: true,
    content,
    kind,
    scope: resolvedScope,
    project: resolvedProject,
  };
}

/** Convenience wrapper for a fully-formed input object. */
export function evaluateMemoryInput(input: MemoryInput): MemoryPolicyResult {
  return evaluateMemoryContent(
    input.content,
    input.kind,
    input.scope ?? MemoryScope.Global,
    input.project ?? null,
  );
}

/** True when the value may be stored/loaded as memory content. */
export function isAcceptableStoredContent(
  content: unknown,
  kind: unknown,
): boolean {
  return evaluateMemoryContent(content, kind).ok;
}
