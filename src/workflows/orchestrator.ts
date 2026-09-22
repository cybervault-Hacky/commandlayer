/**
 * Phase 5 — workflow orchestrator.
 *
 * The engine owns the bounded execution loop and is the only place that
 * decides whether another step runs:
 *
 *   approved workflow
 *     ↓  (approval bound to the workflow hash, checked before anything runs)
 *   checkpoint: tab binding · budget · one bounded observation
 *     ↓  (the step plan is re-bound to the CURRENT page freshness fields,
 *         and the executable actions are re-verified against the approved
 *         actionsHash — still exactly the approved content, nothing more)
 *   Phase 4 executor  ← the single execution security boundary
 *     ↓
 *   verify the step (registry-driven condition)
 *     ↓
 *   continue / stop / bounded replan
 *
 * Hard invariants:
 * - the UI never drives this loop; it sends one approval and reads
 *   snapshots (pause/cancel are cooperative flags checked at checkpoints)
 * - one workflow per tab at a time (typed conflict, never interference)
 * - every stop condition ends the run: nothing after a failure runs
 * - the loop is bounded by steps, lifetime, retries, refreshes, replans
 * - an approval covers exactly one workflow hash; a changed workflow can
 *   never execute under an old approval
 */
import { actionSessionStore } from '@/actions/session';
import { permissionLedger } from '@/actions/permissions';
import { computePlanHash, hashActions } from '@/actions/planHash';
import { createRequestId } from '@/shared/messaging/envelope';
import type { ExecutionOutcome } from '@/actions/executor';
import type { ActionPlan, ActionStepResult } from '@/actions/types';
import type { PageContext, PageSection } from '@/shared/types/page';
import { WORKFLOW_LIMITS } from './limits';
import { toWorkflowError, workflowError, type WorkflowError } from './errors';
import { workflowHashMatches } from './hash';
import { WorkflowEvent, isTerminalWorkflowStatus } from './machine';
import {
  detectNavigation,
  urlMatchesExpectation,
  WorkflowObserver,
  type ObservationSample,
} from './observer';
import { planWorkflow, planWorkflowWithProposal } from './planner';
import { isReplannable, type WorkflowReplanner } from './replan';
import { workflowSessions, type WorkflowRunGuard } from './session';
import {
  toWorkflowView,
  workflowSessionStore,
  type WorkflowRecord,
  type WorkflowStore,
} from './state';
import {
  verifyStepResult,
  verifyWorkflowOutcome,
  type StepVerificationResult,
} from './verifier';
import {
  WorkflowEventType,
  WorkflowStatus,
  WorkflowStepStatus,
  type Workflow,
  type WorkflowOutcome,
  type WorkflowRunResult,
  type WorkflowSnapshot,
  type WorkflowStep,
  type WorkflowStepView,
} from './types';
import type { TaskUnderstanding } from './understanding';

/** Privileged seams the background layer provides (never the UI). */
export interface WorkflowEnvironment {
  getActiveTab(): Promise<{ id: number; url?: string } | null>;
  /** One on-demand Phase 2 Page Intelligence capture. */
  capture(sections: readonly PageSection[]): Promise<PageContext | null>;
  /**
   * Store the step's Phase 4 plan in the action session store and grant
   * exactly that plan hash the authorization carried by this workflow.
   */
  authorizeStep(plan: ActionPlan, workflowId: string): boolean;
  /** Execute one authorized step through the Phase 4 executor. */
  executeStep(planId: string, planHash: string): Promise<ExecutionOutcome>;
}

/**
 * An UNTRUSTED proposal source (an AI provider, a gateway, a user-edited
 * file — anything). Whatever it returns is treated as hostile data: it is
 * schema-validated, registry-validated, workflow-validated, and then
 * accepted ONLY when it matches the deterministic plan action-for-action.
 */
export type WorkflowProposalSource = (input: {
  requestId: string;
  goal: string;
  tabId: number;
  context: PageContext;
}) => Promise<unknown> | unknown;

export interface WorkflowEngineDeps {
  env: WorkflowEnvironment;
  store?: WorkflowStore;
  sessions?: typeof workflowSessions;
  now?: () => number;
  /** Test seam only; production uses WORKFLOW_LIMITS.STEP_TIMEOUT_MS. */
  stepTimeoutMs?: number;
  replanner?: WorkflowReplanner | null;
  /** Optional untrusted proposal source (never trusted, never required). */
  proposalSource?: WorkflowProposalSource | null;
}

export type SnapshotOutcome =
  | { ok: true; snapshot: WorkflowSnapshot }
  | { ok: false; error: WorkflowError };

export type { WorkflowSnapshot };

export interface CreateOutcome {
  understanding: TaskUnderstanding;
  workflow?: Workflow;
  error?: WorkflowError;
}

interface StopReason {
  status: WorkflowStatus;
  error: WorkflowError;
  /** Index of the step that stopped the run (for bounded replanning). */
  failedStepIndex?: number;
  /** User-facing summary override. */
  summary?: string;
}

interface RunState {
  /** Last verified page identity for this run. */
  url: string;
  hash: string;
}

