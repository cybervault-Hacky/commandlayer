import { useCallback, useState } from 'react';
import {
  APP_NAME,
  PHASE_LABEL,
} from '@/shared/constants/app';
import { CommandSource } from '@/shared/types/command';
import type { QuickAction } from '@/shared/constants/quickActions';
import type { ActionPlan } from '@/actions/types';
import {
  useCommandPipeline,
} from '@/shared/hooks/useCommandPipeline';
import { usePageContext } from '@/shared/hooks/usePageContext';
import { usePageIntelligence } from '@/shared/hooks/usePageIntelligence';
import { useSettings } from '@/shared/hooks/useSettings';
import { useWorkflowController } from '@/shared/hooks/useWorkflowController';
import { WorkflowStatus } from '@/workflows/types';
import { BrandMark, IconSettings } from '@/shared/components/icons';
import { AIResponseCard } from '@/shared/components/AIResponseCard';
import { ActionPreviewCard } from '@/shared/components/ActionPreviewCard';
import { ActionProgressCard } from '@/shared/components/ActionProgressCard';
import { CommandInput } from '@/shared/components/CommandInput';
import { CurrentPageCard } from '@/shared/components/CurrentPageCard';
import { PageInsightCard } from '@/shared/components/PageInsightCard';
import { QuickActions } from '@/shared/components/QuickActions';
import { WorkflowPreviewCard } from '@/shared/components/WorkflowPreviewCard';
import { WorkflowProgressCard } from '@/shared/components/WorkflowProgressCard';
import { MemoryPreviewCard } from '@/shared/components/MemoryPreviewCard';
import { MemoryResultCard } from '@/shared/components/MemoryResultCard';
import { SettingsView } from './components/SettingsView';
import { MemoryView } from './components/MemoryView';
import { FirstRunTip } from './components/FirstRunTip';

type PanelView = 'home' | 'settings' | 'memory';

/**
 * Phase 4: the Side Panel is the CommandLayer intelligence + safe action
 * interface.
 *
 * Hero → command box → quick actions → [reasoning response | action
 * preview | execution progress | memory confirmation] → current page
 * insight. Settings hosts the Phase 6 memory manager.
 *
 * Every action follows PREVIEW → PERMISSION → EXECUTE → VERIFY: nothing
 * runs from a plain command, and approval is an explicit button press.
 */
