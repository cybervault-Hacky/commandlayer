import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { ActionKind } from '@/actions/types';
import type { WorkflowStepView, WorkflowView } from '@/workflows/types';
import { cn } from '@/shared/utilities/cn';
import { ICON_FOR_ACTION } from './actionIcons';
import { RiskBadge } from './RiskBadge';
import { IconCircleDot, IconShieldCheck } from './icons';
import {
  intentLabel,
  stepPositionLabel,
  workflowCardClass,
} from './workflowDisplay';

export interface WorkflowPreviewCardProps {
  workflow: WorkflowView;
  onApprove: () => void;
  onCancel: () => void;
  /** Read-only rendering (e.g. inside the session transcript). */
  readOnly?: boolean;
  /** Inline, user-safe notice (e.g. a rejected approval attempt). */
  notice?: string | null;
}

function StepIcon({ step }: { step: WorkflowStepView }): ReactElement {
  const Icon =
    step.kind !== undefined ? ICON_FOR_ACTION[step.kind as ActionKind] : null;
  return Icon ? (
    <Icon size={14} className="text-text-secondary" />
  ) : (
    <IconCircleDot size={13} className="text-text-muted" />
  );
}

/**
 * Phase 5 — WORKFLOW PREVIEW.
 *
 * Shows the bounded task before anything runs: the goal, what "done"
 * means, and every step in order with its deterministic label and risk.
 * Approving sends only the workflow identity; the background re-checks
 * the hash, the tab binding, and the one-workflow-per-tab rule before the
 * first step executes. Nothing is remembered after the session.
 */
export function WorkflowPreviewCard({
  workflow,
  onApprove,
  onCancel,
  readOnly = false,
  notice = null,
}: WorkflowPreviewCardProps) {
  const approveRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!readOnly) approveRef.current?.focus();
  }, [readOnly, workflow.workflowId]);

  const handleCancelKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === 'Tab' && event.shiftKey) {
      event.preventDefault();
      approveRef.current?.focus();
    }
  };

  const handleApproveKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      cancelRef.current?.focus();
    }
  };

  const total = workflow.steps.length;

  return (
    <div
      className={workflowCardClass}
      role="group"
      aria-label="Workflow preview"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <IconShieldCheck size={15} className="text-accent" />
          <h3 className="text-[12.5px] font-semibold text-text-primary">
            Workflow preview
          </h3>
        </div>
        <RiskBadge risk={workflow.risk} />
      </div>

      <p className="mt-2 text-[11.5px] leading-4.5 text-text-secondary">
        <span className="text-text-muted">Goal: </span>
        {workflow.goal}
      </p>
      <p className="mt-1 text-[11px] leading-4 text-text-muted">
        Done when: {workflow.expectedOutcome}
      </p>

      <ol
        className="mt-3 flex flex-col gap-1.5"
        aria-label={`Workflow steps (${total})`}
      >
        {workflow.steps.map((step) => (
          <li
            key={step.stepId}
            className="flex items-start gap-2.5 rounded-[var(--cl-radius-sm)] bg-surface px-2.5 py-2"
          >
            <span className="mt-[1px] flex-none">
              <StepIcon step={step} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                {stepPositionLabel(step.index, total)} ·{' '}
                {intentLabel(step.intent)}
              </span>
              <span className="mt-0.5 block text-[12px] font-medium leading-[1.45] text-text-primary">
                {step.label}
              </span>
              {step.previews
                ?.filter((preview) => preview !== step.label)
                .map((preview, index) => (
                  <span
                    key={`${step.stepId}-preview-${index}`}
                    className="mt-0.5 block break-words text-[10.5px] leading-4 text-text-secondary"
                  >
                    {preview}
                  </span>
                ))}
              {step.kind === ActionKind.ClickElement ? (
                <span className="mt-0.5 block text-[10.5px] text-text-muted">
                  Expected to open a new destination in this tab.
                </span>
              ) : null}
            </span>
            <span className="mt-[1px] flex-none">
              {step.retryPolicy === 'SAFE' || step.retryPolicy === 'VERIFY_FIRST' ? (
                <span className="text-[9.5px] font-medium uppercase tracking-[0.04em] text-text-muted">
                  retry-safe
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>

      {notice ? (
        <p role="alert" className="mt-3 text-[11px] leading-4 text-error">
          {notice}
        </p>
      ) : null}

      {!readOnly ? (
        <>
          <p className="mt-3 text-[10.5px] leading-4 text-text-muted">
            Nothing runs until you approve. Steps run one at a time, and you
            can pause or cancel at any point.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              ref={approveRef}
              onClick={onApprove}
              onKeyDown={handleApproveKeyDown}
              className="btn-primary h-8 flex-1 text-xs"
            >
              Approve &amp; run
            </button>
            <button
              type="button"
              ref={cancelRef}
              onClick={onCancel}
              onKeyDown={handleCancelKeyDown}
              className={cn('btn-secondary h-8 flex-1 text-xs')}
            >
              Cancel
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