export class WorkflowEngine {
  private readonly env: WorkflowEnvironment;
  private readonly store: WorkflowStore;
  private readonly sessions: typeof workflowSessions;
  private readonly now: () => number;
  private readonly stepTimeoutMs: number;
  private readonly replanner: WorkflowReplanner | null;
  private readonly proposalSource: WorkflowProposalSource | null;
  private readonly observer: WorkflowObserver;

  constructor(deps: WorkflowEngineDeps) {
    this.env = deps.env;
    this.store = deps.store ?? workflowSessionStore;
    this.sessions = deps.sessions ?? workflowSessions;
    this.now = deps.now ?? Date.now;
    this.stepTimeoutMs = deps.stepTimeoutMs ?? WORKFLOW_LIMITS.STEP_TIMEOUT_MS;
    this.replanner = deps.replanner ?? null;
    this.proposalSource = deps.proposalSource ?? null;
    this.observer = new WorkflowObserver((options) =>
      this.env.capture(options.sections),
    );
  }

  /* ----------------------------- create ---------------------------- */

  /**
   * Understand and plan a goal. Nothing executes and nothing is
   * authorized here: the stored workflow lands in AWAITING_APPROVAL.
   */
  create(input: {
    requestId: string;
    goal: string;
    context: PageContext;
    tabId: number;
  }): CreateOutcome {
    const planned = planWorkflow({
      goal: input.goal,
      requestId: input.requestId,
      context: input.context,
      tabId: input.tabId,
      now: new Date(this.now()),
    });

    if (!planned.workflow) {
      return {
        understanding: planned.understanding,
        ...(planned.error ? { error: planned.error } : {}),
      };
    }

    this.store.create(planned.workflow);
    return { understanding: planned.understanding, workflow: planned.workflow };
  }

  /**
   * Create a workflow from an UNTRUSTED AI proposal.
   *
   *   raw proposal
   *     → schema validation (closed keys; no code/selector/xpath/script)
   *     → action-registry validation (only registered actions)
   *     → workflow validation (bounds, hash integrity, sensitive block)
   *     → acceptance only when it matches the deterministic plan exactly
   *     → preview (AWAITING_APPROVAL) — never execution
   *
   * A rejected proposal never degrades safety: the deterministic plan is
   * used instead, or the goal is refused.
   */
  async createFromProposal(input: {
    requestId: string;
    goal: string;
    context: PageContext;
    tabId: number;
    proposal?: unknown;
  }): Promise<CreateOutcome> {
    let proposal = input.proposal;
    if (proposal === undefined && this.proposalSource) {
      try {
        proposal = await this.proposalSource({
          requestId: input.requestId,
          goal: input.goal,
          tabId: input.tabId,
          context: input.context,
        });
      } catch {
        proposal = undefined;
      }
    }

    const planned = planWorkflowWithProposal(proposal, {
      goal: input.goal,
      requestId: input.requestId,
      context: input.context,
      tabId: input.tabId,
      now: new Date(this.now()),
    });

    if (!planned.workflow) {
      return {
        understanding: planned.understanding,
        ...(planned.error ? { error: planned.error } : {}),
      };
    }

    this.store.create(planned.workflow);
    return { understanding: planned.understanding, workflow: planned.workflow };
  }

  /* ---------------------------- approve ---------------------------- */

