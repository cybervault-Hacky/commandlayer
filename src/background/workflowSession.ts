/**
 * Phase 5 — background workflow session.
 *
 * This is the privileged half of the workflow engine: tab access, the
 * Phase 2 Page Intelligence capture used for checkpoint observations, the
 * per-step authorization hand-off to the Phase 4 permission ledger, and
 * the Phase 4 executor itself. The UI never touches any of it — it sends
 * identity-only messages (workflowId + the reviewed workflowHash) and
 * receives bounded views.
 *
 * Phase 4 remains the ONLY execution security boundary: a workflow step
 * runs through `executePlan`, which re-checks the plan hash, the
 * single-use approval, tab/URL/content-hash freshness, the action
 * allowlist, target resolution, and the sensitive-field block. The
 * workflow layer adds one thing above it — a per-step authorization that
 * is granted only after the step's executable actions have been proven
 * hash-identical to the approved step.
 */
import { executePlan } from '@/actions/executor';
import { permissionLedger } from '@/actions/permissions';
import { actionSessionStore } from '@/actions/session';
import { createRequestId } from '@/shared/messaging/envelope';
import { ErrorCode, USER_ERROR_MESSAGES } from '@/shared/constants/errors';
import type { CommandSource, CommandResult } from '@/shared/types/command';
import type { WorkflowUnderstandingView } from '@/shared/types/command';
import type { PageContext, PageSection } from '@/shared/types/page';
import { workflowError, type WorkflowError } from '@/workflows/errors';
import { WorkflowStatus } from '@/workflows/types';
import type { WorkflowRunResult, WorkflowView } from '@/workflows/types';
import type { TaskUnderstanding } from '@/workflows/understanding';
import { planWorkflow } from '@/workflows/planner';
import {
  WorkflowEngine,
  type WorkflowEnvironment,
  type WorkflowSnapshot,
} from '@/workflows/orchestrator';
import { createDeterministicReplanner } from '@/workflows/replan';
import { toWorkflowView, workflowSessionStore } from '@/workflows/state';
import { createExecutorEnvironment } from './actionSession';
import { getActiveTabId, getPageContext } from './pageContext';

/** Page sections a workflow plan needs (identity, structure, text, links). */
export const WORKFLOW_SECTIONS: readonly PageSection[] = [
  'metadata',
  'headings',
  'text',
  'links',
];

/** The privileged seams the engine runs against. */
export function createWorkflowEnvironment(): WorkflowEnvironment {
  return {
    async getActiveTab() {
      if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null;
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab || typeof tab.id !== 'number') return null;
        return { id: tab.id, url: tab.url };
      } catch {
        return null;
      }
    },

    async capture(sections): Promise<PageContext | null> {
      const context = await getPageContext({ sections: [...sections] });
      if (context.state !== 'ready' && context.state !== 'partial') return null;
      return context;
    },

    authorizeStep(plan, workflowId) {
      // Store the rebound plan and grant this single step authorization
      // on behalf of the approved workflow. The executor still enforces
      // hash binding, freshness, single use, the action allowlist, target
      // resolution, and the sensitive-field block.
      actionSessionStore.addPlan(plan);
      permissionLedger.approveForWorkflow(plan.planId, plan.planHash, workflowId);
      return true;
    },

    executeStep(planId, planHash) {
      return executePlan(planId, planHash, createExecutorEnvironment());
    },
  };
}

let engine: WorkflowEngine | null = null;

/** Process-wide engine (worker lifetime == session lifetime). */
export function getWorkflowEngine(): WorkflowEngine {
  if (!engine) {
    engine = new WorkflowEngine({
      env: createWorkflowEnvironment(),
      replanner: createDeterministicReplanner(),
    });
  }
  return engine;
}

/** Test seam: inject a stub engine, or reset to the real one. */
export function __setWorkflowEngineForTests(next: WorkflowEngine | null): void {
  engine = next;
}

/* --------------------------- create -------------------------------- */

