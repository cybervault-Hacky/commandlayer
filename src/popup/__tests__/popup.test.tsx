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

describe('Popup', () => {
  beforeEach(() => {
    const stub = createChromeStub({
      activeTab: { id: 1, title: 'GitHub', url: 'https://github.com/' },
    });
    installChromeStub(stub);
    resetChromeStorage();
    __resetStorageBackendForTests();
    __resetTransportForTests();
  });

  it('renders branding, status, page context and actions', async () => {
    render(<App />);

    // Extension status: the stubbed runtime makes this an "extension".
    expect(await screen.findByText('Ready')).toBeInTheDocument();

    // Current page context from the stubbed active tab.
    await waitFor(() => expect(screen.getByText('github.com')).toBeInTheDocument());
    expect(screen.getByText('GitHub')).toBeInTheDocument();

    expect(
      screen.getByRole('button', { name: /open command center/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /open side panel/i }),
    ).toBeInTheDocument();

    // Shortcut information and version footer.
    expect(screen.getByText(/opens commandlayer/i)).toBeInTheDocument();
    expect(screen.getByText(/v0\.2\.0/i)).toBeInTheDocument();
  });

  it('opens the side panel when requested', async () => {
    const stub = createChromeStub({
      activeTab: { id: 1, title: 'GitHub', url: 'https://github.com/' },
    });
    installChromeStub(stub);
    resetChromeStorage();
    __resetStorageBackendForTests();
    __resetTransportForTests();

    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole('button', { name: /open side panel/i }),
    );

    expect(stub.sidePanel.open).toHaveBeenCalledTimes(1);
    expect(stub.sidePanel.open).toHaveBeenCalledWith({ tabId: 1 });
  });

  it('opens the command center tab when requested', async () => {
    const stub = createChromeStub({
      activeTab: { id: 1, title: 'GitHub', url: 'https://github.com/' },
    });
    installChromeStub(stub);
    resetChromeStorage();
    __resetStorageBackendForTests();
    __resetTransportForTests();

    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole('button', { name: /open command center/i }),
    );

    expect(stub.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('command-center.html') }),
    );
  });

  it('reports unsupported pages in the current-page card', async () => {
    const stub = createChromeStub({
      activeTab: { id: 1, title: 'Extensions', url: 'chrome://extensions' },
    });
    installChromeStub(stub);
    resetChromeStorage();
    __resetStorageBackendForTests();
    __resetTransportForTests();

    render(<App />);
    expect(await screen.findByText('Extensions')).toBeInTheDocument();
  });

  it('shows the unavailable state when there is no active tab', async () => {
    const stub = createChromeStub();
    installChromeStub(stub);
    resetChromeStorage();
    __resetStorageBackendForTests();
    __resetTransportForTests();

    render(<App />);
    expect(await screen.findByText('No page context')).toBeInTheDocument();
  });
});