  /**
   * Approve ONE workflow hash and run it. Wrong hashes, duplicate
   * approvals, expired workflows, completed workflows, and cross-tab
   * conflicts are all rejected before a single step runs.
   */
  async approve(input: {
    workflowId: string;
    workflowHash: string;
  }): Promise<SnapshotOutcome> {
    const record = this.store.get(input.workflowId);
    if (!record) return { ok: false, error: workflowError('WORKFLOW_UNKNOWN') };
    const { workflow } = record;

    if (!workflowHashMatches(workflow, input.workflowHash)) {
      return { ok: false, error: workflowError('WORKFLOW_APPROVAL_MISMATCH') };
    }
    if (workflow.status === WorkflowStatus.Expired) {
      return { ok: false, error: workflowError('WORKFLOW_EXPIRED') };
    }
    if (isTerminalWorkflowStatus(workflow.status)) {
      return { ok: false, error: workflowError('WORKFLOW_ALREADY_COMPLETED') };
    }
    if (workflow.status !== WorkflowStatus.AwaitingApproval) {
      // Duplicate approval while already approved/running/paused.
      return { ok: false, error: workflowError('WORKFLOW_STATE_INVALID') };
    }
    if (this.isApprovalExpired(record)) {
      this.store.apply(workflow.workflowId, WorkflowEvent.Expire);
      return { ok: false, error: workflowError('WORKFLOW_APPROVAL_EXPIRED') };
    }

    // One workflow per tab: never let two workflows drive one page.
    const conflict = this.store.runningWorkflowForTab(workflow.tabId);
    if (conflict && conflict.workflow.workflowId !== workflow.workflowId) {
      return { ok: false, error: workflowError('WORKFLOW_CONFLICT') };
    }

    // Tab and page binding: the workflow runs where it was planned.
    const tab = await this.env.getActiveTab();
    if (!tab || tab.id !== workflow.tabId) {
      return this.stopBeforeRun(record, 'WORKFLOW_TAB_CHANGED');
    }
    if (
      workflow.url.length > 0 &&
      typeof tab.url === 'string' &&
      tab.url.length > 0 &&
      tab.url !== workflow.url
    ) {
      return this.stopBeforeRun(record, 'WORKFLOW_CONTEXT_CHANGED');
    }

    // Claim the tab BEFORE recording the approval: a conflict must not
    // leave the workflow half-approved.
    const claim = this.store.claimTab(workflow.workflowId, workflow.tabId);
    if (!claim.ok) {
      return { ok: false, error: workflowError('WORKFLOW_CONFLICT') };
    }

    // Record the approval against this exact hash (single-use).
    if (!this.store.approve(workflow.workflowId, input.workflowHash)) {
      return { ok: false, error: workflowError('WORKFLOW_STATE_INVALID') };
    }
    if (!this.store.apply(workflow.workflowId, WorkflowEvent.Approve)) {
      return { ok: false, error: workflowError('WORKFLOW_STATE_INVALID') };
    }
    this.store.appendEvent(workflow.workflowId, {
      type: WorkflowEventType.Approved,
      at: this.nowIso(),
      message: 'Approved — running bounded steps.',
    });
    if (!this.store.apply(workflow.workflowId, WorkflowEvent.Start)) {
      return { ok: false, error: workflowError('WORKFLOW_STATE_INVALID') };
    }
    this.store.appendEvent(workflow.workflowId, {
      type: WorkflowEventType.Started,
      at: this.nowIso(),
      message: 'Workflow started.',
    });
    workflow.startedAt = this.nowIso();

    return this.run(record);
  }

  /** Resume a paused workflow (same approval, unchanged workflow hash). */
  async resume(input: {
    workflowId: string;
    workflowHash: string;
  }): Promise<SnapshotOutcome> {
    const record = this.store.get(input.workflowId);
    if (!record) return { ok: false, error: workflowError('WORKFLOW_UNKNOWN') };
    const { workflow } = record;

    if (!workflowHashMatches(workflow, input.workflowHash)) {
      return { ok: false, error: workflowError('WORKFLOW_APPROVAL_MISMATCH') };
    }
    if (workflow.status === WorkflowStatus.Expired) {
      return { ok: false, error: workflowError('WORKFLOW_EXPIRED') };
    }
    if (isTerminalWorkflowStatus(workflow.status)) {
      return { ok: false, error: workflowError('WORKFLOW_ALREADY_COMPLETED') };
    }
    if (workflow.status !== WorkflowStatus.Paused) {
      return { ok: false, error: workflowError('WORKFLOW_STATE_INVALID') };
    }
    if (this.isExpired(record)) {
      this.store.apply(workflow.workflowId, WorkflowEvent.Expire);
      return { ok: false, error: workflowError('WORKFLOW_EXPIRED') };
    }

    const tab = await this.env.getActiveTab();
    if (!tab || tab.id !== workflow.tabId) {
      return this.stopBeforeRun(record, 'WORKFLOW_TAB_CHANGED');
    }

    if (!this.store.apply(workflow.workflowId, WorkflowEvent.Resume)) {
      return { ok: false, error: workflowError('WORKFLOW_STATE_INVALID') };
    }
    this.store.appendEvent(workflow.workflowId, {
      type: WorkflowEventType.Resumed,
      at: this.nowIso(),
      message: 'Workflow resumed.',
    });
    const claim = this.store.claimTab(workflow.workflowId, workflow.tabId);
    if (!claim.ok) {
      return { ok: false, error: workflowError('WORKFLOW_CONFLICT') };
    }
    this.sessions.requestResume(workflow.workflowId);
    return this.run(record);
  }

  /* ---------------------------- controls --------------------------- */

  /** Cooperative pause: no new step starts; a running step finishes safely. */
  pause(workflowId: string): SnapshotOutcome {
    const record = this.store.get(workflowId);
    if (!record) return { ok: false, error: workflowError('WORKFLOW_UNKNOWN') };
    const { workflow } = record;

    if (isTerminalWorkflowStatus(workflow.status)) {
      return { ok: false, error: workflowError('WORKFLOW_ALREADY_COMPLETED') };
    }
    if (workflow.status === WorkflowStatus.Paused) {
      return { ok: true, snapshot: { workflow: toWorkflowView(record) } };
    }
    if (
      workflow.status !== WorkflowStatus.Running &&
      workflow.status !== WorkflowStatus.Verifying
    ) {
      return { ok: false, error: workflowError('WORKFLOW_STATE_INVALID') };
    }

    if (!this.sessions.requestPause(workflowId)) {
      // No live run guard (the loop is between steps): pause immediately.
      this.store.apply(workflowId, WorkflowEvent.Pause);
      this.store.appendEvent(workflowId, {
        type: WorkflowEventType.Paused,
        at: this.nowIso(),
        message: 'Workflow paused.',
      });
    }
    return { ok: true, snapshot: { workflow: toWorkflowView(record) } };
  }

