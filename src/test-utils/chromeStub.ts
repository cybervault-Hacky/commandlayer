import { vi } from 'vitest';

/**
 * Minimal chrome.* stub for jsdom tests. Mirrors just the surface the
 * Phase 1 code touches (runtime, tabs, permissions, storage, sidePanel).
 * It deliberately omits runtime.sendMessage so the message layer selects
 * the LocalTransport and the real background handler runs in-process.
 */

export interface ChromeStub {
  runtime: {
    id: string;
    getManifest: () => { version: string };
    getURL: (path: string) => string;
  };
  tabs: {
    query: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  permissions: {
    contains: ReturnType<typeof vi.fn>;
  };
  storage: {
    local: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
    };
  };
  sidePanel: {
    open: ReturnType<typeof vi.fn>;
  };
}

const storageData: Record<string, unknown> = {};

export function resetChromeStorage(): void {
  for (const key of Object.keys(storageData)) delete storageData[key];
}

export function readChromeStorage(key: string): unknown {
  return storageData[key];
}

export function createChromeStub(options: {
  activeTab?: { id?: number; title?: string; url?: string };
  version?: string;
} = {}): ChromeStub {
  const { activeTab, version } = options;
  return {
    runtime: {
      id: 'test-extension-id',
      getManifest: () => ({ version: version ?? '0.1.0' }),
      getURL: (path: string) => `chrome-extension://test-extension-id/${path}`,
    },
    tabs: {
      query: vi.fn(async () => (activeTab ? [activeTab] : [])),
      create: vi.fn(async () => ({ id: 99 })),
    },
    permissions: {
      contains: vi.fn(async () => ({ hasPermission: true })),
    },
    storage: {
      local: {
        get: vi.fn(async (key: string | string[]) => {
          const keys = typeof key === 'string' ? [key] : key;
          const out: Record<string, unknown> = {};
          for (const k of keys) {
            if (k in storageData) out[k] = storageData[k];
          }
          return out;
        }),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          Object.assign(storageData, obj);
        }),
      },
    },
    sidePanel: {
      open: vi.fn(async () => undefined),
    },
  };
}

export function installChromeStub(stub: ChromeStub): void {
  (globalThis as { chrome?: unknown }).chrome = stub;
}

export function uninstallChromeStub(): void {
  delete (globalThis as { chrome?: unknown }).chrome;
}
