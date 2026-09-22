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
