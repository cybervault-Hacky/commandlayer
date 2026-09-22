import { beforeEach, describe, expect, it } from 'vitest';
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
import { resetMockProvider, setMockProviderLatency } from '@/ai/mockProvider';
import { extractPageContext } from '@/page-intelligence';
import { isExtractPageRequest } from '@/page-intelligence/protocol';
import type { PageContext } from '@/shared/types/page';

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head><title>GitHub</title></head>
<body>
  <article>
    <h1>GitHub</h1>
    <h2>Code hosting</h2>
    <p>Build and ship software with your team.</p>
  </article>
</body>
</html>`;

function wirePage(stub: ChromeStub): void {
  const dom = new JSDOM(PAGE_HTML, { url: 'https://github.com/' });
  stub.tabs.sendMessage.mockImplementation(
    async (_tabId: number, message: unknown) => {
      if (!isExtractPageRequest(message)) {
        throw new Error(
          'Could not establish connection. Receiving end does not exist.',
        );
      }
      const context: PageContext = extractPageContext(dom.window.document, {
        sections: message.sections,
      });
      return { ok: true, context };
    },
  );
}

function setup(options: { wired?: boolean } = {}) {
  const stub = createChromeStub({
    activeTab: { id: 1, title: 'GitHub', url: 'https://github.com/' },
  });
  installChromeStub(stub);
  resetChromeStorage();
  __resetStorageBackendForTests();
  __resetTransportForTests();
  resetMockProvider();
  setMockProviderLatency(0);
  if (options.wired) wirePage(stub);
  return stub;
}

describe('Command Center (session transcript)', () => {
  beforeEach(() => setup());

  it('renders the command center shell, quick actions, and transcript', async () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: /command center/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Command')).toBeInTheDocument();

    for (const label of ['Analyze', 'Summarize', 'Explain', 'Extract']) {
      expect(
        screen.getByRole('button', { name: new RegExp(`^${label}`, 'i') }),
      ).toBeInTheDocument();
    }
    // Research/Compare were removed, not faked.
    expect(screen.queryByRole('button', { name: /^Research/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Compare/i })).toBeNull();

    expect(
      screen.getByText(/ask about the page you have open/i),
    ).toBeInTheDocument();
    expect(await screen.findByText('Ready')).toBeInTheDocument();
  });

  it('records questions and validated answers in the session transcript', async () => {
    setup({ wired: true });
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText('Command');

    await user.type(input, 'Summarize this page');
    await user.keyboard('{Enter}');

    // User turn appears immediately.
    expect(screen.getByText('Summarize this page')).toBeInTheDocument();

    // Assistant turn renders the validated AI answer + intent badge
    // (answer + sections may match, hence findAllByText).
    await waitFor(async () =>
      expect(
        (await screen.findAllByText(/Code hosting|Build and ship/i)).length,
      ).toBeGreaterThan(0),
    );
    // The validated response card carries the provider provenance.
    expect(screen.getAllByText(/Local reasoning/).length).toBeGreaterThanOrEqual(1);

    // Draft clears after a successful command.
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('records failed reasoning attempts honestly (no page content)', async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText('Command');

    await user.type(input, 'What is this page about?');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.getByText('Intelligence unavailable')).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/page contents are not available/i),
    ).toBeInTheDocument();
  });

  it('clears the whole session transcript', async () => {
    setup({ wired: true });
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText('Command');

    await user.type(input, 'Summarize this page');
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.getByText('Summarize this page')).toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: 'Clear session' }));
    expect(
      screen.getByText(/ask about the page you have open/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('Summarize this page')).not.toBeInTheDocument();
  });

  it('runs quick actions through the transcript with their template', async () => {
    setup({ wired: true });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /^Explain/i }));

    // User turn uses the quick action's structured template.
    expect(
      screen.getByText('Explain the current page'),
    ).toBeInTheDocument();
    await waitFor(async () =>
      expect(
        (await screen.findAllByText(/Build and ship|Code hosting/i)).length,
      ).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/Local reasoning/).length).toBeGreaterThanOrEqual(1);
  });
});
