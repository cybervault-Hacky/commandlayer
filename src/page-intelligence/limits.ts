/**
 * Centralized extraction limits. A malicious or enormous page must never
 * produce an unbounded message payload: every extractor enforces these caps
 * and reports `truncated: true` when content was cut.
 */
export const PAGE_LIMITS = {
  /** Total characters of extracted main text across all paragraphs. */
  MAX_TEXT_CHARACTERS: 20_000,
  MAX_PARAGRAPHS: 60,
  /** Per-paragraph cap. */
  MAX_PARAGRAPH_LENGTH: 600,

  MAX_HEADINGS: 40,
  MAX_HEADING_LENGTH: 160,

  MAX_LINKS: 80,
  MAX_LINK_TEXT_LENGTH: 120,

  MAX_TABLES: 6,
  MAX_TABLE_ROWS: 30,
  MAX_TABLE_COLUMNS: 12,
  MAX_CELL_LENGTH: 200,

  MAX_SELECTED_TEXT: 2_000,

  MAX_FORMS: 8,
  MAX_FORM_FIELDS: 30,
  MAX_FIELD_NAME_LENGTH: 64,
  MAX_FIELD_LABEL_LENGTH: 80,

  MAX_TITLE: 120,
  MAX_DESCRIPTION: 300,
  MAX_LANGUAGE: 35,
  MAX_URL: 2_048,
  MAX_HOSTNAME: 253,

  /** Upper sanity bounds used when validating untrusted extractor output. */
  VALIDATOR_MAX_HEADING_TEXT: 160,
  VALIDATOR_MAX_URL: 2_048,
} as const;
