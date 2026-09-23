import { beforeEach, describe, expect, it } from 'vitest';
import { AIErrorCode, AIIntent } from '../types';
import { aiError } from '../errors';
import {
  mockAIProvider,
  resetMockProvider,
  setMockProviderFailure,
  setMockProviderLatency,
  setMockProviderMalformed,
} from '../mockProvider';
import {
  alwaysAborted,
  makeAIContext,
  makeAIRequest,
  neverAborted,
} from './fixtures';

beforeEach(() => {
  resetMockProvider();
});

describe('mock provider (Phase 3, deterministic, zero-config default)', () => {
  it('advertises itself as the local mock provider', () => {
    expect(mockAIProvider.id).toBe('local-mock');
    expect(mockAIProvider.mode).toBe('mock');
    expect(mockAIProvider.isAvailable()).toBe(true);
  });

  it('produces a deterministic success candidate echoing the request', async () => {
    const request = makeAIRequest({ intent: AIIntent.Summarize });
    const result = await mockAIProvider.generate(request, neverAborted());
    expect('code' in result).toBe(false);
    if (!('code' in result)) {
      expect(result.status).toBe('success');
      expect(result.requestId).toBe('req-1');
      expect(result.intent).toBe(AIIntent.Summarize);
      expect(result.answer).toContain('Climate Report 2026');
      expect(result.sections?.length).toBeGreaterThan(0);
    }
  });

  // Phase 7 added the developer intents to the same taxonomy, so the loop is
  // simply longer (each request costs the mock provider's fixed latency).
  it('grounds each intent in the supplied context (never invents pages)', async () => {
    for (const intent of Object.values(AIIntent)) {
      const request = makeAIRequest({ intent });
      const result = await mockAIProvider.generate(request, neverAborted());
      expect('code' in result).toBe(false);
      if (!('code' in result)) {
        expect(result.intent).toBe(intent);
        expect((result.answer ?? '').toLowerCase()).toContain('climate report 2026');
      }
    }
  }, 30000);

  it('echoes the user prompt for ANSWER so stale responses are detectable', async () => {
    const a = await mockAIProvider.generate(
      makeAIRequest({ intent: AIIntent.Answer, userPrompt: 'What is X?' }),
      neverAborted(),
    );
    const b = await mockAIProvider.generate(
      makeAIRequest({ intent: AIIntent.Answer, userPrompt: 'What is Y?' }),
      neverAborted(),
    );
    if (!('code' in a) && !('code' in b)) {
      expect(a.answer).toContain('What is X?');
      expect(b.answer).toContain('What is Y?');
      expect(a.answer).not.toBe(b.answer);
    }
  });

  it('is deterministic — same request yields identical output', async () => {
    const request = makeAIRequest({ intent: AIIntent.Analyze });
    const one = await mockAIProvider.generate(request, neverAborted());
    const two = await mockAIProvider.generate(request, neverAborted());
    expect(one).toEqual(two);
  });

  it('returns the injected typed failure without reaching content', async () => {
    setMockProviderFailure(aiError(AIErrorCode.AI_RATE_LIMITED));
    const result = await mockAIProvider.generate(
      makeAIRequest(),
      neverAborted(),
    );
    expect('code' in result).toBe(true);
    if ('code' in result) {
      expect(result.code).toBe(AIErrorCode.AI_RATE_LIMITED);
      expect(result.retryable).toBe(true);
    }
  });

  it('returns a hostile malformed candidate for the validator to reject', async () => {
    setMockProviderMalformed(true);
    const result = await mockAIProvider.generate(
      makeAIRequest(),
      neverAborted(),
    );
    expect('code' in result).toBe(false);
    if (!('code' in result)) {
      // Deliberately wrong requestId + unsafe content; the validator, not
      // the provider, is responsible for rejecting this.
      expect(result.requestId).toBe('evil-request-id');
      expect(result.answer).toContain('<script>');
      expect(result.sources?.[0]?.url).toBe('javascript:alert(1)');
    }
  });

  it('honors cancellation when aborted before starting', async () => {
    const result = await mockAIProvider.generate(makeAIRequest(), alwaysAborted());
    expect('code' in result).toBe(true);
    if ('code' in result) {
      expect(result.code).toBe(AIErrorCode.AI_CANCELLED);
    }
  });

  it('honors cancellation while waiting on latency', async () => {
    setMockProviderLatency(500);
    const controller = new AbortController();
    const pending = mockAIProvider.generate(makeAIRequest(), controller.signal);
    setTimeout(() => controller.abort(), 5);
    const result = await pending;
    expect('code' in result).toBe(true);
    if ('code' in result) {
      expect(result.code).toBe(AIErrorCode.AI_CANCELLED);
    }
    resetMockProvider();
  });

  it('never leaks raw form values (there are none in AIContext)', async () => {
    // AIContext has no form fields by construction; guard the shape.
    const context = makeAIContext();
    expect(Object.keys(context)).not.toContain('forms');
    expect(JSON.stringify(context)).not.toContain('password');
  });
});
