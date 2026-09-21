import { useCallback, useState } from 'react';
import {
  APP_NAME,
  PHASE_LABEL,
} from '@/shared/constants/app';
import { CommandSource } from '@/shared/types/command';
import type { QuickAction } from '@/shared/constants/quickActions';
import {
  useCommandPipeline,
} from '@/shared/hooks/useCommandPipeline';
import { usePageContext } from '@/shared/hooks/usePageContext';
import { useSettings } from '@/shared/hooks/useSettings';
import { BrandMark, IconSettings } from '@/shared/components/icons';
import { CommandInput } from '@/shared/components/CommandInput';
import { CommandResultCard } from '@/shared/components/CommandResultCard';
import { CurrentPageCard } from '@/shared/components/CurrentPageCard';
import { QuickActions } from '@/shared/components/QuickActions';
import { SettingsView } from './components/SettingsView';
import { FirstRunTip } from './components/FirstRunTip';

type PanelView = 'home' | 'settings';

/**
 * The primary Phase 1 experience.
 *
 * Header → hero → command input → quick actions → current page → footer.
 * All state flows through the shared hooks; no business logic lives here.
 */
export function App() {
  const { settings, update } = useSettings();
  const { context, loading: pageLoading, refresh } = usePageContext();
  const [view, setView] = useState<PanelView>('home');
  const [draft, setDraft] = useState('');

  // Successful free-text commands clear the draft.
  const pipeline = useCommandPipeline(CommandSource.SidePanel, (result) => {
    if (result.status === 'completed') setDraft('');
  });

  const processing = pipeline.phase === 'processing';

  const handleSubmit = useCallback(() => {
    void pipeline.submitText(draft);
  }, [pipeline, draft]);

  const handleQuickAction = useCallback(
    (action: QuickAction) => {
      void pipeline.submitQuickAction(action.id);
    },
    [pipeline],
  );

  return (
    <div className="cl-app h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[400px] flex-col px-4 pb-4 pt-4 sm:px-5">
        {view === 'home' ? (
          <>
            <header className="cl-enter flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <BrandMark size={22} />
                <span className="text-[13px] font-semibold tracking-[0.01em] text-text-primary">
                  Command<span className="text-accent">Layer</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setView('settings')}
                className="btn-secondary h-8 gap-1.5 px-2.5 text-xs"
              >
                <IconSettings size={14} />
                Settings
              </button>
            </header>

            <section className="cl-enter mt-7" style={{ animationDelay: '40ms' }}>
              <h1 className="text-[21px] font-semibold leading-[1.3] tracking-[-0.01em] text-text-primary">
                Your web,{' '}
                <br />
                <span className="text-text-secondary">
                  intelligently connected.
                </span>
              </h1>
            </section>

            <section className="cl-enter mt-5" style={{ animationDelay: '80ms' }}>
              <CommandInput
                value={draft}
                onChange={setDraft}
                onSubmit={handleSubmit}
                loading={processing}
              />
              <CommandResultCard
                phase={pipeline.phase}
                result={pipeline.result}
                errorMessage={pipeline.errorMessage}
              />
            </section>

            <section className="cl-enter mt-4" style={{ animationDelay: '120ms' }}>
              <QuickActions onSelect={handleQuickAction} disabled={processing} />
            </section>

            {!settings.onboardingSeen && (
              <div className="cl-enter" style={{ animationDelay: '160ms' }}>
                <FirstRunTip
                  onDismiss={() => {
                    void update({ onboardingSeen: true });
                  }}
                />
              </div>
            )}

            <section
              className="cl-enter mt-4"
              style={{ animationDelay: '200ms' }}
              aria-label="Current page"
            >
              <CurrentPageCard
                context={context}
                loading={pageLoading}
                onRefresh={refresh}
              />
            </section>

            <footer className="mt-auto pt-8">
              <p className="text-center text-[10px] tracking-[0.04em] text-text-muted">
                {APP_NAME} · {PHASE_LABEL}
              </p>
            </footer>
          </>
        ) : (
          <SettingsView onBack={() => setView('home')} />
        )}
      </div>
    </div>
  );
}
