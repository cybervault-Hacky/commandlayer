import { beforeEach, describe, expect, it } from 'vitest';
import { setMockProviderFailure, setMockProviderLatency } from '@/ai/mockProvider';
import { buildPageContext } from '@/shared/pageContext';
import { CommandDispatcher } from '../dispatcher';
import {
  buildCommandRequest,
  buildQuickActionRequest,
} from '../requests';
import type { CommandRequest } from '@/shared/types/command';

beforeEach(() => {
  setMockProviderLatency(0);
  setMockProviderFailure(null);
});

function makeRequest(overrides: Partial<CommandRequest> = {}): CommandRequest {
  return {
    id: 'test-1',
    text: 'Summarize this page',
    source: 'sidepanel',
    context: buildPageContext({ title: 'GitHub', url: 'https://github.com/' }),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('CommandDispatcher', () => {
  it('completes a command through the mock AI provider', async () => {
    const result = await new CommandDispatcher().dispatch(makeRequest());
    expect(result.status).toBe('completed');
    expect(result.text).toContain('Command received');
    expect(result.text).toContain('AI intelligence will be connected in a future phase');
    expect(result.id).toBe('test-1');
    expect(result.source).toBe('sidepanel');
    expect(result.startedAt).toBeTruthy();
    expect(result.finishedAt).toBeTruthy();
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
    const result = await new CommandDispatcher().dispatch(
      { ...makeRequest(), id: '' } as CommandRequest,
    );
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('INVALID_PAYLOAD');
  });

  it('records quick actions on the result', async () => {
    const result = await new CommandDispatcher().dispatch(
      makeRequest({ quickAction: 'summarize' }),
    );
    expect(result.status).toBe('completed');
    expect(result.quickAction).toBe('summarize');
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

  it('maps AI errors to a friendly failure', async () => {
    const dispatcher = new CommandDispatcher({
      handle: async () => ({
        code: 'AI_UNAVAILABLE',
        message: 'nope',
        retryable: false,
      }),
    });
    const result = await dispatcher.dispatch(makeRequest());
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('AI_UNAVAILABLE');
  });

  it('uses the provider-configured failure in the real pipeline', async () => {
    setMockProviderFailure({
      code: 'AI_UNAVAILABLE',
      message: 'maintenance',
      retryable: false,
    });
    const result = await new CommandDispatcher().dispatch(makeRequest());
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('AI_UNAVAILABLE');
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
      'compare',
      'command-center',
      buildPageContext({ title: 'GitHub', url: 'https://github.com/' }),
    );
    expect(request.quickAction).toBe('compare');
    expect(request.text).toBe('Compare the current page');
    expect(request.source).toBe('command-center');
  });

  it('throws a safe error for unknown quick actions', () => {
    expect(() =>
      buildQuickActionRequest('hack' as never, 'popup', null),
    ).toThrow(/invalid data/i);
  });
});
