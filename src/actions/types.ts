/**
 * Phase 4 — Safe Action Engine: core contracts.
 *
 * SECURITY MODEL (invariants enforced throughout this module):
 * - The AI never executes anything. Actions are proposed by a
 *   deterministic planner, validated against a strict typed allowlist,
 *   previewed, explicitly approved, then executed one step at a time.
 * - No executable code, arbitrary selectors, or browser-API access can
 *   enter the pipeline: every payload is a closed, typed shape.
 * - The approved plan is bound to the executed plan by a deterministic
 *   plan hash; any change requires a new approval.
 */

/** The closed allowlist of executable action kinds. Nothing else runs. */
export const ActionKind = {
  ReadPage: 'READ_PAGE',
  Scroll: 'SCROLL',
  FindText: 'FIND_TEXT',
  ClickElement: 'CLICK_ELEMENT',
  TypeText: 'TYPE_TEXT',
  SelectOption: 'SELECT_OPTION',
} as const;

export type ActionKind = (typeof ActionKind)[keyof typeof ActionKind];

export function isActionKind(value: unknown): value is ActionKind {
  return (
    typeof value === 'string' &&
    Object.values(ActionKind).includes(value as ActionKind)
  );
}

/**
 * Deterministic risk classification. The registry owns this mapping —
 * no AI output can influence a risk level.
 */
export const ActionRisk = {
  ReadOnly: 'READ_ONLY',
  Low: 'LOW_RISK',
  Confirmation: 'CONFIRMATION_REQUIRED',
} as const;

export type ActionRisk = (typeof ActionRisk)[keyof typeof ActionRisk];

/**
 * Safe element targeting. There is deliberately NO raw CSS/XPath
 * selector kind: the planner and the AI can only describe elements by
 * visible text, accessible role+name, or a strict stable id.
 */
export type ElementTarget =
  | { kind: 'text'; text: string; occurrence?: number }
  | { kind: 'role'; role: string; name: string; occurrence?: number }
  | { kind: 'stable-id'; id: string };

export interface ReadPageAction {
  type: typeof ActionKind.ReadPage;
}

export type ScrollDirection = 'up' | 'down' | 'top' | 'bottom';

export interface ScrollAction {
  type: typeof ActionKind.Scroll;
  direction: ScrollDirection;
  /** Pixels for up/down (clamped to ACTION_LIMITS). Ignored for top/bottom. */
  distancePx?: number;
}

export interface FindTextAction {
  type: typeof ActionKind.FindText;
  query: string;
  caseSensitive?: boolean;
}

export interface ClickElementAction {
  type: typeof ActionKind.ClickElement;
  target: ElementTarget;
}

export interface TypeTextAction {
  type: typeof ActionKind.TypeText;
  target: ElementTarget;
  text: string;
}

export interface SelectOptionAction {
  type: typeof ActionKind.SelectOption;
  target: ElementTarget;
  /** The option's visible label (never a bare index). */
  option: string;
}

/** The closed union of executable actions. */
export type Action =
  | ReadPageAction
  | ScrollAction
  | FindTextAction
  | ClickElementAction
  | TypeTextAction
  | SelectOptionAction;

/**
 * Retry characteristic of an action kind. Owned by the registry — never
 * by AI output, never by a request, and never configurable at runtime.
 *
 * - NEVER: repeating the action could duplicate a side effect (clicks,
 *   typing, relative scrolls).
 * - SAFE: the action is a pure read; repeating it changes nothing.
 * - VERIFY_FIRST: the action may be repeated at most once, and only after
 *   the step's verification condition was evaluated and found unmet.
 */
export const ActionRetryPolicy = {
  Never: 'NEVER',
  Safe: 'SAFE',
  VerifyFirst: 'VERIFY_FIRST',
} as const;

export type ActionRetryPolicy =
  (typeof ActionRetryPolicy)[keyof typeof ActionRetryPolicy];

/** One step of a plan: a validated action with a stable identity. */
export interface PlannedAction {
  stepId: string;
  action: Action;
  /** Human-readable preview line, generated once at plan creation. */
  preview: string;
}

/**
 * A structured action plan. Created ONLY by the background planner,
 * stored ONLY in the background session, and executed ONLY after an
 * explicit approval bound to `planHash`.
 */
export interface ActionPlan {
  planId: string;
  /** The command that produced this plan. */
  requestId: string;
  /** Active tab + URL + content hash at planning time (freshness). */
  tabId: number;
  url: string;
  contentHash: string;
  actions: PlannedAction[];
  /** Highest risk among the steps. */
  risk: ActionRisk;
  requiresConfirmation: boolean;
  /** Deterministic identity of exactly this plan (tamper binding). */
  planHash: string;
  createdAt: string;
  /** Expiry: approvals are single-use and time-boxed. */
  expiresAt: string;
}

