import {
  QUICK_ACTIONS,
  type QuickAction,
} from '@/shared/constants/quickActions';
import { cn } from '@/shared/utilities/cn';
import {
  IconAnalyze,
  IconExplain,
  IconExtract,
  IconSummarize,
} from './icons';

const ACTION_ICON: Record<QuickAction['id'], typeof IconAnalyze> = {
  analyze: IconAnalyze,
  summarize: IconSummarize,
  explain: IconExplain,
  extract: IconExtract,
};

export interface QuickActionsProps {
  onSelect: (action: QuickAction) => void;
  disabled?: boolean;
  /** 'grid' for the side panel (2×2 cards), 'row' for the command center. */
  variant?: 'grid' | 'row';
}

/**
 * Reusable quick actions. Each click builds a structured CommandRequest and
 * runs it through the command pipeline — no action performs work itself.
 */
export function QuickActions({
  onSelect,
  disabled = false,
  variant = 'grid',
}: QuickActionsProps) {
  return (
    <div
      role="group"
      aria-label="Quick actions"
      className={cn(
        variant === 'grid' ? 'grid grid-cols-2 gap-2' : 'flex flex-wrap gap-2',
      )}
    >
      {QUICK_ACTIONS.map((action) => {
        const Icon = ACTION_ICON[action.id];
        return (
          <button
            key={action.id}
            type="button"
            onClick={() => onSelect(action)}
            disabled={disabled}
            className={cn(
              'group rounded-[var(--cl-radius-md)] border border-border bg-surface',
              'transition-all duration-[var(--cl-duration-fast)] ease-out',
              'hover:-translate-y-px hover:border-accent/40 hover:bg-surface-elevated',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cl-accent-ring)]',
              'active:translate-y-0',
              'disabled:pointer-events-none disabled:opacity-50',
              variant === 'grid' ? 'p-3 text-left' : 'px-3 py-2',
            )}
          >
            <span className="flex items-center gap-2.5">
              <span
                className={cn(
                  'flex shrink-0 items-center justify-center rounded-[10px]',
                  'bg-accent-soft text-accent',
                  variant === 'grid' ? 'size-8' : 'size-6',
                )}
              >
                <Icon size={variant === 'grid' ? 15 : 14} />
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium leading-4 text-text-primary">
                  {action.label}
                </span>
                {variant === 'grid' && (
                  <span className="mt-0.5 block truncate text-[10.5px] leading-4 text-text-muted">
                    {action.description}
                  </span>
                )}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
