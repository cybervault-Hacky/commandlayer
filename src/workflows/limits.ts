/**
 * Phase 5 — centralized workflow limits.
 *
 * Every bound the workflow engine obeys lives here, with conservative
 * defaults. There is deliberately NO runtime override and no settings
 * switch: an unbounded workflow, an unbounded loop, or an unbounded
 * observation budget can never be configured into existence.
 */
import type { PageSection } from '@/shared/types/page';

/** How many sections a bounded observation captures (minimum necessary). */
const OBSERVATION_SECTIONS: readonly PageSection[] = [
  'metadata',
  'headings',
  'text',
];

/**
 * A replan needs link data to resolve the revised target, but still only
 * ever captures this bounded set — never the whole page.
 */
const REPLAN_SECTIONS: readonly PageSection[] = [
  'metadata',
  'headings',
  'text',
  'links',
];

export const WORKFLOW_LIMITS = {
  /**
   * Maximum steps in one workflow. Deliberately small: a workflow is a
   * short, reviewable task, not an agent plan.
   */
  MAX_WORKFLOW_STEPS: 4,
  /** Exactly one Phase 4 action per step (never a hidden batch). */
  MAX_ACTIONS_PER_STEP: 1,
  /** Hard wall-clock budget for one run, measured from START. */
  MAX_WORKFLOW_DURATION_MS: 120_000,
  /** At most one retry per step, and only when the registry allows it. */
  MAX_STEP_RETRIES: 1,
  /** At most one bounded replan per workflow run. */
  MAX_WORKFLOW_REPLANS: 1,
  /** Bounded context observations per run (checkpoints only). */
  MAX_CONTEXT_REFRESHES: 8,
  /** One step can never hang the run. */
  MAX_STEP_TIMEOUT_MS: 8_000,
  /** Alias used by the engine for a single step's timeout. */
  STEP_TIMEOUT_MS: 8_000,
  /** An approval is single-use and expires with the workflow. */
  APPROVAL_TTL_MS: 120_000,
  /** Session-scoped workflows expire; nothing is kept forever. */
  WORKFLOW_TTL_MS: 300_000,
  /** At most this many proposals may await approval at once. */
  MAX_PENDING_WORKFLOWS: 5,
  /** At most this many workflow records exist in the session at once. */
  MAX_ACTIVE_WORKFLOWS: 8,
  /** Exactly one workflow may drive a tab at a time. */
  MAX_RUNNING_PER_TAB: 1,
  /** Store cap: oldest terminal records are evicted beyond this. */
  MAX_RECORDS: 25,
  /** Bounded goal text. */
  MAX_GOAL_LENGTH: 300,
  /** Bounded user-facing step labels. */
  MAX_STEP_LABEL: 96,
  /** Bounded outcome descriptions. */
  MAX_OUTCOME_DESCRIPTION: 200,
  /** The transcript is a bounded ring, not a log. */
  MAX_EVENTS: 40,
  /** Headings kept from one observation. */
  OBSERVATION_MAX_HEADINGS: 8,
  OBSERVATION_SECTIONS,
  REPLAN_SECTIONS,
} as const;
