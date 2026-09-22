/**
 * Phase 3 — response parsing.
 *
 * Providers return UNTRUSTED text. Parsing is JSON-only (never eval),
 * lenient about types (coerced + rejected on violation), and always
 * returns null on anything unexpected. The validator then applies the
 * full trust policy; parsing alone grants nothing.
 */
import { isAIIntent } from './types';
import type { AIIntent, AIResponseCandidate, AISection, AISource } from './types';

/** Parse raw provider text into a structural candidate, or null. */
export function parseAICandidate(raw: unknown): AIResponseCandidate | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    // Tolerate a single code fence that a model sometimes wraps around
    // the JSON (the contract says "no fences", but we degrade safely).
    const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    try {
      value = JSON.parse(fenced ? (fenced[1] ?? '') : text);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null) return null;
  const obj = value as Record<string, unknown>;

  if (obj.status === 'error') {
    const error = (
      typeof obj.error === 'object' && obj.error !== null
        ? obj.error
        : {}
    ) as Record<string, unknown>;
    return {
      status: 'error',
      requestId: str(obj.requestId),
      intent: aiIntent(obj.intent),
      error: {
        code: str(error.code),
        message: str(error.message),
      },
    };
  }

  if (obj.status !== 'success') return null;

  const answer = str(obj.answer);
  if (answer === undefined) return null;

  return {
    status: 'success',
    requestId: str(obj.requestId),
    intent: aiIntent(obj.intent),
    answer,
    sections: sections(obj.sections),
    sources: sources(obj.sources),
  };
}

function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function aiIntent(value: unknown): AIIntent | undefined {
  return isAIIntent(value) ? value : undefined;
}

function sections(value: unknown): AISection[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const out: AISection[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return undefined;
    const o = item as Record<string, unknown>;
    const title = str(o.title);
    const content = str(o.content);
    if (title === undefined || content === undefined) return undefined;
    out.push({ title, content });
  }
  return out;
}

function sources(value: unknown): AISource[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const out: AISource[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return undefined;
    const o = item as Record<string, unknown>;
    const url = str(o.url);
    if (url === undefined) return undefined;
    out.push({ title: str(o.title) ?? '', url });
  }
  return out;
}
