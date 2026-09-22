/**
 * Phase 4 — action executor (background service worker).
 *
 * The executor is the ONLY code that runs actions, and it only runs:
 *   1. plans that exist in the session store (created by the planner),
 *   2. whose hash equals the hash the user approved (plan binding),
 *   3. whose approval is single-use and unexpired (permission ledger),
 *   4. whose page context is still fresh (tab + URL + content hash),
 *   5. one validated, registry-known step at a time,
 *   6. stopping immediately after any failure, block, or stale result.
 *
 * There is no path from AI output to this module: AI responses carry no
 * actions field (rejected by the AI validator's closed contract), and
 * plans only enter the store through the deterministic planner.
 */
import { ACTION_LIMITS } from './limits';
import { actionError, toActionError } from './errors';
import { computePlanHash } from './planHash';
import { permissionLedger } from './permissions';
import { actionRegistry } from './registry';
import { actionSessionStore } from './session';
import { ActionEvent } from './machine';
import {
  buildExecuteActionRequest,
  isContentActionResponse,
} from './protocol';
import { describeTarget } from './targets';
import {
  ActionErrorCode,
  ActionSessionState,
  type ActionError,
  type ActionExecutionResult,
  type ActionPlan,
  type ActionStepResult,
  type PlannedAction,
  type ReadPageData,
} from './types';

export type ExecutionOutcome =
  | { ok: true; result: ActionExecutionResult }
  | { ok: false; error: ActionError };

interface ActiveTabInfo {
  id: number;
  url?: string;
}

/** All privileged browser access in this module goes through these seams. */
export interface ExecutorEnvironment {
  getActiveTab(): Promise<ActiveTabInfo | null>;
  sendStep(
    tabId: number,
    message: unknown,
  ): Promise<unknown>;
  /** Re-capture a minimal context hash for freshness validation. */
  captureContentHash(): Promise<string>;
  /** READ_PAGE: reuse Phase 2 Page Intelligence (no second engine). */
  readPage(): Promise<ReadPageData | null>;
}

/**
 * Execute an approved plan end to end. Never throws; always resolves to
 * a typed outcome with user-safe wording.
 */
