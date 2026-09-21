import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import type { PageContext } from '@/shared/types/page';

const fakeContext: PageContext = {
  state: 'ready',
  title: 'Fixture',
  url: 'https://example.com/',
  hostname: 'example.com',
  headings: [{ level: 1, text: 'T' }],
  paragraphs: ['p'],
  links: [],
  selectedText: null,
  tables: [],
  forms: [],
  contentStats: {
    textLength: 1,
    wordCount: 1,
    paragraphCount: 1,
    headingCount: 1,
    linkCount: 0,
    tableCount: 0,
    formCount: 0,
    selectedTextLength: 0,
  },
  truncated: false,
  contentHash: '12345678',
  capturedAt: '2026-01-01T00:00:00.000Z',
};

vi.mock('@/page-intelligence', async () => {
  const actual = await vi.importActual<object>('@/page-intelligence');
  return { ...actual, extractPageContext: vi.fn() };
});

import type * as pageIntelligence from '@/page-intelligence';
import { extractPageContext } from '@/page-intelligence';
import { EXTRACT_PAGE_REQUEST_TYPE } from '@/page-intelligence/protocol';
import { handleContentMessage } from '../contentScript';

beforeEach(() => {
  vi.mocked(extractPageContext).mockImplementation(() => fakeContext);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function run(raw: unknown): { ok?: boolean; context?: PageContext; calls: number } {
  let response: { ok?: boolean; context?: PageContext } | undefined;
  handleContentMessage(raw, (r) => {
    response = r;
  });
  return { ...response, calls: vi.mocked(extractPageContext).mock.calls.length };
}

describe('content script (extraction-only, on-demand)', () => {
  it('answers a valid full extraction request', () => {
    const raw = { v: 1, type: EXTRACT_PAGE_REQUEST_TYPE, sections: null };
    const out = run(raw);
    expect(out.ok).toBe(true);
    expect(out.context).toEqual(fakeContext);
    expect(vi.mocked(extractPageContext)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(extractPageContext).mock.calls[0]?.[1]).toEqual({ sections: null });
  });

  it('passes requested sections through (on-demand subsets)', () => {
    const raw = { v: 1, type: EXTRACT_PAGE_REQUEST_TYPE, sections: ['headings'] };
    const out = run(raw);
    expect(out.ok).toBe(true);
    expect(vi.mocked(extractPageContext).mock.calls[0]?.[1]).toEqual({
      sections: ['headings'],
    });
  });

  it('ignores foreign message shapes (never responds to them)', () => {
    for (const raw of [
      'garbage',
      null,
      42,
      {},
      { v: 1 },
      { v: 2, type: EXTRACT_PAGE_REQUEST_TYPE, sections: null },
      { v: 1, type: 'cl:other', sections: null },
      { v: 1, type: EXTRACT_PAGE_REQUEST_TYPE, sections: ['evil'] },
      { v: 1, type: EXTRACT_PAGE_REQUEST_TYPE, sections: {} },
      { v: 1, type: EXTRACT_PAGE_REQUEST_TYPE },
    ]) {
      const before = vi.mocked(extractPageContext).mock.calls.length;
      const out = run(raw);
      expect(
        vi.mocked(extractPageContext).mock.calls.length,
        JSON.stringify(raw),
      ).toBe(before);
      expect(out.ok, JSON.stringify(raw)).toBeUndefined();
    }
  });

  it('reports a safe failure when extraction throws', () => {
    vi.mocked(extractPageContext).mockImplementation(() => {
      throw new Error('hostile page');
    });
    const out = run({ v: 1, type: EXTRACT_PAGE_REQUEST_TYPE, sections: null });
    expect(out.ok).toBe(false);
    expect(out.context).toBeUndefined();
  });

  it('runs the real extraction on a jsdom document end-to-end', async () => {
    // Delegate the mocked seam to the REAL implementation for this test.
    const real = await vi.importActual<typeof pageIntelligence>('@/page-intelligence');
    vi.mocked(extractPageContext).mockImplementation(real.extractPageContext);

    const dom = new JSDOM(
      `<html lang="en"><head><title>Live</title></head>
       <body><h1>Live heading</h1><p>Live paragraph</p></body></html>`,
      { url: 'https://example.com/live' },
    );
    // The content script reads the global `document`; point it at jsdom's.
    vi.stubGlobal('document', dom.window.document);

    try {
      const out = run({ v: 1, type: EXTRACT_PAGE_REQUEST_TYPE, sections: null });
      expect(out.ok).toBe(true);
      expect(out.context?.title).toBe('Live');
      expect(out.context?.headings).toEqual([{ level: 1, text: 'Live heading' }]);
      expect(out.context?.paragraphs).toEqual(['Live paragraph']);
      expect(out.context?.url).toBe('https://example.com/live');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
