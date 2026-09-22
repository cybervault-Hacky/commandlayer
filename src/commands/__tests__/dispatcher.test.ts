import { beforeEach, describe, expect, it } from 'vitest';
import {
  resetMockProvider,
  setMockProviderFailure,
  setMockProviderLatency,
  setMockProviderMalformed,
} from '@/ai/mockProvider';
import { aiError } from '@/ai/errors';
import { AIErrorCode, AIIntent } from '@/ai/types';
import { buildPageContext } from '@/shared/pageContext';
import type { PageContext } from '@/shared/types/page';
import { CommandDispatcher } from '../dispatcher';
import {
  buildCommandRequest,
  buildQuickActionRequest,
} from '../requests';
import type { CommandRequest } from '@/shared/types/command';

beforeEach(() => {
  resetMockProvider();
});

/** A page with real captured content the reasoning engine can use. */
function pageWithContent(overrides: Partial<PageContext> = {}): PageContext {
  return {
    ...buildPageContext({ title: 'GitHub', url: 'https://github.com/' }),
    state: 'ready',
    headings: [{ level: 1, text: 'GitHub' }],
    paragraphs: ['Build and ship software with your team.'],
    links: [
      { text: 'Pricing', url: 'https://github.com/pricing', hostname: 'github.com' },
    ],
    contentStats: {
      textLength: 40,
      wordCount: 7,
      paragraphCount: 1,
      headingCount: 1,
      linkCount: 1,
      tableCount: 0,
      formCount: 0,
      selectedTextLength: 0,
    },
    ...overrides,
  };
}

