/**
 * Phase 6 — Persistent Personal Memory (public surface).
 *
 *   "Remember that I prefer TypeScript."
 *        ↓ parse (explicit phrasing only)
 *   typed memory intent → policy → preview → USER CONFIRMS → stored
 *        ↓ later
 *   relevance-gated retrieval → bounded saved context → AI / UI
 *
 * Invariants (enforced by tests):
 * - only the repository writes; only the controller confirms;
 * - the AI can never create, change, or delete a memory;
 * - memory can never grant an action permission, change risk, or bypass
 *   an approval;
 * - page content and workflow results never become memory on their own;
 * - sensitive material is refused, always.
 */
export * from './types';
export * from './limits';
export * from './errors';
export {
  containsSensitiveMemoryContent,
  cleanProjectLabel,
  evaluateMemoryContent,
  evaluateMemoryInput,
  isAcceptableStoredContent,
  type MemoryPolicyCode,
  type MemoryPolicyResult,
} from './policy';
export {
  MEMORY_SCHEMA_VERSION,
  countByKind,
  parseMemoryRecord,
  parseStoredMemoryState,
  toStoredMemoryState,
  type ParsedMemoryState,
  type StoredMemoryState,
} from './schema';
export {
  MEMORY_STORAGE_KEY,
  loadMemoryRecords,
  saveMemoryRecords,
} from './storage';
export {
  findRelation,
  mentionsProject,
  resolveConflicts,
  retrieveRelevant,
  sameAttribute,
  searchRecords,
  similarity,
  type MemoryRelation,
} from './matcher';
export {
  MemoryRepository,
  memoryRepository,
  type MemoryFailureCode,
  type MemoryRepositoryOptions,
  type MemoryWriteOutcome,
} from './repository';
export {
  isMemoryCommand,
  kindFilterFromQuery,
  parseMemoryCommand,
  type ParsedMemoryKindFilter,
} from './parser';
export {
  MemoryController,
  inferMemoryKind,
  memoryController,
  toRecordView,
  type MemoryCommandOutcome,
  type MemoryControllerOptions,
  type MemoryEnabledCheck,
} from './controller';
