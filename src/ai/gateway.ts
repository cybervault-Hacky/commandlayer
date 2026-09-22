/**
 * Phase 3 — Secure Intelligence Gateway contract.
 *
 * Architecture: Extension → HTTPS → Secure Gateway → AI Provider.
 * The extension NEVER holds a provider secret. Credentials live in the
 * gateway (server-side); the extension only knows the gateway URL.
 *
 * Wire contract: POST {gateway}/v1/reason
 *   request : { requestId, intent, prompt, system, context }
 *   response: JSON matching AIResponseCandidate (success) or
 *             { status: 'error', requestId, intent, error: {code,message} }
 *
 * This module is transport-agnostic: the HTTP call is an injected
 * fetcher, so the whole contract is unit-testable without a network.
 */
import { aiError } from './errors';
import { AI_LIMITS } from './limits';
import {
  AIErrorCode,
  type AIContext,
  type AIError,
  type AIIntent,
  type AIResponseCandidate,
} from './types';

/** Path of the reasoning endpoint on the gateway. */
export const REASON_PATH = '/v1/reason';

/** Body shape of POST /v1/reason. */
export interface GatewayReasonRequest {
  requestId: string;
  intent: AIIntent;
  /** System layer (instructions + task). */
  system: string;
  /** User layer + untrusted webpage data layer. */
  prompt: string;
  /** Minimal structured page context (never raw PageContext/forms). */
  context: AIContext;
}

/** Minimal fetch-like signature (compatible with global fetch). */
export type GatewayFetcher = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface GatewayCallOptions {
  baseUrl: string;
  request: GatewayReasonRequest;
  signal: AbortSignal;
  fetcher?: GatewayFetcher;
  timeoutMs?: number;
}

export type GatewayResult = AIResponseCandidate | AIError;

/**
 * Explicit gateway URL override (tests / tooling seam). Production code
 * never calls the setter — the URL comes from the build environment.
 */
let gatewayUrlOverride: string | undefined;
export function setGatewayUrlOverride(url: string | undefined): void {
  gatewayUrlOverride = url;
}

/**
 * Read the configured gateway URL. Returns undefined when unconfigured.
 * Secrets are never read here — only the gateway's URL.
 */
export function getGatewayUrlFromEnv(): string | undefined {
  if (gatewayUrlOverride !== undefined) return gatewayUrlOverride;
  const meta = (import.meta as unknown as { env?: Record<string, unknown> })
    .env;
  const raw = meta?.VITE_AI_GATEWAY_URL;
  return typeof raw === 'string' && raw.trim().length > 0
    ? raw.trim()
    : undefined;
}

/**
 * Validate a gateway base URL. HTTPS is required, except for localhost
 * loopback URLs (local development). No path, query, or fragment.
 */
export function isValidGatewayUrl(raw: string | undefined): raw is string {
  if (typeof raw !== 'string') return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.protocol === 'http:') {
    const host = url.hostname;
    const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    if (!local) return false;
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return false;
  return true;
}

/** Full reasoning endpoint for a configured gateway base URL. */
export function reasonEndpoint(baseUrl: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}${REASON_PATH}`;
}

/**
 * Execute one reasoning call against the gateway. Maps every failure to
 * a typed AIError with user-safe wording; never throws.
 */
export async function callReasonEndpoint(
  options: GatewayCallOptions,
): Promise<GatewayResult> {
  const { request, signal } = options;
  const timeoutMs = options.timeoutMs ?? AI_LIMITS.DEFAULT_TIMEOUT_MS;
  if (!isValidGatewayUrl(options.baseUrl)) {
    return aiError(AIErrorCode.AI_CONFIGURATION_ERROR);
  }
  const fetcher: GatewayFetcher =
    options.fetcher ?? ((globalThis.fetch as unknown as GatewayFetcher) ?? (
      async () => {
        throw new Error('fetch unavailable');
      }
    ));

  const body: GatewayReasonRequest = request;
  const serialized = JSON.stringify(body);
  if (serialized.length > AI_LIMITS.MAX_SERIALIZE_CHARS * 2) {
    return aiError(AIErrorCode.AI_CONTEXT_TOO_LARGE);
  }

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const combined = combineSignals(signal, timeoutController.signal);

  try {
    const res = await fetcher(reasonEndpoint(options.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: serialized,
      signal: combined,
    });

    if (!res.ok) return mapHttpError(res.status);

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return aiError(AIErrorCode.AI_INVALID_RESPONSE);
    }
    // Structural candidate; the validator applies the trust policy.
    return parsed as AIResponseCandidate;
  } catch {
    if (signal.aborted) return aiError(AIErrorCode.AI_CANCELLED);
    if (timeoutController.signal.aborted) {
      return aiError(AIErrorCode.AI_TIMEOUT);
    }
    return aiError(AIErrorCode.AI_NETWORK_ERROR);
  } finally {
    clearTimeout(timer);
    timeoutController.abort();
  }
}

/** Map HTTP status codes to typed AI errors (user-safe wording only). */
export function mapHttpError(status: number): AIError {
  if (status === 401 || status === 403) return aiError(AIErrorCode.AI_AUTH_ERROR);
  if (status === 408) return aiError(AIErrorCode.AI_TIMEOUT);
  if (status === 429) return aiError(AIErrorCode.AI_RATE_LIMITED);
  if (status === 400 || status === 413 || status === 422) {
    return aiError(AIErrorCode.AI_INVALID_REQUEST);
  }
  if (status >= 500) return aiError(AIErrorCode.AI_PROVIDER_ERROR);
  return aiError(AIErrorCode.AI_INVALID_RESPONSE);
}

/** Compose an external abort signal with an internal timeout signal. */
function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const relay = (reason: unknown) => {
    controller.abort(reason);
  };
  if (a.aborted) relay(a.reason);
  else a.addEventListener('abort', () => relay(a.reason), { once: true });
  if (b.aborted) relay(b.reason);
  else b.addEventListener('abort', () => relay(b.reason), { once: true });
  return controller.signal;
}