  /** Cancel: no future step may start, even if one is finishing now. */
  cancel(workflowId: string): SnapshotOutcome {
    const record = this.store.get(workflowId);
    if (!record) return { ok: false, error: workflowError('WORKFLOW_UNKNOWN') };
    const { workflow } = record;

    if (isTerminalWorkflowStatus(workflow.status)) {
      return { ok: false, error: workflowError('WORKFLOW_ALREADY_COMPLETED') };
    }

    const live = this.sessions.get(workflowId);
    if (
      live &&
      (workflow.status === WorkflowStatus.Running ||
        workflow.status === WorkflowStatus.Verifying)
    ) {
      // The loop stops before the next step; the current step may finish.
      this.sessions.requestCancel(workflowId);
      return { ok: true, snapshot: { workflow: toWorkflowView(record) } };
    }

    this.store.apply(workflowId, WorkflowEvent.Cancel);
    this.store.appendEvent(workflowId, {
      type: WorkflowEventType.Cancelled,
      at: this.nowIso(),
      message: 'Workflow cancelled.',
    });
    this.store.releaseTab(workflowId);
    workflow.summary = 'Cancelled before any further step ran.';
    return { ok: true, snapshot: { workflow: toWorkflowView(record) } };
  }

  /** Read-only snapshot (no side effects, no execution). */
  view(workflowId: string): SnapshotOutcome {
    const record = this.store.get(workflowId);
    if (!record) return { ok: false, error: workflowError('WORKFLOW_UNKNOWN') };
    return { ok: true, snapshot: { workflow: toWorkflowView(record) } };
  }

  /* ------------------------------ loop ----------------------------- */

