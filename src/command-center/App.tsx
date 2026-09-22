import { useCallback, useRef, useState } from 'react';
import {
  APP_NAME,
  COMMAND_LOG_LIMIT,
  PHASE_LABEL,
  TAGLINE,
} from '@/shared/constants/app';
import { CommandSource } from '@/shared/types/command';
import {
  getQuickAction,
  type QuickAction,
} from '@/shared/constants/quickActions';
import { useCommandPipeline } from '@/shared/hooks/useCommandPipeline';
import { usePageContext } from '@/shared/hooks/usePageContext';
import { useWorkflowController } from '@/shared/hooks/useWorkflowController';
import { WorkflowStatus } from '@/workflows/types';
import { BrandMark } from '@/shared/components/icons';
import { CommandInput } from '@/shared/components/CommandInput';
import { CurrentPageCard } from '@/shared/components/CurrentPageCard';
import { QuickActions } from '@/shared/components/QuickActions';
import { WorkflowPreviewCard } from '@/shared/components/WorkflowPreviewCard';
import { WorkflowProgressCard } from '@/shared/components/WorkflowProgressCard';
import {
  SessionTranscript,
  type TranscriptEntry,
} from './components/SessionTranscript';

/**
 * The full-window intelligence experience, opened from the popup.
 *
 * Phase 3: a session-only reasoning transcript. User questions and the
 * validated AI answers accumulate here for the lifetime of the tab —
 * nothing is persisted anywhere.
 *
 * Phase 6: memory requests appear in the transcript too ("Memory saved.")
 * and stay interactive while a confirmation is pending. The transcript is
 * still session-only; saved memories live in Settings → Memory.
 */
export function App() {
  const { context, loading: pageLoading, refresh } = usePageContext();
  const [draft, setDraft] = useState('');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  /** Id of the question the in-flight answer belongs to. */
  const pendingTurnIdRef = useRef<string | null>(null);

  const appendTurn = useCallback((entry: TranscriptEntry) => {
    setTranscript((prev) => [...prev, entry].slice(-COMMAND_LOG_LIMIT));
  }, []);

  // Phase 5: the workflow card is driven by its own bounded controller;
  // the transcript keeps the session-only record of every turn.
  const workflow = useWorkflowController(CommandSource.CommandCenter);

  const pipeline = useCommandPipeline(
    CommandSource.CommandCenter,
    (result) => {
      // Assistant turn: pair it with the pending user turn id.
      const pendingId = pendingTurnIdRef.current;
      pendingTurnIdRef.current = null;
      if (result.status === 'completed') setDraft('');
      if (result.workflow) workflow.open(result.workflow);
      appendTurn({
        kind: 'assistant',
        id: pendingId ? `${pendingId}-a` : result.id,
        result,
        at: result.finishedAt,
      });
    },
  );

  const processing = pipeline.phase === 'processing';

  const submitUserTurn = useCallback(
    (text: string) => {
      const id = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      pendingTurnIdRef.current = id;
      appendTurn({
        kind: 'user',
        id,
        text,
        at: new Date().toISOString(),
      });
    },
    [appendTurn],
  );

  const handleSubmit = useCallback(() => {
    const text = draft.trim();
    if (text.length === 0 || processing) return;
    submitUserTurn(text);
    void pipeline.submitText(text);
  }, [pipeline, draft, processing, submitUserTurn]);

  const activeWorkflow = workflow.workflow;

  const handleQuickAction = useCallback(
    (action: QuickAction) => {
      if (processing) return;
      submitUserTurn(getQuickAction(action.id)?.template ?? action.label);
      void pipeline.submitQuickAction(action.id);
    },
    [pipeline, processing, submitUserTurn],
  );

  return (
    <div className="cl-app min-h-full">
      <main className="mx-auto flex min-h-full w-full max-w-[560px] flex-col px-6 py-10">
        <header className="cl-enter flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BrandMark size={26} />
            <div>
              <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-text-primary">
                Command Center
              </h1>
              <p className="mt-0.5 text-[11px] text-text-muted">{TAGLINE}</p>
            </div>
          </div>
        </header>

        <section
          className="cl-enter mt-8"
          style={{ animationDelay: '50ms' }}
          aria-label="Session transcript"
        >
          <SessionTranscript
            entries={transcript}
            onClear={() => setTranscript([])}
            liveMemoryEntryId={pipeline.result?.memory ? pipeline.result.id : null}
            onMemoryConfirm={(previewId) => void pipeline.confirmMemory(previewId)}
            onMemoryCancel={(previewId) => pipeline.cancelMemory(previewId)}
          />
        </section>

        <section className="cl-enter mt-5" style={{ animationDelay: '100ms' }}>
          <CommandInput
            value={draft}
            onChange={setDraft}
            onSubmit={handleSubmit}
            loading={processing}
            placeholder="Ask about this page…"
          />
          <div className="mt-3.5">
            <QuickActions
              variant="row"
              disabled={processing}
              onSelect={handleQuickAction}
            />
          </div>
        </section>

        {activeWorkflow && (
          <section
            className="cl-enter mt-5"
            style={{ animationDelay: '130ms' }}
            aria-label="Active workflow"
          >
            {activeWorkflow.status === WorkflowStatus.AwaitingApproval ? (
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
                  workflow.phase === 'working' || workflow.phase === 'running'
                }
                onPause={() => void workflow.pause()}
                onResume={() => void workflow.resume()}
                onCancel={() => void workflow.cancel()}
                onOpenFollowUp={(followUp) => workflow.open(followUp)}
                notice={workflow.notice}
              />
            )}
          </section>
        )}

        <section
          className="cl-enter mt-5"
          style={{ animationDelay: '150ms' }}
          aria-label="Current page"
        >
          <CurrentPageCard
            context={context}
            loading={pageLoading}
            onRefresh={refresh}
          />
        </section>

        <footer className="mt-auto pt-10">
          <p className="text-center text-[10px] tracking-[0.04em] text-text-muted">
            {APP_NAME} · {PHASE_LABEL} · Transcript is session-only and
            never stored
          </p>
        </footer>
      </main>
    </div>
  );
}