export function App() {
  const { settings, update } = useSettings();
  const { context, loading: pageLoading, refresh } = usePageContext();
  const { insight, capturing, capture } = usePageIntelligence(context);
  const [view, setView] = useState<PanelView>('home');
  const [draft, setDraft] = useState('');
  /** The plan currently being executed (preview → progress binding). */
  const [executingPlan, setExecutingPlan] = useState<ActionPlan | null>(null);

  // Phase 5: an approved workflow runs in the background; the panel shows
  // its bounded preview, step progress, and result.
  const workflow = useWorkflowController(CommandSource.SidePanel);

  // Successful free-text commands clear the draft.
  const pipeline = useCommandPipeline(CommandSource.SidePanel, (result) => {
    if (result.status === 'completed' && !result.execution) setDraft('');
    if (result.workflow) workflow.open(result.workflow);
  });

  const processing = pipeline.phase === 'processing';
  const result = pipeline.result;

  const handleSubmit = useCallback(() => {
    setExecutingPlan(null);
    workflow.dismiss();
    void pipeline.submitText(draft);
  }, [pipeline, draft, workflow]);

  const handleQuickAction = useCallback(
    (action: QuickAction) => {
      setExecutingPlan(null);
      workflow.dismiss();
      void pipeline.submitQuickAction(action.id);
    },
    [pipeline, workflow],
  );

  const handleApprove = useCallback(
    (plan: ActionPlan) => {
      setExecutingPlan(plan);
      void pipeline.executePlan(plan);
    },
    [pipeline],
  );

  const handleCancelPlan = useCallback(
    (plan: ActionPlan) => {
      setExecutingPlan(null);
      void pipeline.cancelPlan(plan.planId);
    },
    [pipeline],
  );

  const handleClear = useCallback(() => {
    setExecutingPlan(null);
    workflow.dismiss();
    pipeline.reset();
  }, [pipeline, workflow]);

  // Which card owns the command slot?
  const execution = result?.execution ?? null;
  const previewPlan =
    result?.plan && !execution && pipeline.phase !== 'processing'
      ? result.plan
      : null;
  const runningPlan = processing && executingPlan ? executingPlan : null;
  const activeWorkflow = workflow.workflow;
  // Phase 6 — a memory change is never applied from a command: it waits
  // for an explicit confirmation here.
  const memoryPreview = result?.memory ?? null;
  const memoryResult = result?.memoryResult ?? null;
  const showReasoningCard =
    !activeWorkflow &&
    !execution &&
    !previewPlan &&
    !runningPlan &&
    !memoryPreview &&
    !memoryResult;

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
                Ask about this page.
                <br />
                <span className="text-text-secondary">
                  Request safe actions.
                </span>
              </h1>
              <p className="mt-1.5 text-[11.5px] leading-4 text-text-muted">
                Intelligence about the page you are viewing — plus safe,
                bounded actions. Every action is previewed first and runs
                only after your explicit approval.
              </p>
            </section>

            <section className="cl-enter mt-5" style={{ animationDelay: '80ms' }}>
              <CommandInput
                value={draft}
                onChange={setDraft}
                onSubmit={handleSubmit}
                loading={processing}
                placeholder="Ask, or say “find …”, “scroll …”, “click …”"
              />

              {activeWorkflow &&
                (activeWorkflow.status === WorkflowStatus.AwaitingApproval ? (
                  <WorkflowPreviewCard
                    workflow={activeWorkflow}
                    onApprove={() => void workflow.approve()}
                    onCancel={() => workflow.dismiss()}
                    notice={workflow.notice}
                  />
                ) : (
                  <WorkflowProgressCard
                    workflow={activeWorkflow}
                    run={workflow.run}
                    running={
                      workflow.phase === 'working' ||
                      workflow.phase === 'running'
                    }
                    onPause={() => void workflow.pause()}
                    onResume={() => void workflow.resume()}
                    onCancel={() => void workflow.cancel()}
                    onOpenFollowUp={(followUp) => workflow.open(followUp)}
                    notice={workflow.notice}
                  />
                ))}

              {runningPlan && (
                <ActionProgressCard
                  plan={runningPlan}
                  execution={null}
                  running
                />
              )}

              {execution && (
                <ActionProgressCard
                  plan={
                    executingPlan && executingPlan.planId === execution.planId
                      ? executingPlan
                      : null
                  }
                  execution={execution}
                />
              )}

              {memoryPreview && (
                <MemoryPreviewCard
                  preview={memoryPreview}
                  onConfirm={() => {
                    void pipeline.confirmMemory(memoryPreview.previewId);
                  }}
                  onCancel={() => {
                    pipeline.cancelMemory(memoryPreview.previewId);
                  }}
                />
              )}

              {!memoryPreview && memoryResult && (
                <MemoryResultCard result={memoryResult} onDismiss={handleClear} />
              )}

              {previewPlan && (
                <ActionPreviewCard
                  plan={previewPlan}
                  onApprove={() => handleApprove(previewPlan)}
                  onCancel={() => handleCancelPlan(previewPlan)}
                />
              )}

              {showReasoningCard && (
                <AIResponseCard
                  phase={pipeline.phase}
                  result={result}
                  errorMessage={pipeline.errorMessage}
                  onRetry={() => void pipeline.retry()}
                  onClear={handleClear}
                />
              )}
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

            <section
              className="cl-enter mt-3"
              style={{ animationDelay: '240ms' }}
              aria-label="Page insight"
            >
              <PageInsightCard
                basicContext={context}
                insight={insight}
                capturing={capturing}
                onCapture={() => void capture()}
              />
            </section>

            <footer className="mt-auto pt-8">
              <p className="text-center text-[10px] tracking-[0.04em] text-text-muted">
                {APP_NAME} · {PHASE_LABEL}
              </p>
            </footer>
          </>
        ) : (
          view === 'settings' ? (
            <SettingsView
              onBack={() => setView('home')}
              onOpenMemory={() => setView('memory')}
            />
          ) : (
            <MemoryView onBack={() => setView('settings')} />
          )
        )}
      </div>
    </div>
  );
}
