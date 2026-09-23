import {
  FindingCategory,
  FindingConfidence,
  FindingSeverity,
} from '@/ai/types';
import { DEVELOPER_INTENT_LABELS } from '@/developer/intents';
import type { DeveloperFinding, DeveloperResultView } from '@/developer/types';
import { cn } from '@/shared/utilities/cn';
import { SafeMarkdown } from './SafeMarkdown';
import {
  IconAlertTriangle,
  IconCheckCircle,
  IconCode,
  IconFindText,
  IconInfo,
  IconRepo,
  IconShield,
  IconTerminalCheck,
  IconX,
} from './icons';

export interface DeveloperResultCardProps {
  result: DeveloperResultView;
  onDismiss?: () => void;
  className?: string;
}

const SEVERITY_LABELS: Record<FindingSeverity, string> = {
  [FindingSeverity.Info]: 'Info',
  [FindingSeverity.Low]: 'Low',
  [FindingSeverity.Medium]: 'Medium',
  [FindingSeverity.High]: 'High',
};

const CATEGORY_LABELS: Record<FindingCategory, string> = {
  [FindingCategory.Correctness]: 'correctness',
  [FindingCategory.Maintainability]: 'maintainability',
  [FindingCategory.Security]: 'security',
  [FindingCategory.Performance]: 'performance',
  [FindingCategory.Testing]: 'testing',
  [FindingCategory.Compatibility]: 'compatibility',
  [FindingCategory.Configuration]: 'configuration',
};

const CONFIDENCE_LABELS: Record<FindingConfidence, string> = {
  [FindingConfidence.Low]: 'Low confidence',
  [FindingConfidence.Medium]: 'Medium confidence',
  [FindingConfidence.High]: 'High confidence',
};

function severityClass(severity: FindingSeverity): string {
  switch (severity) {
    case FindingSeverity.High:
      return 'text-error border-error/40';
    case FindingSeverity.Medium:
      return 'text-warning border-warning/40';
    case FindingSeverity.Low:
      return 'text-accent border-accent/40';
    default:
      return 'text-text-muted border-border';
  }
}

/**
 * Phase 7 — the developer result: summary, findings with evidence, affected
 * files, and the honest notes about what could not be read.
 *
 * Every string here was produced either by a deterministic local rule or by
 * a VALIDATED model response. Wording is deliberately hedged ("may", "worth
 * checking") — the card never claims certainty.
 */
