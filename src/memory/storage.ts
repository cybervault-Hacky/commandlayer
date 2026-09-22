/**
 * Phase 6 — the ONLY module that touches persistent memory storage.
 *
 *   MemoryRepository → MemoryStorage → StorageBackend → chrome.storage.local
 *
 * Nothing else in the codebase may read or write the memory key: a single
 * write path keeps the policy, the limits, and the sanitization
 * unavoidable. Storage failures (quota, unavailable backend, corrupt
 * data) are never fatal — they degrade to an empty, clearly-reported
 * state so the extension keeps working.
 */
import { getStorageBackend } from '@/storage/backend';
import { STORAGE_KEYS } from '@/storage/keys';
import {
  parseStoredMemoryState,
  toStoredMemoryState,
  type ParsedMemoryState,
} from './schema';
import type { MemoryRecord } from './types';

export async function loadMemoryRecords(): Promise<ParsedMemoryState> {
  try {
    const raw = await getStorageBackend().get(STORAGE_KEYS.memory);
    return parseStoredMemoryState(raw);
  } catch {
    return { records: [], rejected: 0, available: false, version: null };
  }
}

/**
 * Persist the whole bounded record list. Returns false (never throws)
 * when storage refuses the write; the caller reports a safe failure and
 * keeps the in-memory state unchanged.
 */
export async function saveMemoryRecords(
  records: readonly MemoryRecord[],
): Promise<boolean> {
  try {
    await getStorageBackend().set(
      STORAGE_KEYS.memory,
      toStoredMemoryState(records),
    );
    return true;
  } catch {
    return false;
  }
}

/** Where memory lives, for documentation and tests. */
export const MEMORY_STORAGE_KEY = STORAGE_KEYS.memory;
