/**
 * Phase 5 — deterministic workflow identity.
 *
 * The workflow the user approves MUST be exactly the workflow that runs.
 * `computeWorkflowHash` covers the goal, the ordered step intents and
 * targets, each step's executable payload, the propagated risk, the
 * declared outcome, and the page binding (tab, URL, content hash).
 * Approving a workflow authorizes that exact identity — nothing else.
 *
 * The same canonicalization as the Phase 4 plan hash is used (sorted
 * keys, no whitespace), so both identities are derived the same way.
 */
import { canonicalize, hashActions } from '@/actions/planHash';
import { fnv1a32 } from '@/page-intelligence/hash';
import type { Workflow, WorkflowStep } from './types';

export { hashActions };

/** Canonical hash of one step's executable content (tamper binding). */
export function hashStepActions(step: {
  actionPlan: Pick<Workflow['steps'][number]['actionPlan'], 'actions'>;
}): string {
  return hashActions(step.actionPlan.actions);
}

/** The hashable identity of one step (page binding excluded: per-step). */
export function workflowStepIdentity(step: WorkflowStep) {
  return {
    index: step.index,
    intent: step.intent,
    actionsHash: step.actionsHash,
    expectsNavigation: step.expectsNavigation,
    expectedUrl: step.expectedUrl ?? null,
  };
}

/**
 * Deterministic hash of a workflow's binding fields. Volatile run-time
 * fields (status, attempts, results, observations) are deliberately not
 * part of it: an approval stays valid while the plan is unchanged, and
 * any material change produces a different hash and requires a new one.
 */
export function computeWorkflowHash(
  workflow: Pick<
    Workflow,
    | 'goal'
    | 'steps'
    | 'risk'
    | 'expectedOutcome'
    | 'tabId'
    | 'url'
    | 'contentHash'
  >,
): string {
  return fnv1a32(
    canonicalize({
      goal: workflow.goal,
      risk: workflow.risk,
      expectedOutcome: workflow.expectedOutcome,
      tabId: workflow.tabId,
      url: workflow.url,
      contentHash: workflow.contentHash,
      steps: workflow.steps.map((step) => ({
        ...workflowStepIdentity(step),
        actions: step.actionPlan.actions.map((planned) => planned.action),
      })),
    }),
  );
}

/**
 * True when the claimed hash matches both the stored workflow hash and a
 * fresh recomputation. The stored hash is written at creation time; the
 * recomputation catches any in-memory tampering.
 */
export function workflowHashMatches(
  workflow: Workflow,
  claimed: string,
): boolean {
  if (claimed !== workflow.workflowHash) return false;
  return computeWorkflowHash(workflow) === workflow.workflowHash;
}
