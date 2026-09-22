/**
 * Phase 5 — bounded multi-step workflows: core contracts.
 *
 * A workflow is a small, ordered list of pre-validated Phase 4 action
 * plans. It is created only by the deterministic planner, stored only in
 * the background session, and executed only after an approval bound to
 * the exact `workflowHash`. Nothing here is AI-authored and nothing here
 * can execute code: steps wrap the Phase 4 `ActionPlan` contract, which
 * remains the single execution security boundary.
 */
import type {
  ActionKind,
  ActionPlan,
  ActionRisk,
  ActionRetryPolicy,
  ActionStepResult,
  FindTextData,
  ReadPageData,
} from '@/actions/types';

/* ----------------------------- statuses ---------------------------- */

export const WorkflowStatus = {
  /** Under construction; never shown to the user. */
  Draft: 'DRAFT',
  /** Validated and previewable; not yet awaiting an approval. */
  Preview: 'PREVIEW',
  AwaitingApproval: 'AWAITING_APPROVAL',
  /** Approved against a specific hash; not yet running. */
  Approved: 'APPROVED',
  Running: 'RUNNING',
  Paused: 'PAUSED',
  /** All steps done; the declared outcome is being verified. */
  Verifying: 'VERIFYING',
  /** Every step ran AND the declared outcome was verified. */
  Completed: 'COMPLETED',
  /** Every step ran, but the outcome could not be verified. */
  Partial: 'PARTIAL',
  Failed: 'FAILED',
  Blocked: 'BLOCKED',
  Cancelled: 'CANCELLED',
  Stale: 'STALE',
  Expired: 'EXPIRED',
} as const;

export type WorkflowStatus = (typeof WorkflowStatus)[keyof typeof WorkflowStatus];

/** Statuses from which no further transition exists. */
export const TERMINAL_WORKFLOW_STATUSES: readonly WorkflowStatus[] = [
  WorkflowStatus.Completed,
  WorkflowStatus.Partial,
  WorkflowStatus.Failed,
  WorkflowStatus.Blocked,
  WorkflowStatus.Cancelled,
  WorkflowStatus.Stale,
  WorkflowStatus.Expired,
];

export function isTerminalWorkflowStatus(status: WorkflowStatus): boolean {
  return TERMINAL_WORKFLOW_STATUSES.includes(status);
}

export const WorkflowStepStatus = {
  Pending: 'PENDING',
  Running: 'RUNNING',
  Completed: 'COMPLETED',
  Failed: 'FAILED',
  Blocked: 'BLOCKED',
  /** Carried over from a failed run into a bounded replan. */
  Skipped: 'SKIPPED',
} as const;

export type WorkflowStepStatus =
  (typeof WorkflowStepStatus)[keyof typeof WorkflowStepStatus];

/* ------------------------------ intents ---------------------------- */

/**
 * The workflow-level vocabulary of a step. It is deliberately coarser
 * than the action kinds (an "OPEN" step is a CLICK_ELEMENT on a link) so
 * the preview reads like a task, while the executable content stays a
 * registered Phase 4 action.
 */
export const WorkflowIntent = {
  Identify: 'IDENTIFY',
  Find: 'FIND',
  Read: 'READ',
  Open: 'OPEN',
  Type: 'TYPE',
  Select: 'SELECT',
  Scroll: 'SCROLL',
} as const;

export type WorkflowIntent = (typeof WorkflowIntent)[keyof typeof WorkflowIntent];

/** Deterministic intent for a concrete action (never AI-supplied). */
export function workflowIntentForAction(action: {
  type: ActionKind;
}): WorkflowIntent {
  switch (action.type) {
    case 'READ_PAGE':
      return WorkflowIntent.Read;
    case 'FIND_TEXT':
      return WorkflowIntent.Find;
    case 'CLICK_ELEMENT':
      return WorkflowIntent.Open;
    case 'TYPE_TEXT':
      return WorkflowIntent.Type;
    case 'SELECT_OPTION':
      return WorkflowIntent.Select;
    case 'SCROLL':
      return WorkflowIntent.Scroll;
  }
}

/* ----------------------------- outcome ----------------------------- */

export const WorkflowOutcomeKind = {
  /** The goal is fulfilled when the page navigates to an expected URL. */
  Navigation: 'NAVIGATION',
  /** The goal is fulfilled when text is found / content is confirmed. */
  Content: 'CONTENT',
  /** The goal is a read-only inspection. */
  ReadOnly: 'READ_ONLY',
  /** The goal is fulfilled by a bounded interaction sequence. */
  Interaction: 'INTERACTION',
} as const;

