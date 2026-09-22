import type { ActionKind } from '@/actions/types';
import {
  WorkflowStatus,
  type WorkflowRunResult,
  type WorkflowStepView,
  type WorkflowView,
} from '@/workflows/types';
import { cn } from '@/shared/utilities/cn';
import { ICON_FOR_ACTION } from './actionIcons';
import { RiskBadge } from './RiskBadge';
import { StepStatusIcon } from './stepStatus';
import { IconCircleDot, IconSpinner, IconX } from './icons';
import {
  intentLabel,
  progressPercent,
  stepPositionLabel,
  stepStatusFor,
  stepStatusMeta,
  workflowCardClass,
  workflowStatusClass,
  workflowStatusLabel,
} from './workflowDisplay';

export interface WorkflowProgressCardProps {
  workflow: WorkflowView;
  /** Present once the run produced a terminal (or paused) result. */
  run?: WorkflowRunResult | null;
  /** True while the approved run is in flight. */
  running?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  /** A bounded replan produced a revised proposal for a new approval. */
  onOpenFollowUp?: (workflow: WorkflowView) => void;
  readOnly?: boolean;
  notice?: string | null;
}

function StepIcon({ step }: { step: WorkflowStepView }) {
  const Icon =
    step.kind !== undefined ? ICON_FOR_ACTION[step.kind as ActionKind] : null;
  return Icon ? (
    <Icon size={13} className="text-text-muted" />
  ) : (
    <IconCircleDot size={12} className="text-text-muted" />
  );
}

/**
 * Phase 5 — WORKFLOW PROGRESS + RESULT.
 *
 * Shows exactly where the run is ("Step 2 of 3"), what each step did, and
 * whether the declared outcome was actually verified. It never shows page
 * content, typed values, or hidden reasoning — only deterministic labels,
 * bounded messages, and boolean verification results. Partial completion
 * is labeled as such: actions that ran without a verified outcome are
 * never presented as success.
 */
