/**
 * Phase 7 — centralized developer-intelligence limits.
 *
 * Everything the developer layer produces is bounded: bounded file lists,
 * bounded search hits, bounded snippets, bounded findings, bounded plans.
 * Nothing here grows with repository size, and every cap is reported rather
 * than hidden.
 */
export const DEVELOPER_LIMITS = {
  /** Command text that may be interpreted as a developer request. */
  MAX_COMMAND_LENGTH: 400,
  /** Normalized target phrase (symbol, path fragment, query). */
  MAX_QUERY_LENGTH: 120,
  MIN_QUERY_LENGTH: 2,

  /** Repository understanding. */
  MAX_FILES_LISTED: 40,
  MAX_CONFIG_FILES: 12,
  MAX_FRAMEWORK_HINTS: 5,
  MAX_README_EXCERPT: 1_200,

  /** Bounded local search. */
  MAX_SEARCH_HITS: 20,
  MAX_SEARCH_SNIPPET: 160,
  SNIPPET_RADIUS: 60,
  MAX_SEARCH_FILES: 40,
  SEARCH_TIMEOUT_MS: 1_000,

  /** Bounded code slice handed to the model for one file. */
  MAX_CODE_LINES: 120,

  /** Change sets. */
  MAX_CHANGED_FILES: 30,
  MAX_DIFF_LINES: 120,
  MAX_SENSITIVE_FILES: 12,
  LARGE_CHANGE_LINES: 400,
  LARGE_FILE_CHANGE_LINES: 250,

  /** Issue understanding. */
  MAX_ISSUE_REQUIREMENTS: 8,
  MAX_ISSUE_ACCEPTANCE: 8,
  MAX_RELATED_FILES: 10,

  /** Results. */
  MAX_OBSERVATIONS: 8,
  MAX_FINDINGS: 12,
  MAX_AFFECTED_FILES: 20,
  MAX_NOTES: 5,
  MAX_REASONABLE_FILE_CHARS: 200,

  /** Change plans. */
  MAX_PLAN_STEPS: 8,
  MAX_PLAN_STEP_FILES: 6,
  /** Navigation proposals the Action Engine may be asked to run. */
  MAX_PLAN_NAVIGATION: 4,
} as const;
