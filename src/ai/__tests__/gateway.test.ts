import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIErrorCode, AIIntent } from '../types';
import type { AIResponseCandidate } from '../types';
import {
  callReasonEndpoint,
  getGatewayUrlFromEnv,
  isValidGatewayUrl,
  mapHttpError,
  REASON_PATH,
  reasonEndpoint,
  setGatewayUrlOverride,
  type GatewayFetcher,
} from '../gateway';
import { makeAIContext } from './fixtures';

const BASE = 'https://gateway.example.com';

function jsonResponse(status: number, body: unknown): GatewayFetcher {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }));
}

afterEach(() => {
  setGatewayUrlOverride(undefined);
});

describe('gateway URL configuration', () => {
  it('reads the gateway URL at call time (override seam)', () => {
    expect(getGatewayUrlFromEnv()).toBeUndefined();
    setGatewayUrlOverride('https://gateway.example.com');
    expect(getGatewayUrlFromEnv()).toBe('https://gateway.example.com');
    setGatewayUrlOverride(undefined);
    expect(getGatewayUrlFromEnv()).toBeUndefined();
  });

  it('requires https (http only for localhost development)', () => {
    expect(isValidGatewayUrl('https://gateway.example.com')).toBe(true);
    expect(isValidGatewayUrl('http://localhost:8080')).toBe(true);
    expect(isValidGatewayUrl('http://127.0.0.1:8080')).toBe(true);
    expect(isValidGatewayUrl('http://gateway.example.com')).toBe(false);
    expect(isValidGatewayUrl('ftp://gateway.example.com')).toBe(false);
    expect(isValidGatewayUrl('not a url')).toBe(false);
    expect(isValidGatewayUrl(undefined)).toBe(false);
  });

  it('rejects base URLs carrying paths, queries, or fragments', () => {
    expect(isValidGatewayUrl('https://gateway.example.com/api')).toBe(false);
    expect(isValidGatewayUrl('https://gateway.example.com/?x=1')).toBe(false);
    expect(isValidGatewayUrl('https://gateway.example.com/#frag')).toBe(false);
  });

  it('builds the /v1/reason endpoint', () => {
    expect(reasonEndpoint(BASE)).toBe(`${BASE}${REASON_PATH}`);
    expect(reasonEndpoint(`${BASE}/`)).toBe(`${BASE}${REASON_PATH}`);
  });
});

describe('callReasonEndpoint (POST /v1/reason)', () => {
  const request = {
    requestId: 'req-1',
    intent: AIIntent.Summarize,
    system: 'sys',
    prompt: 'User request: hi',
    context: makeAIContext(),
  };
  const signal = new AbortController().signal;

  it('POSTs the contract body and returns the parsed candidate', async () => {
    const fetcher = jsonResponse(200, {
      requestId: 'req-1',
      intent: AIIntent.Summarize,
      status: 'success',
      answer: 'ok',
    });
    const result = await callReasonEndpoint({
      baseUrl: BASE,
      request,
      signal,
      fetcher,
    });
    expect('code' in result).toBe(false);
    expect((result as AIResponseCandidate).answer).toBe('ok');

    // Wire contract assertions.
    const [url, init] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(url).toBe(`${BASE}${REASON_PATH}`);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toMatchObject({
      requestId: 'req-1',
      intent: 'SUMMARIZE',
      system: 'sys',
    });
    // No secrets travel from the extension: no Authorization header.
    expect(init.headers['Authorization']).toBeUndefined();
  });

  it('maps HTTP failures to typed errors', async () => {
    const cases: Array<[number, string]> = [
      [401, AIErrorCode.AI_AUTH_ERROR],
      [403, AIErrorCode.AI_AUTH_ERROR],
      [429, AIErrorCode.AI_RATE_LIMITED],
      [400, AIErrorCode.AI_INVALID_REQUEST],
      [413, AIErrorCode.AI_INVALID_REQUEST],
      [500, AIErrorCode.AI_PROVIDER_ERROR],
      [503, AIErrorCode.AI_PROVIDER_ERROR],
      [418, AIErrorCode.AI_INVALID_RESPONSE],
    ];
    for (const [status, code] of cases) {
      const result = await callReasonEndpoint({
        baseUrl: BASE,
        request,
        signal,
        fetcher: jsonResponse(status, ''),
      });
      expect('code' in result, `status ${status}`).toBe(true);
      if ('code' in result) expect(result.code).toBe(code);
    }
  });

  it('rejects non-JSON response bodies as invalid responses', async () => {
    const result = await callReasonEndpoint({
      baseUrl: BASE,
      request,
      signal,
      fetcher: jsonResponse(200, '<html>not json</html>'),
    });
    expect('code' in result).toBe(true);
    if ('code' in result) {
      expect(result.code).toBe(AIErrorCode.AI_INVALID_RESPONSE);
    }
  });

  it('maps network failures to AI_NETWORK_ERROR without leaking details', async () => {
    const fetcher: GatewayFetcher = vi.fn(async () => {
      throw new Error('ECONNREFUSED 10.0.0.5:443 secret-key=abc');
    });
    const result = await callReasonEndpoint({
      baseUrl: BASE,
      request,
      signal,
      fetcher,
    });
    expect('code' in result).toBe(true);
    if ('code' in result) {
      expect(result.code).toBe(AIErrorCode.AI_NETWORK_ERROR);
      expect(result.message).not.toContain('ECONNREFUSED');
      expect(result.message).not.toContain('secret-key');
    }
  });

  it('returns AI_CANCELLED when the external signal aborts', async () => {
    const controller = new AbortController();
    const fetcher: GatewayFetcher = vi.fn(
      (_url, init) =>
        new Promise<never>((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
          controller.abort();
        }),
    );
    const result = await callReasonEndpoint({
      baseUrl: BASE,
      request,
      signal: controller.signal,
      fetcher,
    });
    expect('code' in result).toBe(true);
    if ('code' in result) expect(result.code).toBe(AIErrorCode.AI_CANCELLED);
  });

  it('times out slow gateways with AI_TIMEOUT', async () => {
    const fetcher: GatewayFetcher = vi.fn(
      (_url, init) =>
        new Promise<never>((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const result = await callReasonEndpoint({
      baseUrl: BASE,
      request,
      signal,
      fetcher,
      timeoutMs: 150,
    });
    expect('code' in result).toBe(true);
    if ('code' in result) expect(result.code).toBe(AIErrorCode.AI_TIMEOUT);
  }, 10000);

  it('rejects invalid base URLs as a configuration error', async () => {
    const result = await callReasonEndpoint({
      baseUrl: 'http://insecure.example.com',
      request,
      signal,
      fetcher: jsonResponse(200, {}),
    });
    expect('code' in result).toBe(true);
    if ('code' in result) {
      expect(result.code).toBe(AIErrorCode.AI_CONFIGURATION_ERROR);
    }
  });
});

describe('mapHttpError', () => {
  it('covers the full documented status space', () => {
    expect(mapHttpError(408).code).toBe(AIErrorCode.AI_TIMEOUT);
    expect(mapHttpError(404).code).toBe(AIErrorCode.AI_INVALID_RESPONSE);
    expect(mapHttpError(401).retryable).toBe(false);
    expect(mapHttpError(429).retryable).toBe(true);
  });
});
