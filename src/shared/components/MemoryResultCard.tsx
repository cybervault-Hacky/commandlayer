import {
  MemoryResultAction,
  MEMORY_KIND_LABELS,
  type MemoryResultView,
} from '@/memory/types';
import { cn } from '@/shared/utilities/cn';
import {
  IconAlertTriangle,
  IconCheckCircle,
  IconInfo,
  IconMemory,
  IconShield,
} from './icons';

export interface MemoryResultCardProps {
  result: MemoryResultView;
  /** Optional dismiss affordance (the Side Panel clears the result). */
  onDismiss?: () => void;
  className?: string;
}

type Tone = 'success' | 'blocked' | 'neutral';

function toneFor(action: MemoryResultView['action']): Tone {
  switch (action) {
    case MemoryResultAction.Saved:
    case MemoryResultAction.Updated:
    case MemoryResultAction.Deleted:
    case MemoryResultAction.Cleared:
      return 'success';
    case MemoryResultAction.Blocked:
    case MemoryResultAction.Disabled:
      return 'blocked';
    default:
      return 'neutral';
  }
}

function labelFor(action: MemoryResultView['action']): string {
  switch (action) {
    case MemoryResultAction.Saved:
      return 'Memory saved';
    case MemoryResultAction.Updated:
      return 'Memory updated';
    case MemoryResultAction.AlreadySaved:
      return 'Already saved';
    case MemoryResultAction.Deleted:
      return 'Memory deleted';
    case MemoryResultAction.Cleared:
      return 'Memory cleared';
    case MemoryResultAction.Listed:
      return 'Saved memories';
    case MemoryResultAction.NoMatch:
      return 'Nothing matched';
    case MemoryResultAction.Blocked:
      return 'Not saved';
    case MemoryResultAction.Disabled:
      return 'Memory is off';
    default:
      return 'Memory';
  }
}

/**
 * Phase 6 — the bounded outcome of a memory operation.
 *
 * Shows only what the user needs: what happened and (when useful) the
 * saved memories that are now stored. Never renders storage internals,
 * raw payloads, or refused content.
 */
export function MemoryResultCard({
  result,
  onDismiss,
  className,
}: MemoryResultCardProps) {
  const tone = toneFor(result.action);
  const Icon =
    tone === 'success'
      ? IconCheckCircle
      : tone === 'blocked'
        ? IconShield
        : IconInfo;

  return (
    <div
      className={cn(
        'cl-card cl-enter mt-3 overflow-hidden',
        tone === 'blocked' && 'border-warning/30',
        className,
      )}
      aria-label={labelFor(result.action)}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
          <IconMemory size={12} className="shrink-0 text-accent" />
          {labelFor(result.action)}
        </span>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded px-1 text-[10.5px] font-medium text-text-muted transition-colors hover:text-text-primary"
          >
            Dismiss
          </button>
        )}
      </div>

      <div className="px-3.5 py-3">
        <div className="flex items-start gap-2">
          <Icon
            size={14}
            className={cn(
              'mt-0.5 shrink-0',
              tone === 'success'
                ? 'text-success'
                : tone === 'blocked'
                  ? 'text-warning'
                  : 'text-text-muted',
            )}
          />
          <p className="text-[12px] leading-5 text-text-secondary">
            {result.message}
          </p>
        </div>

        {result.records.length > 0 && (
          <ul className="mt-2.5 space-y-2 border-t border-border/70 pt-2.5">
            {result.records.map((record) => (
              <li key={record.id} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.04em] text-text-muted">
                  {MEMORY_KIND_LABELS[record.kind]}
                </span>
                <span className="min-w-0 text-[12px] leading-5 break-words text-text-primary">
                  {record.content}
                </span>
              </li>
            ))}
          </ul>
        )}

        {result.action === MemoryResultAction.Listed && (
          <p className="mt-2.5 text-[11px] leading-4 text-text-muted">
            Manage or delete saved memories in Settings → Memory.
          </p>
        )}

        {tone === 'blocked' && (
          <p className="mt-2.5 flex items-start gap-2 text-[11px] leading-4 text-text-muted">
            <IconAlertTriangle size={13} className="mt-0.5 shrink-0" />
            Nothing was stored.
          </p>
        )}
      </div>
    </div>
  );
}