export type WorkflowOutcomeKind =
  (typeof WorkflowOutcomeKind)[keyof typeof WorkflowOutcomeKind];

/** Declared BEFORE approval: what "done" means for this goal. */
export interface WorkflowOutcomeSpec {
  kind: WorkflowOutcomeKind;
  /** One-line, user-safe description shown in the preview. */
  description: string;
  /** Expected destination, when the outcome is a navigation. */
  expectedUrl?: string;
  /** Text whose presence proves a content outcome. */
  expectedText?: string;
}

/** The final verified (or unverified) outcome of a run. */
export interface WorkflowOutcome {
  kind: WorkflowOutcomeKind;
  description: string;
  /** True ONLY when the declared outcome was independently observed. */
  verified: boolean;
  /** User-safe explanation of what was (or was not) verified. */
  detail: string;
}

/* ------------------------------ steps ------------------------------ */

export interface WorkflowStep {
  stepId: string;
  /** 0-based position; the workflow executes steps in this order, once. */
  index: number;
  /** Deterministic, user-facing label ("Find text …"). */
  label: string;
  /** The workflow-level purpose of this step (closed vocabulary). */
  intent: WorkflowIntent;
  /** The pre-validated Phase 4 plan for exactly this step. */
  actionPlan: ActionPlan;
  /** Canonical hash of the step's executable content (tamper binding). */
  actionsHash: string;
  /**
   * Retry characteristic, copied from the registry at plan time. The
   * engine may never retry a step the registry marked NEVER.
   */
  retryPolicy: ActionRetryPolicy;
  /** True when this step is EXPECTED to navigate the current tab. */
  expectsNavigation: boolean;
  /** Approved destination when navigation is expected. */
  expectedUrl?: string;
  status: WorkflowStepStatus;
  attempts: number;
  /**
   * True when the step can change page state (so a fresh observation is
   * required afterwards). Read-only steps are never re-observed.
   */
  mutated: boolean;
  result?: ActionStepResult;
  /** Short user-safe line for the progress UI. */
  message?: string;
  /** User-safe detail of the last verification. */
  detail?: string;
  startedAt?: string;
  finishedAt?: string;
  /** Page identity observed after a mutating step (not part of the hash). */
  observedUrl?: string;
  observedHash?: string;
}

/* ---------------------------- workflows ---------------------------- */

export interface Workflow {
  workflowId: string;
  /** The command that produced this workflow. */
  requestId: string;
  /** The user's own goal, normalized and bounded. */
  goal: string;
  status: WorkflowStatus;
  steps: WorkflowStep[];
  /** Index of the next step to run (0-based). */
  currentStepIndex: number;
  /** Hard cap the plan was validated against (never a runtime setting). */
  maxSteps: number;
  /** Highest risk among the steps — propagated, never downgraded. */
  risk: ActionRisk;
  /** Always true: a workflow is never pre-authorized. */
  requiresConfirmation: boolean;
  /** Declared before approval, verified after the last step. */
  expectedOutcome: WorkflowOutcomeSpec;
  /** Page identity the workflow was planned against. */
  tabId: number;
  url: string;
  contentHash: string;
  /** Deterministic identity of goal + steps + page binding (approval). */
  workflowHash: string;
  createdAt: string;
  approvedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  outcome?: WorkflowOutcome;
  /** User-safe one-line summary of the latest terminal state. */
  summary?: string;
  /** Bounded replan counter (never exceeds MAX_WORKFLOW_REPLANS). */
  revision: number;
  /** Approval expiry: stale approvals can never be replayed. */
  expiresAt: string;
  /** A stored follow-up proposal created by a bounded replan. */
  followUpWorkflowId?: string;
}

/* ---------------------------- proposals ---------------------------- */

/**
 * One untrusted step candidate (e.g. from an AI proposal). `action` is
 * `unknown` on purpose: nothing is trusted until the Phase 4 validator
 * has parsed it into a registered action.
 */
export interface ProposedStep {
  action: unknown;
  label?: string;
}

/** An untrusted workflow proposal: a goal and an ordered step list. */
export interface WorkflowProposal {
  goal: string;
  steps: ProposedStep[];
}

/* ----------------------------- events ------------------------------ */

