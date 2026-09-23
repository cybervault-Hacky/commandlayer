/**
 * Phase 5 — bounded, observation-based replanning.
 *
 * Replanning is deliberately narrow, deterministic, and never automatic:
 *
 *   step fails → observe (bounded) → at most ONE revised proposal →
 *   validate → NEW approval required
 *
 * Rules enforced here:
 * - a replan is only produced for failures that a fresh page observation
 *   could actually fix (a target that moved, a read-only step whose
 *   evidence disappeared) — never for blocked/sensitive failures, never
 *   for tab changes, never for cancellations
 * - a revised plan is never executed under the old approval: it becomes a
 *   NEW workflow with a NEW hash that must be approved again
 * - a replan identical to the failed workflow is refused (no loops)
 * - steps that already completed are carried over as SKIPPED so no
 *   completed work is repeated
 */
import type { PageContext } from '@/shared/types/page';
import { computeWorkflowHash } from './hash';
import { WORKFLOW_LIMITS } from './limits';
import { planWorkflow } from './planner';
import type { WorkflowErrorCode } from './errors';
import {
  WorkflowStatus,
  WorkflowStepStatus,
  type Workflow,
  type WorkflowStep,
} from './types';

export interface ReplanInput {
  workflow: Workflow;
  failedStepIndex: number;
  /** Refreshed page context captured at the failure checkpoint. */
  context: PageContext;
  tabId: number;
  requestId: string;
  now: Date;
  /** User-safe reason the step stopped. */
  errorCode: WorkflowErrorCode;
}

export type WorkflowReplanner = (input: ReplanInput) => Workflow | null;

/** Failures that a fresh observation may legitimately fix. */
const REPLANNABLE_CODES: ReadonlySet<WorkflowErrorCode> = new Set([
  'WORKFLOW_TARGET_NOT_FOUND',
  'WORKFLOW_VERIFICATION_FAILED',
]);

export function isReplannable(input: {
  errorCode: WorkflowErrorCode;
  step: WorkflowStep | undefined;
}): boolean {
  if (!REPLANNABLE_CODES.has(input.errorCode)) return false;
  const action = input.step?.actionPlan.actions[0]?.action;
  if (!action) return false;
  // Only identification steps may trigger a replan. Mutating steps that
  // failed are never re-planned automatically.
  if (action.type === 'FIND_TEXT' || action.type === 'READ_PAGE') return true;
  return (
    action.type === 'CLICK_ELEMENT' &&
    input.step?.expectsNavigation === true &&
    input.errorCode === 'WORKFLOW_TARGET_NOT_FOUND'
  );
}

/**
 * The default replanner: replan the same goal against the REFRESHED page
 * context, carrying completed steps over as SKIPPED. Returns null when no
 * new proposal is possible (identical plan, no remaining steps, or the
 * refreshed context no longer supports the goal).
 */
export function createDeterministicReplanner(): WorkflowReplanner {
  return (input) => {
    const planned = planWorkflow({
      goal: input.workflow.goal,
      requestId: input.requestId,
      context: input.context,
      tabId: input.tabId,
      now: input.now,
    });
    const revision = planned.workflow;
    if (!revision) return null;

    // Carry over already-completed work: a step with identical executable
    // content is marked SKIPPED instead of running again.
    const completedHashes = new Set(
      input.workflow.steps
        .filter((step) => step.status === WorkflowStepStatus.Completed)
        .map((step) => step.actionsHash),
    );

    const steps: WorkflowStep[] = revision.steps.map((step, index) => ({
      ...step,
      index,
      status: completedHashes.has(step.actionsHash)
        ? WorkflowStepStatus.Skipped
        : WorkflowStepStatus.Pending,
    }));

    if (!steps.some((step) => step.status === WorkflowStepStatus.Pending)) {
      return null; // nothing left to do — do not propose an empty run
    }

    const risk = revision.risk;
    const hashInput = {
      goal: revision.goal,
      steps,
      risk,
      tabId: revision.tabId,
      url: revision.url,
      contentHash: revision.contentHash,
      expectedOutcome: revision.expectedOutcome,
    };
    const workflowHash = computeWorkflowHash(hashInput);

    // An identical plan means the failure was not fixable by replanning.
    if (workflowHash === input.workflow.workflowHash) return null;

    return {
      ...revision,
      steps,
      status: WorkflowStatus.Draft,
      workflowHash,
      revision: input.workflow.revision + 1,
      approvedAt: undefined,
      startedAt: undefined,
      finishedAt: undefined,
      currentStepIndex: 0,
      maxSteps: WORKFLOW_LIMITS.MAX_WORKFLOW_STEPS,
    };
  };
}
