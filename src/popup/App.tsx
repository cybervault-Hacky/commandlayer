import { useCallback, useState } from 'react';
import {
  APP_NAME,
  APP_VERSION,
  PHASE_LABEL,
} from '@/shared/constants/app';
import { MessageType } from '@/shared/constants/messages';
import { sendMessage } from '@/shared/messaging/client';
import { getCommandLayerShortcut } from '@/shared/platform';
import { useExtensionStatus } from '@/shared/hooks/useExtensionStatus';
import { usePageContext } from '@/shared/hooks/usePageContext';
import { BrandMark } from '@/shared/components/icons';
import { StatusDot } from '@/shared/components/StatusDot';

/**
 * The compact launcher/control surface. Deliberately does not duplicate the
 * Side Panel: brand + status, current page status, the two primary actions,
 * the keyboard shortcut, and version info.
 */
export function App() {
  const status = useExtensionStatus();
  const { context, loading: pageLoading } = usePageContext();
  const [actionError, setActionError] = useState<string | null>(null);
  const shortcut = getCommandLayerShortcut();
  const inExtension = status?.environment === 'extension';

  const openCommandCenter = useCallback(async () => {
    const result = await sendMessage(MessageType.OPEN_COMMAND_CENTER);
    setActionError(result.ok ? null : result.error.message);
  }, []);

  const openSidePanel = useCallback(async () => {
    const result = await sendMessage(MessageType.OPEN_SIDE_PANEL);
    setActionError(result.ok ? null : result.error.message);
  }, []);

  return (
    <div className="cl-app min-h-[430px] w-[360px]">
      <div className="mx-auto flex w-full flex-col gap-4 p-5">
        <header className="cl-enter flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BrandMark size={22} />
            <span className="text-[13px] font-semibold tracking-[0.01em] text-text-primary">
              Command<span className="text-accent">Layer</span>
            </span>
          </div>
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            <StatusDot tone={inExtension ? 'success' : 'warning'} pulse />
            {inExtension ? 'Ready' : 'Preview'}
          </p>
        </header>

        <section
          className="cl-enter cl-card p-3.5"
          style={{ animationDelay: '40ms' }}
          aria-label="Current page"
        >
          {pageLoading || !context ? (
            <div className="space-y-2">
              <div className="cl-skeleton h-4 w-3/4" />
              <div className="cl-skeleton h-3 w-1/3" />
            </div>
          ) : context.state === 'ready' ? (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-text-primary">
                  {context.title ?? 'Untitled page'}
                </p>
                {context.hostname && (
                  <p className="mt-0.5 truncate font-mono text-[11px] text-text-secondary">
                    {context.hostname}
                  </p>
                )}
              </div>
              <StatusDot tone="success" className="mt-1" />
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <p className="text-[12.5px] text-text-secondary">
                {context.state === 'unsupported'
                  ? context.title ?? 'Browser page'
                  : 'No page context'}
              </p>
              <StatusDot
                tone={context.state === 'unsupported' ? 'warning' : 'neutral'}
                className="mt-1"
              />
            </div>
          )}
        </section>

        <div
          className="cl-enter flex flex-col gap-2"
          style={{ animationDelay: '80ms' }}
        >
          <button
            type="button"
            className="btn-primary w-full"
            onClick={() => void openCommandCenter()}
          >
            Open Command Center
          </button>
          <button
            type="button"
            className="btn-secondary w-full"
            onClick={() => void openSidePanel()}
          >
            Open Side Panel
          </button>
          {actionError && (
            <p role="alert" className="px-1 text-[11px] leading-4 text-error">
              {actionError}
            </p>
          )}
        </div>

        <div
          className="cl-enter flex items-center justify-between rounded-[var(--cl-radius-md)] border border-border bg-surface px-3 py-2.5"
          style={{ animationDelay: '120ms' }}
        >
          <span className="flex items-center gap-1" aria-hidden="true">
            {shortcut.keys.map((key) => (
              <kbd key={key} className="kbd">
                {key}
              </kbd>
            ))}
          </span>
          <span className="text-[11px] text-text-muted">
            Opens CommandLayer
          </span>
        </div>

        <footer
          className="cl-enter mt-auto flex items-center justify-between"
          style={{ animationDelay: '160ms' }}
        >
          <span className="text-[10px] text-text-muted">{APP_NAME}</span>
          <span className="font-mono text-[10px] tabular-nums text-text-muted">
            v{status?.version ?? APP_VERSION} · {PHASE_LABEL}
          </span>
        </footer>
      </div>
    </div>
  );
}
