import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { ActionRisk } from '@/actions/types';
import type { ActionKind, ActionPlan } from '@/actions/types';
import { cn } from '@/shared/utilities/cn';
import {
  IconClickAction,
  IconFindText,
  IconPlay,
  IconReadPage,
  IconScrollAction,
  IconSelectAction,
  IconShieldCheck,
  IconTypeAction,
  IconX,
  type IconProps,
} from './icons';

export interface ActionPreviewCardProps {
  plan: ActionPlan;
  onApprove: () => void;
  onCancel: () => void;
  /** Read-only rendering (e.g. inside the session transcript). */
  readOnly?: boolean;
}

const ACTION_ICONS: Record<ActionKind, (props: IconProps) => ReactElement> = {
  READ_PAGE: IconReadPage,
  SCROLL: IconScrollAction,
  FIND_TEXT: IconFindText,
  CLICK_ELEMENT: IconClickAction,
  TYPE_TEXT: IconTypeAction,
  SELECT_OPTION: IconSelectAction,
};

function riskMeta(risk: ActionRisk): { label: string; className: string } {
  switch (risk) {
    case ActionRisk.ReadOnly:
      return { label: 'Read-only', className: 'cl-risk-readonly' };
    case ActionRisk.Low:
      return { label: 'Low risk', className: 'cl-risk-low' };
    default:
      return { label: 'Requires confirmation', className: 'cl-risk-confirm' };
  }
}

/**
 * Phase 4 — ACTION PREVIEW. Shows exactly what will run (steps, targets,
 * values, risk) before anything executes. Approval is an explicit button
 * press; "yes"/"do it" in the command box never grants permission.
 */
export function ActionPreviewCard({
  plan,
  onApprove,
  onCancel,
  readOnly = false,
}: ActionPreviewCardProps) {
  const approveRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  // Focus management: the primary action receives focus on mount.
  useEffect(() => {
    if (!readOnly) approveRef.current?.focus();
  }, [readOnly, plan.planId]);

  // Keyboard support: Escape withdraws the proposal; Tab stays trapped
  // between the two decision buttons while the card is pending.
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

  const risk = riskMeta(plan.risk);
  const count = plan.actions.length;

  return (
    <div
      className="cl-action-card cl-enter"
      role="group"
      aria-label="Proposed action plan"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <IconShieldCheck size={15} className="text-accent" />
          <h3 className="text-[12.5px] font-semibold text-text-primary">
            Proposed action{count === 1 ? '' : 's'}
          </h3>
        </div>
        <span className={cn('cl-risk-badge', risk.className)}>{risk.label}</span>
      </div>

      <ol className="mt-3 flex flex-col gap-1.5" aria-label="Action steps">
        {plan.actions.map((step, index) => {
          const Icon = ACTION_ICONS[step.action.type] ?? IconReadPage;
          return (
            <li
              key={step.stepId}
              className="flex items-start gap-2.5 rounded-[var(--cl-radius-sm)] bg-surface px-2.5 py-2"
            >
              <span className="mt-[1px] text-text-secondary">
                <Icon size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium leading-[1.45] text-text-primary">
                  {index + 1}. {step.preview}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      {readOnly ? (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-text-muted">
          Awaiting your approval — nothing runs until you allow it.
        </p>
      ) : (
        <>
          <p className="mt-3 text-[10.5px] leading-4 text-text-muted">
            Runs only after you allow it. The exact plan is locked to your
            approval — any change requires a new one.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              ref={cancelRef}
              data-action="cancel"
              onClick={onCancel}
              onKeyDown={handleCancelKeyDown}
              className="btn-secondary h-8 gap-1.5 px-3 text-xs"
            >
              <IconX size={13} />
              Cancel
            </button>
            <button
              type="button"
              ref={approveRef}
              onClick={onApprove}
              onKeyDown={handleApproveKeyDown}
              className="btn-primary h-8 gap-1.5 px-3.5 text-xs"
            >
              <IconPlay size={13} />
              {count === 1 ? 'Allow & run' : `Allow & run ${count} actions`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
