import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { MessageType } from '@/shared/constants/messages';
import {
  createChromeStub,
  installChromeStub,
  uninstallChromeStub,
  type ChromeStub,
} from '@/test-utils/chromeStub';
import { __resetStorageBackendForTests } from '@/storage/backend';
import { __resetTransportForTests } from '@/shared/messaging/transport';
import { resetMockProvider, setMockProviderLatency } from '@/ai/mockProvider';
import { extractPageContext } from '@/page-intelligence';
import { isExtractPageRequest } from '@/page-intelligence/protocol';
import type { CommandResult } from '@/shared/types/command';
import type { ExtensionStatus } from '@/shared/types/status';
import type { PageContext } from '@/shared/types/page';
import {
  handleBackgroundMessage,
  isTrustedSender,
} from '../handlers';

const REASONING_PAGE_HTML = `<!doctype html>
<html lang="en">
<head><title>Orbital Mechanics Primer</title></head>
<body>
  <article>
    <h1>Orbital Mechanics Primer</h1>
    <h2>Kepler's Laws</h2>
    <p>Planets sweep equal areas in equal times.</p>
    <p>Orbits are ellipses with the focus at the primary.</p>
    <a href="https://example.org/kepler">Kepler reference</a>
  </article>
</body>
</html>`;