export async function executePlan(
  planId: string,
  claimedHash: string,
  env: ExecutorEnvironment,
): Promise<ExecutionOutcome> {
  // 1. The plan must exist in the session store (never from the caller).
  const record = actionSessionStore.get(planId);
  if (!record) {
    return { ok: false, error: actionError(ActionErrorCode.ACTION_PLAN_UNKNOWN) };
  }
  const { plan } = record;

  // 2. Plan binding: executed plan == approved plan.
  if (
    typeof claimedHash !== 'string' ||
    claimedHash.length === 0 ||
    claimedHash !== plan.planHash ||
    computePlanHash(plan) !== plan.planHash
  ) {
    return { ok: false, error: actionError(ActionErrorCode.ACTION_PLAN_CHANGED) };
  }

  // 3. A plan may only execute from the awaiting-permission state.
  if (record.state !== ActionSessionState.AwaitingPermission) {
    return {
      ok: false,
      error: actionError(
        record.state === ActionSessionState.Completed ||
          record.state === ActionSessionState.Failed ||
          record.state === ActionSessionState.Blocked ||
          record.state === ActionSessionState.Stale
          ? ActionErrorCode.ACTION_PERMISSION_DENIED
          : ActionErrorCode.ACTION_PERMISSION_REQUIRED,
      ),
    };
  }

  // 4. Explicit, single-use, unexpired approval bound to this hash.
  const approval = permissionLedger.consume(planId, plan.planHash);
  if (!approval.ok) return { ok: false, error: approval.error };

  // 5. Freshness: same active tab and URL as planning time.
  const tab = await env.getActiveTab();
  if (!tab || tab.id !== plan.tabId || tab.url !== plan.url) {
    actionSessionStore.apply(planId, ActionEvent.Stale);
    actionSessionStore.dispose(planId);
    return { ok: false, error: actionError(ActionErrorCode.ACTION_CONTEXT_STALE) };
  }

  // 6. Freshness: content hash must still match (target pages only).
  if (requiresTargetValidation(plan)) {
    const freshHash = await env.captureContentHash();
    if (freshHash !== plan.contentHash) {
      actionSessionStore.apply(planId, ActionEvent.Stale);
      actionSessionStore.dispose(planId);
      return { ok: false, error: actionError(ActionErrorCode.ACTION_CONTEXT_STALE) };
    }
  }

  // 7. Transition to APPROVED → EXECUTING through the state machine.
  if (!actionSessionStore.apply(planId, ActionEvent.Approve)) {
    return { ok: false, error: actionError(ActionErrorCode.ACTION_PERMISSION_REQUIRED) };
  }
  if (!actionSessionStore.apply(planId, ActionEvent.BeginExecution)) {
    return { ok: false, error: actionError(ActionErrorCode.ACTION_PERMISSION_REQUIRED) };
  }

  // 8. Bounded step-by-step execution; hard stop on any non-success.
  const startedAt = new Date().toISOString();
  const steps: ActionStepResult[] = [];
  let stoppedAt: number | undefined;
  let finalEvent: ActionEvent = ActionEvent.Complete;
  let status: ActionExecutionResult['status'] = 'completed';

  for (let i = 0; i < plan.actions.length; i++) {
    const step = plan.actions[i];
    if (!step) continue;
    const started = Date.now();
    let stepResult: ActionStepResult;
    try {
      stepResult = await runStep(plan, step, tab.id, env);
    } catch (err) {
      stepResult = {
        actionId: step.stepId,
        kind: step.action.type,
        status: 'failed',
        message: toActionError(err).message,
        durationMs: Date.now() - started,
      };
    }
    stepResult.durationMs = Date.now() - started;
    steps.push(stepResult);

    if (stepResult.status !== 'success') {
      stoppedAt = i;
      finalEvent =
        stepResult.status === 'blocked'
          ? ActionEvent.Block
          : stepResult.status === 'stale'
            ? ActionEvent.Stale
            : stepResult.status === 'cancelled'
              ? ActionEvent.Cancel
              : ActionEvent.Fail;
      status =
        stepResult.status === 'blocked'
          ? 'blocked'
          : stepResult.status === 'stale'
            ? 'stale'
            : stepResult.status === 'cancelled'
              ? 'cancelled'
              : 'failed';
      break; // STOP — never continue blindly, never auto-replan.
    }
  }

  actionSessionStore.apply(planId, finalEvent);
  const finishedAt = new Date().toISOString();
  const summary = buildSummary(plan, steps, status, stoppedAt);

  const result: ActionExecutionResult = {
    planId,
    planHash: plan.planHash,
    status,
    steps,
    ...(stoppedAt !== undefined ? { stoppedAt } : {}),
    summary,
    startedAt,
    finishedAt,
  };

  // Plans are single-use: dispose after the one authorized execution.
  actionSessionStore.dispose(planId);
  return { ok: true, result };
}

function requiresTargetValidation(plan: ActionPlan): boolean {
  return plan.actions.some(
    (s) =>
      s.action.type === 'CLICK_ELEMENT' ||
      s.action.type === 'TYPE_TEXT' ||
      s.action.type === 'SELECT_OPTION',
  );
}

async function runStep(
  plan: ActionPlan,
  step: PlannedAction,
  tabId: number,
  env: ExecutorEnvironment,
): Promise<ActionStepResult> {
  const kind = step.action.type;

  // The registry is the allowlist: unregistered kinds never execute.
  if (!actionRegistry.isRegistered(kind)) {
    return {
      actionId: step.stepId,
      kind,
      status: 'blocked',
      message: 'That action is not supported in this version.',
      durationMs: 0,
    };
  }

  // READ_PAGE runs against the Phase 2 PageContext via the injected
  // environment — no DOM mutation, no second extraction engine.
  if (kind === 'READ_PAGE') {
    return runReadPageStep(step, env);
  }

  let raw: unknown;
  try {
    raw = await env.sendStep(tabId, buildExecuteActionRequest(plan.planId, step));
  } catch {
    return {
      actionId: step.stepId,
      kind,
      status: 'failed',
      message: 'The page did not respond to the action request.',
      durationMs: 0,
    };
  }

  if (!isContentActionResponse(raw)) {
    return {
      actionId: step.stepId,
      kind,
      status: 'failed',
      message: 'The page returned an unexpected action response.',
      durationMs: 0,
    };
  }

  if (raw.ok === false) {
    return {
      actionId: step.stepId,
      kind,
      status: mapWireErrorStatus(raw.error),
      message: mapWireErrorMessage(raw.error),
      durationMs: 0,
    };
  }

  const { result } = raw;
  return {
    actionId: step.stepId,
    kind,
    status: normalizeStepStatus(result.status),
    message: safeMessage(result.message),
    ...(result.verification ? { verification: result.verification } : {}),
    ...(result.data ? { data: result.data } : {}),
    durationMs: 0,
  };
}