export interface CreateWorkflowInput {
  goal: string;
  source: CommandSource;
  requestId?: string;
  /** Pre-captured context (the command pipeline already has one). */
  context?: PageContext | null;
  tabId?: number;
}

/**
 * Understand a goal and prepare a bounded workflow. Nothing executes and
 * nothing is authorized: the stored workflow lands in AWAITING_APPROVAL
 * and the reply carries only a preview.
 */
export async function createWorkflowCommand(
  input: CreateWorkflowInput,
): Promise<CommandResult> {
  const startedAt = new Date().toISOString();
  const requestId = input.requestId ?? createRequestId('wreq');
  const [captured, activeTabId] = await Promise.all([
    input.context !== undefined
      ? Promise.resolve(input.context)
      : getPageContext({ sections: [...WORKFLOW_SECTIONS] }),
    input.tabId !== undefined
      ? Promise.resolve(input.tabId)
      : getActiveTabId(),
  ]);

  const context = captured;
  if (!context || activeTabId === undefined) {
    return failureResult({
      id: requestId,
      source: input.source,
      startedAt,
      text: USER_ERROR_MESSAGES[ErrorCode.PAGE_UNAVAILABLE],
      errorCode: ErrorCode.PAGE_UNAVAILABLE,
    });
  }
  if (context.state !== 'ready' && context.state !== 'partial') {
    return failureResult({
      id: requestId,
      source: input.source,
      startedAt,
      text: USER_ERROR_MESSAGES[ErrorCode.PAGE_UNAVAILABLE],
      errorCode: ErrorCode.PAGE_UNAVAILABLE,
    });
  }

  const planned = planWorkflow({
    goal: input.goal,
    requestId,
    context,
    tabId: activeTabId,
  });

  if (!planned.workflow) {
    const error = planned.error ?? workflowError('WORKFLOW_TASK_NOT_SUPPORTED');
    return failureResult({
      id: requestId,
      source: input.source,
      startedAt,
      text: error.message,
      errorCode: error.code,
      ...(planned.understanding.kind === 'UNSUPPORTED' ||
      planned.understanding.kind === 'WORKFLOW'
        ? { understanding: understandingView(planned.understanding) }
        : {}),
    });
  }

  const record = workflowSessionStore.create(planned.workflow);
  const view = toWorkflowView(record);
  return {
    id: requestId,
    status: 'completed',
    text: `I prepared a ${view.steps.length}-step workflow. Review it before running anything.`,
    source: input.source,
    workflow: view,
    understanding: understandingView(planned.understanding),
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

/* --------------------------- control ------------------------------- */

export interface ApproveWorkflowInput {
  workflowId: string;
  workflowHash: string;
  source: CommandSource;
}

export async function approveWorkflowCommand(
  input: ApproveWorkflowInput,
): Promise<CommandResult> {
  const startedAt = new Date().toISOString();
  const outcome = await getWorkflowEngine().approve({
    workflowId: input.workflowId,
    workflowHash: input.workflowHash,
  });
  return outcome.ok
    ? snapshotResult(outcome.snapshot, input.source, startedAt)
    : errorResult(outcome.error, input.workflowId, input.source, startedAt);
}

export async function resumeWorkflowCommand(
  input: ApproveWorkflowInput,
): Promise<CommandResult> {
  const startedAt = new Date().toISOString();
  const outcome = await getWorkflowEngine().resume({
    workflowId: input.workflowId,
    workflowHash: input.workflowHash,
  });
  return outcome.ok
    ? snapshotResult(outcome.snapshot, input.source, startedAt)
    : errorResult(outcome.error, input.workflowId, input.source, startedAt);
}

export function pauseWorkflowCommand(input: {
  workflowId: string;
  source: CommandSource;
}): CommandResult {
  const startedAt = new Date().toISOString();
  const outcome = getWorkflowEngine().pause(input.workflowId);
  return outcome.ok
    ? snapshotResult(outcome.snapshot, input.source, startedAt)
    : errorResult(outcome.error, input.workflowId, input.source, startedAt);
}

export function cancelWorkflowCommand(input: {
  workflowId: string;
  source: CommandSource;
}): CommandResult {
  const startedAt = new Date().toISOString();
  const outcome = getWorkflowEngine().cancel(input.workflowId);
  return outcome.ok
    ? snapshotResult(outcome.snapshot, input.source, startedAt)
    : errorResult(outcome.error, input.workflowId, input.source, startedAt);
}

/** Read-only status (no side effects, nothing executes). */
export function workflowStatusCommand(input: {
  workflowId: string;
  source: CommandSource;
}): CommandResult {
  const startedAt = new Date().toISOString();
  const outcome = getWorkflowEngine().view(input.workflowId);
  return outcome.ok
    ? snapshotResult(outcome.snapshot, input.source, startedAt)
    : errorResult(outcome.error, input.workflowId, input.source, startedAt);
}

/* --------------------------- mapping ------------------------------- */

function snapshotResult(
  snapshot: WorkflowSnapshot,
  source: CommandSource,
  startedAt: string,
): CommandResult {
  const run = snapshot.run;
  const status = run?.status ?? snapshot.workflow.status;
  const ok =
    status === WorkflowStatus.Completed || status === WorkflowStatus.Paused;

  return {
    id: snapshot.workflow.workflowId,
    status: ok ? 'completed' : 'failed',
    text:
      run?.summary ??
      snapshot.workflow.summary ??
      (status === WorkflowStatus.Paused
        ? 'Workflow paused — no further step will start.'
        : 'Workflow updated.'),
    source,
    workflow: snapshot.workflow,
    ...(run ? { workflowRun: run } : {}),
    ...(ok ? {} : { errorCode: errorCodeForStatus(status) }),
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

function errorResult(
  error: WorkflowError,
  workflowId: string,
  source: CommandSource,
  startedAt: string,
): CommandResult {
  const record = workflowSessionStore.get(workflowId);
  return failureResult({
    id: workflowId,
    source,
    startedAt,
    text: error.message,
    errorCode: error.code,
    ...(record ? { workflow: toWorkflowView(record) } : {}),
  });
}

function failureResult(input: {
  id: string;
  source: CommandSource;
  startedAt: string;
  text: string;
  errorCode: string;
  workflow?: WorkflowView;
  understanding?: WorkflowUnderstandingView;
}): CommandResult {
  return {
    id: input.id,
    status: 'failed',
    text: input.text,
    source: input.source,
    ...(input.workflow ? { workflow: input.workflow } : {}),
    ...(input.understanding ? { understanding: input.understanding } : {}),
    errorCode: input.errorCode,
    startedAt: input.startedAt,
    finishedAt: new Date().toISOString(),
  };
}

function errorCodeForStatus(status: WorkflowStatus): string {
  switch (status) {
    case WorkflowStatus.Blocked:
      return ErrorCode.WORKFLOW_BLOCKED;
    case WorkflowStatus.Cancelled:
      return ErrorCode.WORKFLOW_CANCELLED;
    case WorkflowStatus.Stale:
      return ErrorCode.WORKFLOW_CONTEXT_CHANGED;
    case WorkflowStatus.Expired:
      return ErrorCode.WORKFLOW_EXPIRED;
    default:
      return ErrorCode.WORKFLOW_STEP_FAILED;
  }
}

/** Project the deterministic understanding into the UI-safe shape. */
export function understandingView(
  understanding: TaskUnderstanding,
): WorkflowUnderstandingView {
  return {
    kind: understanding.kind,
    goal: understanding.goal,
    expectedOutcome: understanding.expectedOutcome,
    intents: [...understanding.intents],
    contextRequirements: [...understanding.contextRequirements],
    supported: understanding.supported,
    ...(understanding.reason ? { reason: understanding.reason } : {}),
  };
}


export { WorkflowStatus };
export type { WorkflowRunResult };
export type { WorkflowView };