export function WorkflowProgressCard({
  workflow,
  run = null,
  running = false,
  onPause,
  onResume,
  onCancel,
  onOpenFollowUp,
  readOnly = false,
  notice = null,
}: WorkflowProgressCardProps) {
  const total = workflow.steps.length;
  const completed = workflow.progress.completed;
  const status = workflow.status;
  const terminal =
    status === WorkflowStatus.Completed ||
    status === WorkflowStatus.Partial ||
    status === WorkflowStatus.Failed ||
    status === WorkflowStatus.Blocked ||
    status === WorkflowStatus.Cancelled ||
    status === WorkflowStatus.Stale ||
    status === WorkflowStatus.Expired;
  const active = running || status === WorkflowStatus.Running || status === WorkflowStatus.Verifying;
  const currentIndex = Math.min(workflow.currentStepIndex, Math.max(total - 1, 0));
  const outcome = run?.outcome ?? workflow.outcome ?? null;
  const followUp = run?.followUp ?? null;

  const title = active
    ? 'Workflow running'
    : status === WorkflowStatus.Paused
      ? 'Workflow paused'
      : 'Workflow result';

  return (
    <div
      className={workflowCardClass}
      role="group"
      aria-label={active ? 'Running workflow' : 'Workflow result'}
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {active ? (
            <IconSpinner size={15} className="text-accent" />
          ) : status === WorkflowStatus.Completed ? (
            <IconCircleDot size={15} className="cl-step-success" />
          ) : status === WorkflowStatus.Paused ? (
            <IconCircleDot size={15} className="cl-step-blocked" />
          ) : (
            <IconX size={15} className={workflowStatusClass(status)} />
          )}
          <h3 className="text-[12.5px] font-semibold text-text-primary">
            {title}
          </h3>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'text-[10px] font-semibold uppercase tracking-[0.04em]',
              workflowStatusClass(status),
            )}
          >
            {workflowStatusLabel(status)}
          </span>
          <RiskBadge risk={workflow.risk} short />
        </div>
      </div>

      <p className="mt-2 text-[11.5px] leading-4.5 text-text-secondary">
        <span className="text-text-muted">Goal: </span>
        {workflow.goal}
      </p>

      <div className="mt-2.5">
        <p className="text-[10.5px] text-text-muted">
          {total > 0 ? stepPositionLabel(currentIndex, total) : 'No steps'} ·{' '}
          {completed} of {total} completed
        </p>
        <div
          className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface"
          role="progressbar"
          aria-label="Workflow progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={completed}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${progressPercent(completed, total)}%` }}
          />
        </div>
      </div>

      <ol
        className="mt-3 flex flex-col gap-1.5"
        aria-label={`Workflow steps (${total})`}
      >
        {workflow.steps.map((step) => {
          const display = stepStatusFor(step.status);
          const meta = stepStatusMeta(display);
          return (
            <li
              key={step.stepId}
              className="flex items-start gap-2.5 rounded-[var(--cl-radius-sm)] bg-surface px-2.5 py-2"
            >
              <span className="mt-[2px] flex-none">
                <StepStatusIcon status={display} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                  <span>
                    {stepPositionLabel(step.index, total)} ·{' '}
                    {intentLabel(step.intent)}
                  </span>
                  <StepIcon step={step} />
                  <span className="sr-only">{meta.title}</span>
                </span>
                <span
                  className={cn(
                    'mt-0.5 block text-[12px] font-medium leading-[1.45]',
                    display === 'pending'
                      ? 'text-text-muted'
                      : 'text-text-primary',
                  )}
                >
                  {step.label}
                </span>
                {step.message && step.status !== 'PENDING' && (
                  <span className="mt-0.5 block text-[10.5px] leading-4 text-text-muted">
                    {step.message}
                  </span>
                )}
                {step.detail && (
                  <span className={cn('mt-0.5 block text-[10.5px]', meta.className)}>
                    Verified: {step.detail}
                  </span>
                )}
                {step.data?.kind === 'FIND_TEXT' && (
                  <span className="mt-1 block">
                    {step.data.matches.map((match) => (
                      <span
                        key={match.index}
                        className="mt-0.5 block truncate text-[10.5px] text-text-secondary"
                        title={match.snippet}
                      >
                        {match.index}. {match.snippet}
                      </span>
                    ))}
                  </span>
                )}
                {step.data?.kind === 'READ_PAGE' && (
                  <span className="mt-1 block text-[10.5px] text-text-secondary">
                    {step.data.stats}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      {outcome && (run || terminal) && (
        <div className="mt-3 rounded-[var(--cl-radius-sm)] border border-border px-2.5 py-2">
          <p
            className={cn(
              'text-[11px] font-medium leading-4',
              outcome.verified ? 'cl-step-success' : 'cl-step-blocked',
            )}
          >
            {outcome.verified
              ? `Outcome verified — ${outcome.description}`
              : `Outcome not verified — ${outcome.description}`}
          </p>
          <p className="mt-0.5 text-[10.5px] leading-4 text-text-muted">
            {outcome.detail}
          </p>
        </div>
      )}

      {workflow.summary && !active && (
        <p
          className={cn(
            'mt-2.5 text-[11px] leading-4',
            status === WorkflowStatus.Completed
              ? 'text-text-secondary'
              : status === WorkflowStatus.Partial
                ? 'text-warning'
                : 'text-error',
          )}
        >
          {workflow.summary}
        </p>
      )}

      {followUp && onOpenFollowUp && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-[var(--cl-radius-sm)] bg-surface px-2.5 py-2">
          <span className="text-[10.5px] leading-4 text-text-secondary">
            A revised {followUp.steps.length}-step proposal is ready. It needs
            your approval before anything runs.
          </span>
          <button
            type="button"
            onClick={() => onOpenFollowUp(followUp)}
            className="btn-secondary h-7 flex-none gap-1 px-2 text-[11px]"
          >
            Review
          </button>
        </div>
      )}

      {notice && (
        <p role="alert" className="mt-2.5 text-[11px] leading-4 text-error">
          {notice}
        </p>
      )}

      {!readOnly && !terminal && (
        <div className="mt-3 flex items-center gap-2">
          {status === WorkflowStatus.Paused ? (
            <button
              type="button"
              onClick={onResume}
              className="btn-primary h-8 flex-1 text-xs"
            >
              Resume
            </button>
          ) : (
            <button
              type="button"
              onClick={onPause}
              disabled={!workflow.canPause}
              className="btn-secondary h-8 flex-1 text-xs"
            >
              Pause
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            disabled={!workflow.canCancel}
            className="btn-secondary h-8 flex-1 text-xs"
          >
            Cancel workflow
          </button>
        </div>
      )}
    </div>
  );
}
