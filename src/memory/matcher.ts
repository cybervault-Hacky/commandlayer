/**
 * Phase 6 — deterministic memory matching.
 *
 * Three jobs, all local and reproducible (no model, no heuristics that
 * vary between runs):
 *
 * 1. RELATION — does a new memory duplicate, extend, or replace an
 *    existing one? Used to offer "Update existing memory?" instead of
 *    silently creating duplicates.
 * 2. RETRIEVAL — which few memories are relevant to this request? Bounded
 *    (never the whole store) and relevance-gated (no shared topic →
 *    nothing is sent).
 * 3. CONFLICT RESOLUTION — when two retrieved memories talk about the same
 *    attribute with different values, only the newest confirmed one is
 *    used; the older is reported as superseded (never deleted, never sent
 *    to the AI as a contradiction).
 */
import {
  MemoryScope,
  type MemoryInput,
  type MemoryRecord,
  type MemoryUsedView,
} from './types';
import { MEMORY_LIMITS } from './limits';
import {
  attributeShape,
  changeMarker,
  frameOf,
  memoryTokens,
  objectOf,
} from './sanitizer';

/** Jaccard similarity over salient tokens (0..1). */
export function similarity(a: string, b: string): number {
  const left = new Set(memoryTokens(a));
  const right = new Set(memoryTokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export type MemoryRelation =
  | { relation: 'NONE' }
  | {
      relation: 'DUPLICATE' | 'SIMILAR' | 'REPLACEMENT' | 'CONFLICT';
      record: MemoryRecord;
    };

function sameScope(a: MemoryInput, b: MemoryRecord): boolean {
  const scope = a.scope ?? MemoryScope.Global;
  if (scope !== b.scope) return false;
  if (scope === MemoryScope.Project) {
    return (
      (a.project ?? null)?.toLowerCase() === (b.project ?? null)?.toLowerCase()
    );
  }
  return true;
}

/**
 * True when two memories describe the same attribute with a different
 * value ("prefer X" vs "prefer Y"). Deliberately narrow: both must share
 * the same frame verb and the same object shape (single value vs
 * qualified value), so "prefer TypeScript for frontend work" and "prefer
 * dark mode" are NOT treated as conflicting.
 */
export function sameAttribute(a: string, b: string): boolean {
  const frameA = frameOf(a);
  const frameB = frameOf(b);
  if (frameA === null || frameB === null || frameA !== frameB) return false;
  const objectA = objectOf(a);
  const objectB = objectOf(b);
  if (objectA.length === 0 || objectB.length === 0) return false;
  if (objectA.join(' ') === objectB.join(' ')) return true;
  // Same attribute only when both sides are simple values of the same
  // shape: "prefer TypeScript" vs "prefer JavaScript", never
  // "prefer TypeScript for frontend work" vs "prefer dark mode".
  return (
    attributeShape(a) === 'noun' &&
    attributeShape(b) === 'noun' &&
    objectA.length === 1 &&
    objectB.length === 1
  );
}

/**
 * Classify how a proposed memory relates to what is already stored.
 * Order matters: exact duplicate first, then an explicit replacement
 * ("...I now prefer..."), then a near match, then an attribute conflict.
 */
export function findRelation(
  records: readonly MemoryRecord[],
  input: MemoryInput,
): MemoryRelation {
  const enabled = records.filter((record) => record.enabled);
  const candidateTokens = memoryTokens(input.content).join(' ');

  for (const record of enabled) {
    if (!sameScope(input, record)) continue;
    if (memoryTokens(record.content).join(' ') === candidateTokens) {
      return { relation: 'DUPLICATE', record };
    }
  }

  for (const record of enabled) {
    if (!sameScope(input, record)) continue;
    if (
      changeMarker(input.content) &&
      sameAttribute(input.content, record.content)
    ) {
      return { relation: 'REPLACEMENT', record };
    }
  }

  for (const record of enabled) {
    if (record.kind !== input.kind) continue;
    if (!sameScope(input, record)) continue;
    if (similarity(input.content, record.content) >= MEMORY_LIMITS.SIMILARITY_THRESHOLD) {
      return { relation: 'SIMILAR', record };
    }
  }

  for (const record of enabled) {
    if (record.kind !== input.kind) continue;
    if (!sameScope(input, record)) continue;
    if (sameAttribute(input.content, record.content)) {
      return { relation: 'CONFLICT', record };
    }
  }

  return { relation: 'NONE' };
}

/** Does this query actually name the memory's project? */
export function mentionsProject(query: string, project: string | null): boolean {
  if (!project) return false;
  return query.toLowerCase().includes(project.toLowerCase());
}

function scoreFor(queryTokens: readonly string[], record: MemoryRecord): number {
  const tokens = new Set(memoryTokens(record.content));
  let score = 0;
  for (const token of queryTokens) if (tokens.has(token)) score += 1;
  if (score === 0) return 0;
  // Preferences and standing instructions are the most useful saved
  // context at equal topical relevance.
  if (
    record.kind === 'PREFERENCE' ||
    record.kind === 'EXPLICIT_INSTRUCTION'
  ) {
    score += 0.25;
  }
  return score;
}

function toUsed(record: MemoryRecord): MemoryUsedView {
  return { id: record.id, kind: record.kind, content: record.content };
}

/**
 * Retrieve the few memories relevant to one request.
 *
 * - relevance-gated: at least one shared salient token is required, so an
 *   unrelated request never sees the store;
 * - scope-safe: PROJECT memories are used only when the request names
 *   that project (a project fact never becomes a global assumption);
 * - conflict-safe: superseded values are dropped, not sent as
 *   contradictions.
 */
export function retrieveRelevant(
  records: readonly MemoryRecord[],
  query: string,
  limit: number = MEMORY_LIMITS.MAX_RETRIEVED_MEMORIES,
): { memories: MemoryUsedView[]; superseded: number } {
  const queryTokens = memoryTokens(query);
  if (queryTokens.length === 0) return { memories: [], superseded: 0 };

  const scored = records
    .filter((record) => record.enabled)
    .filter((record) => record.scope === MemoryScope.Global || mentionsProject(query, record.project))
    .map((record) => ({ record, score: scoreFor(queryTokens, record) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) =>
      b.score - a.score || b.record.updatedAt - a.record.updatedAt,
    );

  const { kept, superseded } = resolveConflicts(scored.map((entry) => entry.record));
  return { memories: kept.slice(0, limit).map(toUsed), superseded };
}

/**
 * Deterministic conflict resolution over an ordered (best-first) list:
 * within the same category + attribute frame, keep the newest confirmed
 * memory and count the older ones as superseded.
 */
export function resolveConflicts(records: readonly MemoryRecord[]): {
  kept: MemoryRecord[];
  superseded: number;
} {
  const groups = new Map<string, MemoryRecord>();
  const kept: MemoryRecord[] = [];
  let superseded = 0;

  for (const record of records) {
    const frame = frameOf(record.content);
    const objects = objectOf(record.content);
    const shape = attributeShape(record.content);
    const groupable = frame !== null && objects.length > 0 && shape !== null;
    if (!groupable) {
      kept.push(record);
      continue;
    }
    const key = `${record.kind}:${frame}:${shape}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, record);
      kept.push(record);
      continue;
    }
    if (objectOf(existing.content).join(' ') === objects.join(' ')) {
      // Same attribute and same value: keep the newest, drop the repeat.
      if (record.updatedAt > existing.updatedAt) {
        const index = kept.indexOf(existing);
        if (index >= 0) kept[index] = record;
        groups.set(key, record);
      }
      superseded += 1;
      continue;
    }
    if (record.updatedAt > existing.updatedAt) {
      const index = kept.indexOf(existing);
      if (index >= 0) kept[index] = record;
      groups.set(key, record);
    }
    superseded += 1;
  }

  return { kept, superseded };
}

/**
 * Relevance lookup used for memory targeting ("forget the one about X").
 * Returns the records that share at least one salient token, best first —
 * never a guessed match, and never the whole store.
 */
export function searchByRelevance(
  records: readonly MemoryRecord[],
  query: string,
): MemoryRecord[] {
  const queryTokens = memoryTokens(query);
  if (queryTokens.length === 0) return [];
  const scored = records
    .map((record) => ({ record, score: scoreFor(queryTokens, record) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.record.updatedAt - a.record.updatedAt);
  return scored.map((entry) => entry.record);
}

/** Search for the management UI (bounded, newest first). */
export function searchRecords(
  records: readonly MemoryRecord[],
  query: string,
  kind: MemoryRecord['kind'] | null = null,
): MemoryRecord[] {
  const filterTokens = memoryTokens(query);
  const filtered = records.filter(
    (record) =>
      (kind === null || record.kind === kind) &&
      (filterTokens.length === 0 ||
        filterTokens.every((token) =>
          new Set([...memoryTokens(record.content), memoryTokens(record.project ?? '')]).has(token),
        )),
  );
  return filtered
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MEMORY_LIMITS.MAX_SEARCH_RESULTS);
}
