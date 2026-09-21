import { useCallback, useState } from 'react';
import {
  APP_NAME,
  COMMAND_LOG_LIMIT,
  PHASE_LABEL,
  TAGLINE,
} from '@/shared/constants/app';
import { CommandSource } from '@/shared/types/command';
import type { CommandResult } from '@/shared/types/command';
import { useCommandPipeline } from '@/shared/hooks/useCommandPipeline';
import { usePageContext } from '@/shared/hooks/usePageContext';
import { BrandMark } from '@/shared/components/icons';
import { CommandInput } from '@/shared/components/CommandInput';
import { CommandResultCard } from '@/shared/components/CommandResultCard';
import { CurrentPageCard } from '@/shared/components/CurrentPageCard';
import { QuickActions } from '@/shared/components/QuickActions';
import { CommandLog } from './components/CommandLog';

/**
 * The full-window command experience, opened from the popup.
 * Shares the exact same input, quick actions, context and pipeline as the
 * Side Panel, plus a session-only command log.
 */
export function App() {
  const { context, loading: pageLoading, refresh } = usePageContext();
  const [draft, setDraft] = useState('');
  const [log, setLog] = useState<CommandResult[]>([]);

  // Terminal commands enter the session log; successes clear the draft.
  const pipeline = useCommandPipeline(CommandSource.CommandCenter, (result) => {
    setLog((prev) => [result, ...prev].slice(0, COMMAND_LOG_LIMIT));
    if (result.status === 'completed') setDraft('');
  });

  const processing = pipeline.phase === 'processing';

  const handleSubmit = useCallback(() => {
    void pipeline.submitText(draft);
  }, [pipeline, draft]);

  return (
    <div className="cl-app min-h-full">
      <main className="mx-auto flex min-h-full w-full max-w-[560px] flex-col px-6 py-10">
        <header className="cl-enter flex items-center gap-3">
          <BrandMark size={26} />
          <div>
            <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-text-primary">
              Command Center
            </h1>
            <p className="mt-0.5 text-[11px] text-text-muted">{TAGLINE}</p>
          </div>
        </header>

        <section className="cl-enter mt-10" style={{ animationDelay: '50ms' }}>
          <CommandInput
            value={draft}
            onChange={setDraft}
            onSubmit={handleSubmit}
            loading={processing}
            placeholder="What should CommandLayer do?"
          />
          <div className="mt-3.5">
            <QuickActions
              variant="row"
              disabled={processing}
              onSelect={(action) => {
                void pipeline.submitQuickAction(action.id);
              }}
            />
          </div>
          <CommandResultCard
            phase={pipeline.phase}
            result={pipeline.result}
            errorMessage={pipeline.errorMessage}
          />
        </section>

        <section
          className="cl-enter mt-6 grid gap-3 sm:grid-cols-2"
          style={{ animationDelay: '100ms' }}
        >
          <CurrentPageCard
            context={context}
            loading={pageLoading}
            onRefresh={refresh}
          />
          <CommandLog entries={log} onClear={() => setLog([])} />
        </section>

        <footer className="mt-auto pt-10">
          <p className="text-center text-[10px] tracking-[0.04em] text-text-muted">
            {APP_NAME} · {PHASE_LABEL} · Commands run locally in this build
          </p>
        </footer>
      </main>
    </div>
  );
}
