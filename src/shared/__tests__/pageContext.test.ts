import { describe, expect, it } from 'vitest';
import { buildPageContext } from '../pageContext';

const FIXED = new Date('2026-01-01T00:00:00.000Z');

describe('buildPageContext', () => {
  it('extracts title, URL and hostname for a normal page', () => {
    const context = buildPageContext(
      { title: 'GitHub', url: 'https://github.com/' },
      FIXED,
    );
    expect(context.state).toBe('ready');
    expect(context.title).toBe('GitHub');
    expect(context.hostname).toBe('github.com');
    expect(context.url).toBe('https://github.com/');
    expect(context.capturedAt).toBe(FIXED.toISOString());
    // Basic (tabs-API) contexts carry empty intelligence sections.
    expect(context.headings).toEqual([]);
    expect(context.paragraphs).toEqual([]);
    expect(context.links).toEqual([]);
    expect(context.tables).toEqual([]);
    expect(context.forms).toEqual([]);
    expect(context.selectedText).toBeNull();
    expect(context.truncated).toBe(false);
  });

  it('strips www and ports for the display hostname', () => {
    const context = buildPageContext(
      { title: 'Docs', url: 'https://www.example.com:8080/page' },
      FIXED,
    );
    expect(context.hostname).toBe('example.com');
  });

  it('marks internal browser pages as unsupported', () => {
    for (const url of [
      'chrome://extensions',
      'edge://extensions/shortcuts',
      'about:blank',
      'view-source:https://example.com',
      'chrome-extension://abc123/index.html',
    ]) {
      const context = buildPageContext({ title: 'Internal', url }, FIXED);
      expect(context.state, url).toBe('unsupported');
      expect(context.reason, url).toBe('browser-page');
    }
  });

  it('marks missing URLs as unavailable', () => {
    expect(buildPageContext({ title: 'No URL' }, FIXED).state).toBe(
      'unavailable',
    );
    expect(buildPageContext({}, FIXED).reason).toBe('no-tab');
  });

  it('rejects unsafe URL schemes', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'vbscript:msgbox(1)',
    ]) {
      const context = buildPageContext({ url }, FIXED);
      expect(context.state, url).not.toBe('ready');
      expect(context.hostname, url).toBeUndefined();
    }
  });

  it('sanitizes titles (control chars, whitespace)', () => {
    const context = buildPageContext(
      { title: '  Page\u0000Title\u0007  ' },
      FIXED,
    );
    expect(context.title).toBe('PageTitle');

    const withBreaks = buildPageContext(
      { title: '  Page\tTitle\nMore  ', url: 'https://example.com' },
      FIXED,
    );
    expect(withBreaks.title).toBe('Page Title More');
  });

  it('truncates very long titles with an ellipsis', () => {
    const context = buildPageContext(
      { title: 'A'.repeat(500), url: 'https://example.com' },
      FIXED,
    );
    expect(context.state).toBe('ready');
    expect(context.title?.length).toBe(120);
    expect(context.title?.endsWith('…')).toBe(true);
  });

  it('ignores non-string garbage input', () => {
    const context = buildPageContext(
      { title: 42, url: { href: 'https://x.com' } } as never,
      FIXED,
    );
    expect(context.state).toBe('unavailable');
    expect(context.title).toBeUndefined();
  });
});
