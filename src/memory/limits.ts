/**
 * Phase 6 — centralized memory limits.
 *
 * Memory is a bounded resource: a bounded number of records, of a bounded
 * length each, retrieved in bounded quantity. Nothing in Phase 6 is
 * unlimited, and these constants are the only place the bounds live.
 */
export const MEMORY_LIMITS = {
  /** Hard cap on stored records (enforced on every write). */
  MAX_MEMORY_RECORDS: 50,
  /** A memory is a sentence, not a document. */
  MAX_MEMORY_CONTENT_LENGTH: 240,
  /** Anything shorter than this is not a useful memory. */
  MIN_MEMORY_CONTENT_LENGTH: 3,
  /** Project labels in PROJECT scope. */
  MAX_MEMORY_PROJECT_LENGTH: 40,
  /** Longest text that may be treated as a memory command. */
  MAX_MEMORY_COMMAND_LENGTH: 400,
  /** Memories handed to one reasoning request (never the whole store). */
  MAX_RETRIEVED_MEMORIES: 4,
  /** Bounded search results in the management UI. */
  MAX_SEARCH_RESULTS: 25,
  /** Pending (unconfirmed) previews held in worker memory. */
  MAX_PENDING_PREVIEWS: 5,
  /** A confirmation must arrive while the preview is still relevant. */
  PREVIEW_TTL_MS: 120_000,
  /** Token-overlap threshold for "this looks like the same memory". */
  SIMILARITY_THRESHOLD: 0.5,
  /** Memory ids are random hex of this length. */
  ID_LENGTH: 24,
} as const;
