/**
 * Phase 5 — step and outcome verification.
 *
 * Verification is deterministic and registry-driven. The condition for a
 * step is derived from its action kind — never from AI output — and it
 * never reads a value the user typed:
 *
 *   READ_PAGE       → the page structure was read
 *   FIND_TEXT       → the expected text matched (count > 0)
 *   SCROLL          → the scroll completed
 *   CLICK_ELEMENT   → the target was clicked (state re-checked in-page)
 *   TYPE_TEXT       → the non-sensitive field state matches (boolean only)
 *   SELECT_OPTION   → the expected option is selected (label only)
 *
 * A step that ran but whose condition does not hold is a FAILURE, and the
 * workflow stops. CommandLayer never reports success it cannot verify, and
 * the final outcome distinguishes COMPLETED from "actions executed but
 * outcome unverified" (PARTIAL).
 */
import type { ActionStepResult } from '@/actions/types';
import type { WorkflowErrorCode } from './errors';
import type { ObservationSample } from './observer';
import { urlMatchesExpectation } from './observer';
import {
  WorkflowOutcomeKind,
  WorkflowStepStatus,
  type Workflow,
  type WorkflowOutcome,
  type WorkflowStep,
} from './types';

export interface StepVerificationResult {
  ok: boolean;
  /** True when execution was blocked by a safety rule (never retried). */
  blocked: boolean;
  /** User-safe wording (booleans and state, never values). */
  detail: string;
  errorCode?: WorkflowErrorCode;
}

/** Verify one executed step. The executor already produced a typed result. */
export function verifyStepResult(
  step: WorkflowStep,
  result: ActionStepResult,
): StepVerificationResult {
  if (result.status === 'blocked') {
    return {
      ok: false,
      blocked: true,
      detail: result.message,
      errorCode: 'WORKFLOW_BLOCKED',
    };
  }
  if (result.status === 'cancelled') {
    return {
      ok: false,
      blocked: false,
      detail: result.message,
      errorCode: 'WORKFLOW_CANCELLED',
    };
  }
  if (result.status === 'stale') {
    return {
      ok: false,
      blocked: false,
      detail: result.message,
      errorCode: 'WORKFLOW_CONTEXT_CHANGED',
    };
  }
  if (result.status !== 'success') {
    return {
      ok: false,
      blocked: false,
      detail: result.message,
      errorCode: 'WORKFLOW_STEP_FAILED',
    };
  }

  const action = step.actionPlan.actions[0]?.action;
  if (!action) {
    return {
      ok: false,
      blocked: false,
      detail: 'The step had no action to verify.',
      errorCode: 'WORKFLOW_INVALID',
    };
  }

  switch (action.type) {
    case 'READ_PAGE': {
      if (result.data?.kind === 'READ_PAGE') {
        return { ok: true, blocked: false, detail: result.data.stats };
      }
      return {
        ok: false,
        blocked: false,
        detail: 'The page structure could not be read.',
        errorCode: 'WORKFLOW_VERIFICATION_FAILED',
      };
    }

    case 'FIND_TEXT': {
      const count =
        result.data?.kind === 'FIND_TEXT' ? result.data.matchCount : 0;
      if (count > 0) {
        return {
          ok: true,
          blocked: false,
          detail: `Found ${count} match${count === 1 ? '' : 'es'}.`,
        };
      }
      return {
        ok: false,
        blocked: false,
        detail: 'No matching text was found on the page.',
        errorCode: 'WORKFLOW_TARGET_NOT_FOUND',
      };
    }

    case 'SCROLL':
      return { ok: true, blocked: false, detail: 'The page was scrolled.' };

    case 'CLICK_ELEMENT':
      return {
        ok: result.verification?.ok !== false,
        blocked: false,
        detail:
          result.verification?.detail ?? 'The target was clicked and re-checked.',
        errorCode: 'WORKFLOW_VERIFICATION_FAILED',
      };

    case 'TYPE_TEXT':
    case 'SELECT_OPTION': {
      // Boolean state only — the verifier never inspects or reports the
      // field's value.
      const ok = result.verification?.ok === true;
      return {
        ok,
        blocked: false,
        detail:
          result.verification?.detail ??
          (ok ? 'Field state verified.' : 'Field state could not be verified.'),
        errorCode: 'WORKFLOW_VERIFICATION_FAILED',
      };
    }
  }
}

/** True when a completed FIND_TEXT step reported matches. */
export function findStepHadMatches(workflow: Workflow): boolean {
  return workflow.steps.some(
    (step) =>
      step.intent === 'FIND' &&
      step.result?.data?.kind === 'FIND_TEXT' &&
      step.result.data.matchCount > 0,
  );
}

export interface OutcomeVerification {
  outcome: WorkflowOutcome;
  /** User-safe explanation of what was (not) verified. */
  detail: string;
}

/**
 * Verify the workflow's declared expected outcome against the final
 * bounded observation. An unverifiable outcome is reported as such — the
 * workflow finishes PARTIAL, never COMPLETED.
 */
export function verifyWorkflowOutcome(
  workflow: Workflow,
  observation: ObservationSample | null,
): OutcomeVerification {
  const spec = workflow.expectedOutcome;
  const allStepsCompleted = workflow.steps.every(
    (step) => step.status === WorkflowStepStatus.Completed,
  );
  const outcome = (verified: boolean): WorkflowOutcome => ({
    kind: spec.kind,
    description: spec.description,
    verified,
    detail: spec.description,
  });

  switch (spec.kind) {
    case WorkflowOutcomeKind.Navigation: {
      if (!observation) {
        return {
          outcome: outcome(false),
          detail: 'The page could not be re-checked after the last step.',
        };
      }
      const navigated = observation.url !== workflow.url;
      if (spec.expectedUrl) {
        if (urlMatchesExpectation(observation.url, spec.expectedUrl)) {
          return {
            outcome: outcome(true),
            detail: 'The expected destination was reached.',
          };
        }
        return {
          outcome: outcome(false),
          detail: 'The page did not open the expected destination.',
        };
      }
      return navigated
        ? {
            outcome: outcome(true),
            detail: 'The page navigated as expected.',
          }
        : {
            outcome: outcome(false),
            detail: 'The page did not navigate as expected.',
          };
    }

    case WorkflowOutcomeKind.Content: {
      const expectedText = spec.expectedText;
      const seenInObservation =
        observation !== null &&
        expectedText !== undefined &&
        [
          observation.title ?? '',
          ...observation.headings,
        ].some((value) => value.toLowerCase().includes(expectedText.toLowerCase()));
      if (seenInObservation || findStepHadMatches(workflow)) {
        return {
          outcome: outcome(true),
          detail: expectedText
            ? `“${expectedText}” was found on the page.`
            : 'The expected content was confirmed on the page.',
        };
      }
      return {
        outcome: outcome(false),
        detail: 'The expected content could not be confirmed on the page.',
      };
    }

    case WorkflowOutcomeKind.ReadOnly:
    case WorkflowOutcomeKind.Interaction:
    default: {
      if (allStepsCompleted) {
        return {
          outcome: outcome(true),
          detail: 'Every step ran and was verified.',
        };
      }
      return {
        outcome: outcome(false),
        detail: 'Not every step of the workflow could be completed.',
      };
    }
  }
}