/** Per-step verification outcome (never carries sensitive values). */
export interface StepVerification {
  ok: boolean;
  /** User-safe detail, e.g. 'Selected option matches request'. */
  detail: string;
}

export type StepStatus =
  | 'success'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'stale'
  | 'skipped';

/** Structured result of one executed step. */
export interface ActionStepResult {
  actionId: string;
  kind: ActionKind;
  status: StepStatus;
  /** User-safe summary (no typed values, no secrets). */
  message: string;
  verification?: StepVerification;
  /** Read-only structured data (FIND_TEXT matches, READ_PAGE stats). */
  data?: FindTextData | ReadPageData;
  durationMs: number;
}

export interface FindTextMatch {
  /** 1-based occurrence index on the page. */
  index: number;
  /** Bounded context snippet around the match. */
  snippet: string;
}

export interface FindTextData {
  kind: typeof ActionKind.FindText;
  matchCount: number;
  matches: FindTextMatch[];
}

export interface ReadPageData {
  kind: typeof ActionKind.ReadPage;
  title: string;
  url: string;
  stats: string;
  topHeadings: string[];
}

export type ActionExecutionStatus =
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'stale';

/** The terminal outcome of executing an approved plan. */
export interface ActionExecutionResult {
  planId: string;
  planHash: string;
  status: ActionExecutionStatus;
  steps: ActionStepResult[];
  /** Index of the step that stopped the run, when not completed. */
  stoppedAt?: number;
  /** User-safe summary line. */
  summary: string;
  startedAt: string;
  finishedAt: string;
}

/**
 * Explicit action state machine. Invalid transitions are rejected
 * (see machine.ts); there is no path from PLANNING to EXECUTING that
 * skips PREVIEW → AWAITING_PERMISSION → APPROVED.
 */
export const ActionSessionState = {
  Idle: 'IDLE',
  Planning: 'PLANNING',
  Preview: 'PREVIEW',
  AwaitingPermission: 'AWAITING_PERMISSION',
  Approved: 'APPROVED',
  Executing: 'EXECUTING',
  Verifying: 'VERIFYING',
  Completed: 'COMPLETED',
  Cancelled: 'CANCELLED',
  Failed: 'FAILED',
  Blocked: 'BLOCKED',
  Stale: 'STALE',
} as const;

export type ActionSessionState =
  (typeof ActionSessionState)[keyof typeof ActionSessionState];

/** Typed action error codes (user-safe messages in USER_ERROR_MESSAGES). */
export const ActionErrorCode = {
  ACTION_INVALID: 'ACTION_INVALID',
  ACTION_NOT_ALLOWED: 'ACTION_NOT_ALLOWED',
  ACTION_PERMISSION_REQUIRED: 'ACTION_PERMISSION_REQUIRED',
  ACTION_PERMISSION_DENIED: 'ACTION_PERMISSION_DENIED',
  ACTION_PERMISSION_EXPIRED: 'ACTION_PERMISSION_EXPIRED',
  ACTION_PLAN_CHANGED: 'ACTION_PLAN_CHANGED',
  ACTION_PLAN_UNKNOWN: 'ACTION_PLAN_UNKNOWN',
  ACTION_CONTEXT_STALE: 'ACTION_CONTEXT_STALE',
  ACTION_TARGET_NOT_FOUND: 'ACTION_TARGET_NOT_FOUND',
  ACTION_TARGET_AMBIGUOUS: 'ACTION_TARGET_AMBIGUOUS',
  ACTION_SENSITIVE_FIELD: 'ACTION_SENSITIVE_FIELD',
  ACTION_EXECUTION_FAILED: 'ACTION_EXECUTION_FAILED',
  ACTION_VERIFICATION_FAILED: 'ACTION_VERIFICATION_FAILED',
  ACTION_LIMIT_EXCEEDED: 'ACTION_LIMIT_EXCEEDED',
  ACTION_TIMEOUT: 'ACTION_TIMEOUT',
  ACTION_CANCELLED: 'ACTION_CANCELLED',
  ACTION_UNSUPPORTED: 'ACTION_UNSUPPORTED',
} as const;

export type ActionErrorCode =
  (typeof ActionErrorCode)[keyof typeof ActionErrorCode];

export interface ActionError {
  code: ActionErrorCode;
  /** User-safe message. Never contains stack traces or DOM internals. */
  message: string;
}

/** Wire response of one content-script step execution. */
export type ContentActionResponse =
  | {
      ok: true;
      result: {
        status: StepStatus;
        message: string;
        verification?: StepVerification;
        data?: FindTextData | ReadPageData;
      };
    }
  | { ok: false; error: ActionErrorCode };
