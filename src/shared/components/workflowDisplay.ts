import { cn } from '@/shared/utilities/cn';
import {
  WorkflowIntent,
  WorkflowStatus,
  WorkflowStepStatus,
  type WorkflowStepStatus as WorkflowStepStatusType,
} from '@/workflows/types';
import type { StepStatus } from './stepStatus';

/** Fixed label + CSS class for one display status (shared wording). */
export function stepStatusMeta(status: StepStatus): {
  className: string;
  title: string;
} {
  switch (status) {
    case 'success':
      return { className: 'cl-step-success', title: 'Done' };
    case 'failed':
      return { className: 'cl-step-failed', title: 'Failed' };
    case 'blocked':
      return { className: 'cl-step-blocked', title: 'Blocked' };
    case 'stale':
      return { className: 'cl-step-stale', title: 'Stopped — page changed' };
    case 'cancelled':
      return { className: 'cl-step-cancelled', title: 'Cancelled' };
    case 'skipped':
      return { className: 'cl-step-skipped', title: 'Skipped' };
    case 'running':
      return { className: 'cl-step-running', title: 'Running' };
    default:
      return { className: 'cl-step-pending', title: 'Pending' };
  }
}

/** Progress-display status for one workflow step. */
export function stepStatusFor(
  status: WorkflowStepStatusType,
): StepStatus {
  switch (status) {
    case WorkflowStepStatus.Completed:
      return 'success';
    case WorkflowStepStatus.Failed:
      return 'failed';
    case WorkflowStepStatus.Blocked:
      return 'blocked';
    case WorkflowStepStatus.Skipped:
      return 'skipped';
    case WorkflowStepStatus.Running:
      return 'running';
    default:
      return 'pending';
  }
}

/** Fixed wording for a workflow-level status (never content-supplied). */
export function workflowStatusLabel(status: WorkflowStatus): string {
  switch (status) {
    case WorkflowStatus.Draft:
      return 'Draft';
    case WorkflowStatus.Preview:
      return 'Preview';
    case WorkflowStatus.AwaitingApproval:
      return 'Awaiting approval';
    case WorkflowStatus.Approved:
      return 'Approved';
    case WorkflowStatus.Running:
      return 'Running';
    case WorkflowStatus.Paused:
      return 'Paused';
    case WorkflowStatus.Verifying:
      return 'Verifying';
    case WorkflowStatus.Completed:
      return 'Completed';
    case WorkflowStatus.Partial:
      return 'Partial — outcome unverified';
    case WorkflowStatus.Failed:
      return 'Failed';
    case WorkflowStatus.Blocked:
      return 'Blocked';
    case WorkflowStatus.Cancelled:
      return 'Cancelled';
    case WorkflowStatus.Stale:
      return 'Stopped — page changed';
    case WorkflowStatus.Expired:
      return 'Expired';
  }
}

export function workflowStatusTone(
  status: WorkflowStatus,
): 'success' | 'warning' | 'error' | 'muted' | 'accent' {
  switch (status) {
    case WorkflowStatus.Completed:
      return 'success';
    case WorkflowStatus.Running:
    case WorkflowStatus.Verifying:
    case WorkflowStatus.Approved:
      return 'accent';
    case WorkflowStatus.Partial:
    case WorkflowStatus.Blocked:
    case WorkflowStatus.Stale:
    case WorkflowStatus.Expired:
    case WorkflowStatus.Paused:
      return 'warning';
    case WorkflowStatus.Failed:
      return 'error';
    default:
      return 'muted';
  }
}

export function workflowStatusClass(status: WorkflowStatus): string {
  switch (workflowStatusTone(status)) {
    case 'success':
      return 'cl-step-success';
    case 'accent':
      return 'cl-step-running';
    case 'warning':
      return 'cl-step-blocked';
    case 'error':
      return 'cl-step-failed';
    default:
      return 'cl-step-pending';
  }
}

export function intentLabel(intent: WorkflowIntent): string {
  switch (intent) {
    case WorkflowIntent.Identify:
      return 'Identify';
    case WorkflowIntent.Find:
      return 'Find';
    case WorkflowIntent.Read:
      return 'Read';
    case WorkflowIntent.Open:
      return 'Open';
    case WorkflowIntent.Type:
      return 'Type';
    case WorkflowIntent.Select:
      return 'Select';
    case WorkflowIntent.Scroll:
      return 'Scroll';
  }
}

/** "Step 1 of 3" — never an ordinal the content can influence. */
export function stepPositionLabel(index: number, total: number): string {
  return `Step ${index + 1} of ${total}`;
}

export function progressPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}

export const workflowCardClass = cn('cl-action-card', 'cl-workflow-card');
