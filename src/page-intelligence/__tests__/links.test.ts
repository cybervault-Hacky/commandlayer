import { describe, expect, it } from 'vitest';
import { extractLinks } from '../links';
import { PAGE_LIMITS } from '../limits';
import { createDocument } from './fixtures';

describe('extractLinks', () => {
  it('normalizes relative links to absolute URLs', () => {
    const { doc } = createDocument(
      `<html><body><a href="/docs">Docs</a></body></html>`,
      'https://example.com/base/path',
    );
    const { links } = extractLinks(doc);
    expect(links).toEqual([
      { text: 'Docs', url: 'https://example.com/docs', hostname: 'example.com' },
    ]);
  });

  it('drops duplicates (by normalized URL) keeping the first occurrence', () => {
    const { doc } = createDocument(
      `<html><body>
        <a href="/target">First</a>
        <a href="https://example.com/target">Same target</a>
        <a href="https://other.example/page">Other</a>
      </body></html>`,
      'https://example.com/',
    );
    const { links } = extractLinks(doc);
    expect(links).toHaveLength(2);
    expect(links[0]?.text).toBe('First');
    expect(links[1]?.url).toBe('https://other.example/page');
  });

  it('rejects non-http(s) URLs and skips fragment-only links', () => {
    const { doc } = createDocument(
      `<html><body>
        <a href="javascript:alert(1)">JS</a>
        <a href="mailto:x@example.com">Mail</a>
        <a href="data:text/html,x">Data</a>
        <a href="ftp://files.example.com/x">FTP</a>
        <a href="#section">Fragment only</a>
        <a href="/ok">Good</a>
      </body></html>`,
    );
    const { links } = extractLinks(doc);
    expect(links).toHaveLength(1);
    expect(links[0]?.text).toBe('Good');
  });

  it('records a sanitized rel subset and link text', () => {
    const { doc } = createDocument(
      `<html><body>
        <a href="/x" rel="nofollow sponsored">Sponsored</a>
        <a href="/y" rel="bogus token">No rel</a>
      </body></html>`,
    );
    const { links } = extractLinks(doc);
    expect(links[0]).toMatchObject({
      text: 'Sponsored',
      url: 'https://example.com/x',
      rel: 'nofollow sponsored',
    });
    expect(links[1]?.rel).toBeUndefined();
  });

  it('skips hidden anchors', () => {
    const { doc } = createDocument(
      `<html><body>
        <a href="/visible" style="display:none">Hidden</a>
        <a href="/shown">Shown</a>
      </body></html>`,
    );
    expect(extractLinks(doc).links.map((l) => l.text)).toEqual(['Shown']);
  });

  it('caps the link count and reports truncation', () => {
    const many = Array.from(
      { length: PAGE_LIMITS.MAX_LINKS + 15 },
      (_, i) => `<a href="/link-${i}">Link ${i}</a>`,
    ).join('');
    const { doc } = createDocument(`<html><body>${many}</body></html>`);
    const { links, truncated } = extractLinks(doc);
    expect(links).toHaveLength(PAGE_LIMITS.MAX_LINKS);
    expect(truncated).toBe(true);
  });
});
