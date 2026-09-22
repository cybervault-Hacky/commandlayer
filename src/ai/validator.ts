/**
 * Phase 3 — response validation: the trust policy.
 *
 * EVERY provider response (mock or gateway) passes through here before
 * the UI may render it. The policy:
 * - requestId must echo the request (correlation + replay protection)
 * - intent must match the request when present
 * - only the allowlisted fields are accepted (unknown fields → reject)
 * - every string is re-sanitized and length-capped
 * - sources must be ABSOLUTE http/https URLs (parseSafeUrl); dangerous
 *   protocols (javascript:, data:, vbscript:, file:, ...) are rejected
 * - error responses are mapped to typed AIErrors with safe messages
 *
 * Nothing parsed by parser.ts is trusted until this module approves it.
 */
import { parseSafeUrl } from '@/shared/security/url';
import { AI_LIMITS } from './limits';
import { aiError } from './errors';
import {
  AIErrorCode,
  isAIIntent,
  type AIError,
  type AIRequest,
  type AIResponse,
  type AIResponseCandidate,
} from './types';

export type ValidationResult =
  | { ok: true; response: AIResponse }
  | { ok: false; error: AIError };

/** The only fields a successful candidate may carry (closed contract). */
const ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  'requestId',
  'intent',
  'status',
  'answer',
  'sections',
  'sources',
]);

/**
 * Validate a parsed candidate against the originating request.
 * `providerId` is stamped onto the approved response for UI provenance.
 */
export function validateAIResponse(
  candidate: AIResponseCandidate | null,
  request: AIRequest,
  providerId: string,
): ValidationResult {
  if (candidate === null) {
    return { ok: false, error: aiError(AIErrorCode.AI_INVALID_RESPONSE) };
  }

  if (candidate.status === 'error') {
    return { ok: false, error: mapProviderError(candidate.error) };
  }

  // Closed shape: only allowlisted fields may appear. Unknown fields mean
  // the provider drifted from (or is attacking) the contract — reject.
  for (const key of Object.keys(candidate)) {
    if (!ALLOWED_FIELDS.has(key)) {
      return { ok: false, error: aiError(AIErrorCode.AI_INVALID_RESPONSE) };
    }
  }

  // Correlation: the provider must echo our requestId. A missing or
  // mismatched id means the response cannot be correlated — reject it.
  if (candidate.requestId !== request.requestId) {
    return { ok: false, error: aiError(AIErrorCode.AI_INVALID_RESPONSE) };
  }

  // Intent: must match when the provider echoes one.
  if (candidate.intent !== undefined && !isAIIntent(candidate.intent)) {
    return { ok: false, error: aiError(AIErrorCode.AI_INVALID_RESPONSE) };
  }
  if (candidate.intent !== undefined && candidate.intent !== request.intent) {
    return { ok: false, error: aiError(AIErrorCode.AI_INVALID_RESPONSE) };
  }

  const answer = cleanText(candidate.answer ?? '', AI_LIMITS.MAX_ANSWER_CHARS);
  if (answer === null) {
    return { ok: false, error: aiError(AIErrorCode.AI_INVALID_RESPONSE) };
  }

  const sections = validateSections(candidate.sections);
  if (sections === null) {
    return { ok: false, error: aiError(AIErrorCode.AI_INVALID_RESPONSE) };
  }

  const sources = validateSources(candidate.sources);
  if (sources === null) {
    return { ok: false, error: aiError(AIErrorCode.AI_INVALID_RESPONSE) };
  }

  return {
    ok: true,
    response: {
      requestId: request.requestId,
      intent: request.intent,
      status: 'success',
      answer,
      sections,
      sources,
      provider: providerId,
      finishedAt: new Date().toISOString(),
    },
  };
}

// Intentional: stripping control characters from untrusted AI output.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function cleanText(value: string, max: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(CONTROL_CHARS, '').trim();
  if (cleaned.length === 0 || cleaned.length > max) return null;
  return cleaned;
}

function validateSections(
  value: AIResponseCandidate['sections'],
): AIResponse['sections'] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  if (value.length > AI_LIMITS.MAX_SECTIONS) return null;
  const out: AIResponse['sections'] = [];
  for (const s of value) {
    if (typeof s !== 'object' || s === null) return null;
    const title = cleanText(s.title, AI_LIMITS.MAX_SECTION_TITLE);
    const content = cleanText(s.content, AI_LIMITS.MAX_SECTION_CONTENT);
    if (title === null || content === null) return null;
    out.push({ title, content });
  }
  return out;
}

function validateSources(
  value: AIResponseCandidate['sources'],
): AIResponse['sources'] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  if (value.length > AI_LIMITS.MAX_SOURCES) return null;
  const out: AIResponse['sources'] = [];
  const seen = new Set<string>();
  for (const s of value) {
    if (typeof s !== 'object' || s === null) return null;
    // Absolute URL required (no relative "references"), then protocol
    // allowlist via parseSafeUrl (http/https only).
    let absolute: URL;
    try {
      absolute = new URL(s.url);
    } catch {
      return null;
    }
    const safe = parseSafeUrl(absolute.href);
    if (safe === null) return null;
    const title = cleanText(s.title, AI_LIMITS.MAX_SOURCE_TITLE) ?? '';
    if (seen.has(safe.href)) continue; // de-dupe, not a violation
    seen.add(safe.href);
    out.push({ title, url: safe.href });
  }
  return out;
}

function mapProviderError(
  error: { code?: string; message?: string } | undefined,
): AIError {
  const code = error?.code;
  if (code !== undefined && isAIErrorCode(code)) return aiError(code);
  return aiError(AIErrorCode.AI_PROVIDER_ERROR);
}

function isAIErrorCode(value: string): value is AIErrorCode {
  return Object.values(AIErrorCode).includes(value as AIErrorCode);
}
