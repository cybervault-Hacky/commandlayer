import type { ActionExecutionResult, ActionPlan } from '@/actions/types';
import type { DeveloperResultView } from '@/developer/types';
import { cn } from '@/shared/utilities/cn';
import { ActionPreviewCard } from './ActionPreviewCard';
import { ActionProgressCard } from './ActionProgressCard';
import { IconInfo, IconSteps, IconTerminalCheck } from './icons';

export interface DeveloperChangePlanCardProps {
  /** The developer result whose plan is being rendered. */
  result: DeveloperResultView;
  /**
   * The Phase 4 navigation plan, when the analysis proposed any. It is a
   * separate, hashed object: the developer result itself carries no
   * executable data, and nothing here can run without the explicit
   * approval the Action Engine demands.
   */
  actionPlan?: ActionPlan | null;
  execution?: ActionExecutionResult | null;
  running?: boolean;
  onApprove?: () => void;
  onCancel?: () => void;
  readOnly?: boolean;
  className?: string;
}

/**
 * Phase 7 — the change plan. Steps are ADVISORY; only the "Open on GitHub"
 * part is executable, and that part goes through the Phase 4 preview and
 * approval flow rendered inside this card.
 *
 * PREVIEW → ALLOW & RUN → PROGRESS → VERIFY is preserved exactly: the plan
 * card never executes anything itself, and a plan without executable
 * navigation says so plainly.
 */
export function DeveloperChangePlanCard({
  result,
  actionPlan = null,
  execution = null,
  running = false,
  onApprove,
  onCancel,
  readOnly = false,
  className,
}: DeveloperChangePlanCardProps) {
  const plan = result.plan;
  if (!plan) return null;

  return (
    <section
      className={cn('cl-card cl-enter overflow-hidden', className)}
      aria-label="Change plan"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
          <IconSteps size={12} className="shrink-0 text-accent" />
          Change plan
        </span>
        <span className="shrink-0 text-[9.5px] uppercase tracking-[0.04em] text-text-muted">
          {plan.executable ? 'Review before running' : 'Advisory only'}
        </span>
      </div>

      <div className="px-3.5 py-3">
        <p className="text-[11.5px] leading-5 text-text-secondary">{plan.summary}</p>

        <ol className="mt-3 flex flex-col gap-2 border-t border-border/70 pt-3">
          {plan.steps.map((step, index) => (
            <li key={`${index}-${step.title}`} className="flex gap-2">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[9.5px] text-text-muted">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[11.5px] font-medium text-text-primary">
                  {step.title}
                </span>
                {step.detail && (
                  <span className="mt-0.5 block whitespace-pre-line break-words text-[11px] leading-4 text-text-muted">
                    {step.detail}
                  </span>
                )}
                {step.files && step.files.length > 0 && (
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {step.files.map((file) => (
                      <span
                        key={file}
                        className="max-w-full truncate rounded-[var(--cl-radius-sm)] border border-border px-1.5 py-0.5 font-mono text-[9.5px] text-text-muted"
                        title={file}
                      >
                        {file}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>

        {execution ? (
          <div className="mt-3 border-t border-border/70 pt-3">
            <ActionProgressCard plan={actionPlan} execution={execution} running={false} />
          </div>
        ) : actionPlan ? (
          <div className="mt-3 border-t border-border/70 pt-3">
            <p className="mb-2 flex items-start gap-1.5 text-[10.5px] leading-4 text-text-muted">
              <IconTerminalCheck size={12} className="mt-0.5 shrink-0" />
              <span>
                Only the “open on GitHub” steps below can run, and only after
                you allow them. The plan steps above are recommendations.
              </span>
            </p>
            <ActionPreviewCard
              plan={actionPlan}
              onApprove={() => onApprove?.()}
              onCancel={() => onCancel?.()}
              readOnly={readOnly}
            />
            {running && (
              <ActionProgressCard plan={actionPlan} execution={null} running />
            )}
          </div>
        ) : (
          <p className="mt-3 flex items-start gap-1.5 border-t border-border/70 pt-2.5 text-[10.5px] leading-4 text-text-muted">
            <IconInfo size={11} className="mt-0.5 shrink-0" />
            <span>
              This plan is advisory — nothing in it can be run from here.
            </span>
          </p>
        )}
      </div>
    </section>
  );
}
