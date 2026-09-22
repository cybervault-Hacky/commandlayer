import { describe, expect, it } from 'vitest';
import { buildPageContext } from '@/shared/pageContext';
import type { PageContext } from '@/shared/types/page';
import { AI_LIMITS } from '../limits';
import { AIIntent } from '../types';
import { buildAIContext, INTENT_CONTEXT_SECTIONS } from '../context';

/** A fully-captured page with content in every section. */
function richPage(overrides: Partial<PageContext> = {}): PageContext {
  return {
    ...buildPageContext({ title: 'Docs', url: 'https://docs.example.com/a' }),
    state: 'ready',
    description: 'Docs description',
    language: 'en',
    headings: [
      { level: 1, text: 'Intro' },
      { level: 2, text: 'Usage' },
    ],
    paragraphs: ['First paragraph with details.', 'Second paragraph.'],
    links: [
      { text: 'Home', url: 'https://docs.example.com/', hostname: 'docs.example.com' },
      { text: 'Home', url: 'https://docs.example.com/', hostname: 'docs.example.com' },
      { text: 'Guide', url: 'https://docs.example.com/guide', hostname: 'docs.example.com' },
    ],
    tables: [
      { headers: ['A', 'B'], rows: [['1', '2']], truncated: false },
    ],
    selectedText: 'the selected part',
    contentStats: {
      textLength: 100,
      wordCount: 20,
      paragraphCount: 2,
      headingCount: 2,
      linkCount: 3,
      tableCount: 1,
      formCount: 1,
      selectedTextLength: 17,
    },
    forms: [
      {
        method: 'post',
        fields: [{ name: 'token', type: 'password', required: true }],
        truncated: false,
      },
    ],
    ...overrides,
  };
}

describe('buildAIContext (minimization + privacy)', () => {
  it('never includes any form information for any intent', () => {
    for (const intent of Object.values(AIIntent)) {
      const context = buildAIContext(richPage(), intent);
      expect(context, intent).not.toBeNull();
      if (context) {
        const serialized = JSON.stringify(context);
        expect(serialized).not.toContain('token');
        expect(serialized).not.toContain('password');
        expect(serialized).not.toContain('forms');
      }
    }
  });

  it('excludes forms from every intent section profile', () => {
    for (const sections of Object.values(INTENT_CONTEXT_SECTIONS)) {
      expect(sections).not.toHaveProperty('forms');
    }
  });

  it('gives ANALYZE links + tables but SUMMARIZE only headings + text', () => {
    const analyze = buildAIContext(richPage(), AIIntent.Analyze);
    const summarize = buildAIContext(richPage(), AIIntent.Summarize);
    expect(analyze?.links.length).toBe(2); // deduped
    expect(analyze?.tables.length).toBe(1);
    expect(summarize?.links.length).toBe(0);
    expect(summarize?.tables.length).toBe(0);
    expect(summarize?.headings.length).toBe(2);
    expect(summarize?.text).toContain('First paragraph');
  });

  it('includes the user selection only for ANSWER', () => {
    expect(
      buildAIContext(richPage(), AIIntent.Answer)?.selectedText,
    ).toBe('the selected part');
    expect(
      buildAIContext(richPage(), AIIntent.Extract)?.selectedText,
    ).toBeNull();
  });

  it('returns null when there is nothing to reason about', () => {
    // Basic (tabs-only) context: ready state but zero captured content.
    const basic = buildPageContext({
      title: 'GitHub',
      url: 'https://github.com/',
    });
    expect(buildAIContext(basic, AIIntent.Summarize)).toBeNull();
  });

  it('returns null for unsupported or unavailable pages', () => {
    const unsupported = {
      ...buildPageContext({ title: 'X', url: 'chrome://settings' }),
      state: 'unsupported' as const,
    };
    expect(buildAIContext(unsupported, AIIntent.Answer)).toBeNull();

    const unavailable = {
      ...buildPageContext({ title: '', url: '' }),
      state: 'unavailable' as const,
    };
    expect(buildAIContext(unavailable, AIIntent.Answer)).toBeNull();
  });

  it('caps headings and links and flags truncation', () => {
    const page = richPage({
      headings: Array.from({ length: AI_LIMITS.MAX_CONTEXT_HEADINGS + 10 }, (_, i) => ({
        level: 2 as const,
        text: `Heading ${i}`,
      })),
      links: Array.from({ length: AI_LIMITS.MAX_CONTEXT_LINKS + 5 }, (_, i) => ({
        text: `L${i}`,
        url: `https://example.com/${i}`,
        hostname: 'example.com',
      })),
    });
    const context = buildAIContext(page, AIIntent.Analyze);
    expect(context?.headings.length).toBe(AI_LIMITS.MAX_CONTEXT_HEADINGS);
    expect(context?.links.length).toBe(AI_LIMITS.MAX_CONTEXT_LINKS);
    expect(context?.truncated).toBe(true);
  });

  it('caps page text to the budget and flags truncation', () => {
    const page = richPage({
      paragraphs: Array.from({ length: 30 }, (_, i) =>
        `Paragraph ${i}. ${'x'.repeat(480)}`,
      ),
    });
    const context = buildAIContext(page, AIIntent.Summarize);
    expect(context).not.toBeNull();
    expect(context!.text.length).toBeLessThanOrEqual(
      AI_LIMITS.MAX_CONTEXT_TEXT_CHARS,
    );
    expect(context!.truncated).toBe(true);
  });

  it('strips markup-like control characters via sanitization', () => {
    const page = richPage({
      headings: [{ level: 1, text: 'Title\u0000with\u0007controls' }],
    });
    const context = buildAIContext(page, AIIntent.Explain);
    expect(context?.headings[0]?.text).not.toContain('\u0000');
    expect(context?.headings[0]?.text).not.toContain('\u0007');
  });
});
