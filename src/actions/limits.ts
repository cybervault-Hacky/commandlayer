/**
 * Phase 4 — hard, centralized action limits.
 *
 * Every number here is a safety bound, not a tuning knob: the engine
 * stops rather than exceeding any of them. There are no retries, no
 * autonomous replans, and no unbounded loops in Phase 4.
 */
export const ACTION_LIMITS = {
  /** Maximum steps in a single plan. */
  MAX_ACTIONS_PER_PLAN: 5,

  /** Maximum characters for any user-provided value in a payload. */
  MAX_TEXT_LENGTH: 500,
  /** Maximum characters for target text / role names / option labels. */
  MAX_TARGET_TEXT: 200,
  /** Maximum length of a FIND_TEXT query. */
  MAX_FIND_QUERY: 200,

  /** Scroll bounds: per action, per plan, and per-axis operation count. */
  MAX_SCROLL_DISTANCE_PX: 5000,
  MAX_SCROLL_TOTAL_PX: 15000,
  MAX_SCROLL_OPERATIONS_PER_PLAN: 3,

  /** FIND_TEXT caps. */
  MAX_FIND_MATCHES: 25,
  FIND_SNIPPET_LENGTH: 120,
  /** Text nodes scanned before giving up (bounded DOM work). */
  FIND_MAX_NODES_SCANNED: 4000,

  /** Target resolution caps (bounded DOM work per lookup). */
  TARGET_MAX_CANDIDATES_SCANNED: 2000,

  /**
   * Approvals are single-use and time-boxed. There is no persistent
   * ALLOW_ALL_ACTIONS permission — ever.
   */
  PLAN_TTL_MS: 120000,

  /** Per-step execution budget on the content side. */
  STEP_TIMEOUT_MS: 5000,

  /** Autonomous replans after a failure: none. The user decides. */
  MAX_REPLANS: 0,

  /** Session-store hygiene: pending plans are swept after expiry. */
  MAX_PENDING_PLANS: 25,

  /** READ_PAGE: bounded preview content. */
  READ_PAGE_MAX_HEADINGS: 5,
} as const;
