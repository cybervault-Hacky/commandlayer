/**
 * Phase 6 — Persistent Personal Memory: the closed type vocabulary.
 *
 * Memory exists so CommandLayer can carry useful, user-approved context
 * ACROSS sessions. It is intentionally tiny and boring:
 *
 * - five fixed categories, no arbitrary kinds
 * - one source: the user explicitly asked for it (USER_EXPLICIT)
 * - one confidence level: HIGH (only user-confirmed memories are stored)
 * - two scopes: GLOBAL, or PROJECT when the user named the project
 *
 * Nothing here is inferred from browsing, page content, workflows, or AI
 * output. A record exists only after the user confirmed a preview.
 */
import type { AISavedMemory } from '@/ai/types';

export const MemoryKind = {
  Preference: 'PREFERENCE',
  UserFact: 'USER_FACT',
  WorkStyle: 'WORK_STYLE',
  ProjectContext: 'PROJECT_CONTEXT',
  ExplicitInstruction: 'EXPLICIT_INSTRUCTION',
} as const;

export type MemoryKind = (typeof MemoryKind)[keyof typeof MemoryKind];

/** Display order and the closed set (validated everywhere). */
export const MEMORY_KINDS: readonly MemoryKind[] = [
  MemoryKind.Preference,
  MemoryKind.UserFact,
  MemoryKind.WorkStyle,
  MemoryKind.ProjectContext,
  MemoryKind.ExplicitInstruction,
];

export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  [MemoryKind.Preference]: 'Preference',
  [MemoryKind.UserFact]: 'User fact',
  [MemoryKind.WorkStyle]: 'Work style',
  [MemoryKind.ProjectContext]: 'Project context',
  [MemoryKind.ExplicitInstruction]: 'Instruction',
};

/** Plural labels for the management UI filters. */
export const MEMORY_KIND_FILTER_LABELS: Record<MemoryKind, string> = {
  [MemoryKind.Preference]: 'Preferences',
  [MemoryKind.UserFact]: 'User facts',
  [MemoryKind.WorkStyle]: 'Work style',
  [MemoryKind.ProjectContext]: 'Project context',
  [MemoryKind.ExplicitInstruction]: 'Instructions',
};

