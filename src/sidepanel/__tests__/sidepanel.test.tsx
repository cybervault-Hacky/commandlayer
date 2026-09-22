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
import {
  resetMockProvider,
  setMockProviderFailure,
  setMockProviderLatency,
} from '@/ai/mockProvider';
import { aiError } from '@/ai/errors';
import { AIErrorCode } from '@/ai/types';
import { extractPageContext } from '@/page-intelligence';
import { isExtractPageRequest } from '@/page-intelligence/protocol';
import type { PageContext } from '@/shared/types/page';
import { getSettings } from '@/storage/settings';

const GITHUB_TAB = { id: 1, title: 'GitHub', url: 'https://github.com/' };

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
  const stub = createChromeStub({ activeTab: GITHUB_TAB });
  installChromeStub(stub);
  resetChromeStorage();
  __resetStorageBackendForTests();
  __resetTransportForTests();
  resetMockProvider();
  setMockProviderLatency(0);
  setMockProviderFailure(null);
  if (options.wired) wirePage(stub);
  return stub;
}

describe('Side Panel (intelligence interface)', () => {
  beforeEach(() => setup());

  it('renders brand, hero, input, quick actions and page context', async () => {
    render(<App />);

    expect(screen.getAllByText(/CommandLayer/).length).toBeGreaterThan(0);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /ask about this page/i,
      }),
    ).toBeInTheDocument();

    expect(screen.getByLabelText('Command')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/what do you want to know/i),
    ).toBeInTheDocument();

    for (const label of ['Analyze', 'Summarize', 'Explain', 'Extract']) {
      expect(
        screen.getByRole('button', { name: new RegExp(`^${label}`, 'i') }),
      ).toBeInTheDocument();
    }
    // Research/Compare were removed instead of being faked.
    expect(screen.queryByRole('button', { name: /^Research/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Compare/i })).toBeNull();

    await waitFor(() => expect(screen.getByText('Ready')).toBeInTheDocument());
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('github.com')).toBeInTheDocument();
  });

  it('submits a command and renders the validated AI response', async () => {
    setup({ wired: true });
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText('Command');

    await user.type(input, 'Summarize this page');
    await user.keyboard('{Enter}');

    // The response card carries the answer and provider provenance.
    await waitFor(async () =>
      expect(
        (await screen.findAllByText(/Build and ship software/i)).length,
      ).toBeGreaterThan(0),
    );
    expect(screen.getByText(/Local reasoning/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy answer' })).toBeInTheDocument();

    // Draft clears after a successful command.
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('shows the thinking state while reasoning runs', async () => {
    setup({ wired: true });
    setMockProviderLatency(300);
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText('Command');

    await user.type(input, 'Explain this page');
    await user.keyboard('{Enter}');

    expect(screen.getByText(/Understanding page/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Submit command' }),
    ).toBeDisabled();

    await waitFor(async () =>
      expect(
        (await screen.findAllByText(/Build and ship software/i)).length,
      ).toBeGreaterThan(0),
    );
    resetMockProvider();
  });

  it('supports Shift+Enter for multiline drafts without submitting', async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText('Command');

    await user.type(input, 'first line');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await user.type(input, 'second line');

    expect(input).toHaveValue('first line\nsecond line');
    expect(screen.queryByText(/Intelligence unavailable/i)).not.toBeInTheDocument();
  });

  it('keeps the submit button disabled for empty commands', async () => {
    const user = userEvent.setup();
    render(<App />);

    const submit = screen.getByRole('button', { name: 'Submit command' });
    expect(submit).toBeDisabled();

    const input = screen.getByLabelText('Command');
    await user.click(input);
    await user.keyboard('{Enter}');
    expect(screen.queryByText(/Intelligence unavailable/i)).not.toBeInTheDocument();
  });

  it('clears the draft with the clear button', async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText('Command');

    await user.type(input, 'some draft');
    await user.click(screen.getByRole('button', { name: 'Clear command' }));
    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Submit command' })).toBeDisabled();
  });

  it('runs a quick action through the reasoning pipeline', async () => {
    setup({ wired: true });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /^Summarize/i }));

    await waitFor(async () =>
      expect(
        (await screen.findAllByText(/Build and ship software/i)).length,
      ).toBeGreaterThan(0),
    );
    expect(screen.getByText(/Local reasoning/)).toBeInTheDocument();
  });

  it('shows a typed, retryable error when no page content is available', async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText('Command');

    await user.type(input, 'Analyze this page');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.getByText('Intelligence unavailable')).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/page contents are not available/i),
    ).toBeInTheDocument();
    // AI_PAGE_UNAVAILABLE is transient → retry offered.
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // Draft is preserved so the user can retry.
    expect(input).toHaveValue('Analyze this page');
  });

  it('shows a professional error state when the provider fails', async () => {
    setup({ wired: true });
    setMockProviderFailure(aiError(AIErrorCode.AI_UNAVAILABLE));
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText('Command');

    await user.type(input, 'Analyze this page');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.getByText('Intelligence unavailable')).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/intelligence is unavailable/i),
    ).toBeInTheDocument();
    expect(input).toHaveValue('Analyze this page');
  });

  it('shows AI provider status in settings without any secret fields', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /settings/i }));
    expect(
      screen.getByRole('heading', { name: 'Settings' }),
    ).toBeInTheDocument();

    expect(screen.getByText('Intelligence')).toBeInTheDocument();
    expect(screen.getByText(/reasoning provider/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/local mock provider/i).length,
    ).toBeGreaterThanOrEqual(1);
    // No API-key storage controls exist — settings never hold secrets.
    expect(screen.queryByLabelText(/api key/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/api key/i)).toBeNull();
  });

  it('opens settings and applies theme + reduce motion to the document', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /settings/i }));

    await user.click(screen.getByRole('button', { name: 'Light' }));
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('light'),
    );

    await user.click(screen.getByRole('switch', { name: /reduce motion/i }));
    await waitFor(() =>
      expect(document.documentElement.dataset.motion).toBe('reduced'),
    );

    const stored = await getSettings();
    expect(stored).toMatchObject({ theme: 'light', reduceMotion: true });
  });

  it('returns from settings to the home view', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /settings/i }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back to main view/i }));
    expect(
      await screen.findByRole('heading', { name: /ask about this page/i }),
    ).toBeInTheDocument();
  });

  it('shows the first-run tip until dismissed', async () => {
    const user = userEvent.setup();
    render(<App />);

    const tip = await screen.findByRole('note');
    expect(tip).toHaveTextContent(/summon commandlayer/i);

    await user.click(screen.getByRole('button', { name: 'Dismiss tip' }));
    await waitFor(() =>
      expect(screen.queryByRole('note')).not.toBeInTheDocument(),
    );

    const stored = await getSettings();
    expect(stored.onboardingSeen).toBe(true);
  });
});
