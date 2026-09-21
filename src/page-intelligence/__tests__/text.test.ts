import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { extractParagraphs } from '../text';
import { PAGE_LIMITS } from '../limits';
import { RICH_PAGE_HTML, createDocument } from './fixtures';

describe('extractParagraphs (readable text baseline)', () => {
  it('prefers the article root and extracts meaningful blocks', () => {
    const { doc } = createDocument(RICH_PAGE_HTML);
    const { paragraphs } = extractParagraphs(doc);
    expect(paragraphs).toContain('First meaningful paragraph about the subject.');
    expect(paragraphs).toContain('Second paragraph with more detail.');
    expect(paragraphs).toContain('First item');
    expect(paragraphs).toContain('Second item');
  });

  it('excludes header, nav, footer and form boilerplate', () => {
    const { doc } = createDocument(RICH_PAGE_HTML);
    const { paragraphs } = extractParagraphs(doc);
    expect(paragraphs).not.toContain('Site header boilerplate');
    expect(paragraphs).not.toContain('Navigation boilerplate');
    expect(paragraphs).not.toContain('Footer boilerplate');
  });

  it('excludes hidden content (display:none, [hidden], aria-hidden)', () => {
    const { doc } = createDocument(RICH_PAGE_HTML);
    const { paragraphs } = extractParagraphs(doc);
    expect(paragraphs).not.toContain('Hidden display none');

    const { doc: doc2 } = createDocument(
      `<html><body>
        <article>
          <p>Visible text</p>
          <p hidden>Hidden attr</p>
          <p style="visibility:hidden">Visibility hidden</p>
          <p aria-hidden="true">Aria hidden</p>
        </article>
      </body></html>`,
    );
    expect(extractParagraphs(doc2).paragraphs).toEqual(['Visible text']);
  });

  it('never descends into script, style, noscript or template', () => {
    const { doc } = createDocument(
      `<html><body><article>
        <script>var leak = "script text";</script>
        <style>.x { color: red; }</style>
        <noscript>Noscript text</noscript>
        <template><p>Template text</p></template>
        <p>Real text</p>
      </article></body></html>`,
    );
    const json = JSON.stringify(extractParagraphs(doc).paragraphs);
    expect(json).toContain('Real text');
    expect(json).not.toContain('script text');
    expect(json).not.toContain('Noscript text');
    expect(json).not.toContain('Template text');
  });

  it('excludes zero-size elements when layout metrics exist', () => {
    const dom = new JSDOM(
      `<html><body data-test-width="1024" data-test-height="768"><article>
        <p data-test-width="400" data-test-height="20">Normal paragraph</p>
        <p data-test-width="0" data-test-height="0">Collapsed paragraph</p>
      </article></body></html>`,
      { url: 'https://example.com' },
    );
    // Simulate a layout engine: per-element offsetWidth/offsetHeight from data attrs.
    Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return Number(this.dataset.testWidth ?? 0);
      },
    });
    Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return Number(this.dataset.testHeight ?? 0);
      },
    });
    const { paragraphs } = extractParagraphs(dom.window.document);
    expect(paragraphs).toContain('Normal paragraph');
    expect(paragraphs).not.toContain('Collapsed paragraph');
  });

  it('de-duplicates identical paragraphs', () => {
    const { doc } = createDocument(
      `<html><body><article>
        <p>Same line</p>
        <p>Same line</p>
        <p>Other line</p>
      </article></body></html>`,
    );
    expect(extractParagraphs(doc).paragraphs).toEqual(['Same line', 'Other line']);
  });

  it('truncates a single paragraph at the per-paragraph limit', () => {
    const { doc } = createDocument(
      `<html><body><article><p>${'word '.repeat(300)}</p></article></body></html>`,
    );
    const { paragraphs } = extractParagraphs(doc);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.length).toBeLessThanOrEqual(PAGE_LIMITS.MAX_PARAGRAPH_LENGTH);
  });

  it('caps the paragraph count and reports truncation', () => {
    const many = Array.from(
      { length: PAGE_LIMITS.MAX_PARAGRAPHS + 5 },
      (_, i) => `<p>Paragraph number ${i} with some body text.</p>`,
    ).join('');
    const { doc } = createDocument(`<html><body><article>${many}</article></body></html>`);
    const { paragraphs, truncated } = extractParagraphs(doc);
    expect(paragraphs).toHaveLength(PAGE_LIMITS.MAX_PARAGRAPHS);
    expect(truncated).toBe(true);
  });

  it('caps total text characters and reports truncation', () => {
    const many = Array.from(
      { length: 60 },
      (_, i) => `<p>Block ${i}: ${'x'.repeat(500)}</p>`,
    ).join('');
    const { doc } = createDocument(`<html><body><article>${many}</article></body></html>`);
    const { paragraphs, textLength, truncated } = extractParagraphs(doc);
    expect(textLength).toBeLessThanOrEqual(PAGE_LIMITS.MAX_TEXT_CHARACTERS);
    expect(truncated).toBe(true);
    expect(paragraphs.length).toBeGreaterThan(10);
  });

  it('reports word and character counts', () => {
    const { doc } = createDocument(
      `<html><body><article><p>one two three</p><p>four five</p></article></body></html>`,
    );
    const { textLength, wordCount } = extractParagraphs(doc);
    expect(wordCount).toBe(5);
    expect(textLength).toBe('one two three'.length + 'four five'.length);
  });
});
