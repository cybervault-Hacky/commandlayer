import { beforeEach, describe, expect, it } from 'vitest';
import { buildPageContext } from '@/shared/pageContext';
import type { PageContext } from '@/shared/types/page';
import type { AIRequest } from '../types';
import {
  MOCK_RESPONSE_TEXT,
  MockAIProvider,
  PAGE_CONTEXT_CAPTURED_TEXT,
  setMockProviderLatency,
} from '../mockProvider';

beforeEach(() => {
  setMockProviderLatency(0);
});

function requestWith(page: PageContext | null): AIRequest {
  return {
    id: 'req-1',
    prompt: 'Analyze this page',
    context: page === null ? {} : { page },
  };
}

function withIntelligence(context: PageContext): PageContext {
  return {
    ...context,
    headings: [{ level: 1, text: 'H' }],
    paragraphs: ['p'],
    contentStats: { ...context.contentStats, headingCount: 1, paragraphCount: 1 },
  };
}

describe('MockAIProvider (context-aware, never claims AI)', () => {
  it('acks a command without any page context', async () => {
    const result = await new MockAIProvider().complete(requestWith(null));
    expect('text' in result && result.text).toBe(MOCK_RESPONSE_TEXT);
  });

  it('acks a command with a basic (tabs-API only) context', async () => {
    const page = buildPageContext({ title: 'GitHub', url: 'https://github.com/' });
    const result = await new MockAIProvider().complete(requestWith(page));
    expect('text' in result && result.text).toBe(MOCK_RESPONSE_TEXT);
  });

  it('reports a real captured page context when intelligence is present', async () => {
    const page = withIntelligence(
      buildPageContext({ title: 'GitHub', url: 'https://github.com/' }),
    );
    const result = await new MockAIProvider().complete(requestWith(page));
    expect('text' in result && result.text).toBe(PAGE_CONTEXT_CAPTURED_TEXT);
  });

  it('works with partial contexts', async () => {
    const page = {
      ...withIntelligence(
        buildPageContext({ title: 'X', url: 'https://x.example/' }),
      ),
      state: 'partial' as const,
    };
    const result = await new MockAIProvider().complete(requestWith(page));
    expect('text' in result && result.text).toBe(PAGE_CONTEXT_CAPTURED_TEXT);
  });

  it('falls back to the honest acknowledgement for unavailable pages', async () => {
    const page: PageContext = {
      state: 'unavailable',
      reason: 'no-tab',
      headings: [],
      paragraphs: [],
      links: [],
      selectedText: null,
      tables: [],
      forms: [],
      contentStats: {
        textLength: 0,
        wordCount: 0,
        paragraphCount: 0,
        headingCount: 0,
        linkCount: 0,
        tableCount: 0,
        formCount: 0,
        selectedTextLength: 0,
      },
      truncated: false,
      capturedAt: new Date().toISOString(),
    };
    const result = await new MockAIProvider().complete(requestWith(page));
    expect('text' in result && result.text).toBe(MOCK_RESPONSE_TEXT);
  });

  it('never claims an AI analysis ran', async () => {
    const page = withIntelligence(
      buildPageContext({ title: 'X', url: 'https://x.example/' }),
    );
    const result = await new MockAIProvider().complete(requestWith(page));
    if ('text' in result) {
      expect(result.text.toLowerCase()).not.toMatch(/analyzed|summary is|here is the answer/i);
      expect(result.text).toContain('future phase');
    }
  });
});
