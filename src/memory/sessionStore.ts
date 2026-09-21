import type { MemoryEntry, MemoryStore } from './types';

/**
 * In-memory session store: lives and dies with the page/worker. Deliberately
 * volatile — Phase 1 must not accumulate long-term memory.
 */
export class SessionMemoryStore implements MemoryStore {
  private readonly entries: MemoryEntry[] = [];
  private counter = 0;

  async remember(
    entry: Omit<MemoryEntry, 'id' | 'createdAt'>,
  ): Promise<MemoryEntry> {
    this.counter += 1;
    const stored: MemoryEntry = {
      ...entry,
      id: `mem-${this.counter}`,
      createdAt: new Date().toISOString(),
    };
    this.entries.push(stored);
    return stored;
  }

  async recall(query?: string): Promise<MemoryEntry[]> {
    if (!query) return [...this.entries];
    const needle = query.toLowerCase();
    return this.entries.filter((entry) =>
      entry.content.toLowerCase().includes(needle),
    );
  }

  async clear(): Promise<void> {
    this.entries.length = 0;
  }
}
