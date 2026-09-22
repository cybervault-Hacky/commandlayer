import { beforeEach, describe, expect, it } from 'vitest';
import { resetMockProvider } from '@/ai/mockProvider';
import { buildPageContext } from '@/shared/pageContext';
import type { PageContext } from '@/shared/types/page';
import { actionSessionStore } from '@/actions/session';
import { CommandDispatcher } from '../dispatcher';
import { buildCommandRequest } from '../requests';
import type { CommandRequest } from '@/shared/types/command';

beforeEach(() => {
  resetMockProvider();
  actionSessionStore.clear();
});

function pageWithContent(overrides: Partial<PageContext> = {}): PageContext {
  return {
    ...buildPageContext({ title: 'Docs', url: 'https://docs.example.com/' }),
    state: 'ready',
    headings: [{ level: 1, text: 'Docs' }],
    paragraphs: ['Some content about the docs.'],
    contentStats: {
      textLength: 26,
      wordCount: 5,
      paragraphCount: 1,
      headingCount: 1,
      linkCount: 0,
      tableCount: 0,
      formCount: 0,
      selectedTextLength: 0,
    },
    ...overrides,
  };
}

function makeRequest(text: string, withTab = true): CommandRequest {
  return buildCommandRequest({
    text,
    source: 'sidepanel',
    context: pageWithContent(),
    ...(withTab ? { tabId: 4 } : {}),
  });
}

describe('dispatcher — Phase 4 action planning branch', () => {
  it('routes action-shaped commands to the deterministic planner (no AI)', async () => {
    const result = await new CommandDispatcher().dispatch(
      makeRequest('scroll down 400px'),
    );
    expect(result.status).toBe('completed');
    expect(result.plan).toBeDefined();
    expect(result.plan!.actions[0]!.action).toMatchObject({
      type: 'SCROLL',
      direction: 'down',
      distancePx: 400,
    });
    // Nothing executed: no execution result exists yet.
    expect(result.execution).toBeUndefined();
    // The AI pipeline was never involved.
    expect(result.ai).toBeUndefined();
    // The plan was stored for approval-bound execution.
    expect(actionSessionStore.get(result.plan!.planId)).toBeDefined();
  });

  it('marks mutating plans as confirmation-required', async () => {
    const result = await new CommandDispatcher().dispatch(
      makeRequest('click the "Save" button'),
    );
    expect(result.plan!.requiresConfirmation).toBe(true);
    expect(result.plan!.risk).toBe('CONFIRMATION_REQUIRED');
  });

  it('does NOT treat consent phrases as approvals or plans', async () => {
    for (const text of ['yes', 'do it', 'go ahead', 'confirm', 'yes, run it']) {
      const result = await new CommandDispatcher().dispatch(makeRequest(text));
      expect(result.plan, text).toBeUndefined();
      expect(result.execution, text).toBeUndefined();
    }
  });

  it('falls back to reasoning when the phrasing is not plannable', async () => {
    // Action-ish words but no quotable target → reasoning handles it.
    const result = await new CommandDispatcher().dispatch(makeRequest('click around'));
    expect(result.plan).toBeUndefined();
    expect(result.ai).toBeDefined();
  });

  it('keeps pure reasoning commands on the AI path', async () => {
    const result = await new CommandDispatcher().dispatch(
      makeRequest('Summarize this page'),
    );
    expect(result.plan).toBeUndefined();
    expect(result.ai).toBeDefined();
  });

  it('requires a tab binding before planning (no context → reasoning/error, never a plan)', async () => {
    const request = buildCommandRequest({
      text: 'scroll down',
      source: 'sidepanel',
      context: null,
    });
    const result = await new CommandDispatcher().dispatch(request);
    expect(result.plan).toBeUndefined();
    expect(result.status).toBe('failed'); // no page → AI_PAGE_UNAVAILABLE
  });

  it('does not plan without a tab identity', async () => {
    const result = await new CommandDispatcher().dispatch(
      makeRequest('scroll down', false),
    );
    expect(result.plan).toBeUndefined();
  });
});
