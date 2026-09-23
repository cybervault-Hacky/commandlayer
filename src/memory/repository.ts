/**
 * Phase 6 — the memory repository: the single mutation path.
 *
 * Everything that can create, update, or delete a memory goes through
 * this class, and every operation re-runs:

 *   normalize → policy (sensitive/structural) → limits → persist
 *
 * There is no "raw storage" access anywhere else in the extension
 * (storage.ts is imported only here), so the policy cannot be bypassed by
 * a caller that forgets it. Writes are serialized and rolled back when
 * persistence fails, and reads never throw.
 */
import { ErrorCode } from '@/shared/constants/errors';
import { USER_ERROR_MESSAGES } from '@/shared/constants/errors';
import { MEMORY_LIMITS } from './limits';
import {
  evaluateMemoryContent,
  type MemoryPolicyCode,
} from './policy';
import { countByKind, type ParsedMemoryState } from './schema';
import { loadMemoryRecords, saveMemoryRecords } from './storage';
import {
  findRelation,
  retrieveRelevant,
  searchByRelevance,
  searchRecords,
  type MemoryRelation,
} from './matcher';
import {
  MemoryScope,
  type MemoryInput,
  type MemoryKind,
  type MemoryRecord,
  type MemoryRetrieval,
  type MemoryStatusView,
} from './types';

export type MemoryFailureCode =
  | 'MEMORY_SENSITIVE_BLOCKED'
  | 'MEMORY_CONTENT_TOO_LONG'
  | 'MEMORY_INVALID'
  | 'MEMORY_LIMIT_EXCEEDED'
  | 'MEMORY_STORAGE_FAILED'
  | 'MEMORY_NOT_FOUND';

export type MemoryWriteOutcome =
  | { ok: true; record: MemoryRecord; replaced: MemoryRecord | null }
  | { ok: false; code: MemoryFailureCode; message: string };

function failure(code: MemoryFailureCode): { ok: false; code: MemoryFailureCode; message: string } {
  return { ok: false, code, message: USER_ERROR_MESSAGES[code] };
}

/**
 * Local relevance score for targeting: how many salient query tokens the
 * record shares. Kept here (not in the repository's public surface) so the
 * tie-breaking rule lives next to its only use.
 */
function scoreCandidate(
  query: string,
  record: MemoryRecord,
): number {
  const queryTokens = new Set<string>();
  for (const token of tokenize(query)) queryTokens.add(token);
  let score = 0;
  for (const token of tokenize(record.content)) {
    if (queryTokens.has(token)) score += 1;
  }
  return score;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((word) => word.replace(/s$/, ''))
    .filter((word) => word.length > 2 && !STOPWORD_TOKENS.has(word));
}

const STOPWORD_TOKENS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'you', 'your', 'about',
  'memory', 'remember', 'saved', 'prefer',
]);

function codeForPolicy(policyCode: MemoryPolicyCode): MemoryFailureCode {
  switch (policyCode) {
    case 'SENSITIVE':
      return 'MEMORY_SENSITIVE_BLOCKED';
    case 'TOO_LONG':
      return 'MEMORY_CONTENT_TOO_LONG';
    default:
      return 'MEMORY_INVALID';
  }
}

/** Random, content-free ids (never derived from what the user said). */
function defaultIdFactory(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = new Uint8Array(MEMORY_LIMITS.ID_LENGTH);
    cryptoObj.getRandomValues(bytes);
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join(
      '',
    );
  }
  let out = '';
  while (out.length < MEMORY_LIMITS.ID_LENGTH) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)] ?? 'a';
  }
  return out;
}

export interface MemoryRepositoryOptions {
  load?: () => Promise<ParsedMemoryState>;
  save?: (records: readonly MemoryRecord[]) => Promise<boolean>;
  now?: () => number;
  newId?: () => string;
}

export class MemoryRepository {
  private records: MemoryRecord[] = [];
  private loaded = false;
  private storageAvailable = true;
  /** Records discarded while loading (tampered/corrupt) — diagnostics only. */
  private rejectedOnLoad = 0;
  private queue: Promise<unknown> = Promise.resolve();

