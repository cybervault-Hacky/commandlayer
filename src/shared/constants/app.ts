/**
 * Product-level constants. `APP_VERSION` must stay in sync with
 * public/manifest.json — tests enforce this.
 */
export const APP_NAME = 'CommandLayer';
export const APP_VERSION = '0.2.0';
export const PHASE_LABEL = 'Phase 3 AI Reasoning';
export const TAGLINE = 'Think once. Execute everywhere.';

/** Maximum length of a stored page title (display truncation). */
export const PAGE_CONTEXT_TITLE_MAX = 120;
/** Maximum URL length we are willing to parse. */
export const PAGE_CONTEXT_URL_MAX = 2048;
/** Maximum length of a single command. */
export const COMMAND_TEXT_MAX = 2000;
/** How many entries the Command Center keeps in its session log. */
export const COMMAND_LOG_LIMIT = 12;
