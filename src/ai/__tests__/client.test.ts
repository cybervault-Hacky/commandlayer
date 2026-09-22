import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getActiveAIProvider,
  getAIProvider,
  getAIStatusInfo,
  registerAIProvider,
} from '../index';
import {
  resetMockProvider,
  setMockProviderLatency,
  setMockProviderMalformed,
} from '../mockProvider';
import { setGatewayUrlOverride } from '../gateway';
import { runAIRequest } from '../client';
import { AIErrorCode, AIIntent } from '../types';
import { makeAIContext, makeAIRequest } from './fixtures';

beforeEach(() => {
  resetMockProvider();
});

afterEach(() => {
  resetMockProvider();
  setGatewayUrlOverride(undefined);
});

describe('provider registry', () => {
  it('defaults to the local mock provider with zero configuration', () => {
    const provider = getActiveAIProvider();
    expect(provider.id).toBe('local-mock');
    expect(getAIProvider('local-mock')).toBeDefined();
    expect(getAIProvider('secure-gateway')).toBeDefined();
  });

  it('keeps the mock active while no gateway URL is configured', () => {
    expect(getActiveAIProvider().mode).toBe('mock');
    const status = getAIStatusInfo();
    expect(status).toMatchObject({
      providerId: 'local-mock',
      mode: 'mock',
      gatewayConfigured: false,
    });
  });

  it('activates the gateway provider when a valid URL is configured', () => {
    setGatewayUrlOverride('https://gateway.example.com');
    expect(getActiveAIProvider().id).toBe('secure-gateway');
    expect(getAIStatusInfo()).toMatchObject({
      mode: 'gateway',
      gatewayConfigured: true,
    });
  });

  it('falls back to the mock for invalid gateway URLs', () => {
    setGatewayUrlOverride('http://insecure.example.com');
    expect(getActiveAIProvider().id).toBe('local-mock');
    setGatewayUrlOverride('not a url');
    expect(getActiveAIProvider().id).toBe('local-mock');
  });

  it('registers additional providers by id', () => {
    registerAIProvider({
      id: 'test-extra',
      displayName: 'Extra',
      version: '0.0.1',
      mode: 'mock',
      isAvailable: () => false,
      generate: async () => ({ code: AIErrorCode.AI_UNAVAILABLE, message: 'x', retryable: false }),
    });
    expect(getAIProvider('test-extra')?.displayName).toBe('Extra');
    // Unavailable providers never become active.
    expect(getActiveAIProvider().id).toBe('local-mock');
  });
});

describe('runAIRequest (orchestration)', () => {
  const options = {
    requestId: 'req-1',
    intent: AIIntent.Summarize,
    userPrompt: 'Summarize this page',
    context: makeAIContext(),
    signal: new AbortController().signal,
  };

  it('returns a validated response end to end', async () => {
    const result = await runAIRequest(options);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.requestId).toBe('req-1');
      expect(result.response.intent).toBe(AIIntent.Summarize);
      expect(result.response.provider).toBe('local-mock');
      expect(result.response.answer.length).toBeGreaterThan(0);
    }
  });

  it('converts provider cancellations from internal timeouts to AI_TIMEOUT', async () => {
    setMockProviderLatency(2000);
    const result = await runAIRequest({ ...options, timeoutMs: 1000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(AIErrorCode.AI_TIMEOUT);
    resetMockProvider();
  }, 10000);

  it('keeps external cancellations as AI_CANCELLED', async () => {
    setMockProviderLatency(2000);
    const controller = new AbortController();
    const pending = runAIRequest({
      ...options,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(AIErrorCode.AI_CANCELLED);
    resetMockProvider();
  }, 10000);

  it('rejects already-aborted requests immediately', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runAIRequest({ ...options, signal: controller.signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(AIErrorCode.AI_CANCELLED);
  });

  it('rejects malformed provider output as AI_INVALID_RESPONSE', async () => {
    setMockProviderMalformed(true);
    const result = await runAIRequest(options);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(AIErrorCode.AI_INVALID_RESPONSE);
      expect(result.error.message).not.toContain('script');
    }
  });

  it('clamps timeout values into the safe window', async () => {
    setMockProviderLatency(0);
    // Sub-minimum timeouts are clamped UP, so a fast provider still wins.
    const result = await runAIRequest({ ...options, timeoutMs: 1 });
    expect(result.ok).toBe(true);
  });

  it('builds requests with the full AIRequest shape', () => {
    const request = makeAIRequest();
    expect(request).toMatchObject({
      requestId: expect.any(String),
      intent: expect.any(String),
      userPrompt: expect.any(String),
      context: expect.any(Object),
      createdAt: expect.any(String),
    });
  });
});
