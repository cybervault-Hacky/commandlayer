import { ActionRisk } from '@/actions/types';
import { cn } from '@/shared/utilities/cn';

/**
 * Risk badge for a plan or a workflow step. The wording is fixed, never
 * supplied by content or AI, and the color is semantic (read-only / low /
 * confirmation).
 */
export function RiskBadge({
  risk,
  short = false,
  className,
}: {
  risk: ActionRisk;
  /** Compact wording for progress surfaces ("Confirmed"). */
  short?: boolean;
  className?: string;
}) {
  const meta =
    risk === ActionRisk.ReadOnly
      ? { label: 'Read-only', tone: 'cl-risk-readonly' }
      : risk === ActionRisk.Low
        ? { label: 'Low risk', tone: 'cl-risk-low' }
        : {
            label: short ? 'Confirmed' : 'Requires confirmation',
            tone: 'cl-risk-confirm',
          };

  return (
    <span className={cn('cl-risk-badge', meta.tone, className)}>{meta.label}</span>
  );
}
