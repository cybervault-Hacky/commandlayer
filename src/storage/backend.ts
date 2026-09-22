/**
 * Storage backend abstraction.
 *
 * chrome.storage.local in a real extension; an in-memory map in plain-browser
 * dev previews and tests. UI code never touches chrome.storage directly.
 */
export interface StorageBackend {
  readonly kind: 'chrome' | 'memory';
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

class ChromeStorageBackend implements StorageBackend {
  readonly kind = 'chrome' as const;

  async get(key: string): Promise<unknown> {
    const result = await chrome.storage.local.get(key);
    return result[key];
  }

  async set(key: string, value: unknown): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }
}

class MemoryStorageBackend implements StorageBackend {
  readonly kind = 'memory' as const;
  private readonly store = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    return this.store.get(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }
}

let cachedBackend: StorageBackend | null = null;

export function getStorageBackend(): StorageBackend {
  if (!cachedBackend) {
    const hasChromeStorage =
      typeof chrome !== 'undefined' && !!chrome.storage?.local;
    cachedBackend = hasChromeStorage
      ? new ChromeStorageBackend()
      : new MemoryStorageBackend();
  }
  return cachedBackend;
}

/** Test seam: re-detect the backend after stubbing chrome. */
export function __resetStorageBackendForTests(): void {
  cachedBackend = null;
}