  private async run(record: WorkflowRecord): Promise<SnapshotOutcome> {
    const { workflow } = record;
    const workflowId = workflow.workflowId;
    const guard: WorkflowRunGuard =
      this.sessions.get(workflowId) ??
      this.sessions.begin(workflowId, workflow.tabId);
    const activePlans: string[] = [];

    let stop: StopReason | undefined;
    let paused = false;

    try {
      const state: RunState = {
        url: workflow.url,
        hash: workflow.contentHash,
      };

      let index = workflow.currentStepIndex;
      while (index < workflow.steps.length) {
        const step = workflow.steps[index];
        if (!step) break;

        if (step.status === WorkflowStepStatus.Skipped) {
          index += 1;
          workflow.currentStepIndex = index;
          continue;
        }

        /* --- checkpoint: controls and budget ---------------------- */
        if (guard.cancelRequested) {
          stop = {
            status: WorkflowStatus.Cancelled,
            error: workflowError('WORKFLOW_CANCELLED'),
          };
          break;
        }
        if (!this.sessions.withinDeadline(workflowId)) {
          stop = {
            status: WorkflowStatus.Expired,
            error: workflowError('WORKFLOW_TIMEOUT'),
          };
          break;
        }
        if (guard.paused) {
          paused = true;
          break;
        }

        /* --- checkpoint: tab binding ------------------------------ */
        const tab = await this.env.getActiveTab();
        if (!tab || tab.id !== workflow.tabId) {
          stop = {
            status: WorkflowStatus.Stale,
            error: workflowError('WORKFLOW_TAB_CHANGED'),
          };
          break;
        }

        /* --- checkpoint: bounded context observation -------------- */
        const previous = index > 0 ? workflow.steps[index - 1] : undefined;
        const needsCheckpoint =
          index === 0 || (previous?.mutated === true && previous.observedUrl === undefined);
        if (needsCheckpoint) {
          const refreshed = await this.observeWithinBudget(workflowId);
          if (!refreshed.ok || !refreshed.sample) {
            stop = {
              status: WorkflowStatus.Stale,
              error: workflowError('WORKFLOW_CONTEXT_CHANGED'),
            };
            break;
          }
          const sample = refreshed.sample;
          if (!previous) {
            // Before the first step: the page must still be the planned one.
            if (detectNavigation(workflow.url, sample.url)) {
              stop = {
                status: WorkflowStatus.Stale,
                error: workflowError('WORKFLOW_CONTEXT_CHANGED'),
              };
              break;
            }
          } else if (previous.expectsNavigation) {
            if (
              previous.expectedUrl &&
              !urlMatchesExpectation(sample.url, previous.expectedUrl)
            ) {
              stop = {
                status: WorkflowStatus.Stale,
                error: workflowError('WORKFLOW_CONTEXT_CHANGED'),
                summary:
                  'The page navigated somewhere other than the approved destination, so the workflow stopped.',
              };
              break;
            }
          } else if (detectNavigation(state.url, sample.url)) {
            stop = {
              status: WorkflowStatus.Stale,
              error: workflowError('WORKFLOW_CONTEXT_CHANGED'),
            };
            break;
          }
          state.url = sample.url;
          state.hash = sample.contentHash;
        }

        /* --- rebind the plan to current freshness ------------------ */
        const bound = this.bindStep(step, tab.id, state);
        if (!bound) {
          stop = {
            status: WorkflowStatus.Blocked,
            error: workflowError('WORKFLOW_CHANGED'),
          };
          break;
        }
        if (!this.env.authorizeStep(bound, workflowId)) {
          stop = {
            status: WorkflowStatus.Blocked,
            error: workflowError('WORKFLOW_BLOCKED'),
          };
          break;
        }
        activePlans.push(bound.planId);

        /* --- execute one bounded step ------------------------------ */
        step.status = WorkflowStepStatus.Running;
        step.attempts += 1;
        step.startedAt = this.nowIso();
        this.store.appendEvent(workflowId, {
          type: WorkflowEventType.StepStarted,
          at: step.startedAt,
          stepIndex: index,
          message: step.label,
        });

        const urlBeforeStep = state.url;
        let result = await this.executeBoundStep(bound);
        this.sessions.recordStep(workflowId);
        let verified = verifyStepResult(step, result);

        if (!verified.ok) {
          const retried = await this.retryStepOnce(
            record,
            step,
            index,
            result,
            state,
            activePlans,
          );
          if (retried) {
            result = retried.result;
            verified = retried.verified;
            this.sessions.recordStep(workflowId);
          }
        }

        if (!verified.ok) {
          stop = this.recordStepFailure(record, step, index, verified, result);
          break;
        }

        step.status = WorkflowStepStatus.Completed;
        step.result = result;
        step.detail = verified.detail;
        step.finishedAt = this.nowIso();
        step.mutated = isMutatingStep(step);
        this.store.appendEvent(workflowId, {
          type: WorkflowEventType.StepCompleted,
          at: step.finishedAt,
          stepIndex: index,
          message: verified.detail,
        });

        /* --- post-step checkpoint (mutating steps only) ------------ */
        if (step.mutated) {
          const post = await this.observeWithinBudget(workflowId);
          if (!post.ok || !post.sample) {
            stop = {
              status: WorkflowStatus.Stale,
              error: workflowError('WORKFLOW_CONTEXT_CHANGED'),
            };
            break;
          }
          step.observedUrl = post.sample.url;
          step.observedHash = post.sample.contentHash;
          state.url = post.sample.url;
          state.hash = post.sample.contentHash;

          if (step.expectsNavigation) {
            let navigated = detectNavigation(urlBeforeStep, state.url);
            if (!navigated) {
              // One bounded re-check: navigations can land asynchronously.
              const recheck = await this.observeWithinBudget(workflowId);
              if (recheck.ok && recheck.sample) {
                navigated = detectNavigation(urlBeforeStep, recheck.sample.url);
                step.observedUrl = recheck.sample.url;
                step.observedHash = recheck.sample.contentHash;
                state.url = recheck.sample.url;
                state.hash = recheck.sample.contentHash;
              }
            }
            if (!navigated) {
              stop = {
                status: WorkflowStatus.Stale,
                error: workflowError('WORKFLOW_CONTEXT_CHANGED'),
                summary:
                  'The page did not navigate as the workflow expected, so it stopped.',
              };
              break;
            }
            if (
              step.expectedUrl &&
              !urlMatchesExpectation(state.url, step.expectedUrl)
            ) {
              stop = {
                status: WorkflowStatus.Stale,
                error: workflowError('WORKFLOW_CONTEXT_CHANGED'),
                summary:
                  'The page navigated somewhere other than the approved destination, so the workflow stopped.',
              };
              break;
            }
          } else if (detectNavigation(urlBeforeStep, state.url)) {
            stop = {
              status: WorkflowStatus.Stale,
              error: workflowError('WORKFLOW_CONTEXT_CHANGED'),
              summary:
                'The page navigated unexpectedly, so the workflow stopped.',
            };
            break;
          }
        }

        index += 1;
        workflow.currentStepIndex = index;
      }

      /* --- terminal handling ------------------------------------- */
      if (paused) {
        this.store.apply(workflowId, WorkflowEvent.Pause);
        this.store.appendEvent(workflowId, {
          type: WorkflowEventType.Paused,
          at: this.nowIso(),
          message: 'Workflow paused — no further step will start.',
        });
        return { ok: true, snapshot: { workflow: toWorkflowView(record) } };
      }

      if (stop) {
        await this.finishStopped(record, stop);
        return { ok: true, snapshot: this.snapshotWithRun(record) };
      }

      /* --- all steps done: verify the declared outcome ------------ */
      this.store.apply(workflowId, WorkflowEvent.BeginVerification);
      const finalObservation = await this.observeWithinBudget(workflowId);
      return {
        ok: true,
        snapshot: await this.finishVerified(
          record,
          finalObservation.ok ? finalObservation.sample : null,
        ),
      };
    } catch (error) {
      const failure = toWorkflowError(error);
      this.finishStoppedSync(record, {
        status: WorkflowStatus.Failed,
        error: failure,
      });
      return { ok: true, snapshot: this.snapshotWithRun(record) };
    } finally {
      for (const planId of activePlans) {
        actionSessionStore.dispose(planId);
        permissionLedger.revoke(planId);
      }
      if (isTerminalWorkflowStatus(record.workflow.status)) {
        this.store.releaseTab(workflowId);
        this.sessions.end(workflowId);
      }
    }
  }

