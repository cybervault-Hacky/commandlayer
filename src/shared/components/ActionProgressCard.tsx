import { ActionRisk } from '@/actions/types';
import type {
  ActionExecutionResult,
  ActionPlan,
  ActionStepResult,
  StepStatus,
} from '@/actions/types';
import { cn } from '@/shared/utilities/cn';
import {
  IconAlertTriangle,
  IconCheckCircle,
  IconCircle,
  IconShieldCheck,
  IconSpinner,
  IconX,
} from './icons';

export interface ActionProgressCardProps {
  /** The plan being executed (previews while running). */
  plan: ActionPlan | null;
  /** Present once the execution has finished. */
  execution: ActionExecutionResult | null;
  /** True while the execution is in flight. */
  running?: boolean;
}

interface StepDisplay {
  key: string;
  label: string;
  status: StepStatus | 'pending' | 'running';
  /** Executed-step outcome wording (never carries typed values). */
  message?: string;
  detail?: string;
  data?: ActionStepResult['data'];
}

function statusMeta(
  status: StepDisplay['status'],
): { className: string; title: string } {
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

function StepIcon({ status }: { status: StepDisplay['status'] }) {
  switch (status) {
    case 'success':
      return <IconCheckCircle size={14} className="cl-step-success" />;
    case 'failed':
      return <IconAlertTriangle size={14} className="cl-step-failed" />;
    case 'blocked':
      return <IconShieldCheck size={14} className="cl-step-blocked" />;
    case 'stale':
      return <IconAlertTriangle size={14} className="cl-step-stale" />;
    case 'cancelled':
    case 'skipped':
      return <IconX size={14} className="cl-step-cancelled" />;
    case 'running':
      return <IconSpinner size={14} className="cl-step-running" />;
    default:
      return <IconCircle size={14} className="cl-step-pending" />;
  }
}

/**
 * Phase 4 — EXECUTION + VERIFICATION display. ✓ done · ● running · ○
 * pending. Verification details are boolean/state only — values are
 * never shown. Nothing renders unless the plan was explicitly approved.
 */
export function ActionProgressCard({
  plan,
  execution,
  running = false,
}: ActionProgressCardProps) {
  const steps: StepDisplay[] = execution
    ? execution.steps.map((step: ActionStepResult, index) => {
        const preview = plan?.actions[index]?.preview ?? step.message;
        return {
          key: step.actionId,
          label: preview,
          status: step.status,
          ...(step.message ? { message: step.message } : {}),
          ...(step.verification
            ? { detail: step.verification.detail }
            : {}),
          ...(step.data ? { data: step.data } : {}),
        };
      })
    : (plan?.actions ?? []).map((step, index) => ({
        key: step.stepId,
        label: step.preview,
        status: running && index === 0 ? 'running' : 'pending',
      }));

  const summary = execution?.summary ?? (running ? 'Executing…' : '');
  const overall = execution?.status;

  return (
    <div
      className="cl-action-card cl-enter"
      role="group"
      aria-label={running ? 'Running action plan' : 'Action plan result'}
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {running ? (
            <IconSpinner size={15} className="text-accent" />
          ) : overall === 'completed' ? (
            <IconCheckCircle size={15} className="cl-step-success" />
          ) : overall === 'blocked' ? (
            <IconShieldCheck size={15} className="cl-step-blocked" />
          ) : (
            <IconAlertTriangle size={15} className="cl-step-failed" />
          )}
          <h3 className="text-[12.5px] font-semibold text-text-primary">
            {running ? 'Running action' : 'Action result'}
          </h3>
        </div>
        {plan && (
          <span
            className={cn(
              'cl-risk-badge',
              plan.risk === ActionRisk.ReadOnly
                ? 'cl-risk-readonly'
                : plan.risk === ActionRisk.Low
                  ? 'cl-risk-low'
                  : 'cl-risk-confirm',
            )}
          >
            {plan.risk === ActionRisk.ReadOnly
              ? 'Read-only'
              : plan.risk === ActionRisk.Low
                ? 'Low risk'
                : 'Confirmed'}
          </span>
        )}
      </div>

      <ol className="mt-3 flex flex-col gap-1.5" aria-label="Execution progress">
        {steps.map((step, index) => {
          const meta = statusMeta(step.status);
          return (
            <li
              key={step.key}
              className="flex items-start gap-2.5 rounded-[var(--cl-radius-sm)] bg-surface px-2.5 py-2"
            >
              <span className="mt-[1px] flex-none">
                <StepIcon status={step.status} />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block text-[12px] font-medium leading-[1.45]',
                    step.status === 'pending'
                      ? 'text-text-muted'
                      : 'text-text-primary',
                  )}
                >
                  {index + 1}. {step.label}
                </span>
                {step.message &&
                  step.status !== 'pending' &&
                  step.message !== step.label && (
                    <span className="mt-0.5 block text-[10.5px] text-text-muted">
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
                    {step.data.topHeadings.length > 0 && (
                      <span className="mt-0.5 block truncate text-text-muted">
                        {step.data.topHeadings.join(' · ')}
                      </span>
                    )}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      {summary && (
        <p
          className={cn(
            'mt-3 text-[11px] leading-4',
            overall === 'completed'
              ? 'text-text-secondary'
              : overall === 'blocked' || overall === 'stale'
                ? 'text-warning'
                : 'text-error',
          )}
        >
          {summary}
        </p>
      )}
    </div>
  );
}
