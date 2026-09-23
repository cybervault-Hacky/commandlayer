/**
 * Phase 3 — AI context / response budgets.
 *
 * These are TIGHTER than the Phase 2 PAGE_LIMITS on purpose: the page
 * engine may store a fuller PageContext for the UI, but the context
 * builder trims to these smaller budgets before anything reaches the
 * AI (lower tokens, lower latency, less exposure).
 */
export const AI_LIMITS = {
  /** Max user prompt length (mirrors Phase 1 input validation). */
  MAX_PROMPT: 2000,

  // Context budgets
  MAX_CONTEXT_HEADINGS: 25,
  MAX_CONTEXT_TEXT_CHARS: 12000,
  MAX_CONTEXT_LINKS: 20,
  MAX_CONTEXT_TABLES: 4,
  MAX_CONTEXT_TABLE_ROWS: 15,
  MAX_CONTEXT_SELECTED: 1000,

  /**
   * Phase 7 — developer intelligence (hard bounds). The developer context is
   * excerpt-only: bounded file lists, bounded code/diff lines, bounded
   * findings. Nothing here can grow with repository size.
   */
  MAX_DEVELOPER_FILES: 40,
  MAX_DEVELOPER_CHANGED_FILES: 30,
  MAX_DEVELOPER_CODE_LINES: 120,
  MAX_DEVELOPER_DIFF_LINES: 120,
  MAX_DEVELOPER_LINE_CHARS: 200,
  MAX_DEVELOPER_OBSERVATIONS: 8,
  MAX_DEVELOPER_OBSERVATION_CHARS: 200,

  /** Structured findings / change plans in one validated response. */
  MAX_FINDINGS: 12,
  MAX_FINDING_TEXT: 400,
  MAX_CHANGE_PLAN_STEPS: 8,
  MAX_CHANGE_PLAN_TITLE: 140,
  MAX_CHANGE_PLAN_DETAIL: 400,
  MAX_CHANGE_PLAN_FILES: 10,

  // Phase 6 — saved memory attached to one request (hard bounds)
  MAX_REQUEST_MEMORIES: 4,
  MAX_MEMORY_CHARS: 240,

  // Serialized payload budget (hard cap before the request leaves the client)
  MAX_SERIALIZE_CHARS: 60000,

  // Response budgets (enforced by the validator; the system prompt asks
  // the model for the same limits)
  MAX_ANSWER_CHARS: 20000,
  MAX_SECTIONS: 6,
  MAX_SECTION_TITLE: 120,
  MAX_SECTION_CONTENT: 20000,
  MAX_SOURCES: 6,
  MAX_SOURCE_TITLE: 160,

  // Lifecycle
  DEFAULT_TIMEOUT_MS: 30000,
  MIN_TIMEOUT_MS: 1000,
  MAX_TIMEOUT_MS: 120000,

  // Safe Markdown renderer
  MAX_MARKDOWN_NODES: 400,
} as const;
