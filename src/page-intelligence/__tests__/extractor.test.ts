import { describe, expect, it } from 'vitest';
import { extractPageContext } from '../extractor';
import { RICH_PAGE_HTML, createDocument } from './fixtures';

describe('extractPageContext (engine orchestration)', () => {
  it('builds a complete, consistent context from a rich page', () => {
    const { doc } = createDocument(RICH_PAGE_HTML, 'https://example.com/article');
    const context = extractPageContext(doc);

    expect(context.state).toBe('ready');
    expect(context.truncated).toBe(false);
    expect(context.title).toBe('Example Article');
    expect(context.url).toBe('https://example.com/article');
    expect(context.hostname).toBe('example.com');
    expect(context.language).toBe('en');
    expect(context.description).toBe('A fixture article for extraction tests.');
    expect(context.canonicalUrl).toBe('https://example.com/canonical-article');

    expect(context.headings.map((h) => h.text)).toEqual([
      'Main Title',
      'Section One',
      'Subsection',
      'Deep note',
    ]);
    expect(context.paragraphs).toContain('First meaningful paragraph about the subject.');
    expect(context.paragraphs).not.toContain('Site header boilerplate');
    expect(context.paragraphs).not.toContain('Navigation boilerplate');
    expect(context.paragraphs).not.toContain('Footer boilerplate');
    expect(context.paragraphs).not.toContain('Hidden display none');

    expect(context.links.map((l) => l.url)).toEqual([
      'https://example.com/about',
      'https://example.com/relative-link',
      'https://example.com/absolute-link',
    ]);

    expect(context.tables).toHaveLength(1);
    expect(context.tables[0]?.headers).toEqual(['Name', 'Value']);
    expect(context.tables[0]?.rows).toEqual([
      ['alpha', '1'],
      ['', '2'],
    ]);

    expect(context.selectedText).toBeNull();

    // Stats must agree with the actual sections.
    const stats = context.contentStats;
    expect(stats.headingCount).toBe(context.headings.length);
    expect(stats.paragraphCount).toBe(context.paragraphs.length);
    expect(stats.linkCount).toBe(context.links.length);
    expect(stats.tableCount).toBe(context.tables.length);
    expect(stats.formCount).toBe(context.forms.length);
    expect(stats.textLength).toBe(
      context.paragraphs.reduce((sum, p) => sum + p.length, 0),
    );
    expect(stats.wordCount).toBeGreaterThan(0);
    expect(stats.selectedTextLength).toBe(0);

    // Lightweight, stable content hash.
    expect(context.contentHash).toMatch(/^[0-9a-f]{8}$/);
    const again = extractPageContext(doc);
    expect(again.contentHash).toBe(context.contentHash);

    // capturedAt is a valid ISO timestamp.
    expect(Number.isFinite(Date.parse(context.capturedAt))).toBe(true);
  });

  it('marks the context partial when limits truncate sections', () => {
    const manyHeadings = Array.from(
      { length: 50 },
      (_, i) => `<h2>H${i}</h2>`,
    ).join('');
    const { doc } = createDocument(
      `<html><body><article>${manyHeadings}</article></body></html>`,
    );
    const context = extractPageContext(doc);
    expect(context.state).toBe('partial');
    expect(context.truncated).toBe(true);
    expect(context.headings.length).toBeLessThan(50);
  });

  it('extracts only the requested sections', () => {
    const { doc } = createDocument(RICH_PAGE_HTML, 'https://example.com/article');
    const context = extractPageContext(doc, { sections: ['metadata', 'headings'] });

    expect(context.title).toBe('Example Article');
    expect(context.headings.length).toBeGreaterThan(0);
    expect(context.paragraphs).toEqual([]);
    expect(context.links).toEqual([]);
    expect(context.tables).toEqual([]);
    expect(context.forms).toEqual([]);
    expect(context.selectedText).toBeNull();
  });

  it('treats null/empty sections as a full capture', () => {
    const { doc } = createDocument(RICH_PAGE_HTML, 'https://example.com/article');
    expect(extractPageContext(doc, { sections: null }).links.length).toBeGreaterThan(0);
    expect(extractPageContext(doc, { sections: [] }).links.length).toBeGreaterThan(0);
  });

  it('never crashes on an empty document', () => {
    const { doc } = createDocument(`<html><body></body></html>`);
    const context = extractPageContext(doc);
    expect(context.state).toBe('ready');
    expect(context.headings).toEqual([]);
    expect(context.paragraphs).toEqual([]);
    expect(context.contentHash).toMatch(/^[0-9a-f]{8}$/);
  });
});
