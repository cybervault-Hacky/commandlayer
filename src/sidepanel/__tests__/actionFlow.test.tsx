import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JSDOM } from 'jsdom';
import { App } from '../App';
import {
  createChromeStub,
  installChromeStub,
  resetChromeStorage,
  uninstallChromeStub,
  type ChromeStub,
} from '@/test-utils/chromeStub';
import { __resetStorageBackendForTests } from '@/storage/backend';
import { __resetTransportForTests } from '@/shared/messaging/transport';
import { resetMockProvider, setMockProviderLatency } from '@/ai/mockProvider';
import { handleContentMessage } from '@/content/contentScript';
import { actionSessionStore } from '@/actions/session';
import { permissionLedger } from '@/actions/permissions';

const TAB = { id: 9, title: 'Console', url: 'https://console.example.com/' };

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head><title>Console</title></head>
<body>
  <h1>Console</h1>
  <p>Manage your workspace.</p>
  <button id="menuBtn" aria-expanded="false">Menu</button>
</body>
</html>`;

let dom: JSDOM;

function wireRealContentScript(stub: ChromeStub): void {
  dom = new JSDOM(PAGE_HTML, { url: TAB.url });
  vi.spyOn(dom.window.Element.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({ x: 0, y: 0, width: 120, height: 32, top: 0, right: 120, bottom: 32, left: 0, toJSON: () => ({}) }) as DOMRect,
  );
  const menuBtn = dom.window.document.getElementById('menuBtn');
  menuBtn?.addEventListener('click', () => menuBtn.setAttribute('aria-expanded', 'true'));
  Object.defineProperty(dom.window, 'scrollTo', { value: () => undefined, configurable: true });
  stub.tabs.sendMessage.mockImplementation(async (_tabId: number, message: unknown) => {
    // The REAL content script reads the global document; point it at the
    // page fixture only for the duration of the message, then restore
    // the environment document so React rendering is unaffected.
    vi.stubGlobal('document', dom.window.document);
    let response: unknown;
    try {
      handleContentMessage(message, (r) => {
        response = r;
      });
    } finally {
      vi.unstubAllGlobals();
    }
    if (response === undefined) {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    }
    return response;
  });
}

function setup(): ChromeStub {
  const stub = createChromeStub({ activeTab: TAB });
  installChromeStub(stub);
  resetChromeStorage();
  __resetStorageBackendForTests();
  __resetTransportForTests();
  resetMockProvider();
  setMockProviderLatency(0);
  actionSessionStore.clear();
  permissionLedger.clear();
  wireRealContentScript(stub);
  return stub;
}

beforeEach(setup);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  uninstallChromeStub();
  actionSessionStore.clear();
  permissionLedger.clear();
});

async function submitCommand(user: ReturnType<typeof userEvent.setup>, text: string) {
  const input = screen.getByLabelText('Command');
  await user.type(input, `${text}{Enter}`);
}

describe('Side Panel — safe action flow (Phase 4)', () => {
  it('shows an ACTION PREVIEW for action commands (nothing executes yet)', async () => {
    const user = userEvent.setup();
    render(<App />);

    await submitCommand(user, 'click the "Menu" button');

    await waitFor(() => {
      expect(screen.getByText(/Proposed action/i)).toBeInTheDocument();
    });
    // The phrasing names the button role → role-target preview wording.
    expect(screen.getByText(/Click .*“Menu”/)).toBeInTheDocument();
    expect(screen.getByText('Requires confirmation')).toBeInTheDocument();
    // The page is still untouched — preview only.
    expect(dom.window.document.getElementById('menuBtn')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('executes after explicit approval and shows the verified result', async () => {
    const user = userEvent.setup();
    render(<App />);

    await submitCommand(user, 'click the "Menu" button');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /allow & run/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /allow & run/i }));

    await waitFor(() => {
      expect(screen.getByText(/Action result/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Completed 1 of 1 action/)).toBeInTheDocument();
    // The real DOM effect happened through the content-script channel.
    expect(dom.window.document.getElementById('menuBtn')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('Cancel withdraws the proposal without executing', async () => {
    const user = userEvent.setup();
    render(<App />);

    await submitCommand(user, 'click the "Menu" button');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Proposed action/i)).toBeNull();
    });
    expect(dom.window.document.getElementById('menuBtn')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('Escape cancels a pending proposal', async () => {
    const user = userEvent.setup();
    render(<App />);

    await submitCommand(user, 'click the "Menu" button');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /allow & run/i })).toBeInTheDocument();
    });
    // Focus is already on the approve button; Escape must cancel.
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByText(/Proposed action/i)).toBeNull();
    });
  });

  it('read-only actions (find) also require an explicit run click', async () => {
    const user = userEvent.setup();
    render(<App />);

    await submitCommand(user, 'find "workspace"');
    await waitFor(() => {
      expect(screen.getByText(/Find text “workspace”/)).toBeInTheDocument();
    });
    expect(screen.getByText('Read-only')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /allow & run/i }));
    await waitFor(() => {
      expect(screen.getByText(/Found 1 match/i)).toBeInTheDocument();
    });
    // Match snippets render in the progress card data section.
    expect(screen.getByText(/Manage your workspace/)).toBeInTheDocument();
  });
});