  /* ---------------------------- helpers ---------------------------- */

  /** Re-bind a step's Phase 4 plan to the current freshness fields. */
  private bindStep(
    step: WorkflowStep,
    tabId: number,
    state: RunState,
  ): ActionPlan | null {
    const approvedActions = step.actionPlan.actions;
    if (hashActions(approvedActions) !== step.actionsHash) return null;

    const partial: ActionPlan = {
      planId: createRequestId('wrun'),
      requestId: step.actionPlan.requestId,
      tabId,
      url: state.url,
      contentHash: state.hash,
      actions: approvedActions,
      risk: step.actionPlan.risk,
      requiresConfirmation: step.actionPlan.requiresConfirmation,
      planHash: '',
      createdAt: this.nowIso(),
      expiresAt: new Date(
        this.now() + WORKFLOW_LIMITS.APPROVAL_TTL_MS,
      ).toISOString(),
    };
    partial.planHash = computePlanHash(partial);

    // The executable content must be exactly what was approved.
    if (hashActions(partial.actions) !== step.actionsHash) return null;
    return partial;
  }

  /** Execute one authorized step; failures become typed step results. */
  private async executeBoundStep(plan: ActionPlan): Promise<ActionStepResult> {
    const executed = await withTimeout(
      this.env.executeStep(plan.planId, plan.planHash),
      this.stepTimeoutMs,
    );
    if (executed === TIMED_OUT) {
      return failedStepResult(plan, 'failed', 'The step took too long and was stopped.');
    }
    if (!executed.ok) {
      return failedStepResult(
        plan,
        executionFailureStatus(executed.error.code),
        executed.error.message,
      );
    }
    const step = executed.result.steps[0];
    if (!step) {
      return failedStepResult(
        plan,
        'failed',
        'The step returned no result.',
      );
    }
    return step;
  }

  /** One bounded retry, allowed only by the action's retry policy. */
  private async retryStepOnce(
    record: WorkflowRecord,
    step: WorkflowStep,
    index: number,
    result: ActionStepResult,
    state: RunState,
    activePlans: string[],
  ): Promise<{ result: ActionStepResult; verified: StepVerificationResult } | null> {
    const workflowId = record.workflow.workflowId;
    const ranSuccessfully = result.status === 'success';
    const policy = step.retryPolicy;
    const allowed =
      policy === 'SAFE' || (policy === 'VERIFY_FIRST' && ranSuccessfully);
    if (!allowed) return null;
    if (step.attempts > WORKFLOW_LIMITS.MAX_STEP_RETRIES) return null;
    if (!this.sessions.consumeRetry(workflowId).ok) return null;

    this.store.appendEvent(workflowId, {
      type: WorkflowEventType.StepRetried,
      at: this.nowIso(),
      stepIndex: index,
      message: `Retrying once: ${result.message}`.slice(
        0,
        WORKFLOW_LIMITS.MAX_STEP_LABEL,
      ),
    });

    const bound = this.bindStep(step, record.workflow.tabId, state);
    if (!bound) return null;
    if (!this.env.authorizeStep(bound, workflowId)) return null;
    activePlans.push(bound.planId);

    step.attempts += 1;
    const retryResult = await this.executeBoundStep(bound);
    return { result: retryResult, verified: verifyStepResult(step, retryResult) };
  }

  private recordStepFailure(
    record: WorkflowRecord,
    step: WorkflowStep,
    index: number,
    verified: StepVerificationResult,
    result: ActionStepResult,
  ): StopReason {
    const { workflow } = record;
    step.status = verified.blocked
      ? WorkflowStepStatus.Blocked
      : WorkflowStepStatus.Failed;
    step.detail = verified.detail;
    step.result = result;
    step.finishedAt = this.nowIso();
    const error = workflowError(
      verified.errorCode ?? 'WORKFLOW_STEP_FAILED',
      verified.detail,
    );
    this.store.appendEvent(workflow.workflowId, {
      type: verified.blocked
        ? WorkflowEventType.Blocked
        : WorkflowEventType.StepFailed,
      at: step.finishedAt,
      stepIndex: index,
      message: verified.detail,
    });
    return {
      status: stopStatusFor(verified, record),
      error,
      failedStepIndex: index,
    };
  }

  /** One bounded observation; the refresh budget is enforced here. */
  private async observeWithinBudget(
    workflowId: string,
  ): Promise<{ ok: boolean; sample: ObservationSample | null }> {
    const budget = this.sessions.consumeRefresh(workflowId);
    if (!budget.ok) return { ok: false, sample: null };
    const sample = await this.observer.observe();
    if (sample) {
      this.store.appendEvent(workflowId, {
        type: WorkflowEventType.Observation,
        at: this.nowIso(),
        message: sample.title ?? sample.url,
      });
    }
    return { ok: true, sample };
  }

  /** Finish a run that stopped before completion (with a bounded replan). */
  private async finishStopped(
    record: WorkflowRecord,
    stop: StopReason,
  ): Promise<void> {
    this.finishStoppedSync(record, stop);
    await this.proposeFollowUp(record, stop);
  }

