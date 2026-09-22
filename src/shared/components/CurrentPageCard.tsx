import type { PageContext } from '@/shared/types/page';
import { StatusDot, type StatusTone } from './StatusDot';
import { IconGlobe, IconRefresh } from './icons';

export interface CurrentPageCardProps {
  context: PageContext | null;
  loading?: boolean;
  onRefresh?: () => void;
}

const STATE_LABEL: Record<PageContext['state'], string> = {
  'not-requested': 'Not requested',
  requesting: 'Requesting',
  ready: 'Ready',
  partial: 'Partial',
  unsupported: 'Unsupported page',
  unavailable: 'Unavailable',
  'permission-required': 'Permission required',
};

const STATE_TONE: Record<PageContext['state'], StatusTone> = {
  'not-requested': 'neutral',
  requesting: 'accent',
  ready: 'success',
  partial: 'warning',
  unsupported: 'warning',
  unavailable: 'neutral',
  'permission-required': 'warning',
};

/**
 * Current-page context: title, domain and a single availability status.
 * Every state is first-class: loading, ready, unsupported (browser pages)
 * and unavailable (no tab / dev preview).
 */
export function CurrentPageCard({
  context,
  loading = false,
  onRefresh,
}: CurrentPageCardProps) {
  return (
    <div className="cl-card p-3.5">
      <div className="flex items-center justify-between">
        <h2 className="section-label">Current page</h2>
        {onRefresh && !loading && (
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Refresh page context"
            className="icon-btn size-6"
          >
            <IconRefresh size={12} />
          </button>
        )}
      </div>

      {loading || !context ? (
        <div className="mt-3 space-y-2" aria-label="Loading page context">
          <div className="cl-skeleton h-4 w-3/4" />
          <div className="cl-skeleton h-3 w-1/3" />
        </div>
      ) : context.state === 'ready' || context.state === 'partial' ? (
        <div className="cl-enter-fade mt-2.5">
          <p className="truncate text-[13px] font-medium text-text-primary">
            {context.title ?? 'Untitled page'}
          </p>
          {context.hostname && (
            <p className="mt-0.5 truncate font-mono text-[11px] text-text-secondary">
              {context.hostname}
            </p>
          )}
        </div>
      ) : context.state === 'unsupported' ? (
        <div className="cl-enter-fade mt-2.5 flex items-start gap-2.5">
          <IconGlobe size={16} className="mt-0.5 shrink-0 text-text-muted" />
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-text-secondary">
              {context.title ?? 'Browser page'}
            </p>
            <p className="mt-0.5 text-[11px] leading-4 text-text-muted">
              CommandLayer can’t inspect internal browser pages.
            </p>
          </div>
        </div>
      ) : (
        <div className="cl-enter-fade mt-2.5">
          <p className="text-[12px] font-medium text-text-secondary">
            No page context
          </p>
          <p className="mt-0.5 text-[11px] leading-4 text-text-muted">
            Open a web page to get started.
          </p>
        </div>
      )}

      {context && (
        <p className="mt-2.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.06em] text-text-muted">
          <StatusDot tone={STATE_TONE[context.state]} className="size-1.5" />
          {STATE_LABEL[context.state]}
        </p>
      )}
    </div>
  );
}
