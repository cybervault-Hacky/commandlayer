import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import {
  createChromeStub,
  installChromeStub,
  resetChromeStorage,
} from '@/test-utils/chromeStub';
import { __resetStorageBackendForTests } from '@/storage/backend';
import { __resetTransportForTests } from '@/shared/messaging/transport';
import {
  setMockProviderFailure,
  setMockProviderLatency,
} from '@/ai/mockProvider';
import { getSettings } from '@/storage/settings';

const GITHUB_TAB = { id: 1, title: 'GitHub', url: 'https://github.com/' };

function setup() {
  const stub = createChromeStub({ activeTab: GITHUB_TAB });
  installChromeStub(stub);
  resetChromeStorage();
  __resetStorageBackendForTests();
  __resetTransportForTests();
  setMockProviderLatency(0);
  setMockProviderFailure(null);
  return stub;
}

describe('Side Panel', () => {
  beforeEach(setup);

  it('renders brand, hero, input, quick actions and page context', async () => {
    render(<App />);

    // Brand wordmark (Command + Layer) is present.
    expect(screen.getAllByText(/CommandLayer/).length).toBeGreaterThan(0);
    expect(
      screen.getByRole('heading', { level: 1, name: /your web,\s+intelligently connected/i }),
    ).toBeInTheDocument();

    expect(screen.getByLabelText('Command')).toBeInTheDocument();

    for (const label of ['Analyze', 'Research', 'Summarize', 'Compare']) {
      expect(
        screen.getByRole('button', { name: new RegExp(`^${label}`, 'i') }),
      ).toBeInTheDocument();
    }

    // Page context resolves from the stubbed active tab.
    await waitFor(() => expect(screen.getByText('Ready')).toBeInTheDocument());
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('github.com')).toBeInTheDocument();
  });

  it('submits a command with Enter and shows the local pipeline result', async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText('Command');

    await user.type(input, 'Summarize this page');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.getByText('Command received')).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/AI intelligence will be connected in a future phase/i),
    ).toBeInTheDocument();
    // Draft clears after a successful command.
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('shows the processing state while the pipeline runs', async () => {
    setMockProviderLatency(300);
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText('Command');

    await user.type(input, 'Research this page');
    await user.keyboard('{Enter}');

    expect(screen.getByText('Processing command')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Submit command' }),
    ).toBeDisabled();

    await waitFor(() =>
      expect(screen.getByText('Command received')).toBeInTheDocument(),
    );
  });

  it('supports Shift+Enter for multiline drafts without submitting', async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText('Command');

    await user.type(input, 'first line');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await user.type(input, 'second line');

    expect(input).toHaveValue('first line\nsecond line');
    expect(screen.queryByText('Command received')).not.toBeInTheDocument();
  });

  it('keeps the submit button disabled for empty commands', async () => {
    const user = userEvent.setup();
    render(<App />);

    const submit = screen.getByRole('button', { name: 'Submit command' });
    expect(submit).toBeDisabled();

    const input = screen.getByLabelText('Command');
    await user.click(input);
    await user.keyboard('{Enter}');
    expect(screen.queryByText('Command received')).not.toBeInTheDocument();
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

  it('runs a quick action through the command pipeline', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /^Summarize/i }));

    await waitFor(() =>
      expect(screen.getByText('Command received')).toBeInTheDocument(),
    );
    // Quick action label appears on the button and in the result meta line.
    expect(screen.getAllByText('Summarize').length).toBeGreaterThanOrEqual(2);
  });

  it('shows a professional error state when the pipeline fails', async () => {
    setMockProviderFailure({
      code: 'AI_UNAVAILABLE',
      message: 'maintenance',
      retryable: false,
    });
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText('Command');

    await user.type(input, 'Analyze this page');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.getByText('Command failed')).toBeInTheDocument(),
    );
    expect(screen.getByText(/intelligence is unavailable/i)).toBeInTheDocument();
    // Draft is preserved so the user can retry.
    expect(input).toHaveValue('Analyze this page');
  });

  it('opens settings and applies theme + reduce motion to the document', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /settings/i }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Light' }));
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('light'),
    );

    await user.click(screen.getByRole('switch', { name: /reduce motion/i }));
    await waitFor(() =>
      expect(document.documentElement.dataset.motion).toBe('reduced'),
    );

    // Persisted through the stubbed chrome.storage.
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
      await screen.findByRole('heading', { name: /your web/i }),
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
