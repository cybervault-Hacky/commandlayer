/**
 * Phase 3 — AI reasoning client (orchestrator).
 *
 * The single entry point for reasoning requests:
 *   validate prompt → build minimal context → provider.generate
 *   (with timeout + cancellation) → parse → validate → AIResponse.
 *
 * UI code never calls providers directly. Every result is either a
 * validated AIResponse or a typed AIError with user-safe wording.
 */
import { AI_LIMITS } from './limits';
import { aiError, toAIError } from './errors';
import { parseAICandidate } from './parser';
import { validateAIResponse } from './validator';
import { getActiveAIProvider } from './index';
import {
  AIErrorCode,
  isAIError,
  type AIContext,
  type AIError,
  type AIIntent,
  type AIRequest,
  type AIResponse,
} from './types';

export type AIResult =
  | { ok: true; response: AIResponse }
  | { ok: false; error: AIError };

export interface RunAIRequestOptions {
  requestId: string;
  intent: AIIntent;
  userPrompt: string;
  /** Minimized AI context built by the caller (buildAIContext). */
  context: AIContext;
  /** External cancellation (user navigated away, superseded, retry). */
  signal: AbortSignal;
  timeoutMs?: number;
}

/**
 * Run one reasoning request end to end. Never throws; always resolves
 * with a typed result.
 */
export async function runAIRequest(options: RunAIRequestOptions): Promise<AIResult> {
  if (options.signal.aborted) {
    return { ok: false, error: aiError(AIErrorCode.AI_CANCELLED) };
  }

  const request: AIRequest = {
    requestId: options.requestId,
    intent: options.intent,
    userPrompt: options.userPrompt,
    context: options.context,
    createdAt: new Date().toISOString(),
  };

  const provider = getActiveAIProvider();

  // Internal timeout composed with the external abort signal.
  const controller = new AbortController();
  const externalAbort = () => controller.abort('external');
  if (options.signal.aborted) externalAbort();
  else options.signal.addEventListener('abort', externalAbort, { once: true });

  const timeoutMs = Math.min(
    AI_LIMITS.MAX_TIMEOUT_MS,
    Math.max(AI_LIMITS.MIN_TIMEOUT_MS, options.timeoutMs ?? AI_LIMITS.DEFAULT_TIMEOUT_MS),
  );
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);

  let raw;
  try {
    raw = await provider.generate(request, controller.signal);
  } catch (err) {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', externalAbort);
    return { ok: false, error: toAIError(err) };
  }
  clearTimeout(timer);
  options.signal.removeEventListener('abort', externalAbort);

  if (isAIError(raw)) {
    // An internal timeout surfaces as a cancellation from the provider;
    // re-label it so the UI shows the right guidance. External aborts
    // stay cancellations.
    if (raw.code === AIErrorCode.AI_CANCELLED && !options.signal.aborted) {
      return { ok: false, error: aiError(AIErrorCode.AI_TIMEOUT) };
    }
    return { ok: false, error: raw };
  }

  const candidate = parseAICandidate(raw);
  const validation = validateAIResponse(candidate, request, provider.id);
  return validation.ok
    ? { ok: true, response: validation.response }
    : { ok: false, error: validation.error };
}
