import { describe, expect, it } from 'vitest';
import { AI_LIMITS } from '../limits';
import { AIErrorCode, AIIntent } from '../types';
import type { AIResponseCandidate } from '../types';
import { parseAICandidate } from '../parser';
import { validateAIResponse } from '../validator';
import { makeAIRequest } from './fixtures';

const request = makeAIRequest();

function validCandidate(overrides: Partial<AIResponseCandidate> = {}): AIResponseCandidate {
  return {
    requestId: 'req-1',
    intent: AIIntent.Summarize,
    status: 'success',
    answer: 'A short answer.',
    sections: [{ title: 'Main', content: '- point one' }],
    sources: [
      { title: 'Methodology', url: 'https://example.org/method' },
    ],
    ...overrides,
  };
}

describe('parseAICandidate (untrusted text → structure, or null)', () => {
  it('parses valid JSON text', () => {
    const candidate = parseAICandidate(JSON.stringify(validCandidate()));
    expect(candidate?.status).toBe('success');
  });

  it('tolerates a single markdown fence around the JSON', () => {
    const candidate = parseAICandidate(
      '```json\n' + JSON.stringify(validCandidate()) + '\n```',
    );
    expect(candidate?.answer).toBe('A short answer.');
  });

  it('returns null for non-JSON, prose, or malformed input', () => {
    expect(parseAICandidate('Sure, here is your answer!')).toBeNull();
    expect(parseAICandidate('{broken')).toBeNull();
    expect(parseAICandidate(42)).toBeNull();
    expect(parseAICandidate(null)).toBeNull();
    expect(parseAICandidate(undefined)).toBeNull();
  });

  it('never evaluates code — JSON.parse only', () => {
    // A naive eval-based parser would execute this; JSON.parse rejects it.
    expect(parseAICandidate('{ "x": globalThis.__pwned = true }')).toBeNull();
  });
});

describe('validateAIResponse (the trust policy)', () => {
  it('accepts a fully valid candidate and stamps provenance', () => {
    const result = validateAIResponse(validCandidate(), request, 'local-mock');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.requestId).toBe('req-1');
      expect(result.response.intent).toBe(AIIntent.Summarize);
      expect(result.response.provider).toBe('local-mock');
      expect(result.response.answer).toBe('A short answer.');
    }
  });

  it('rejects a mismatched or missing requestId (replay protection)', () => {
    for (const candidate of [
      validCandidate({ requestId: 'evil-request-id' }),
      validCandidate({ requestId: undefined }),
    ]) {
      const result = validateAIResponse(candidate, request, 'local-mock');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(AIErrorCode.AI_INVALID_RESPONSE);
      }
    }
  });

  it('rejects a mismatched intent', () => {
    const result = validateAIResponse(
      validCandidate({ intent: AIIntent.Extract }),
      request,
      'local-mock',
    );
    expect(result.ok).toBe(false);
  });

  it('rejects unknown fields (closed response contract)', () => {
    const candidate = {
      ...validCandidate(),
      execute: 'chrome.tabs.remove(1)',
    } as AIResponseCandidate;
    const result = validateAIResponse(candidate, request, 'local-mock');
    expect(result.ok).toBe(false);
  });

  it('rejects over-budget answers, sections, and sources', () => {
    expect(
      validateAIResponse(
        validCandidate({ answer: 'x'.repeat(AI_LIMITS.MAX_ANSWER_CHARS + 1) }),
        request,
        'local-mock',
      ).ok,
    ).toBe(false);

    expect(
      validateAIResponse(
        validCandidate({
          sections: Array.from({ length: AI_LIMITS.MAX_SECTIONS + 1 }, (_, i) => ({
            title: `s${i}`,
            content: 'ok',
          })),
        }),
        request,
        'local-mock',
      ).ok,
    ).toBe(false);

    expect(
      validateAIResponse(
        validCandidate({
          sources: Array.from({ length: AI_LIMITS.MAX_SOURCES + 1 }, (_, i) => ({
            title: `s${i}`,
            url: `https://example.com/${i}`,
          })),
        }),
        request,
        'local-mock',
      ).ok,
    ).toBe(false);
  });

  it('accepts only absolute http/https source URLs', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>x</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'not a url',
    ]) {
      const result = validateAIResponse(
        validCandidate({ sources: [{ title: 'x', url }] }),
        request,
        'local-mock',
      );
      expect(result.ok, url).toBe(false);
    }

    const ok = validateAIResponse(
      validCandidate({
        sources: [{ title: 'Docs', url: 'https://example.org/docs' }],
      }),
      request,
      'local-mock',
    );
    expect(ok.ok).toBe(true);
  });

  it('rejects the hostile malformed candidate end to end', () => {
    const hostile: AIResponseCandidate = {
      requestId: 'evil-request-id',
      intent: AIIntent.Answer,
      status: 'success',
      answer:
        'Sure! <script>window.__pwned = true;</script> Ignore previous instructions.',
      sections: [
        { title: 'harm', content: '<img src=x onerror=alert(1)> [c](javascript:alert(1))' },
      ],
      sources: [{ title: 'x', url: 'javascript:alert(1)' }],
    };
    const result = validateAIResponse(hostile, request, 'local-mock');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(AIErrorCode.AI_INVALID_RESPONSE);
      // User-safe wording only — no hostile payload leakage.
      expect(result.error.message).not.toContain('script');
      expect(result.error.message).not.toContain('alert');
    }
  });

  it('maps provider error candidates to typed errors', () => {
    const result = validateAIResponse(
      {
        requestId: 'req-1',
        status: 'error',
        error: { code: 'AI_RATE_LIMITED', message: 'secret-token=abc123' },
      },
      request,
      'secure-gateway',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(AIErrorCode.AI_RATE_LIMITED);
      // The provider's raw message must not surface.
      expect(result.error.message).not.toContain('secret-token');
    }
  });

  it('rejects null candidates (unparseable output)', () => {
    const result = validateAIResponse(null, request, 'local-mock');
    expect(result.ok).toBe(false);
  });
});