  private readonly load;
  private readonly save;
  private now: () => number;
  private newId: () => string;

  constructor(options: MemoryRepositoryOptions = {}) {
    this.load = options.load ?? loadMemoryRecords;
    this.save = options.save ?? saveMemoryRecords;
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? defaultIdFactory;
  }

  /** Test seam: deterministic clock / id source. */
  setClock(now: () => number): void {
    this.now = now;
  }

  setNewId(newId: () => string): void {
    this.newId = newId;
  }

  /** Test seam: drop the cache so the next call re-reads storage. */
  resetCache(): void {
    this.records = [];
    this.loaded = false;
    this.storageAvailable = true;
    this.rejectedOnLoad = 0;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const parsed = await this.load();
      this.records = parsed.records;
      this.storageAvailable = parsed.available;
      this.rejectedOnLoad = parsed.rejected;
    } catch {
      // A failing backend never breaks the extension: memory reads as
      // empty, is marked unavailable, and writes report a safe failure.
      this.records = [];
      this.storageAvailable = false;
      this.rejectedOnLoad = 0;
    }
    this.loaded = true;
  }

  /** Serialize every mutation (no lost updates, no interleaving). */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async list(): Promise<MemoryRecord[]> {
    await this.ensureLoaded();
    return [...this.records].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    await this.ensureLoaded();
    return this.records.find((record) => record.id === id);
  }

  async status(): Promise<MemoryStatusView> {
    await this.ensureLoaded();
    return {
      enabled: true,
      count: this.records.filter((record) => record.enabled).length,
      total: this.records.length,
      byKind: countByKind(this.records),
      storageAvailable: this.storageAvailable,
    };
  }

  /** Diagnostics: records dropped while loading (never includes content). */
  get discardedOnLoad(): number {
    return this.rejectedOnLoad;
  }

  /** How a proposed memory relates to what is already stored. */
  async relationFor(input: MemoryInput): Promise<MemoryRelation> {
    await this.ensureLoaded();
    return findRelation(this.records, input);
  }

  /**
   * Validate without writing. Used to decide whether a preview may be
   * shown at all — the same checks run again at confirmation time.
   */
  async validate(
    input: MemoryInput,
  ): Promise<{ ok: true } | { ok: false; code: MemoryFailureCode; message: string }> {
    await this.ensureLoaded();
    const policy = evaluateMemoryContent(
      input.content,
      input.kind,
      input.scope ?? MemoryScope.Global,
      input.project ?? null,
    );
    if (!policy.ok) return failure(codeForPolicy(policy.code));
    if (this.records.length >= MEMORY_LIMITS.MAX_MEMORY_RECORDS) {
      return failure('MEMORY_LIMIT_EXCEEDED');
    }
    return { ok: true };
  }

  private buildRecord(
    input: MemoryInput,
  ):
    | { ok: true; record: MemoryRecord }
    | { ok: false; code: MemoryFailureCode; message: string } {
    const policy = evaluateMemoryContent(
      input.content,
      input.kind,
      input.scope ?? MemoryScope.Global,
      input.project ?? null,
    );
    if (!policy.ok) return failure(codeForPolicy(policy.code));
    const timestamp = this.now();
    return {
      ok: true,
      record: {
        id: this.newId(),
        kind: policy.kind,
        content: policy.content,
        scope: policy.scope,
        project: policy.project,
        createdAt: timestamp,
        updatedAt: timestamp,
        source: 'USER_EXPLICIT',
        confidence: 'HIGH',
        enabled: true,
      },
    };
  }

  async create(input: MemoryInput): Promise<MemoryWriteOutcome> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      if (this.records.length >= MEMORY_LIMITS.MAX_MEMORY_RECORDS) {
        return failure('MEMORY_LIMIT_EXCEEDED');
      }
      const built = this.buildRecord(input);
      if (!built.ok) return built;

      const next = [built.record, ...this.records];
      if (!(await this.save(next))) return failure('MEMORY_STORAGE_FAILED');
      this.records = next;
      this.storageAvailable = true;
      return { ok: true, record: built.record, replaced: null };
    });
  }

  async update(id: string, input: MemoryInput): Promise<MemoryWriteOutcome> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const existing = this.records.find((record) => record.id === id);
      if (!existing) return failure('MEMORY_NOT_FOUND');

      const policy = evaluateMemoryContent(
        input.content,
        input.kind,
        input.scope ?? existing.scope,
        input.project ?? existing.project,
      );
      if (!policy.ok) return failure(codeForPolicy(policy.code));

      const updated: MemoryRecord = {
        ...existing,
        kind: policy.kind,
        content: policy.content,
        scope: policy.scope,
        project: policy.project,
        updatedAt: this.now(),
        source: 'USER_EXPLICIT',
        confidence: 'HIGH',
        enabled: true,
      };
      const next = this.records.map((record) =>
        record.id === id ? updated : record,
      );
      if (!(await this.save(next))) return failure('MEMORY_STORAGE_FAILED');
      this.records = next;
      this.storageAvailable = true;
      return { ok: true, record: updated, replaced: existing };
    });
  }

  async remove(id: string): Promise<MemoryWriteOutcome> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const existing = this.records.find((record) => record.id === id);
      if (!existing) return failure('MEMORY_NOT_FOUND');
      const next = this.records.filter((record) => record.id !== id);
      if (!(await this.save(next))) return failure('MEMORY_STORAGE_FAILED');
      this.records = next;
      return { ok: true, record: existing, replaced: existing };
    });
  }

  async clearAll(): Promise<
    { ok: true; removed: number } | { ok: false; code: MemoryFailureCode; message: string }
  > {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const removed = this.records.length;
      if (removed === 0) return { ok: true, removed: 0 };
      if (!(await this.save([]))) return failure('MEMORY_STORAGE_FAILED');
      this.records = [];
      return { ok: true, removed };
    });
  }

  /** Bounded search for the management UI (strict, category-aware). */
  async search(query: string, kind: MemoryKind | null = null): Promise<MemoryRecord[]> {
    return this.searchStrict(query, kind);
  }

  /** Bounded, relevance-gated retrieval for one request. */
  async retrieve(query: string): Promise<MemoryRetrieval> {
    await this.ensureLoaded();
    const { memories, superseded } = retrieveRelevant(this.records, query);
    return { memories, superseded, disabled: false };
  }

  /**
   * The record a "forget/update this" request targets. Ambiguity is never
   * resolved by guessing: a tie for best match returns undefined and the
   * caller asks the user to pick in the memory manager.
   */
  async findByQuery(query: string): Promise<MemoryRecord | undefined> {
    await this.ensureLoaded();
    const candidates = await this.searchAll(query);
    if (candidates.length === 0) return undefined;

    const best = scoreCandidate(query, candidates[0]!);
    const second = candidates[1] ? scoreCandidate(query, candidates[1]) : -1;
    if (candidates.length > 1 && best === second) return undefined;
    return candidates[0];
  }

  /** Relevance-ordered candidates for a query (bounded). */
  async searchAll(query: string): Promise<MemoryRecord[]> {
    await this.ensureLoaded();
    return searchByRelevance(this.records, query).slice(
      0,
      MEMORY_LIMITS.MAX_SEARCH_RESULTS,
    );
  }

  /** Strict token search for the management UI. */
  async searchStrict(
    query: string,
    kind: MemoryKind | null = null,
  ): Promise<MemoryRecord[]> {
    await this.ensureLoaded();
    return searchRecords(this.records, query, kind);
  }
}

/** Worker-scoped singleton: the only memory writer in the extension. */
export const memoryRepository = new MemoryRepository();

/** Error code for a not-found record (kept next to the repository). */
export const MEMORY_NOT_FOUND_CODE = ErrorCode.MEMORY_NOT_FOUND;
