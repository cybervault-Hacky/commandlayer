import { useState, type ReactNode } from 'react';
import type { PageContext, PageContextState } from '@/shared/types/page';
import { StatusDot, type StatusTone } from './StatusDot';
import { IconChevronLeft, IconSpinner } from './icons';
import { cn } from '@/shared/utilities/cn';

export interface PageInsightCardProps {
  /** Cheap tabs-API context (drives whether capture is possible). */
  basicContext: PageContext | null;
  /** Engine-captured context from the last successful on-demand capture. */
  insight: PageContext | null;
  capturing: boolean;
  onCapture: () => void;
}

const STATE_LABEL: Record<PageContextState, string> = {
  'not-requested': 'Not requested',
  requesting: 'Capturing',
  ready: 'Context ready',
  partial: 'Partial context',
  unsupported: 'Unsupported page',
  unavailable: 'Context unavailable',
  'permission-required': 'Site access required',
};

const STATE_TONE: Record<PageContextState, StatusTone> = {
  'not-requested': 'neutral',
  requesting: 'accent',
  ready: 'success',
  partial: 'warning',
  unsupported: 'warning',
  unavailable: 'neutral',
  'permission-required': 'warning',
};

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function statLabel(value: number, singular: string, plural: string): string {
  return `${formatNumber(value)} ${value === 1 ? singular : plural}`;
}

/**
 * Page insight: the on-demand Page Intelligence surface.
 *
 * Nothing is extracted until the user asks. After a capture: compact stats,
 * a collapsible preview (no huge raw text by default) and a toggleable
 * developer JSON view of the fully sanitized context — which by design can
 * never contain form values, cookies, or browser storage.
 */
export function PageInsightCard({
  basicContext,
  insight,
  capturing,
  onCapture,
}: PageInsightCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);

  const pageReady = basicContext?.state === 'ready';

  let body: ReactNode;

  if (capturing) {
    body = (
      <div className="flex items-center gap-2" role="status">
        <IconSpinner size={13} className="text-accent" />
        <p className="text-[12px] text-text-secondary">
          One controlled read of the active page…
        </p>
      </div>
    );
  } else if (insight && (insight.state === 'ready' || insight.state === 'partial')) {
    const stats = insight.contentStats;
    const statBits = [
      statLabel(stats.headingCount, 'heading', 'headings'),
      statLabel(stats.paragraphCount, 'paragraph', 'paragraphs'),
      statLabel(stats.linkCount, 'link', 'links'),
    ];
    if (stats.tableCount > 0) statBits.push(statLabel(stats.tableCount, 'table', 'tables'));
    if (stats.formCount > 0) statBits.push(statLabel(stats.formCount, 'form', 'forms'));

    body = (
      <div className="space-y-3">
        <p className="text-[11px] font-medium leading-4 text-text-secondary">
          {statBits.join(' · ')}
          {insight.truncated && (
            <span className="text-text-muted"> — capped by extraction limits</span>
          )}
        </p>

        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
            Page details
          </span>
          <IconChevronLeft
            size={13}
            className={cn(
              'text-text-muted transition-transform',
              detailsOpen ? '' : '-rotate-90',
            )}
          />
        </button>

        {detailsOpen && (
          <dl className="cl-enter-fade space-y-1.5 rounded-lg bg-surface-sunken px-3 py-2.5">
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-[11px] text-text-muted">Title</dt>
              <dd className="truncate text-[11px] text-text-secondary">
                {insight.title ?? 'Untitled page'}
              </dd>
            </div>
            {insight.headings.slice(0, 3).map((h, index) => (
              <div key={index} className="flex justify-between gap-3">
                <dt className="shrink-0 text-[11px] text-text-muted">
                  H{h.level}
                </dt>
                <dd className="truncate text-[11px] text-text-secondary">{h.text}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-[11px] text-text-muted">Text</dt>
              <dd className="text-[11px] text-text-secondary">
                {formatNumber(stats.textLength)} characters
                {stats.wordCount > 0 ? ` · ${formatNumber(stats.wordCount)} words` : ''}
              </dd>
            </div>
            {insight.selectedText !== null && (
              <div>
                <dt className="text-[11px] text-text-muted">Selected text</dt>
                <dd className="mt-0.5 truncate text-[11px] text-text-secondary">
                  {insight.selectedText}
                </dd>
              </div>
            )}
          </dl>
        )}

        <button
          type="button"
          aria-pressed={jsonOpen}
          className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted underline-offset-2 hover:text-text-secondary hover:underline"
          onClick={() => setJsonOpen((open) => !open)}
        >
          {jsonOpen ? 'Hide developer preview' : 'Developer preview'}
        </button>

        {jsonOpen && (
          <pre
            aria-label="Page context JSON preview"
            className="cl-enter-fade max-h-56 overflow-auto rounded-lg bg-surface-sunken px-3 py-2.5 font-mono text-[10px] leading-4 text-text-secondary"
          >
            {JSON.stringify(insight, null, 2)}
          </pre>
        )}
        <p className="text-[10px] leading-4 text-text-muted">
          Sanitized output — never contains form values, cookies, or browser storage.
        </p>
      </div>
    );
  } else if (insight && insight.state === 'permission-required') {
    body = (
      <div className="space-y-2">
        <p className="text-[11px] leading-4 text-text-secondary">
          CommandLayer cannot read this page. Check the extension’s site access
          for this site in the browser’s extension settings, then try again.
        </p>
        <button type="button" className="btn-secondary h-7 px-2.5 text-[11px]" onClick={onCapture}>
          Try again
        </button>
      </div>
    );
  } else if (insight && insight.state === 'unsupported') {
    body = (
      <p className="text-[11px] leading-4 text-text-secondary">
        Browser-internal pages cannot be inspected. Open a regular web page to
        analyze its content.
      </p>
    );
  } else if (insight && insight.state === 'unavailable') {
    body = (
      <div className="space-y-2">
        <p className="text-[11px] leading-4 text-text-secondary">
          The page context could not be captured.
        </p>
        <button type="button" className="btn-secondary h-7 px-2.5 text-[11px]" onClick={onCapture}>
          Try again
        </button>
      </div>
    );
  } else if (!pageReady) {
    body = (
      <p className="text-[11px] leading-4 text-text-secondary">
        {basicContext?.state === 'unsupported'
          ? 'Browser-internal pages cannot be inspected.'
          : 'Open a web page to analyze its content.'}
      </p>
    );
  } else {
    body = (
      <div className="space-y-2">
        <p className="text-[11px] leading-4 text-text-muted">
          On-demand capture. Nothing is read until you ask.
        </p>
        <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={onCapture}>
          Analyze this page
        </button>
      </div>
    );
  }

  return (
    <div className="cl-card p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="section-label">Page insight</h2>
        {insight && !capturing && insight.state !== 'not-requested' && (
          <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.06em] text-text-muted">
            <StatusDot tone={STATE_TONE[insight.state]} className="size-1.5" />
            {STATE_LABEL[insight.state]}
          </p>
        )}
      </div>

      <div className="mt-2.5">{body}</div>
    </div>
  );
}
