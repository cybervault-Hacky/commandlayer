import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  createChromeStub,
  installChromeStub,
  uninstallChromeStub,
  type ChromeStub,
} from '@/test-utils/chromeStub';
import { handleContentMessage } from '@/content/contentScript';
import type { ExtractPageResponse } from '@/page-intelligence/protocol';
import type { ContentActionResponse } from '@/actions/types';
import { getPageContext } from '../pageContext';

const GITHUB = { id: 1, title: 'GitHub', url: 'https://github.com/' };

const CONTENT_HTML = `<!doctype html>
<html lang="en">
<head><title>GitHub</title><meta name="description" content="Code hosting."></head>
<body>
  <article>
    <h1>GitHub</h1>
    <h2>Features</h2>
    <p>A paragraph about git hosting.</p>
    <a href="/pricing">Pricing</a>
  </article>
</body>
</html>`;

/**
 * Wire the REAL content handler onto the stub's sendMessage channel, so this
 * test exercises the true background → content → background round trip.
 */
function wireRealContentScript(stub: ChromeStub, html: string, url: string): void {
  const dom = new JSDOM(html, { url });
  // The content script reads the global `document` — point it at the fixture.
  vi.stubGlobal('document', dom.window.document);
  stub.tabs.sendMessage.mockImplementation(async (_tabId: number, message: unknown) => {
    let response: ExtractPageResponse | ContentActionResponse | undefined;
    handleContentMessage(message, (r) => {
      response = r;
    });
    if (!response) {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    }
    return response;
  });
}

describe('getPageContext (background → content script)', () => {
  beforeEach(() => {
    installChromeStub(createChromeStub({ activeTab: GITHUB }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    uninstallChromeStub();
  });

  it('returns unavailable (no-tab) when there is no active tab', async () => {
    installChromeStub(createChromeStub());
    const context = await getPageContext();
    expect(context.state).toBe('unavailable');
    expect(context.reason).toBe('no-tab');
  });

  it('returns unsupported for browser-internal pages without messaging', async () => {
    installChromeStub(
      createChromeStub({
        activeTab: { id: 1, title: 'Extensions', url: 'chrome://extensions' },
      }),
    );
    const stub = (globalThis as unknown as { chrome: ChromeStub }).chrome;
    const context = await getPageContext();
    expect(context.state).toBe('unsupported');
    expect(context.reason).toBe('browser-page');
    expect(stub.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('returns permission-required when the content script is unreachable', async () => {
    const stub = (globalThis as unknown as { chrome: ChromeStub }).chrome;
    const context = await getPageContext();
    expect(context.state).toBe('permission-required');
    expect(context.reason).toBe('permission');
    expect(stub.tabs.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('captures and validates a real extraction result (integration)', async () => {
    const stub = (globalThis as unknown as { chrome: ChromeStub }).chrome;
    wireRealContentScript(stub, CONTENT_HTML, 'https://github.com/');

    const context = await getPageContext();

    expect(context.state).toBe('ready');
    expect(context.title).toBe('GitHub');
    expect(context.url).toBe('https://github.com/');
    expect(context.hostname).toBe('github.com');
    expect(context.description).toBe('Code hosting.');
    expect(context.language).toBe('en');
    expect(context.headings.map((h) => h.text)).toEqual(['GitHub', 'Features']);
    expect(context.paragraphs).toEqual(['A paragraph about git hosting.']);
    expect(context.links).toHaveLength(1);
    expect(context.contentStats.headingCount).toBe(2);
    expect(context.contentHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('passes section subsets to the content script', async () => {
    const stub = (globalThis as unknown as { chrome: ChromeStub }).chrome;
    wireRealContentScript(stub, CONTENT_HTML, 'https://github.com/');

    await getPageContext({ sections: ['metadata', 'headings'] });

    expect(stub.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        v: 1,
        type: 'cl:extract-page-context-request',
        sections: ['metadata', 'headings'],
      }),
    );
  });

  it('drops a malicious response that smuggles a form value', async () => {
    const stub = (globalThis as unknown as { chrome: ChromeStub }).chrome;
    stub.tabs.sendMessage.mockResolvedValue({
      ok: true,
      context: {
        state: 'ready',
        forms: [
          {
            method: 'post',
            fields: [{ name: 'pw', type: 'password', value: 'SECRET', required: false }],
            truncated: false,
          },
        ],
        contentStats: {
          textLength: 0,
          wordCount: 0,
          paragraphCount: 0,
          headingCount: 0,
          linkCount: 0,
          tableCount: 0,
          formCount: 1,
          selectedTextLength: 0,
        },
        truncated: false,
        capturedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    const context = await getPageContext();
    expect(context.state).toBe('unavailable');
    expect(context.reason).toBe('error');
    expect(JSON.stringify(context)).not.toContain('SECRET');
  });

  it('drops garbage responses safely', async () => {
    const stub = (globalThis as unknown as { chrome: ChromeStub }).chrome;
    stub.tabs.sendMessage.mockResolvedValue({ ok: true, context: 'not-an-object' });
    const context = await getPageContext();
    expect(context.state).toBe('unavailable');

    stub.tabs.sendMessage.mockResolvedValue({ ok: false, error: 'extraction-failed' });
    const context2 = await getPageContext();
    expect(context2.state).toBe('unavailable');
    expect(context2.reason).toBe('no-content-script');
  });
});
