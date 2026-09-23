import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JSDOM } from 'jsdom';
import { App } from '../App';
import {
  createChromeStub,
  installChromeStub,
  resetChromeStorage,
  seedChromeStorage,
  uninstallChromeStub,
  type ChromeStub,
} from '@/test-utils/chromeStub';
import { __resetStorageBackendForTests } from '@/storage/backend';
import { __resetTransportForTests } from '@/shared/messaging/transport';
import { resetMockProvider, setMockProviderLatency } from '@/ai/mockProvider';
import { handleContentMessage } from '@/content/contentScript';
import { actionSessionStore } from '@/actions/session';
import { permissionLedger } from '@/actions/permissions';
import { STORAGE_KEYS } from '@/storage/keys';

/**
 * Phase 7 — Developer Mode in the Side Panel, end to end over the REAL
 * content script, the REAL background handler, and the REAL Action Engine.
 *
 * What must hold: the mode is opt-in, it shows what was captured and what was
 * analysed, and its one executable part is typed GitHub navigation that runs
 * only after the user approves it — then reports progress and verification.
 */
const TAB = {
  id: 9,
  title: 'Add token refresh by octocat · Pull Request #42 · octocat/hello-world',
  url: 'https://github.com/octocat/hello-world/pull/42/files',
};

const PR_HTML = `<!doctype html>
<html lang="en">
<head>
  <title>Add token refresh by octocat · Pull Request #42 · octocat/hello-world</title>
  <meta name="description" content="Adds a refresh path for expired access tokens.">
  <meta name="octolytics-dimension-repository_nwo" content="octocat/hello-world">
  <meta name="octolytics-dimension-repository_public" content="true">
</head>
<body>
  <h1>Add token refresh</h1>
  <article class="markdown-body"><p>Adds a refresh path for expired access tokens.</p></article>
  <div id="diffstat">+12 −4</div>
  <div data-path="src/auth/session.ts"><span class="diffstat">+12 −4</span></div>
  <div data-path="src/auth/session.test.ts"><span class="diffstat">+40 −0</span></div>
  <table>
    <tr data-line-number="12"><td class="blob-code blob-code-addition" data-code-marker="+">const refreshed = await refresh(token);</td></tr>
    <tr data-line-number="13"><td class="blob-code blob-code-addition" data-code-marker="+">console.log("refreshing", token);</td></tr>
    <tr data-line-number="9"><td class="blob-code blob-code-deletion" data-code-marker="-">return cached;</td></tr>
  </table>
  <a href="/octocat/hello-world/blob/main/src/auth/session.ts">src/auth/session.ts</a>
  <form method="post" action="/session"><input type="password" name="password" value="hunter2"></form>
</body>
</html>`;

let dom: JSDOM;
/** The installed stub, so tests can assert on the browser surface directly. */
let chromeStub: ChromeStub;

function wireRealContentScript(stub: ChromeStub): void {
  dom = new JSDOM(PR_HTML, { url: TAB.url });
  stub.tabs.sendMessage.mockImplementation(async (_tabId: number, message: unknown) => {
    // The REAL content script reads the global document: point it at the PR
    // fixture for this message only, then restore the environment.
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

function setup(developerMode: boolean): ChromeStub {
  // The settings record the Side Panel reads on start-up (schema 1 is
  // required — an unversioned blob is rejected as corrupt by design).
  const stub = createChromeStub({ activeTab: TAB });
  installChromeStub(stub);
  resetChromeStorage();
  seedChromeStorage({
    [STORAGE_KEYS.settings]: {
      schema: 1,
      theme: 'dark',
      reduceMotion: true,
      onboardingSeen: true,
      memoryEnabled: true,
      developerMode,
    },
  });
  __resetStorageBackendForTests();
  __resetTransportForTests();
  resetMockProvider();
  setMockProviderLatency(0);
  actionSessionStore.clear();
  permissionLedger.clear();
  wireRealContentScript(stub);
  chromeStub = stub;
  return stub;
}

beforeEach(() => {
  setup(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  uninstallChromeStub();
  actionSessionStore.clear();
  permissionLedger.clear();
});

async function submitCommand(
  user: ReturnType<typeof userEvent.setup>,
  text: string,
): Promise<void> {
  await user.type(screen.getByLabelText('Command'), `${text}{Enter}`);
}

describe('Side Panel — Developer Mode (Phase 7)', () => {
  it('captures the GitHub page and renders the developer sections', async () => {
    render(<App />);

    const developer = await screen.findByLabelText('Developer context');
    expect(developer).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('octocat/hello-world')).toBeInTheDocument();
    });
    // Provenance is stated, not implied.
    expect(screen.getByText(/nothing was downloaded/i)).toBeInTheDocument();
    // Nothing was requested yet: the capture alone is not a result.
    expect(screen.queryByLabelText('Change plan')).toBeNull();
  });

  it('shows a developer result whose findings cite evidence', async () => {
    const user = userEvent.setup();
    render(<App />);

    await submitCommand(user, 'Review this pull request');

    await waitFor(
      () => {
        expect(screen.getByLabelText('Review pull request')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
    // Findings exist without any real model, and each says where it came from.
    expect(screen.getByText(/Findings · /)).toBeInTheDocument();
    expect(screen.getAllByText(/Analyzed locally/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/octocat\/hello-world/).length).toBeGreaterThan(0);
    // The password value on the page never reaches the panel.
    expect(screen.queryByText(/hunter2/)).toBeNull();
  });

  it('requires approval before anything navigates, then verifies the step', async () => {
    const user = userEvent.setup();
    const stub = chromeStub;
    render(<App />);

    await submitCommand(user, 'Review this pull request');

    const plan = await screen.findByLabelText('Change plan', {}, { timeout: 5000 });
    expect(plan).toBeInTheDocument();
    // Rendering a plan executes nothing.
    expect(stub.tabs.update).not.toHaveBeenCalled();

    const approve = await screen.findByRole(
      'button',
      { name: /allow & run/i },
      { timeout: 5000 },
    );
    await user.click(approve);

    await waitFor(
      () => {
        expect(stub.tabs.update).toHaveBeenCalled();
      },
      { timeout: 5000 },
    );
    // Progress and per-step outcomes are reported, not implied.
    await waitFor(
      () => {
        expect(screen.getByText(/Completed \d+ of \d+ actions/)).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
    expect(screen.getAllByText(/^Opened /).length).toBeGreaterThan(0);
    expect(await screen.findByLabelText('Action plan result')).toBeInTheDocument();

    // Every destination is a GitHub repository page for the approved files.
    expect(stub.tabs.update.mock.calls.length).toBeLessThanOrEqual(4);
    for (const call of stub.tabs.update.mock.calls) {
      const url = call[1]?.url ?? '';
      expect(url).toMatch(/^https:\/\/github\.com\/octocat\/hello-world\/(blob|tree)\//);
    }
  });

  it('captures nothing at all when Developer Mode is off', async () => {
    const stub = setup(false);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText('Command')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('Developer context')).toBeNull();
    // The Phase 2 on-demand guarantee: no capture request was made.
    expect(stub.tabs.sendMessage).not.toHaveBeenCalled();
  });
});
