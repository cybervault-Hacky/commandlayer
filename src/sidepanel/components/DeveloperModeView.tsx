import { useMemo } from 'react';
import type { ActionExecutionResult, ActionPlan } from '@/actions/types';
import type { DeveloperResultView } from '@/developer/types';
import { repositorySlug, type GitHubPageContext } from '@/github/types';
import { MEMORY_KIND_LABELS } from '@/memory/types';
import { useMemory } from '@/shared/hooks/useMemory';
import { DeveloperChangePlanCard } from '@/shared/components/DeveloperChangePlanCard';
import { DeveloperContextCard } from '@/shared/components/DeveloperContextCard';
import { DeveloperResultCard } from '@/shared/components/DeveloperResultCard';
import { IconMemory, IconRepo } from '@/shared/components/icons';

export interface DeveloperModeViewProps {
  github: GitHubPageContext | null;
  loading: boolean;
  /** The latest developer result for this panel (null until a command runs). */
  result: DeveloperResultView | null;
  actionPlan: ActionPlan | null;
  execution: ActionExecutionResult | null;
  running: boolean;
  onApprove: () => void;
  onCancel: () => void;
  onDismissResult?: () => void;
  className?: string;
}

/**
 * Phase 7 — Developer Mode.
 *
 * The sections the brief asks for, in the order a developer reads them:
 * Repository / Current file / Code context (the context card), Analysis (the
 * result card), Change plan (with the Phase 4 approval flow inside it), and
 * Saved developer context (memories that relate to this repository).
 *
 * It is a PRESENTATION mode: it renders what was captured and analysed, and
 * it cannot change what is captured, what is allowed, or what needs approval.
 */
export function DeveloperModeView({
  github,
  loading,
  result,
  actionPlan,
  execution,
  running,
  onApprove,
  onCancel,
  onDismissResult,
  className,
}: DeveloperModeViewProps) {
  const memory = useMemory();

  const slug = github ? repositorySlug(github) : null;

  /**
   * "Saved developer context": stored memories whose text mentions this
   * repository or the current path. Relevance is a simple, explicit match —
   * no scoring, no guessing, and nothing is auto-sent anywhere. Memory can
   * inform context; it can never approve or authorize anything.
   */
  const relevant = useMemo(() => {
    if (!github) return [];
    const needles = [slug?.toLowerCase(), github.repository?.toLowerCase()]
      .filter((needle): needle is string => typeof needle === 'string' && needle.length > 0);
    const pathNeedles = (github.path ?? '')
      .split('/')
      .map((part) => part.toLowerCase())
      .filter((part) => part.length >= 4 && /\.[a-z0-9]+$/.test(part));
    const all = [...needles, ...pathNeedles];
    if (all.length === 0) {
      return memory.records.filter((record) => record.project !== null).slice(0, 5);
    }
    return memory.records
      .filter((record) => {
        const haystack = `${record.content} ${record.project ?? ''}`.toLowerCase();
        return all.some((needle) => haystack.includes(needle));
      })
      .slice(0, 5);
  }, [github, memory.records, slug]);

  if (github === null && !loading) return null;

  return (
    <div className={className}>
      <DeveloperContextCard github={github} loading={loading && github === null} />

      {result && (
        <div className="mt-3">
          <DeveloperResultCard result={result} onDismiss={onDismissResult} />
        </div>
      )}

      {result?.plan && (
        <div className="mt-3">
          <DeveloperChangePlanCard
            result={result}
            actionPlan={actionPlan}
            execution={execution}
            running={running}
            onApprove={onApprove}
            onCancel={onCancel}
          />
        </div>
      )}

      {memory.enabled && relevant.length > 0 && (
        <section
          className="cl-card mt-3 overflow-hidden"
          aria-labelledby="developer-saved-context"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2.5">
            <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
              <IconMemory size={12} className="shrink-0 text-accent" />
              <span id="developer-saved-context">Saved developer context</span>
            </span>
            <span className="text-[9.5px] text-text-muted">You saved these</span>
          </div>
          <ul className="px-3.5 py-3">
            {relevant.map((record) => (
              <li key={record.id} className="flex items-start gap-2 py-1">
                <span className="mt-0.5 shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.04em] text-text-muted">
                  {MEMORY_KIND_LABELS[record.kind]}
                </span>
                <span className="min-w-0 break-words text-[11.5px] leading-5 text-text-secondary">
                  {record.content}
                </span>
              </li>
            ))}
          </ul>
          <p className="flex items-start gap-1.5 px-3.5 pb-3 text-[10px] leading-4 text-text-muted">
            <IconRepo size={11} className="mt-0.5 shrink-0" />
            <span>
              Saved context can inform an explanation. It never approves an
              action and never changes what is allowed.
            </span>
          </p>
        </section>
      )}
    </div>
  );
}
