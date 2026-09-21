import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JSDOM } from 'jsdom';
import { App } from '../App';
import {
  createChromeStub,
  installChromeStub,
  resetChromeStorage,
  type ChromeStub,
} from '@/test-utils/chromeStub';
import { __resetStorageBackendForTests } from '@/storage/backend';
import { __resetTransportForTests } from '@/shared/messaging/transport';
import { setMockProviderLatency } from '@/ai/mockProvider';
import { extractPageContext } from '@/page-intelligence';
import { isExtractPageRequest } from '@/page-intelligence/protocol';
import type { PageContext } from '@/shared/types/page';

const GITHUB = { id: 1, title: 'GitHub', url: 'https://github.com/' };

const CONTENT_HTML = `<!doctype html>
<html lang="en">
<head><title>GitHub</title></head>
<body>
  <article>
    <h1>GitHub</h1>
    <h2>Code hosting</h2>
    <p>Build and ship software with your team.</p>
    <a href="/pricing">Pricing</a>
  </article>
</body>
</html>`;

/** Simulate the browser delivering extraction requests to the page. */
function wirePage(stub: ChromeStub, html: string, url: string): void {
  const dom = new JSDOM(html, { url });
  stub.tabs.sendMessage.mockImplementation(async (_tabId: number, message: unknown) => {
    if (!isExtractPageRequest(message)) {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    }
    const context: PageContext = extractPageContext(dom.window.document, {
      sections: message.sections,
    });
    return { ok: true, context };
  });
}

function setup(options?: { activeTab?: { id: number; title: string; url: string } }) {
  const stub = createChromeStub({
    activeTab: options?.activeTab ?? GITHUB,
  });
  installChromeStub(stub);
  resetChromeStorage();
  __resetStorageBackendForTests();
  __resetTransportForTests();
  setMockProviderLatency(0);
  return stub;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('Side Panel — page insight (on-demand capture)', () => {
  it('offers the on-demand capture and shows the result with stats', async () => {
    const user = userEvent.setup();
    const stub = setup();
    wirePage(stub, CONTENT_HTML, 'https://github.com/');
    render(<App />);

    // Basic context resolves asynchronously; wait for the affordance.
    const analyze = await screen.findByRole('button', {
      name: 'Analyze this page',
    });
    await user.click(analyze);

    // Capture completes → "Context ready" with stats.
    await waitFor(() => expect(screen.getByText('Context ready')).toBeInTheDocument());
    expect(screen.getByText(/2 headings/)).toBeInTheDocument();
    expect(screen.getByText(/1 paragraph/)).toBeInTheDocument();
    expect(screen.getByText(/1 link/)).toBeInTheDocument();

    // Expand the compact preview: title + top headings appear (the title
    // also shows in the current-page card, hence getAllByText).
    await user.click(screen.getByRole('button', { name: 'Page details' }));
    expect((await screen.findAllByText('GitHub')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Code hosting')).toBeInTheDocument();

    // Developer JSON preview.
    await user.click(
      screen.getByRole('button', { name: 'Developer preview' }),
    );
    const pre = await waitFor(() => {
      const el = document.querySelector('pre[aria-label="Page context JSON preview"]');
      if (!el) throw new Error('JSON preview not rendered');
      return el;
    });
    expect(pre.textContent).toContain('"headings"');
    expect(pre.textContent).toContain('"contentStats"');
    expect(pre.textContent).not.toContain('"value"');
  });

  it('shows site-access guidance when the content script is unreachable', async () => {
    const user = userEvent.setup();
    setup(); // default stub: sendMessage rejects (no receiver)
    render(<App />);

    await user.click(
      await screen.findByRole('button', { name: 'Analyze this page' }),
    );

    await waitFor(() =>
      expect(screen.getByText('Site access required')).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/check the extension.s site access/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('does not offer capture on unsupported browser pages', async () => {
    setup({
      activeTab: { id: 1, title: 'Extensions', url: 'chrome://extensions' },
    });
    render(<App />);

    expect(await screen.findByText('Unsupported page')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Analyze this page' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Browser-internal pages cannot be inspected.'),
    ).toBeInTheDocument();
  });

  it('shows an honest idle state before any capture', async () => {
    const stub = setup();
    wirePage(stub, CONTENT_HTML, 'https://github.com/');
    render(<App />);

    await screen.findByText('On-demand capture. Nothing is read until you ask.');
    expect(stub.tabs.sendMessage).not.toHaveBeenCalled();
  });
});
