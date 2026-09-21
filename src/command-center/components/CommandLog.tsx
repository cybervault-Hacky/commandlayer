import type { CommandResult } from '@/shared/types/command';
import { getQuickAction } from '@/shared/constants/quickActions';
import { IconAlertTriangle, IconCheckCircle } from '@/shared/components/icons';

export interface CommandLogProps {
  entries: readonly CommandResult[];
  onClear: () => void;
}

/**
 * Session-only command log (never persisted — Phase 1 keeps no history).
 */
export function CommandLog({ entries, onClear }: CommandLogProps) {
  return (
    <div className="cl-card flex flex-col p-4">
      <div className="flex items-center justify-between">
        <h2 className="section-label">Command log</h2>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="rounded px-1 text-[10.5px] font-medium text-text-muted transition-colors hover:text-text-primary"
          >
            Clear
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="mt-3 text-[11.5px] leading-5 text-text-muted">
          Commands you run this session appear here.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-2">
              {entry.status === 'completed' ? (
                <IconCheckCircle size={13} className="mt-0.5 shrink-0 text-success" />
              ) : (
                <IconAlertTriangle size={13} className="mt-0.5 shrink-0 text-error" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11.5px] text-text-secondary">
                  {entry.quickAction &&
                    `${getQuickAction(entry.quickAction)?.label ?? 'Command'} · `}
                  {entry.commandText ?? entry.text.split('\n')[0]}
                </p>
                <p className="mt-0.5 font-mono text-[9.5px] tabular-nums text-text-muted">
                  {formatTime(entry.finishedAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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
