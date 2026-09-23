/**
 * Phase 6 test fixtures: an in-memory memory store, deterministic clocks
 * and ids, and repository/controller builders.
 *
 * Nothing here touches a real browser or real storage: the memory module
 * is exercised through its injected seams, and the "persistent" tests use
 * the chrome stub's storage map so a runtime restart can be simulated.
 */
import { MemoryRepository } from '@/memory/repository';
import { MemoryController } from '@/memory/controller';
import { MemoryConfidence, MemoryScope, MemorySource } from '@/memory/types';
import type { MemoryKind, MemoryRecord } from '@/memory/types';
import { parseStoredMemoryState, toStoredMemoryState } from '@/memory/schema';

export const FIXTURE_NOW = Date.parse('2026-03-01T09:00:00.000Z');

export function makeRecord(
  overrides: Partial<MemoryRecord> & { content: string },
): MemoryRecord {
  return {
    id: overrides.id ?? `mem${Math.random().toString(36).slice(2, 12)}`,
    kind: (overrides.kind ?? 'PREFERENCE') as MemoryKind,
    content: overrides.content,
    scope: overrides.scope ?? MemoryScope.Global,
    project: overrides.project ?? null,
    createdAt: overrides.createdAt ?? FIXTURE_NOW,
    updatedAt: overrides.updatedAt ?? overrides.createdAt ?? FIXTURE_NOW,
    source: MemorySource.UserExplicit,
    confidence: MemoryConfidence.High,
    enabled: overrides.enabled ?? true,
  };
}

export interface FakeMemoryStore {
  load: () => Promise<ReturnType<typeof parseStoredMemoryState>>;
  save: (records: readonly MemoryRecord[]) => Promise<boolean>;
  /** Raw stored value (as a backend would return it). */
  raw: () => unknown;
  setRaw: (value: unknown) => void;
  writes: number;
  failNextWrite: () => void;
}

/** In-memory stand-in for chrome.storage.local (memory key only). */
export function createFakeStore(
  initial: MemoryRecord[] = [],
): FakeMemoryStore {
  let stored: unknown = initial.length > 0 ? toStoredMemoryState(initial) : undefined;
  let failWrite = false;
  const store: FakeMemoryStore = {
    load: async () => parseStoredMemoryState(stored),
    save: async (records) => {
      if (failWrite) {
        failWrite = false;
        return false;
      }
      stored = toStoredMemoryState(records);
      store.writes += 1;
      return true;
    },
    raw: () => stored,
    setRaw: (value) => {
      stored = value;
    },
    writes: 0,
    failNextWrite: () => {
      failWrite = true;
    },
  };
  return store;
}

export interface TestHarness {
  store: FakeMemoryStore;
  repository: MemoryRepository;
  controller: MemoryController;
  setEnabled: (value: boolean) => void;
  advance: (ms: number) => void;
  now: () => number;
}

/** Repository + controller wired to one fake store and a fake clock. */
export function createHarness(options: {
  initial?: MemoryRecord[];
  enabled?: boolean;
  failWrites?: boolean;
} = {}): TestHarness {
  const store = createFakeStore(options.initial ?? []);
  let clock = FIXTURE_NOW;
  let counter = 0;
  const IDS = 'abcdefghijklmnopqrstuvwxyz0123456789';

  const repository = new MemoryRepository({
    load: store.load,
    save: store.save,
    now: () => clock,
    newId: () => {
      counter += 1;
      return `test${counter.toString().padStart(4, '0')}${IDS.slice(0, 8)}`.slice(0, 24);
    },
  });

  let enabled = options.enabled ?? true;
  const controller = new MemoryController({
    repository,
    now: () => clock,
    newId: () => {
      counter += 1;
      return `prev${counter.toString().padStart(4, '0')}`;
    },
    isEnabled: async () => enabled,
  });

  return {
    store,
    repository,
    controller,
    setEnabled: (value) => {
      enabled = value;
    },
    advance: (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
}