  private finishStoppedSync(record: WorkflowRecord, stop: StopReason): void {
    const { workflow } = record;
    const workflowId = workflow.workflowId;
    const done = countCompleted(workflow);

    if (stop.status === WorkflowStatus.Expired) {
      this.store.apply(workflowId, WorkflowEvent.Expire);
    } else if (stop.status === WorkflowStatus.Stale) {
      this.store.apply(workflowId, WorkflowEvent.Stale);
    } else if (stop.status === WorkflowStatus.Blocked) {
      this.store.apply(workflowId, WorkflowEvent.Block);
    } else if (stop.status === WorkflowStatus.Cancelled) {
      this.store.apply(workflowId, WorkflowEvent.Cancel);
    } else if (done > 0) {
      this.store.apply(workflowId, WorkflowEvent.PartiallyComplete);
    } else {
      this.store.apply(workflowId, WorkflowEvent.Fail);
    }

    const total = workflow.steps.length;
    workflow.summary = stop.summary ?? buildStopSummary(stop, done, total);
    workflow.outcome = {
      kind: workflow.expectedOutcome.kind,
      description: workflow.expectedOutcome.description,
      verified: false,
      detail: 'The declared outcome was not reached.',
    };
    this.store.appendEvent(workflowId, {
      type:
        stop.status === WorkflowStatus.Cancelled
          ? WorkflowEventType.Cancelled
          : stop.status === WorkflowStatus.Blocked
            ? WorkflowEventType.Blocked
            : WorkflowEventType.Failed,
      at: this.nowIso(),
      message: workflow.summary,
    });
  }

  /** Verify the declared outcome and close the workflow. */
  private async finishVerified(
    record: WorkflowRecord,
    observation: ObservationSample | null,
  ): Promise<WorkflowSnapshot> {
    const { workflow } = record;
    const verification = verifyWorkflowOutcome(workflow, observation);
    const outcome: WorkflowOutcome = verification.outcome;
    workflow.outcome = outcome;

    if (outcome.verified) {
      this.store.apply(workflow.workflowId, WorkflowEvent.Complete);
      workflow.summary = `Workflow completed — ${outcome.description}`;
      this.store.appendEvent(workflow.workflowId, {
        type: WorkflowEventType.Completed,
        at: this.nowIso(),
        message: workflow.summary,
      });
    } else {
      // Actions executed, outcome unverified: never reported as success.
      this.store.apply(workflow.workflowId, WorkflowEvent.PartiallyComplete);
      workflow.summary = `All steps ran, but the final outcome could not be verified. ${verification.detail}`;
      this.store.appendEvent(workflow.workflowId, {
        type: WorkflowEventType.Failed,
        at: this.nowIso(),
        message: workflow.summary,
      });
      await this.proposeFollowUp(record, {
        status: WorkflowStatus.Partial,
        error: workflowError(
          'WORKFLOW_VERIFICATION_FAILED',
          verification.detail,
        ),
        failedStepIndex: workflow.steps.length - 1,
      });
    }
    return this.snapshotWithRun(record, outcome);
  }

  private snapshotWithRun(
    record: WorkflowRecord,
    outcome?: WorkflowOutcome,
  ): WorkflowSnapshot {
    const { workflow } = record;
    const view = toWorkflowView(record);
    const steps: WorkflowStepView[] = view.steps;
    const currentOutcome: WorkflowOutcome =
      outcome ??
      workflow.outcome ?? {
        kind: workflow.expectedOutcome.kind,
        description: workflow.expectedOutcome.description,
        verified: false,
        detail: 'Not verified.',
      };
    const completed = workflow.status === WorkflowStatus.Completed;

    const run: WorkflowRunResult = {
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
      status: workflow.status,
      steps,
      outcome: currentOutcome,
      summary:
        workflow.summary ??
        `Workflow stopped after ${countCompleted(workflow)} of ${workflow.steps.length} steps.`,
      startedAt: workflow.startedAt ?? workflow.createdAt,
      finishedAt: workflow.finishedAt ?? this.nowIso(),
      ...(completed ? {} : { stoppedAt: workflow.currentStepIndex }),
    };

    const followUp = workflow.followUpWorkflowId
      ? this.store.get(workflow.followUpWorkflowId)
      : undefined;

    return {
      workflow: view,
      run: followUp ? { ...run, followUp: toWorkflowView(followUp) } : run,
    };
  }

