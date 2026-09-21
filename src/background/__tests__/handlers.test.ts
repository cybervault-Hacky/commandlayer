import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageType } from '@/shared/constants/messages';
import {
  createChromeStub,
  installChromeStub,
  uninstallChromeStub,
} from '@/test-utils/chromeStub';
import { __resetStorageBackendForTests } from '@/storage/backend';
import { __resetTransportForTests } from '@/shared/messaging/transport';
import { setMockProviderLatency } from '@/ai/mockProvider';
import {
  handleBackgroundMessage,
  isTrustedSender,
} from '../handlers';

const TRUSTED = { id: 'test-extension-id' };

function rawMessage(type: string, payload?: unknown) {
  return { v: 1, id: 'req-1', type, ...(payload ? { payload } : {}) };
}

describe('background message handler', () => {
  beforeEach(() => {
    installChromeStub(createChromeStub());
    __resetStorageBackendForTests();
    __resetTransportForTests();
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
      expect(result.data).toEqual({ pong: true, version: '0.1.0' });
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

  it('runs a valid command through the mock pipeline', async () => {
    const result = await handleBackgroundMessage(
      rawMessage(MessageType.COMMAND_SUBMIT, {
        text: 'Summarize this page',
        source: 'sidepanel',
      }),
      TRUSTED,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ status: 'completed' });
    }
  });

  it('runs a valid quick action through the mock pipeline', async () => {
    const result = await handleBackgroundMessage(
      rawMessage(MessageType.QUICK_ACTION, {
        actionId: 'research',
        source: 'sidepanel',
      }),
      TRUSTED,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        status: 'completed',
        quickAction: 'research',
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