function makeRequest(overrides: Partial<CommandRequest> = {}): CommandRequest {
  return {
    id: 'test-1',
    text: 'Summarize this page',
    source: 'sidepanel',
    context: pageWithContent(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('CommandDispatcher (Phase 3 reasoning pipeline)', () => {
  it('completes a command through the reasoning engine with a validated response', async () => {
    const result = await new CommandDispatcher().dispatch(makeRequest());
    expect(result.status).toBe('completed');
    expect(result.id).toBe('test-1');
    expect(result.source).toBe('sidepanel');
    expect(result.intent).toBe(AIIntent.Summarize);
    expect(result.ai).toBeDefined();
    expect(result.ai?.requestId).toBe('test-1');
    expect(result.ai?.provider).toBe('local-mock');
    expect(result.text).toBe(result.ai?.answer);
    expect(result.text).toContain('GitHub');
  });

  it('classifies free text deterministically (ANSWER fallback)', async () => {
    const result = await new CommandDispatcher().dispatch(
      makeRequest({ text: 'Who maintains this site?' }),
    );
    expect(result.status).toBe('completed');
    expect(result.intent).toBe(AIIntent.Answer);
    expect(result.ai?.intent).toBe(AIIntent.Answer);
  });

  it('uses the explicit intent for quick actions', async () => {
    for (const [quickAction, intent] of [
      ['analyze', AIIntent.Analyze],
      ['summarize', AIIntent.Summarize],
      ['explain', AIIntent.Explain],
      ['extract', AIIntent.Extract],
    ] as const) {
      const result = await new CommandDispatcher().dispatch(
        makeRequest({
          quickAction,
          text: `${quickAction} the current page`,
        }),
      );
      expect(result.status, quickAction).toBe('completed');
      expect(result.intent).toBe(intent);
      expect(result.quickAction).toBe(quickAction);
    }
  });

  it('rejects empty commands', async () => {
    const result = await new CommandDispatcher().dispatch(
      makeRequest({ text: '   ' }),
    );
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('EMPTY_COMMAND');
    expect(result.text).toMatch(/enter a command/i);
  });

  it('rejects overly long commands', async () => {
    const result = await new CommandDispatcher().dispatch(
      makeRequest({ text: 'x'.repeat(2001) }),
    );
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('INVALID_PAYLOAD');
  });

  it('rejects malformed requests', async () => {
    const result = await new CommandDispatcher().dispatch({
      ...makeRequest(),
      id: '',
    } as CommandRequest);
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('INVALID_PAYLOAD');
  });

  it('fails safely when no page content is available', async () => {
    const result = await new CommandDispatcher().dispatch(
      makeRequest({ context: null }),
    );
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('AI_PAGE_UNAVAILABLE');
    expect(result.retryable).toBe(true);
  });

  it('fails safely when the captured page has nothing to reason about', async () => {
    const result = await new CommandDispatcher().dispatch(
      makeRequest({
        context: buildPageContext({ title: 'GitHub', url: 'https://github.com/' }),
      }),
    );
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('AI_PAGE_UNAVAILABLE');
  });

  it('survives a throwing handler without leaking internals', async () => {
    const dispatcher = new CommandDispatcher({
      handle: async () => {
        throw new Error('internal boom');
      },
    });
    const result = await dispatcher.dispatch(makeRequest());
    expect(result.status).toBe('failed');
    expect(result.text).not.toContain('internal boom');
    expect(result.text).toMatch(/something went wrong/i);
  });

  it('maps handler errors onto the result with retryability', async () => {
    const dispatcher = new CommandDispatcher({
      handle: async () => ({
        kind: 'error',
        error: aiError(AIErrorCode.AI_RATE_LIMITED),
      }),
    });
    const result = await dispatcher.dispatch(makeRequest());
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('AI_RATE_LIMITED');
    expect(result.retryable).toBe(true);
    expect(result.text).toMatch(/too many requests/i);
  });

  it('uses the provider-configured failure in the real pipeline', async () => {
    setMockProviderFailure(aiError(AIErrorCode.AI_UNAVAILABLE));
    const result = await new CommandDispatcher().dispatch(makeRequest());
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('AI_UNAVAILABLE');
  });

  it('rejects malformed provider output as AI_INVALID_RESPONSE', async () => {
    setMockProviderMalformed(true);
    const result = await new CommandDispatcher().dispatch(makeRequest());
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('AI_INVALID_RESPONSE');
    expect(result.text).not.toContain('script');
  });

  it('cancels an in-flight request when a newer one arrives (same source)', async () => {
    setMockProviderLatency(200);
    const dispatcher = new CommandDispatcher();
    const first = dispatcher.dispatch(
      makeRequest({ id: 'first', text: 'Summarize this page' }),
    );
    // Second dispatch supersedes the first from the same source.
    const second = dispatcher.dispatch(
      makeRequest({ id: 'second', text: 'Explain this page' }),
    );
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.status).toBe('failed');
    expect(firstResult.errorCode).toBe('AI_CANCELLED');
    expect(secondResult.status).toBe('completed');
    expect(secondResult.id).toBe('second');
    resetMockProvider();
  });

  it('does not cancel requests from different sources', async () => {
    setMockProviderLatency(50);
    const dispatcher = new CommandDispatcher();
    const [a, b] = await Promise.all([
      dispatcher.dispatch(makeRequest({ id: 'a', source: 'sidepanel' })),
      dispatcher.dispatch(makeRequest({ id: 'b', source: 'command-center' })),
    ]);
    expect(a.status).toBe('completed');
    expect(b.status).toBe('completed');
    resetMockProvider();
  });
});

describe('request builders', () => {
  it('builds structured command requests', () => {
    const request = buildCommandRequest({
      text: 'hello',
      source: 'sidepanel',
      context: null,
    });
    expect(request.id).toBeTruthy();
    expect(request.text).toBe('hello');
    expect(request.source).toBe('sidepanel');
    expect(request.context).toBeNull();
    expect(request.createdAt).toBeTruthy();
  });

  it('builds quick action requests from templates', () => {
    const request = buildQuickActionRequest(
      'explain',
      'command-center',
      buildPageContext({ title: 'GitHub', url: 'https://github.com/' }),
    );
    expect(request.quickAction).toBe('explain');
    expect(request.text).toBe('Explain the current page');
    expect(request.source).toBe('command-center');
  });

  it('throws a safe error for unknown quick actions', () => {
    expect(() =>
      buildQuickActionRequest('hack' as never, 'popup', null),
    ).toThrow(/invalid data/i);
  });
});
