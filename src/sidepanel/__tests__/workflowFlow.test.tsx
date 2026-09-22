import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
import { workflowSessionStore } from '@/workflows/state';
import { workflowSessions } from '@/workflows/session';

const TAB = {
  id: 9,
  title: 'Console documentation',
  url: 'https://console.example.com/',
};

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head><title>Console documentation</title></head>
<body>
  <h1>Console documentation</h1>
  <h2>Getting started</h2>
  <p>Manage your workspace from the console.</p>
  <a href="https://console.example.com/guide">Console guide</a>
</body>
</html>`;

let dom: JSDOM;

function wireRealContentScript(stub: ChromeStub): void {
  dom = new JSDOM(PAGE_HTML, { url: TAB.url });
  vi.spyOn(dom.window.Element.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        x: 0,
        y: 0,
        width: 120,
        height: 32,
        top: 0,
        right: 120,
        bottom: 32,
        left: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  );
  Object.defineProperty(dom.window, 'scrollTo', {
    value: () => undefined,
    configurable: true,
  });
  stub.tabs.sendMessage.mockImplementation(async (_tabId: number, message: unknown) => {
    // The REAL content script reads the global document; point it at the
    // page fixture for this message only, then restore the environment.
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
  workflowSessionStore.clear();
  workflowSessions.clear();
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
  workflowSessionStore.clear();
  workflowSessions.clear();
});

async function submitCommand(
  user: ReturnType<typeof userEvent.setup>,
  text: string,
): Promise<void> {
  const input = screen.getByLabelText('Command');
  await user.type(input, `${text}{Enter}`);
}

const GOAL = 'find "Console documentation" and read the page';

describe('Side Panel — workflow preview (Phase 5)', () => {
  it('previews a bounded workflow without executing any step', async () => {
    const user = userEvent.setup();
    render(<App />);

    await submitCommand(user, GOAL);

    await waitFor(() => {
      expect(screen.getByText(/Workflow preview/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Step 1 of 2', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Find text “Console documentation”/)).toBeInTheDocument();
    expect(screen.getByText(/Read this page’s structure/)).toBeInTheDocument();
    expect(screen.getByText(/Done when:/)).toBeInTheDocument();
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /approve & run/i }),
    ).toBeInTheDocument();
    // Nothing has run: the page is untouched and no plan was authorized.
    expect(workflowSessions.size()).toBe(0);
    const workflows = workflowSessionStore.size();
    expect(workflows).toBe(1);
    // The preview never shows hidden reasoning or raw page content.
    expect(screen.queryByText(/Manage your workspace from the console\./)).toBeNull();
  });

  it('runs the approved workflow one step at a time and verifies the outcome', async () => {
    const user = userEvent.setup();
    render(<App />);

    await submitCommand(user, GOAL);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve & run/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /approve & run/i }));

    await waitFor(
      () => {
        expect(screen.getByText(/Workflow result/i)).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
    expect(screen.getByRole('progressbar', { name: /workflow progress/i })).toHaveAttribute(
      'aria-valuenow',
      '2',
    );
    expect(screen.getByText(/2 of 2 completed/)).toBeInTheDocument();
    expect(screen.getByText(/Outcome verified/)).toBeInTheDocument();
    expect(screen.getByText(/Workflow completed/)).toBeInTheDocument();
    // Every step reports a verified result.
    expect(screen.getAllByText(/Verified:/)).toHaveLength(2);
    // A finished workflow cannot be paused or cancelled again.
    expect(screen.queryByRole('button', { name: /pause/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /cancel workflow/i })).toBeNull();
  });

  it('cancels a previewed workflow without running a step', async () => {
    const user = userEvent.setup();
    render(<App />);

    await submitCommand(user, GOAL);
    await waitFor(() => {
      expect(screen.getByText(/Workflow preview/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Workflow preview/i)).toBeNull();
    });
    expect(workflowSessions.size()).toBe(0);
  });
});

describe('Side Panel — workflow safety surface', () => {
  it('explains the task-workflow rules in Settings', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /settings/i }));

    const section = await screen.findByRole('region', { name: /task workflows/i });
    expect(within(section).getByText(/up to 4 steps/, { exact: false })).toBeInTheDocument();
    expect(
      within(section).getByText(/Approval is bound to the exact workflow/i),
      'approval language must appear',
    ).toBeInTheDocument();
    expect(
      within(section).getByText(/no automatic retry loops/i, { exact: false }),
    ).toBeInTheDocument();
    // There is no bypass or "trust forever" control — only information.
    expect(screen.queryByRole('button', { name: /trust forever|auto-approve/i })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /bypass/i })).toBeNull();
  });
});
