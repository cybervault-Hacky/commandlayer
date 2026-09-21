/**
 * Memory abstraction — Phase 1 exposes a strictly in-memory, session-scoped
 * store so future phases can define the contract. Nothing here persists to
 * disk or to chrome.storage: long-term memory is explicitly out of scope.
 */

export type MemoryKind = 'session' | 'note' | 'context';

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  content: string;
  createdAt: string;
}

export interface MemoryStore {
  remember(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<MemoryEntry>;
  recall(query?: string): Promise<MemoryEntry[]>;
  clear(): Promise<void>;
}
