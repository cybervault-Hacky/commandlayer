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
import { isSafeRepoPath } from '@/github/patterns';
import { parseSafeUrl } from '@/shared/security/url';
import { AI_LIMITS } from './limits';
import { aiError } from './errors';
import {
  AIErrorCode,
  FindingCategory,
  FindingConfidence,
  FindingSeverity,
  isAIIntent,
  type AIChangePlan,
  type AIError,
  type AIFinding,
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
  // Phase 7 — developer results (validated strictly, see below).
  'findings',
  'changePlan',
]);

/**
 * Phase 7 — wording guard. A finding that asserts certainty is DISCARDED:
 * the brief (and honest engineering) allow "potential issue", "worth
 * checking", "this may…", "evidence suggests…" — never "this is definitely a
 * bug". This is enforced, not merely requested in the prompt.
 */
const CERTAINTY_CLAIM =
  /\b(definitely|certainly|guaranteed|guarantees?|undeniably|without (?:a )?doubt|proves that|proof that|will always|must be a bug|is a bug|is broken|is wrong at line)\b/i;

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

  // Phase 7 — findings are filtered per item (an invalid finding is dropped,
  // never rendered), while a change plan is all-or-nothing.
  const findings = validateFindings(candidate.findings);
  if (findings === null) {
    return { ok: false, error: aiError(AIErrorCode.AI_INVALID_RESPONSE) };
  }
  const changePlan = validateChangePlan(candidate.changePlan);
  if (changePlan === undefined) {
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
      findings,
      changePlan,
      provider: providerId,
      finishedAt: new Date().toISOString(),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const set = new Set(allowed);
  return Object.keys(record).every((key) => set.has(key));
}

function isClosedValue<T extends string>(
  values: Record<string, T>,
  value: unknown,
): value is T {
  return typeof value === 'string' && Object.values(values).includes(value as T);
}

/**
 * Validate the untrusted findings array. Returns [] when absent, null when
 * the field exists but is not an array / is oversized (a contract violation),
 * and otherwise the individually-validated findings.
 */
function validateFindings(value: unknown): AIFinding[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  if (value.length > AI_LIMITS.MAX_FINDINGS) return null;
  const out: AIFinding[] = [];
  for (const entry of value) {
    const finding = parseFinding(entry);
    if (finding !== null) out.push(finding);
  }
  return out;
}

function parseFinding(value: unknown): AIFinding | null {
  if (!isRecord(value)) return null;
  if (
    !onlyKeys(value, [
      'severity',
      'category',
      'file',
      'line',
      'explanation',
      'evidence',
      'confidence',
    ])
  ) {
    return null;
  }
  if (!isClosedValue(FindingSeverity, value.severity)) return null;
  if (!isClosedValue(FindingCategory, value.category)) return null;
  if (!isClosedValue(FindingConfidence, value.confidence)) return null;

  let file: string | null = null;
  if (value.file !== undefined && value.file !== null) {
    if (typeof value.file !== 'string' || !isSafeRepoPath(value.file)) return null;
    file = value.file;
  }

  let line: number | null = null;
  if (value.line !== undefined && value.line !== null) {
    if (
      typeof value.line !== 'number' ||
      !Number.isInteger(value.line) ||
      value.line < 1 ||
      value.line > 5_000_000
    ) {
      return null;
    }
    line = value.line;
  }

  const explanation = cleanText(String(value.explanation ?? ''), AI_LIMITS.MAX_FINDING_TEXT);
  if (explanation === null) return null;
  // Evidence is REQUIRED: a finding without evidence is not a finding.
  const evidence = cleanText(String(value.evidence ?? ''), AI_LIMITS.MAX_FINDING_TEXT);
  if (evidence === null) return null;
  if (CERTAINTY_CLAIM.test(explanation) || CERTAINTY_CLAIM.test(evidence)) return null;

  return {
    severity: value.severity,
    category: value.category,
    file,
    line,
    explanation,
    evidence,
    confidence: value.confidence,
  };
}

/** undefined = field absent (fine); null = present but rejected. */
function validateChangePlan(value: unknown): AIChangePlan | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return undefined;
  if (!onlyKeys(value, ['summary', 'steps'])) return undefined;

  const summary = cleanText(String(value.summary ?? ''), AI_LIMITS.MAX_FINDING_TEXT);
  if (summary === null) return undefined;

  const steps = value.steps;
  if (!Array.isArray(steps) || steps.length === 0) return undefined;
  if (steps.length > AI_LIMITS.MAX_CHANGE_PLAN_STEPS) return undefined;

  const parsedSteps: AIChangePlan['steps'] = [];
  for (const step of steps) {
    if (!isRecord(step) || !onlyKeys(step, ['title', 'detail', 'files'])) {
      return undefined;
    }
    const title = cleanText(String(step.title ?? ''), AI_LIMITS.MAX_CHANGE_PLAN_TITLE);
    if (title === null) return undefined;

    let detail: string | undefined;
    if (step.detail !== undefined) {
      const parsed = cleanText(String(step.detail), AI_LIMITS.MAX_CHANGE_PLAN_DETAIL);
      if (parsed === null) return undefined;
      detail = parsed;
    }

    let files: string[] | undefined;
    if (step.files !== undefined) {
      if (!Array.isArray(step.files) || step.files.length > AI_LIMITS.MAX_CHANGE_PLAN_FILES) {
        return undefined;
      }
      const parsedFiles: string[] = [];
      for (const file of step.files) {
        if (typeof file !== 'string' || !isSafeRepoPath(file)) return undefined;
        parsedFiles.push(file);
      }
      files = parsedFiles;
    }

    parsedSteps.push({
      title,
      ...(detail !== undefined ? { detail } : {}),
      ...(files !== undefined ? { files } : {}),
    });
  }

  return { summary, steps: parsedSteps };
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