async function runReadPageStep(
  step: PlannedAction,
  env: ExecutorEnvironment,
): Promise<ActionStepResult> {
  const data = await env.readPage();
  if (data === null) {
    return {
      actionId: step.stepId,
      kind: 'READ_PAGE',
      status: 'stale',
      message: 'The page could not be read right now.',
      durationMs: 0,
    };
  }
  return {
    actionId: step.stepId,
    kind: 'READ_PAGE',
    status: 'success',
    message: `Read “${data.title}” (${data.stats}).`,
    data,
    durationMs: 0,
  };
}

function normalizeStepStatus(
  status: string,
): ActionStepResult['status'] {
  switch (status) {
    case 'success':
    case 'failed':
    case 'blocked':
    case 'cancelled':
    case 'stale':
      return status;
    default:
      return 'failed';
  }
}

function mapWireErrorStatus(code: string): ActionStepResult['status'] {
  switch (code) {
    case ActionErrorCode.ACTION_SENSITIVE_FIELD:
    case ActionErrorCode.ACTION_NOT_ALLOWED:
      return 'blocked';
    case ActionErrorCode.ACTION_CONTEXT_STALE:
    case ActionErrorCode.ACTION_TARGET_NOT_FOUND:
      return 'stale';
    case ActionErrorCode.ACTION_CANCELLED:
      return 'cancelled';
    default:
      return 'failed';
  }
}

function mapWireErrorMessage(code: string): string {
  // Reuse the user-safe vocabulary; unknown codes degrade generically.
  try {
    return actionError(code as ActionErrorCode).message;
  } catch {
    return 'The action could not be completed.';
  }
}

function safeMessage(message: string): string {
  // Strip control characters from untrusted page-originated wording.
  // eslint-disable-next-line no-control-regex -- deliberate sanitization
  const trimmed = message.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  return trimmed.slice(0, ACTION_LIMITS.MAX_TEXT_LENGTH);
}

/**
 * Step label for summaries. TYPE_TEXT values are NEVER echoed here: a
 * blocked typing step may involve a sensitive field, so the summary
 * references only the action verb and the target description.
 */
function safeStepLabel(step: PlannedAction): string {
  const action = step.action;
  if (action.type === 'TYPE_TEXT') {
    return `Type into ${describeTarget(action.target)}`;
  }
  return step.preview;
}

function buildSummary(
  plan: ActionPlan,
  steps: ActionStepResult[],
  status: ActionExecutionResult['status'],
  stoppedAt: number | undefined,
): string {
  const total = plan.actions.length;
  const done = steps.filter((s) => s.status === 'success').length;
  if (status === 'completed') {
    return `Completed ${done} of ${total} action${total === 1 ? '' : 's'}.`;
  }
  const failedStep = stoppedAt !== undefined ? plan.actions[stoppedAt] : undefined;
  const label = failedStep ? safeStepLabel(failedStep) : 'an action';
  switch (status) {
    case 'blocked':
      return `Stopped before completing: “${label}” was blocked. Nothing after it ran.`;
    case 'stale':
      return `Stopped: the page changed before “${label}” could run.`;
    case 'cancelled':
      return `Stopped: “${label}” was cancelled. Nothing after it ran.`;
    default:
      return `Stopped: “${label}” failed. Nothing after it ran.`;
  }
}
