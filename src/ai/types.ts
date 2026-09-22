/**
 * Phase 3 — Real AI Reasoning Engine: core contracts.
 *
 * The extension never executes anything an AI returns: the AI is a
 * reasoning-only service. Providers receive a typed `AIRequest` (user
 * intent + explicit, minimized page context) and return a raw candidate
 * that is ALWAYS parsed and validated before the UI may render it.
 *
 * Webpage data is untrusted input: prompts separate system instructions,
 * the user's request, and the webpage data block (see prompts.ts).
 */
import type { PageContext } from '@/shared/types/page';

/**
 * Reasoning-only intents. There is deliberately no action intent
 * (no CLICK / TYPE / SUBMIT / NAVIGATE / DELETE / SEND / PURCHASE):
 * CommandLayer does not grant AI permission to perform browser actions.
 */
export const AIIntent = {
  Summarize: 'SUMMARIZE',
  Analyze: 'ANALYZE',
  Explain: 'EXPLAIN',
  Extract: 'EXTRACT',
  Answer: 'ANSWER',
} as const;

export type AIIntent = (typeof AIIntent)[keyof typeof AIIntent];

export function isAIIntent(value: unknown): value is AIIntent {
  return (
    typeof value === 'string' &&
    Object.values(AIIntent).includes(value as AIIntent)
  );
}

/** Page metadata that is safe and useful to reason about. */
export interface AIContextPage {
  title?: string;
  url?: string;
  hostname?: string;
  language?: string;
  description?: string;
}

/**
 * The explicit, minimized context handed to the AI. Every field is
 * intent-relevant (built per-intent by context.ts) and sanitized.
 * Form fields and their values are never part of this object.
 */
export interface AIContext {
  page: AIContextPage;
  headings: Array<{ level: number; text: string }>;
  /** Readable page text (paragraphs joined). May be empty. */
  text: string;
  links: Array<{ text: string; url: string; hostname: string }>;
  tables: Array<{ headers: string[]; rows: string[][] }>;
  /** The user's explicit selection, if any (never form data). */
  selectedText: string | null;
  /** True when some section was truncated to fit the budget. */
  truncated: boolean;
}

/**
 * Phase 6 — one saved memory as the AI sees it. Deliberately tiny: a
 * category and the user's own words. Memory is DATA (never instructions),
 * it is bounded in count, and it is only ever attached when it is
 * relevant to the request.
 */
export interface AISavedMemory {
  kind: string;
  content: string;
}

/** A fully-typed, validated request for the AI reasoning engine. */
export interface AIRequest {
  requestId: string;
  intent: AIIntent;
  /** The user's own words (command text / question). */
  userPrompt: string;
  context: AIContext;
  /**
   * Phase 6 — relevant saved memories the user explicitly stored. Absent
   * or empty when memory is off or nothing was relevant.
   */
  memory?: readonly AISavedMemory[];
  createdAt: string;
}

export interface AISource {
  title: string;
  url: string;
}

export interface AISection {
  title: string;
  /** Markdown content (rendered by the safe Markdown renderer). */
  content: string;
}

/** Raw provider output, before validation. Never trust this shape. */
export interface AIResponseCandidate {
  requestId?: string;
  intent?: AIIntent;
  status: 'success' | 'error';
  answer?: string;
  sections?: AISection[];
  sources?: AISource[];
  error?: { code?: string; message?: string };
}

/** A validated, sanitized response safe for the UI to render. */
export interface AIResponse {
  requestId: string;
  intent: AIIntent;
  status: 'success';
  answer: string;
  sections: AISection[];
  sources: AISource[];
  /** Provider id that produced the response (e.g. 'local-mock'). */
  provider: string;
  finishedAt: string;
}

/**
 * AI error codes. Every code has a fixed, user-safe message
 * (USER_ERROR_MESSAGES) — provider internals, auth details, and raw
 * error text are never forwarded to the UI.
 */
export const AIErrorCode = {
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  AI_TIMEOUT: 'AI_TIMEOUT',
  AI_RATE_LIMITED: 'AI_RATE_LIMITED',
  AI_AUTH_ERROR: 'AI_AUTH_ERROR',
  AI_INVALID_RESPONSE: 'AI_INVALID_RESPONSE',
  AI_INVALID_REQUEST: 'AI_INVALID_REQUEST',
  AI_CONTEXT_TOO_LARGE: 'AI_CONTEXT_TOO_LARGE',
  AI_NETWORK_ERROR: 'AI_NETWORK_ERROR',
  AI_PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
  AI_CONFIGURATION_ERROR: 'AI_CONFIGURATION_ERROR',
  AI_PAGE_UNAVAILABLE: 'AI_PAGE_UNAVAILABLE',
  AI_CANCELLED: 'AI_CANCELLED',
} as const;

export type AIErrorCode =
  (typeof AIErrorCode)[keyof typeof AIErrorCode];

export interface AIError {
  code: AIErrorCode;
  /** User-safe message. Never contains secrets or provider internals. */
  message: string;
  retryable: boolean;
}

export function isAIError(value: unknown): value is AIError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof (value as AIError).code === 'string' &&
    'retryable' in value &&
    typeof (value as AIError).retryable === 'boolean'
  );
}

/**
 * A reasoning provider. The UI never calls providers directly — it goes
 * through the client/orchestrator, which adds timeout, cancellation,
 * and validation. `generate` must be abort-aware and must NEVER throw:
 * it resolves with a candidate or a typed AIError.
 *
 * The interface is streaming-ready: a future phase can add
 * `generateStream(request, signal, onDelta)` without changing the
 * pipeline.
 */
export interface AIProvider {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  /** 'mock' = deterministic local provider, 'gateway' = remote backend. */
  readonly mode: 'mock' | 'gateway';
  isAvailable(): boolean;
  generate(request: AIRequest, signal: AbortSignal): Promise<AIResponseCandidate | AIError>;
}

/** Phase 2 PageContext, re-exported for context-builder consumers. */
export type { PageContext };

/** Safe, non-secret provider status for the Settings UI. */
export interface AIStatusInfo {
  providerId: string;
  providerLabel: string;
  mode: 'mock' | 'gateway' | 'none';
  gatewayConfigured: boolean;
}
