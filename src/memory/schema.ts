/**
 * Phase 6 — stored-memory schema and untrusted-data parsing.
 *
 * Everything read from storage is treated as UNTRUSTED: a record is
 * structurally validated field by field, re-sanitized, and re-checked
 * against the memory policy before it is allowed into the repository. A
 * malformed, tampered, or secret-bearing record is DROPPED (never
 * surfaced, never trusted), and the rest of the store still loads.
 */
import {
  MemoryConfidence,
  MemoryScope,
  MemorySource,
  isMemoryConfidence,
  isMemoryKind,
  isMemoryScope,
  isMemorySource,
  type MemoryKind,
  type MemoryRecord,
} from './types';
import { MEMORY_LIMITS } from './limits';
import { evaluateMemoryContent } from './policy';

/** Bump when the stored shape changes; unknown versions are discarded. */
export const MEMORY_SCHEMA_VERSION = 1;

export interface StoredMemoryState {
  schema: typeof MEMORY_SCHEMA_VERSION;
  records: MemoryRecord[];
}

export interface ParsedMemoryState {
  records: MemoryRecord[];
  /** Records that failed validation and were discarded. */
  rejected: number;
  /** Storage can be read and written (false when the backend failed). */
  available: boolean;
  /** The schema version found, when one was present. */
  version: number | null;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Validate one stored record; returns null when it must be discarded. */
export function parseMemoryRecord(raw: unknown): MemoryRecord | null {
  if (!isRecord(raw)) return null;

  const { id, kind, content, scope, project, createdAt, updatedAt } = raw;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
  if (!isMemoryKind(kind)) return null;
  if (!isMemoryScope(scope)) return null;
  if (!isTimestamp(createdAt) || !isTimestamp(updatedAt)) return null;
  if (!isMemorySource(raw.source)) return null;
  if (!isMemoryConfidence(raw.confidence)) return null;
  if (typeof raw.enabled !== 'boolean') return null;
  if (project !== null && typeof project !== 'string') return null;

  // Content is re-policed on load: a record that somehow bypassed the
  // policy (tampering, an older build, a hand-edited store) never loads.
  const policy = evaluateMemoryContent(content, kind, scope, project);
  if (!policy.ok) return null;

  const resolvedProject =
    policy.scope === MemoryScope.Project ? policy.project : null;

  return {
    id,
    kind: policy.kind,
    content: policy.content,
    scope: policy.scope,
    project: resolvedProject,
    createdAt,
    updatedAt: Math.max(updatedAt, createdAt),
    source: MemorySource.UserExplicit,
    confidence: MemoryConfidence.High,
    enabled: raw.enabled,
  };
}

/** Parse one record with an explicit kind (used by tamper tests). */
export function isRecordShapeSane(raw: unknown): boolean {
  return parseMemoryRecord(raw) !== null;
}

/**
 * Parse the whole stored blob. Never throws: a broken blob yields an
 * empty, marked-as-unavailable or recovered state so the extension keeps
 * working and the UI can explain what happened.
 */
export function parseStoredMemoryState(raw: unknown): ParsedMemoryState {
  if (raw === undefined || raw === null) {
    return { records: [], rejected: 0, available: true, version: null };
  }
  if (!isRecord(raw)) {
    return { records: [], rejected: 0, available: true, version: null };
  }

  const version = typeof raw.schema === 'number' ? raw.schema : null;
  if (version !== MEMORY_SCHEMA_VERSION) {
    // Unknown/older versions are discarded rather than guessed at.
    return {
      records: [],
      rejected: Array.isArray(raw.records) ? raw.records.length : 0,
      available: true,
      version,
    };
  }

  const list = Array.isArray(raw.records) ? raw.records : [];
  const records: MemoryRecord[] = [];
  const seen = new Set<string>();
  let rejected = 0;

  for (const candidate of list) {
    const record = parseMemoryRecord(candidate);
    if (!record || seen.has(record.id)) {
      rejected += 1;
      continue;
    }
    seen.add(record.id);
    records.push(record);
    if (records.length >= MEMORY_LIMITS.MAX_MEMORY_RECORDS) {
      rejected += list.length - records.length - rejected;
      break;
    }
  }

  return { records, rejected, available: true, version };
}

/** Serialize the bounded record list for storage. */
export function toStoredMemoryState(
  records: readonly MemoryRecord[],
): StoredMemoryState {
  return {
    schema: MEMORY_SCHEMA_VERSION,
    records: records
      .slice(0, MEMORY_LIMITS.MAX_MEMORY_RECORDS)
      .map((record) => ({
        id: record.id,
        kind: record.kind,
        content: record.content,
        scope: record.scope,
        project: record.project,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        source: record.source,
        confidence: record.confidence,
        enabled: record.enabled,
      })),
  };
}

/** Count records per kind (bounded, closed keys). */
export function countByKind(
  records: readonly MemoryRecord[],
): Record<MemoryKind, number> {
  const counts = {
    PREFERENCE: 0,
    USER_FACT: 0,
    WORK_STYLE: 0,
    PROJECT_CONTEXT: 0,
    EXPLICIT_INSTRUCTION: 0,
  } as Record<MemoryKind, number>;
  for (const record of records) counts[record.kind] += 1;
  return counts;
}
