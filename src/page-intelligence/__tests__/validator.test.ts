import { describe, expect, it } from 'vitest';
import { parsePageContext } from '../validator';
import { extractPageContext } from '../extractor';
import { RICH_PAGE_HTML, createDocument } from './fixtures';

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    state: 'ready',
    title: 'T',
    url: 'https://example.com/',
    hostname: 'example.com',
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
    capturedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('parsePageContext (untrusted payload validation)', () => {
  it('accepts a well-formed payload and re-sanitizes strings', () => {
    const parsed = parsePageContext(
      basePayload({
        title: '  Evil\u0000Title  ',
        headings: [{ level: 2, text: '  H  ' }],
      }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe('EvilTitle');
    expect(parsed?.headings).toEqual([{ level: 2, text: 'H' }]);
  });

  it('round-trips a real extraction result', () => {
    const { doc } = createDocument(RICH_PAGE_HTML, 'https://example.com/article');
    const real = extractPageContext(doc);
    const parsed = parsePageContext(real);
    expect(parsed).not.toBeNull();
    expect(parsed?.headings).toEqual(real.headings);
    expect(parsed?.links).toEqual(real.links);
    expect(parsed?.tables).toEqual(real.tables);
  });

  it('rejects non-objects and bad envelopes', () => {
    for (const raw of [null, 'str', 42, [], { state: 'ready' }, {}]) {
      expect(parsePageContext(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it('rejects invalid state, reason and capturedAt', () => {
    expect(parsePageContext(basePayload({ state: 'hacked' }))).toBeNull();
    expect(parsePageContext(basePayload({ reason: 'hacked' }))).toBeNull();
    expect(parsePageContext(basePayload({ capturedAt: 'not-a-date' }))).toBeNull();
  });

  it('rejects unsafe URLs and oversized fields', () => {
    expect(parsePageContext(basePayload({ url: 'javascript:alert(1)' }))).toBeNull();
    expect(parsePageContext(basePayload({ url: 'chrome://extensions' }))).toBeNull();
    expect(parsePageContext(basePayload({ title: 'x'.repeat(500) }))).toBeNull();
    expect(
      parsePageContext(basePayload({ description: 'x'.repeat(500) })),
    ).toBeNull();
  });

  it('rejects oversized collections (limit enforcement)', () => {
    expect(
      parsePageContext(
        basePayload({
          headings: Array.from({ length: 41 }, (_, i) => ({ level: 2, text: `H${i}` })),
        }),
      ),
    ).toBeNull();
    expect(
      parsePageContext(basePayload({ paragraphs: Array.from({ length: 61 }, () => 'p') })),
    ).toBeNull();
    expect(
      parsePageContext(
        basePayload({
          paragraphs: Array.from({ length: 34 }, () => 'p'.repeat(600)), // 34 x 600 = 20400 > 20000
        }),
      ),
    ).toBeNull();
    expect(
      parsePageContext(
        basePayload({
          links: Array.from({ length: 81 }, (_, i) => ({
            text: 'l',
            url: `https://example.com/${i}`,
            hostname: 'example.com',
          })),
        }),
      ),
    ).toBeNull();
    expect(
      parsePageContext(
        basePayload({
          tables: Array.from({ length: 7 }, () => ({ headers: [], rows: [], truncated: false })),
        }),
      ),
    ).toBeNull();
    expect(
      parsePageContext(
        basePayload({
          forms: Array.from({ length: 9 }, () => ({ method: 'get', fields: [], truncated: false })),
        }),
      ),
    ).toBeNull();
  });

  it('rejects malformed nested structures', () => {
    expect(parsePageContext(basePayload({ headings: [{ level: 5, text: 'x' }] }))).toBeNull();
    expect(parsePageContext(basePayload({ headings: [{ level: 2, text: 42 }] }))).toBeNull();
    expect(
      parsePageContext(
        basePayload({
          links: [{ text: 'x', url: 'https://example.com/', hostname: 'example.com', rel: 'a'.repeat(100) }],
        }),
      ),
    ).toBeNull();
    expect(
      parsePageContext(
        basePayload({
          tables: [{ headers: ['h'], rows: [['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm']], truncated: false }],
        }),
      ),
    ).toBeNull();
    expect(
      parsePageContext(
        basePayload({
          forms: [{ method: 'post', fields: [{ name: 'x', type: 'unknown-type', required: false }], truncated: false }],
        }),
      ),
    ).toBeNull();
    expect(
      parsePageContext(basePayload({ contentStats: { ...basePayload().contentStats, wordCount: -1 } })),
    ).toBeNull();
    expect(
      parsePageContext(basePayload({ contentStats: { ...basePayload().contentStats, wordCount: 'many' } })),
    ).toBeNull();
  });

  it('rejects an invalid content hash', () => {
    expect(parsePageContext(basePayload({ contentHash: 'zzzzzzzz' }))).toBeNull();
    expect(parsePageContext(basePayload({ contentHash: '12345' }))).toBeNull();
    expect(parsePageContext(basePayload({ contentHash: '12345678' }))).not.toBeNull();
  });

  /* ------------------------------------------------------------------ */
  /* SECURITY: a form field value must never survive validation.        */
  /* ------------------------------------------------------------------ */

  it('SECURITY: rejects any payload whose form fields carry a value key', () => {
    const payload = basePayload({
      forms: [
        {
          method: 'post',
          fields: [
            { name: 'password', type: 'password', value: 'SECRET', required: false },
          ],
          truncated: false,
        },
      ],
    });
    const parsed = parsePageContext(payload);
    expect(parsed).toBeNull();
  });

  it('SECURITY: rejects unknown keys on form fields (strict allowlist)', () => {
    const payload = basePayload({
      forms: [
        {
          method: 'get',
          fields: [{ name: 'x', type: 'text', autocomplete: 'cc-number', required: false }],
          truncated: false,
        },
      ],
    });
    expect(parsePageContext(payload)).toBeNull();
  });

  it('SECURITY: rejects oversized/malicious single strings inside sections', () => {
    expect(
      parsePageContext(basePayload({ selectedText: 'x'.repeat(2001) })),
    ).toBeNull();
    expect(
      parsePageContext(basePayload({ paragraphs: ['x'.repeat(601)] })),
    ).toBeNull();
    expect(
      parsePageContext(
        basePayload({ tables: [{ headers: ['x'.repeat(201)], rows: [], truncated: false }] }),
      ),
    ).toBeNull();
  });
});
