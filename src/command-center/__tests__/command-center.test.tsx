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
import { setMockProviderLatency } from '@/ai/mockProvider';

describe('Command Center', () => {
  beforeEach(() => {
    const stub = createChromeStub({
      activeTab: { id: 1, title: 'GitHub', url: 'https://github.com/' },
    });
    installChromeStub(stub);
    resetChromeStorage();
    __resetStorageBackendForTests();
    __resetTransportForTests();
    setMockProviderLatency(0);
  });

  it('renders the command center shell and quick actions', async () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: /command center/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Command')).toBeInTheDocument();

    for (const label of ['Analyze', 'Research', 'Summarize', 'Compare']) {
      expect(
        screen.getByRole('button', { name: new RegExp(`^${label}`, 'i') }),
      ).toBeInTheDocument();
    }

    expect(await screen.findByText('Ready')).toBeInTheDocument();
  });

  it('submits a command and records it in the session log', async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText('Command');

    await user.type(input, 'Compare these options');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.getByText('Command received')).toBeInTheDocument(),
    );

    // The session log echoes the command that was run.
    expect(screen.getByText('Compare these options')).toBeInTheDocument();
  });

  it('clears the session log', async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText('Command');

    await user.type(input, 'Summarize this page');
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.getByText('Command received')).toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(
      screen.getByText('Commands you run this session appear here.'),
    ).toBeInTheDocument();
  });

  it('runs quick actions through the pipeline', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /^Research/i }));

    await waitFor(() =>
      expect(screen.getByText('Command received')).toBeInTheDocument(),
    );
  });
});
