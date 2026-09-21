import type { CommandPhase } from '@/shared/hooks/useCommandPipeline';
import type { CommandResult } from '@/shared/types/command';
import { getQuickAction } from '@/shared/constants/quickActions';
import {
  IconAlertTriangle,
  IconCheckCircle,
  IconSpinner,
} from './icons';

export interface CommandResultCardProps {
  phase: CommandPhase;
  result: CommandResult | null;
  errorMessage: string | null;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/**
 * Renders the command pipeline state: processing, success and error.
 * Announced politely to assistive tech; only user-safe text is shown.
 */
export function CommandResultCard({
  phase,
  result,
  errorMessage,
}: CommandResultCardProps) {
  if (phase === 'idle') return null;

  return (
    <div role="status" aria-live="polite" className="mt-3">
      {phase === 'processing' && (
        <div className="cl-enter-fade cl-card flex items-center gap-3 p-3.5">
          <IconSpinner size={16} className="text-accent" />
          <div>
            <p className="text-[12.5px] font-medium text-text-primary">
              Processing command
            </p>
            <p className="mt-0.5 text-[11px] text-text-muted">
              Local pipeline · Phase 1
            </p>
          </div>
        </div>
      )}

      {phase === 'completed' && result && (
        <div className="cl-enter cl-card p-3.5">
          <div className="flex items-center gap-2">
            <IconCheckCircle size={15} className="shrink-0 text-success" />
            <p className="text-[12.5px] font-medium text-text-primary">
              Command received
            </p>
          </div>
          <p className="mt-2 whitespace-pre-line text-[12px] leading-5 text-text-secondary">
            {result.text}
          </p>
          <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[9.5px] uppercase tracking-[0.05em] text-text-muted">
            {result.quickAction && (
              <span>{getQuickAction(result.quickAction)?.label}</span>
            )}
            <span aria-hidden="true">·</span>
            <span>{result.source}</span>
            <span aria-hidden="true">·</span>
            <span>{formatTime(result.finishedAt)}</span>
          </p>
        </div>
      )}

      {phase === 'failed' && (
        <div className="cl-enter cl-card border-error/30 p-3.5">
          <div className="flex items-center gap-2">
            <IconAlertTriangle size={15} className="shrink-0 text-error" />
            <p className="text-[12.5px] font-medium text-text-primary">
              Command failed
            </p>
          </div>
          <p className="mt-2 text-[12px] leading-5 text-text-secondary">
            {errorMessage ?? 'Something went wrong. Please try again.'}
          </p>
        </div>
      )}
    </div>
  );
}