export function DeveloperResultCard({
  result,
  onDismiss,
  className,
}: DeveloperResultCardProps) {
  const title = DEVELOPER_INTENT_LABELS[result.intent];
  const where = [result.repository, result.path].filter(Boolean).join('/');

  return (
    <section
      className={cn('cl-card cl-enter overflow-hidden', className)}
      aria-label={title}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
          <IconCode size={12} className="shrink-0 text-accent" />
          <span className="truncate">{title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {result.truncated && (
            <span className="text-[9.5px] uppercase tracking-[0.04em] text-text-muted">
              Truncated
            </span>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss developer result"
              className="cl-icon-btn -mr-1 text-text-muted"
            >
              <IconX size={12} />
            </button>
          )}
        </span>
      </div>

      <div className="px-3.5 py-3">
        {where && (
          <p className="mb-2 flex items-center gap-1.5 truncate font-mono text-[10.5px] text-text-muted">
            <IconRepo size={11} className="shrink-0" />
            <span className="truncate">{where}</span>
            {result.language && <span className="shrink-0">· {result.language}</span>}
          </p>
        )}

        <div className="cl-md">
          <SafeMarkdown content={result.summary} />
        </div>

        {result.findings.length > 0 && (
          <div className="mt-3 border-t border-border/70 pt-3">
            <h3 className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
              <IconShield size={12} className="text-accent" />
              Findings · {result.findings.length}
            </h3>
            <ul className="mt-2 flex flex-col gap-2.5">
              {result.findings.map((finding, index) => (
                <FindingItem
                  key={`${finding.file ?? 'page'}:${finding.line ?? index}`}
                  finding={finding}
                />
              ))}
            </ul>
          </div>
        )}

        {result.search && result.search.hits.length > 0 && (
          <div className="mt-3 border-t border-border/70 pt-3">
            <h3 className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
              <IconFindText size={12} className="text-accent" />
              Matches · {result.search.hits.length}
            </h3>
            <ul className="mt-2 flex flex-col gap-1.5">
              {result.search.hits.map((hit, index) => (
                <li key={`${hit.path ?? 'page'}:${hit.line ?? index}`} className="min-w-0">
                  <p className="truncate font-mono text-[10px] text-text-muted">
                    {hit.path ?? 'page text'}
                    {hit.line !== null ? `:${hit.line}` : ''}
                    {hit.source !== 'file-list' ? ` · ${hit.source}` : ''}
                  </p>
                  <p className="mt-0.5 break-words font-mono text-[11px] leading-4 text-text-secondary">
                    {hit.snippet}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.issue && (
          <div className="mt-3 border-t border-border/70 pt-3">
            <h3 className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
              Issue requirements
            </h3>
            {result.issue.requirements.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1.5">
                {result.issue.requirements.map((requirement, index) => (
                  <li
                    key={`req-${index}`}
                    className="flex gap-2 text-[11.5px] leading-5 text-text-secondary"
                  >
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-text-muted" />
                    <span className="min-w-0 break-words">{requirement}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-[11px] text-text-muted">
                No explicit requirement sentences were found in the captured issue text.
              </p>
            )}
            {result.issue.acceptanceCriteria.length > 0 && (
              <>
                <h4 className="mt-2.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.06em] text-text-muted">
                  <IconCheckCircle size={11} />
                  Acceptance criteria
                </h4>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {result.issue.acceptanceCriteria.map((criterion, index) => (
                    <li
                      key={`ac-${index}`}
                      className="text-[11.5px] leading-5 text-text-secondary"
                    >
                      {criterion}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {result.affectedFiles.length > 0 && (
          <div className="mt-3 border-t border-border/70 pt-3">
            <h3 className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
              <IconTerminalCheck size={12} className="text-accent" />
              Affected files · {result.affectedFiles.length}
            </h3>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {result.affectedFiles.map((file) => (
                <li
                  key={file}
                  className="max-w-full truncate rounded-[var(--cl-radius-sm)] border border-border bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-text-secondary"
                  title={file}
                >
                  {file}
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.observations.length > 0 && (
          <div className="mt-3 border-t border-border/70 pt-3">
            <h3 className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
              Context read
            </h3>
            <ul className="mt-1.5 flex flex-col gap-1">
              {result.observations.map((observation, index) => (
                <li
                  key={`obs-${index}`}
                  className="text-[10.5px] leading-4 text-text-muted"
                >
                  {observation}
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.notes.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5 border-t border-border/70 pt-2.5">
            {result.notes.map((note, index) => (
              <li
                key={`note-${index}`}
                className="flex items-start gap-1.5 text-[10.5px] leading-4 text-text-muted"
              >
                <IconInfo size={11} className="mt-0.5 shrink-0" />
                <span className="min-w-0 break-words">{note}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-2.5 flex items-start gap-1.5 text-[10px] leading-4 text-text-muted">
          <IconAlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span>
            Observations are based only on what this page showed. Treat every
            finding as something to check, not a conclusion.
          </span>
        </p>
      </div>
    </section>
  );
}

function FindingItem({ finding }: { finding: DeveloperFinding }) {
  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            'rounded-full border px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.04em]',
            severityClass(finding.severity),
          )}
        >
          {SEVERITY_LABELS[finding.severity]}
        </span>
        <span className="text-[9.5px] uppercase tracking-[0.04em] text-text-muted">
          {CATEGORY_LABELS[finding.category]}
        </span>
        {finding.file && (
          <span className="truncate font-mono text-[10px] text-text-muted" title={finding.file}>
            {finding.file}
            {finding.line !== null ? `:${finding.line}` : ''}
          </span>
        )}
      </div>
      <p className="text-[11.5px] leading-5 text-text-primary">{finding.explanation}</p>
      <p className="break-words rounded-[var(--cl-radius-sm)] border border-border/70 bg-surface-elevated px-2 py-1 font-mono text-[10px] leading-4 text-text-secondary">
        {finding.evidence}
      </p>
      <p className="text-[9.5px] uppercase tracking-[0.04em] text-text-muted">
        {CONFIDENCE_LABELS[finding.confidence]} ·{' '}
        {finding.origin === 'local' ? 'Analyzed locally' : 'Model-assisted'}
      </p>
    </li>
  );
}
