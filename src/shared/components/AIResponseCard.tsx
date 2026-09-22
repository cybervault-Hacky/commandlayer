import { useEffect, useState } from 'react';
import type { CommandPhase } from '@/shared/hooks/useCommandPipeline';
import type { CommandResult } from '@/shared/types/command';
import { INTENT_LABELS } from '@/ai/intents';
import { cn } from '@/shared/utilities/cn';
import { SafeMarkdown } from './SafeMarkdown';
import {
  IconAlertTriangle,
  IconCopy,
  IconRefresh,
  IconSparkle,
  IconSpinner,
  IconTrash,
  IconX,
} from './icons';

export interface AIResponseCardProps {
  phase: CommandPhase;
  result: CommandResult | null;
  errorMessage: string | null;
  onRetry?: () => void;
  onClear?: () => void;
  /** Hide the clear action (e.g. inside a transcript). */
  hideClear?: boolean;
}

const THINKING_STEPS = [
  'Understanding page',
  'Preparing context',
  'Reasoning',
  'Preparing response',
] as const;

const THINKING_STEP_MS = 1200;

function providerLabel(result: CommandResult): string {
  const provider = result.ai?.provider;
  return provider === 'local-mock'
    ? 'Local reasoning'
    : provider === 'secure-gateway'
      ? 'Secure gateway'
      : 'Intelligence';
}

async function copyAnswer(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Renders the reasoning pipeline: an animated thinking state, the
 * validated AI response (safe Markdown), or a user-safe typed error.
 * Only validated data reaches this component.
 */
export function AIResponseCard({
  phase,
  result,
  errorMessage,
  onRetry,
  onClear,
  hideClear = false,
}: AIResponseCardProps) {
  const [step, setStep] = useState(0);
  const [copied, setCopied] = useState(false);

  // Render-time state adjustment (not an effect): leaving the processing
  // phase resets the thinking-step cycle.
  const [prevPhase, setPrevPhase] = useState(phase);
  if (prevPhase !== phase) {
    setPrevPhase(phase);
    if (phase !== 'processing') setStep(0);
  }

  useEffect(() => {
    if (phase !== 'processing') return;
    const timer = setInterval(() => {
      setStep((s) => (s + 1) % THINKING_STEPS.length);
    }, THINKING_STEP_MS);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  if (phase === 'idle') return null;

  if (phase === 'processing') {
    return (
      <div role="status" aria-live="polite" className="cl-enter-fade cl-card mt-3">
        <div className="flex items-center gap-3 p-3.5">
          <IconSpinner size={16} className="shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="text-[12.5px] font-medium text-text-primary">
              {THINKING_STEPS[step]}
              <span className="cl-thinking-dots" aria-hidden="true" />
            </p>
            <p className="mt-0.5 text-[11px] text-text-muted">
              Reasoning about the current page
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'failed') {
    const retryable = result?.retryable ?? false;
    return (
      <div role="status" aria-live="polite" className="cl-enter cl-card mt-3 border-error/30">
        <div className="p-3.5">
          <div className="flex items-center gap-2">
            <IconAlertTriangle size={15} className="shrink-0 text-error" />
            <p className="text-[12.5px] font-medium text-text-primary">
              Intelligence unavailable
            </p>
          </div>
          <p className="mt-2 text-[12px] leading-5 text-text-secondary">
            {errorMessage ?? 'Something went wrong. Please try again.'}
          </p>
          {(retryable || onClear) && (
            <div className="mt-3 flex items-center gap-2">
              {retryable && onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="cl-btn-ghost"
                >
                  <IconRefresh size={13} />
                  Retry
                </button>
              )}
              {onClear && !hideClear && (
                <button
                  type="button"
                  onClick={onClear}
                  className="cl-btn-ghost"
                >
                  <IconX size={13} />
                  Dismiss
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  const ai = result?.ai;
  if (!result || !ai) return null;

  return (
    <div role="status" aria-live="polite" className="cl-enter cl-card mt-3 overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
          <IconSparkle size={12} className="shrink-0 text-accent" />
          {INTENT_LABELS[ai.intent] ?? 'Answer'}
          <span aria-hidden="true">·</span>
          {providerLabel(result)}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void copyAnswer(ai.answer).then(setCopied)}
            className="cl-icon-btn"
            aria-label="Copy answer"
            title="Copy answer"
          >
            <IconCopy size={13} />
          </button>
          {onClear && !hideClear && (
            <button
              type="button"
              onClick={onClear}
              className="cl-icon-btn"
              aria-label="Clear response"
              title="Clear response"
            >
              <IconTrash size={13} />
            </button>
          )}
        </span>
      </div>

      <div className="px-3.5 py-3">
        <SafeMarkdown content={ai.answer} className="cl-md" />

        {ai.sections.length > 0 && (
          <div className="mt-3 space-y-3 border-t border-border/70 pt-3">
            {ai.sections.map((section) => (
              <section key={section.title}>
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                  {section.title}
                </h4>
                <SafeMarkdown content={section.content} className="cl-md mt-1.5" />
              </section>
            ))}
          </div>
        )}

        {ai.sources.length > 0 && (
          <div className="mt-3 border-t border-border/70 pt-2.5">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
              References
            </h4>
            <ul className="mt-1.5 space-y-1">
              {ai.sources.map((source) => (
                <li key={source.url} className="truncate text-[11.5px]">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      'text-text-secondary underline-offset-2 hover:text-accent hover:underline',
                    )}
                  >
                    {source.title || source.url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.ai && result.ai.requestId && (
          <p className="mt-2.5 truncate font-mono text-[9px] text-text-muted/80">
            {result.ai.requestId}
          </p>
        )}
      </div>

      <span aria-live="polite" className="sr-only">
        {copied ? 'Answer copied to clipboard' : ''}
      </span>
    </div>
  );
}
