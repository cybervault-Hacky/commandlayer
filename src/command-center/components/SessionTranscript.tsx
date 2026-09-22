import type { CommandResult } from '@/shared/types/command';
import { AIResponseCard } from '@/shared/components/AIResponseCard';
import { ActionPreviewCard } from '@/shared/components/ActionPreviewCard';
import { ActionProgressCard } from '@/shared/components/ActionProgressCard';
import { IconSparkle } from '@/shared/components/icons';

export interface TranscriptUserTurn {
  kind: 'user';
  id: string;
  text: string;
  at: string;
}

export interface TranscriptAssistantTurn {
  kind: 'assistant';
  id: string;
  result: CommandResult;
  at: string;
}

export type TranscriptEntry = TranscriptUserTurn | TranscriptAssistantTurn;

export interface SessionTranscriptProps {
  entries: readonly TranscriptEntry[];
  onClear: () => void;
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
 * Session-only reasoning transcript. Never persisted, never leaves the
 * tab: closing the Command Center clears it. Contains only validated
 * AI responses and the user's own prompts.
 */
export function SessionTranscript({ entries, onClear }: SessionTranscriptProps) {
  return (
    <section className="cl-card flex flex-col p-4" aria-label="Session transcript">
      <div className="flex items-center justify-between">
        <h2 className="section-label">Session transcript</h2>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="rounded px-1 text-[10.5px] font-medium text-text-muted transition-colors hover:text-text-primary"
          >
            Clear session
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2 py-8 text-center">
          <IconSparkle size={20} className="text-text-muted" />
          <p className="max-w-[300px] text-[11.5px] leading-5 text-text-muted">
            Ask about the page you have open. Your questions and answers
            stay in this session only.
          </p>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {entries.map((entry) =>
            entry.kind === 'user' ? (
              <li key={entry.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-[var(--cl-radius-md)] border border-border bg-surface-elevated px-3 py-2">
                  <p className="whitespace-pre-line break-words text-[12px] leading-5 text-text-primary">
                    {entry.text}
                  </p>
                  <p className="mt-1 text-right font-mono text-[9px] tabular-nums text-text-muted">
                    {formatTime(entry.at)}
                  </p>
                </div>
              </li>
            ) : (
              <li key={entry.id} className="flex justify-start">
                <div className="w-full max-w-[92%]">
                  {entry.result.execution ? (
                    /* Phase 4: executed plans render their verified
                     * outcome inline (read-only). */
                    <ActionProgressCard
                      plan={entry.result.plan ?? null}
                      execution={entry.result.execution}
                    />
                  ) : entry.result.plan ? (
                    /* Proposed but not executed: read-only preview. */
                    <ActionPreviewCard
                      plan={entry.result.plan}
                      onApprove={() => undefined}
                      onCancel={() => undefined}
                      readOnly
                    />
                  ) : (
                    <AIResponseCard
                      phase={entry.result.status === 'completed' ? 'completed' : 'failed'}
                      result={entry.result}
                      errorMessage={
                        entry.result.status === 'failed' ? entry.result.text : null
                      }
                      hideClear
                    />
                  )}
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