  /**
   * Bounded replan attempt. The revised workflow is stored as a NEW
   * proposal in AWAITING_APPROVAL — it is never executed automatically
   * and never inherits the old approval.
   */
  private async proposeFollowUp(
    record: WorkflowRecord,
    stop: StopReason,
  ): Promise<void> {
    const { workflow } = record;
    if (!this.replanner) return;
    if (stop.failedStepIndex === undefined) return;
    if (!this.sessions.canReplan(workflow.workflowId)) return;
    if (record.replansUsed >= WORKFLOW_LIMITS.MAX_WORKFLOW_REPLANS) return;
    if (
      !isReplannable({
        errorCode: stop.error.code,
        step: workflow.steps[stop.failedStepIndex],
      })
    ) {
      return;
    }

    let context: PageContext | null = null;
    try {
      context = await this.env.capture(WORKFLOW_LIMITS.REPLAN_SECTIONS);
    } catch {
      return;
    }
    if (!context) return;

    const proposal = this.replanner({
      workflow,
      failedStepIndex: stop.failedStepIndex,
      context,
      tabId: workflow.tabId,
      requestId: workflow.requestId,
      now: new Date(this.now()),
      errorCode: stop.error.code,
    });
    if (!proposal) return;
    if (proposal.workflowHash === workflow.workflowHash) return;

    this.sessions.recordReplan(workflow.workflowId);
    record.replansUsed += 1;
    this.store.create(proposal);
    workflow.followUpWorkflowId = proposal.workflowId;
    this.store.appendEvent(workflow.workflowId, {
      type: WorkflowEventType.ReplanProposed,
      at: this.nowIso(),
      message: 'A revised plan is ready for your approval.',
    });
  }

  /** Stop a workflow before its run starts (stale approval path). */
  private stopBeforeRun(
    record: WorkflowRecord,
    code: 'WORKFLOW_TAB_CHANGED' | 'WORKFLOW_CONTEXT_CHANGED',
  ): SnapshotOutcome {
    const error = workflowError(code);
    this.store.apply(record.workflow.workflowId, WorkflowEvent.Stale);
    record.workflow.summary = error.message;
    this.store.appendEvent(record.workflow.workflowId, {
      type: WorkflowEventType.Failed,
      at: this.nowIso(),
      message: error.message,
    });
    this.store.releaseTab(record.workflow.workflowId);
    return { ok: false, error };
  }

  private isExpired(record: WorkflowRecord): boolean {
    const expiry = Date.parse(record.workflow.expiresAt);
    return Number.isFinite(expiry) && this.now() > expiry;
  }

  private isApprovalExpired(record: WorkflowRecord): boolean {
    const base = record.approvedAtMs ?? Date.parse(record.workflow.createdAt);
    if (!Number.isFinite(base)) return false;
    return this.now() - base > WORKFLOW_LIMITS.APPROVAL_TTL_MS;
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }
}

/* ------------------------------ helpers ---------------------------- */

const TIMED_OUT = Symbol('workflow-step-timeout');

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | typeof TIMED_OUT> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function failedStepResult(
  plan: ActionPlan,
  status: ActionStepResult['status'],
  message: string,
): ActionStepResult {
  const action = plan.actions[0];
  return {
    actionId: action?.stepId ?? plan.planId,
    kind: action?.action.type ?? 'READ_PAGE',
    status,
    message,
    durationMs: 0,
  };
}

function executionFailureStatus(
  code: string,
): ActionStepResult['status'] {
  switch (code) {
    case 'ACTION_SENSITIVE_FIELD':
    case 'ACTION_NOT_ALLOWED':
      return 'blocked';
    case 'ACTION_CONTEXT_STALE':
      return 'stale';
    case 'ACTION_CANCELLED':
      return 'cancelled';
    default:
      return 'failed';
  }
}

function isMutatingStep(step: WorkflowStep): boolean {
  const action = step.actionPlan.actions[0]?.action;
  if (!action) return false;
  return action.type !== 'FIND_TEXT' && action.type !== 'READ_PAGE';
}

function countCompleted(workflow: Workflow): number {
  return workflow.steps.filter(
    (step) => step.status === WorkflowStepStatus.Completed,
  ).length;
}

function stopStatusFor(
  verified: StepVerificationResult,
  record: WorkflowRecord,
): WorkflowStatus {
  if (verified.blocked) return WorkflowStatus.Blocked;
  if (verified.errorCode === 'WORKFLOW_CONTEXT_CHANGED') {
    return WorkflowStatus.Stale;
  }
  if (verified.errorCode === 'WORKFLOW_CANCELLED') {
    return WorkflowStatus.Cancelled;
  }
  return countCompleted(record.workflow) > 0
    ? WorkflowStatus.Partial
    : WorkflowStatus.Failed;
}

function buildStopSummary(
  stop: StopReason,
  done: number,
  total: number,
): string {
  const progress = `${done} of ${total} step${total === 1 ? '' : 's'}`;
  switch (stop.status) {
    case WorkflowStatus.Cancelled:
      return `Cancelled after ${progress}. Nothing after it ran.`;
    case WorkflowStatus.Blocked:
      return `Stopped: ${stop.error.message}${
        done > 0 ? ` (${progress} completed.)` : ''
      }`;
    case WorkflowStatus.Stale:
      return `${stop.error.message}${done > 0 ? ` (${progress} completed.)` : ''}`;
    case WorkflowStatus.Expired:
      return `Stopped (expired): ${stop.error.message}`;
    case WorkflowStatus.Failed:
      return `Stopped: ${stop.error.message} Nothing after it ran.`;
    default:
      return `${stop.error.message} Nothing after it ran (${progress} completed).`;
  }
}