export function isMemoryKind(value: unknown): value is MemoryKind {
  return (
    typeof value === 'string' &&
    (MEMORY_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Phase 6 stores user-explicit memories only. The single-value enum keeps
 * the boundary explicit in the type system (and in stored data): any
 * future automatic source needs a schema change and a security review.
 */
export const MemorySource = {
  UserExplicit: 'USER_EXPLICIT',
} as const;

export type MemorySource = (typeof MemorySource)[keyof typeof MemorySource];

export function isMemorySource(value: unknown): value is MemorySource {
  return value === MemorySource.UserExplicit;
}

/** Only user-confirmed memories are stored, so confidence is always HIGH. */
export const MemoryConfidence = {
  High: 'HIGH',
} as const;

export type MemoryConfidence =
  (typeof MemoryConfidence)[keyof typeof MemoryConfidence];

export function isMemoryConfidence(value: unknown): value is MemoryConfidence {
  return value === MemoryConfidence.High;
}

export const MemoryScope = {
  Global: 'GLOBAL',
  Project: 'PROJECT',
} as const;

export type MemoryScope = (typeof MemoryScope)[keyof typeof MemoryScope];

export function isMemoryScope(value: unknown): value is MemoryScope {
  return value === MemoryScope.Global || value === MemoryScope.Project;
}

/** The stored record. Minimal by design — no titles, tags, or history. */
export interface MemoryRecord {
  /** Unpredictable id (never derived from content). */
  id: string;
  kind: MemoryKind;
  content: string;
  scope: MemoryScope;
  /** Project label — present only for PROJECT scope. */
  project: string | null;
  createdAt: number;
  updatedAt: number;
  source: MemorySource;
  confidence: MemoryConfidence;
  enabled: boolean;
}

/** Validated input for a create/update. */
export interface MemoryInput {
  kind: MemoryKind;
  content: string;
  scope?: MemoryScope;
  project?: string | null;
}

/** The typed memory intents. No vague string matching elsewhere. */
export const MemoryIntent = {
  Remember: 'REMEMBER',
  Forget: 'FORGET',
  ListMemory: 'LIST_MEMORY',
  UpdateMemory: 'UPDATE_MEMORY',
} as const;

export type MemoryIntent = (typeof MemoryIntent)[keyof typeof MemoryIntent];

/** A deterministically parsed memory command (never produced by the AI). */
export interface ParsedMemoryCommand {
  intent: MemoryIntent;
  /** For REMEMBER / UPDATE_MEMORY: the phrase the user wants saved. */
  content: string;
  /** For FORGET / LIST_MEMORY / UPDATE_MEMORY: what to look for. */
  query: string;
  scope: MemoryScope;
  project: string | null;
  /** True when the phrasing contains an explicit change marker ("now"). */
  explicitChange: boolean;
  /**
   * True when the user used an explicit update phrase
   * ("update my memory about X to Y") — such a request needs an existing
   * memory to update, while a "remember …" phrasing may always create one.
   */
  explicitUpdate: boolean;
}

/** What a pending preview will do when confirmed. */
export const MemoryPreviewAction = {
  Create: 'CREATE',
  Update: 'UPDATE',
  Delete: 'DELETE',
} as const;

export type MemoryPreviewAction =
  (typeof MemoryPreviewAction)[keyof typeof MemoryPreviewAction];

/** The confirmation UI contract — identity + bounded, sanitized content. */
export interface MemoryPreviewView {
  previewId: string;
  action: MemoryPreviewAction;
  kind: MemoryKind | null;
  /** What will be stored (or deleted, for DELETE). */
  content: string;
  /** The memory being replaced/removed, when applicable. */
  previousContent: string | null;
  scope: MemoryScope;
  project: string | null;
  source: MemorySource;
  replacesExisting: boolean;
  targetId: string | null;
  createdAt: string;
  expiresAt: string;
}

export const MemoryResultAction = {
  Saved: 'SAVED',
  Updated: 'UPDATED',
  AlreadySaved: 'ALREADY_SAVED',
  Deleted: 'DELETED',
  Cleared: 'CLEARED',
  Listed: 'LISTED',
  NoMatch: 'NO_MATCH',
  Blocked: 'BLOCKED',
  Disabled: 'DISABLED',
} as const;

export type MemoryResultAction =
  (typeof MemoryResultAction)[keyof typeof MemoryResultAction];

/** A user-safe, bounded view of a stored memory (for management UIs). */
export interface MemoryRecordView {
  id: string;
  kind: MemoryKind;
  content: string;
  scope: MemoryScope;
  project: string | null;
  createdAt: string;
  updatedAt: string;
  enabled: boolean;
  /** Fixed audit sentence — no tracking language, no internals. */
  audit: string;
}

export const MEMORY_AUDIT_TEXT =
  'Saved because you explicitly asked CommandLayer to remember it.';

/** The terminal outcome of a memory operation. */
export interface MemoryResultView {
  action: MemoryResultAction;
  message: string;
  records: MemoryRecordView[];
  total: number;
}

/** Privacy/settings projection for the UI. */
export interface MemoryStatusView {
  /** Privacy switch (Settings → Memory). */
  enabled: boolean;
  count: number;
  total: number;
  byKind: Record<MemoryKind, number>;
  /** False when storage could not be read/written (graceful degradation). */
  storageAvailable: boolean;
}

/** What the UI sees for a memory that was used in one command. */
export interface MemoryUsedView {
  id: string;
  kind: MemoryKind;
  content: string;
}

/** Retrieval result for one query (bounded, deterministic). */
export interface MemoryRetrieval {
  /** At most MEMORY_LIMITS.MAX_RETRIEVED_MEMORIES, best matches first. */
  memories: MemoryUsedView[];
  /** Older memories hidden because a newer one supersedes them. */
  superseded: number;
  /** True when memory is switched off (nothing was retrieved). */
  disabled: boolean;
}

/** Convert a retrieval into the AI-facing shape (data, never instructions). */
export function toAISavedMemories(
  retrieval: MemoryRetrieval,
): AISavedMemory[] {
  return retrieval.memories.map((memory) => ({
    kind: memory.kind,
    content: memory.content,
  }));
}
