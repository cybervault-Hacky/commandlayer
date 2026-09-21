import { describe, expect, it } from 'vitest';
import { extractMetadata } from '../metadata';
import { createDocument } from './fixtures';

describe('extractMetadata', () => {
  it('extracts title, URL, hostname, language and canonical', () => {
    const { doc } = createDocument(
      `<html lang="en-GB"><head>
        <title>My Page</title>
        <meta name="description" content="The description.">
        <link rel="canonical" href="/canonical">
      </head><body></body></html>`,
      'https://sub.example.com:8443/some/path?x=1',
    );
    const meta = extractMetadata(doc);
    expect(meta.title).toBe('My Page');
    expect(meta.url).toBe('https://sub.example.com:8443/some/path?x=1');
    expect(meta.hostname).toBe('sub.example.com');
    expect(meta.language).toBe('en-GB');
    expect(meta.description).toBe('The description.');
    expect(meta.canonicalUrl).toBe('https://sub.example.com:8443/canonical');
  });

  it('falls back to og:description and the meta language tag', () => {
    const { doc } = createDocument(
      `<html><head>
        <meta property="og:description" content="OG description.">
        <meta name="language" content="de">
      </head><body></body></html>`,
      'https://example.com',
    );
    const meta = extractMetadata(doc);
    expect(meta.description).toBe('OG description.');
    expect(meta.language).toBe('de');
  });

  it('rejects garbage values instead of trusting the DOM', () => {
    const { doc } = createDocument(
      `<html lang="${'x'.repeat(80)}"><head>
        <title>${'T'.repeat(500)}</title>
        <meta name="description" content="">
        <link rel="canonical" href="javascript:alert(1)">
      </head><body></body></html>`,
      'https://example.com',
    );
    const meta = extractMetadata(doc);
    // Oversized language rejected, oversized title truncated.
    expect(meta.language).toBeUndefined();
    expect(meta.title?.length).toBeLessThanOrEqual(120);
    expect(meta.description).toBeUndefined();
    expect(meta.canonicalUrl).toBeUndefined();
  });

  it('resolves relative canonical URLs against the page URL', () => {
    const { doc } = createDocument(
      `<html><head><link rel="canonical" href="/docs/page"></head><body></body></html>`,
      'https://example.com/a/b',
    );
    expect(extractMetadata(doc).canonicalUrl).toBe('https://example.com/docs/page');
  });

  it('returns no metadata when nothing is present', () => {
    const { doc } = createDocument(`<html><body></body></html>`, 'https://example.com');
    const meta = extractMetadata(doc);
    expect(meta.title).toBeUndefined();
    expect(meta.description).toBeUndefined();
    expect(meta.language).toBeUndefined();
    expect(meta.canonicalUrl).toBeUndefined();
    expect(meta.url).toBe('https://example.com/');
  });
});
