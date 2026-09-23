/**
 * Phase 7 — centralized GitHub capture limits.
 *
 * GitHub pages are large: a pull request page can render thousands of diff
 * rows, an issue page hundreds of comments. Everything captured here is
 * capped, and every cap sets `truncated: true` so the UI can be honest
 * about what it did and did not read.
 */
export const GITHUB_LIMITS = {
  /** Identity. */
  MAX_OWNER_LENGTH: 39,
  MAX_REPOSITORY_LENGTH: 100,
  MAX_REF_LENGTH: 255,
  MAX_PATH_LENGTH: 400,
  MAX_PATH_SEGMENTS: 20,
  MAX_COMMIT_SHA_LENGTH: 40,
  MAX_SEARCH_QUERY_LENGTH: 200,
  MAX_TITLE_LENGTH: 200,
  MAX_DESCRIPTION_LENGTH: 600,
  MAX_LANGUAGE_LENGTH: 35,
  MAX_TAG_LENGTH: 100,

  /** Lists. */
  MAX_FILES: 60,
  MAX_CHANGED_FILES: 50,
  MAX_CHANGED_FILE_COUNT: 3000,

  /** Code + diff excerpts (the only "bodies" ever captured). */
  MAX_CODE_LINES: 120,
  MAX_CODE_LINE_LENGTH: 200,
  MAX_CODE_CHARACTERS: 12_000,
  MAX_DIFF_LINES: 150,
  MAX_DIFF_LINE_LENGTH: 200,
  MAX_DIFF_CHARACTERS: 8_000,

  /** README excerpt on repository pages. */
  MAX_README_CHARACTERS: 2_000,

  /** DOM work bounds (never an unbounded traversal). */
  MAX_NODES_VISITED: 4_000,
  MAX_CANDIDATES_SCANNED: 400,

  /** Developer context handed to one AI request. */
  MAX_DEVELOPER_FILES: 40,
  MAX_DEVELOPER_CHANGED_FILES: 30,
  MAX_DEVELOPER_CODE_LINES: 120,
  MAX_DEVELOPER_DIFF_LINES: 120,
  MAX_DEVELOPER_SEARCH_RESULTS: 20,

  /** Code search (bounded, local, never a repository download). */
  SEARCH_MAX_QUERY_LENGTH: 120,
  SEARCH_MAX_FILES: 40,
  SEARCH_MAX_RESULTS: 20,
  SEARCH_MAX_SNIPPETS_PER_FILE: 2,
  SEARCH_SNIPPET_RADIUS: 60,
  SEARCH_TIMEOUT_MS: 1_500,

  /** Structure validation of untrusted payloads. */
  VALIDATOR_MAX_ARRAY_ITEMS: 80,
} as const;