export const WorkflowEventType = {
  Created: 'WORKFLOW_CREATED',
  Validated: 'WORKFLOW_VALIDATED',
  Previewed: 'WORKFLOW_PREVIEWED',
  Approved: 'WORKFLOW_APPROVED',
  Started: 'WORKFLOW_STARTED',
  StepStarted: 'STEP_STARTED',
  StepCompleted: 'STEP_COMPLETED',
  StepFailed: 'STEP_FAILED',
  StepRetried: 'STEP_RETRIED',
  Observation: 'WORKFLOW_OBSERVATION',
  Paused: 'WORKFLOW_PAUSED',
  Resumed: 'WORKFLOW_RESUMED',
  ReplanProposed: 'WORKFLOW_REPLAN_PROPOSED',
  Blocked: 'WORKFLOW_BLOCKED',
  Completed: 'WORKFLOW_COMPLETED',
  Failed: 'WORKFLOW_FAILED',
  Cancelled: 'WORKFLOW_CANCELLED',
  Stale: 'WORKFLOW_STALE',
  Expired: 'WORKFLOW_EXPIRED',
} as const;

export type WorkflowEventType =
  (typeof WorkflowEventType)[keyof typeof WorkflowEventType];

/** One bounded entry of the workflow transcript (never page content). */
export interface WorkflowEventRecord {
  type: WorkflowEventType;
  at: string;
  stepIndex?: number;
  /** Short, user-safe line ("Step 2 of 3 started"). */
  message: string;
}

/* ------------------------------ views ------------------------------ */

export interface WorkflowStepView {
  stepId: string;
  index: number;
  intent: WorkflowIntent;
  /**
   * The registered Phase 4 action kind this step wraps. Present for every
   * planned step; used by the UI for deterministic iconography only.
   */
  kind?: ActionKind;
  label: string;
  status: WorkflowStepStatus;
  attempts: number;
  risk?: ActionRisk;
  retryPolicy?: ActionRetryPolicy;
  /** Pre-generated Phase 4 preview lines (safe, deterministic wording). */
  previews?: string[];
  message?: string;
  detail?: string;
  /** Read-only structured data (FIND_TEXT matches, READ_PAGE stats). */
  data?: FindTextData | ReadPageData;
  /** Per-step verification outcome, when one ran. */
  verified?: boolean;
  startedAt?: string;
  finishedAt?: string;
  observedUrl?: string;
}

export interface WorkflowEventView {
  type: WorkflowEventType;
  at: string;
  stepIndex?: number;
  message: string;
}

/** The UI-safe projection of a workflow: no plans, no page content. */
export interface WorkflowView {
  workflowId: string;
  /**
   * The exact identity the user approves. The UI displays the workflow
   * and echoes THIS hash back; a material change produces a new hash and
   * invalidates any prior approval.
   */
  workflowHash: string;
  goal: string;
  status: WorkflowStatus;
  risk: ActionRisk;
  requiresConfirmation: boolean;
  currentStepIndex: number;
  steps: WorkflowStepView[];
  /** Hard step cap the workflow was validated against. */
  maxSteps: number;
  expectedOutcome: string;
  outcomeKind?: WorkflowOutcomeKind;
  progress: { completed: number; total: number };
  createdAt: string;
  expiresAt: string;
  revision: number;
  /** True once the workflow was approved against a hash. */
  approved: boolean;
  /** True only in AWAITING_APPROVAL (and before the approval TTL). */
  canApprove: boolean;
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
  /** Bounded transcript — step lifecycle only, never hidden reasoning. */
  events: WorkflowEventView[];
  outcome?: WorkflowOutcome;
  summary?: string;
  /** A stored follow-up proposal; a new approval is required to run it. */
  followUpWorkflowId?: string;
}

/** The terminal (or paused) outcome of one execution attempt. */
export interface WorkflowRunResult {
  workflowId: string;
  workflowHash: string;
  status: WorkflowStatus;
  steps: WorkflowStepView[];
  outcome?: WorkflowOutcome;
  summary: string;
  startedAt: string;
  finishedAt: string;
  /** 0-based index of the step that stopped the run, when not completed. */
  stoppedAt?: number;
  /** A bounded follow-up proposal: a NEW approval is required to run it. */
  followUp?: WorkflowView;
}

/** Everything one command/event reply needs (nothing more). */
export interface WorkflowSnapshot {
  workflow: WorkflowView;
  run?: WorkflowRunResult;
}

export type { ActionKind, ActionPlan, ActionRisk, ActionRetryPolicy };