/** Simulate the browser delivering extraction requests to the page. */
function wirePage(stub: ChromeStub, html: string, url: string): void {
  const dom = new JSDOM(html, { url });
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

const TRUSTED = { id: 'test-extension-id' };

function rawMessage(type: string, payload?: unknown) {
  return { v: 1, id: 'req-1', type, ...(payload ? { payload } : {}) };
}

describe('background message handler', () => {
  beforeEach(() => {
    installChromeStub(createChromeStub());
    __resetStorageBackendForTests();
    __resetTransportForTests();
    resetMockProvider();
    setMockProviderLatency(0);
  });

  afterEach(() => {
    uninstallChromeStub();
    vi.restoreAllMocks();
  });

  it('answers PING with the extension version', async () => {
    const result = await handleBackgroundMessage(
      rawMessage(MessageType.PING),
      TRUSTED,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ pong: true, version: '0.2.0' });
    }
  });

  it('answers GET_EXTENSION_STATUS with non-secret AI provider info', async () => {
    const result = await handleBackgroundMessage(
      rawMessage(MessageType.GET_EXTENSION_STATUS),
      TRUSTED,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const status = result.data as ExtensionStatus;
      expect(status.ready).toBe(true);
      expect(status.ai).toMatchObject({
        providerId: 'local-mock',
        mode: 'mock',
        gatewayConfigured: false,
      });
      // No secrets in status, ever.
      expect(JSON.stringify(status)).not.toMatch(/key|secret|token/i);
    }
  });

  it('rejects malformed messages safely', async () => {
    for (const raw of [null, 'string', 42, { v: 1 }, { v: 99, id: 'x', type: 'cl:ping' }]) {
      const result = await handleBackgroundMessage(raw, TRUSTED);
      expect(result).toEqual({
        ok: false,
        error: { code: 'BAD_MESSAGE', message: 'The message received was not valid.' },
      });
    }
  });

  it('rejects unknown message types', async () => {
    const result = await handleBackgroundMessage(
      rawMessage('cl:does-not-exist'),
      TRUSTED,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects untrusted senders', async () => {
    expect(isTrustedSender({ id: 'some-other-extension' })).toBe(false);
    expect(isTrustedSender(null)).toBe(false);

    const result = await handleBackgroundMessage(
      rawMessage(MessageType.PING),
      { id: 'some-other-extension' },
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED_SENDER' } });
  });

  it('rejects invalid COMMAND_SUBMIT payloads', async () => {
    for (const payload of [
      undefined,
      { text: '' },
      { text: 'hello', source: 'evil' },
      { text: 'hello', source: 'sidepanel', quickAction: 'hack' },
      { source: 'sidepanel' },
    ]) {
      const result = await handleBackgroundMessage(
        rawMessage(MessageType.COMMAND_SUBMIT, payload),
        TRUSTED,
      );
      expect(result.ok, JSON.stringify(payload)).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
      }
    }
  });

  it('runs a valid command through the reasoning engine (wired page)', async () => {
    const stub = createChromeStub({
      activeTab: {
        id: 1,
        title: 'Orbital Mechanics Primer',
        url: 'https://example.org/orbits',
      },
    });
    installChromeStub(stub);
    wirePage(stub, REASONING_PAGE_HTML, 'https://example.org/orbits');

    const result = await handleBackgroundMessage(
      rawMessage(MessageType.COMMAND_SUBMIT, {
        text: 'Summarize this page',
        source: 'sidepanel',
      }),
      TRUSTED,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as CommandResult;
      expect(data.status).toBe('completed');
      expect(data.intent).toBe('SUMMARIZE');
      expect(data.ai).toBeDefined();
      expect(data.ai?.requestId).toBe(data.id);
      expect(data.ai?.provider).toBe('local-mock');
      expect(data.ai?.answer).toContain('Orbital Mechanics Primer');
    }
  });

  it('fails a command honestly when no page content is reachable', async () => {
    const result = await handleBackgroundMessage(
      rawMessage(MessageType.COMMAND_SUBMIT, {
        text: 'Summarize this page',
        source: 'sidepanel',
      }),
      TRUSTED,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        status: 'failed',
        errorCode: 'AI_PAGE_UNAVAILABLE',
      });
    }
  });

  it('runs a valid quick action through the reasoning engine', async () => {
    const stub = createChromeStub({
      activeTab: {
        id: 1,
        title: 'Orbital Mechanics Primer',
        url: 'https://example.org/orbits',
      },
    });
    installChromeStub(stub);
    wirePage(stub, REASONING_PAGE_HTML, 'https://example.org/orbits');

    const result = await handleBackgroundMessage(
      rawMessage(MessageType.QUICK_ACTION, {
        actionId: 'explain',
        source: 'sidepanel',
      }),
      TRUSTED,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        status: 'completed',
        quickAction: 'explain',
        intent: 'EXPLAIN',
      });
    }
  });

  it('rejects an unknown quick action', async () => {
    const result = await handleBackgroundMessage(
      rawMessage(MessageType.QUICK_ACTION, {
        actionId: 'hack',
        source: 'sidepanel',
      }),
      TRUSTED,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects invalid SET_SETTINGS payloads', async () => {
    const result = await handleBackgroundMessage(
      rawMessage(MessageType.SET_SETTINGS, { patch: { theme: 'neon' } }),
      TRUSTED,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_SETTINGS');
  });

  it('applies a valid SET_SETTINGS patch', async () => {
    const result = await handleBackgroundMessage(
      rawMessage(MessageType.SET_SETTINGS, {
        patch: { reduceMotion: true },
      }),
      TRUSTED,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ reduceMotion: true });
    }
  });

  it('answers GET_PAGE_CONTEXT safely (no active tab → unavailable)', async () => {
    // The base stub has no active tab, so the capture degrades to a safe,
    // user-facing context instead of failing the message.
    const result = await handleBackgroundMessage(
      rawMessage(MessageType.GET_PAGE_CONTEXT),
      TRUSTED,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        state: 'unavailable',
        reason: 'no-tab',
      });
    }
  });

  it('accepts a valid sections payload for GET_PAGE_CONTEXT', async () => {
    const result = await handleBackgroundMessage(
      rawMessage(MessageType.GET_PAGE_CONTEXT, {
        sections: ['metadata', 'headings'],
      }),
      TRUSTED,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects invalid sections payloads for GET_PAGE_CONTEXT', async () => {
    for (const payload of [
      { sections: 'headings' },
      { sections: ['hacks'] },
      { sections: Array.from({ length: 8 }, (_, i) => `s${i}`) },
      { sections: [null] },
    ]) {
      const result = await handleBackgroundMessage(
        rawMessage(MessageType.GET_PAGE_CONTEXT, payload),
        TRUSTED,
      );
      expect(result.ok, JSON.stringify(payload)).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
      }
    }
  });

  it('returns an unsupported-page context for browser pages', async () => {
    const stub = createChromeStub({
      activeTab: { id: 1, title: 'Extensions', url: 'chrome://extensions' },
    });
    installChromeStub(stub);
    const result = await handleBackgroundMessage(
      rawMessage(MessageType.GET_CURRENT_PAGE),
      TRUSTED,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ state: 'unsupported' });
    }
  });
});
