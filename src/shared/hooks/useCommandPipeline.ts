import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ErrorCode,
  USER_ERROR_MESSAGES,
} from '@/shared/constants/errors';
import { MessageType } from '@/shared/constants/messages';
import { sendMessage } from '@/shared/messaging/client';
import type { ActionPlan } from '@/actions/types';
import type { CommandSource, QuickActionId } from '@/shared/types/command';
import type { CommandResult } from '@/shared/types/command';
import type { WorkflowView } from '@/workflows/types';
import type { MessageResult } from '@/shared/types/message';

export type CommandPhase = 'idle' | 'processing' | 'completed' | 'failed';

interface PipelineState {
  phase: CommandPhase;
  result: CommandResult | null;
  errorMessage: string | null;
}

export interface UseCommandPipelineResult extends PipelineState {
  /** Submit free-text input through the COMMAND_SUBMIT pipeline. */
  submitText: (text: string, quickAction?: QuickActionId) => Promise<void>;
  /** Trigger a quick action through the QUICK_ACTION pipeline. */
  submitQuickAction: (actionId: QuickActionId) => Promise<void>;
  /**
   * Phase 4 — explicit approval + execution of a previewed plan. Sends
   * ONLY the plan identity; the background enforces hash binding,
   * freshness, and single-use approval.
   */
  executePlan: (plan: ActionPlan) => Promise<void>;
  /** Withdraw approval for a pending plan (Cancel button / Escape). */
  cancelPlan: (planId: string) => Promise<void>;
  /**
   * Phase 5 — approve the EXACT workflow the user reviewed. Only the
   * workflow id and its hash cross the boundary; the background re-checks
   * the hash, the approval TTL, the tab binding, and the one-workflow-per
   * -tab rule before the first step runs.
   */
  approveWorkflow: (workflow: WorkflowView) => Promise<void>;
  /** Pause a running workflow: no further step starts. */
  pauseWorkflow: (workflowId: string) => Promise<void>;
  /** Resume a paused workflow under the SAME approval and hash. */
  resumeWorkflow: (workflow: WorkflowView) => Promise<void>;
  /** Cancel: no future step may start (an in-flight step may finish). */
  cancelWorkflow: (workflowId: string) => Promise<void>;
  /** Read-only status refresh (bounded UI progress polling). */
  refreshWorkflow: (workflowId: string) => Promise<void>;
  /**
   * Phase 6 — commit ONE pending memory preview. Only the preview id
   * crosses the boundary; the background re-validates the policy and the
   * limits at commit time and stays the only writer.
   */
  confirmMemory: (previewId: string) => Promise<void>;
  /** Withdraw a pending memory preview — nothing was stored. */
  cancelMemory: (previewId: string) => Promise<void>;
  /** Re-run the last submitted command (enabled only when retryable). */
  retry: () => Promise<void>;
  reset: () => void;
}

/**
 * The UI-side command pipeline. Free text and quick actions share one state
 * machine and both travel through the background dispatcher, so behavior is
 * identical across surfaces.
 *
 * Phase 3 protections:
 * - STALE GUARD: each run increments a sequence; late responses from
 *   superseded runs are dropped silently (no state change, no onResult).
 * - RETRY: the last submission can be re-run for transient (retryable)
 *   failures.
 *
 * `onResult` is invoked with every NON-STALE terminal result so surfaces
 * can react — e.g. the Command Center session transcript — without effects.
 */
export function useCommandPipeline(
  source: CommandSource,
  onResult?: (result: CommandResult) => void,
): UseCommandPipelineResult {
  const [state, setState] = useState<PipelineState>({
    phase: 'idle',
    result: null,
    errorMessage: null,
  });
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  /** Monotonic run sequence for stale-response protection. */
  const runSeqRef = useRef(0);
  /** Re-executable closure of the last submission (for retry). */
  const lastExecuteRef = useRef<
    (() => Promise<MessageResult<CommandResult>>) | null
  >(null);

  const run = useCallback(async (
    execute: () => Promise<MessageResult<CommandResult>>,
  ) => {
    const seq = ++runSeqRef.current;
    lastExecuteRef.current = execute;
    setState({ phase: 'processing', result: null, errorMessage: null });
    const result = await execute();

    // Stale guard: a newer submission superseded this one while it was
    // in flight. Its result must never reach state or onResult.
    if (seq !== runSeqRef.current) return;

    let next: PipelineState;
    if (result.ok) {
      next =
        result.data.status === 'completed'
          ? { phase: 'completed', result: result.data, errorMessage: null }
          : {
              phase: 'failed',
              result: result.data,
              errorMessage: result.data.text,
            };
    } else {
      next = {
        phase: 'failed',
        result: null,
        errorMessage: result.error.message,
      };
    }
    setState(next);
    if (next.result) onResultRef.current?.(next.result);
  }, []);

  const submitText = useCallback(
    (text: string, quickAction?: QuickActionId) => {
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        setState({
          phase: 'failed',
          result: null,
          errorMessage: USER_ERROR_MESSAGES[ErrorCode.EMPTY_COMMAND],
        });
        return Promise.resolve();
      }
      return run(() =>
        sendMessage(MessageType.COMMAND_SUBMIT, {
          text: trimmed,
          source,
          ...(quickAction ? { quickAction } : {}),
        }),
      );
    },
    [run, source],
  );

  const submitQuickAction = useCallback(
    (actionId: QuickActionId) =>
      run(() =>
        sendMessage(MessageType.QUICK_ACTION, { actionId, source }),
      ),
    [run, source],
  );

  const executePlan = useCallback(
    (plan: ActionPlan) =>
      run(() =>
        sendMessage(MessageType.ACTION_EXECUTE, {
          planId: plan.planId,
          planHash: plan.planHash,
          source,
        }),
      ),
    [run, source],
  );

  const approveWorkflow = useCallback(
    (workflow: WorkflowView) =>
      run(() =>
        sendMessage(MessageType.WORKFLOW_APPROVE, {
          workflowId: workflow.workflowId,
          workflowHash: workflow.workflowHash,
          source,
        }),
      ),
    [run, source],
  );

  const pauseWorkflow = useCallback(
    (workflowId: string) =>
      run(() => sendMessage(MessageType.WORKFLOW_PAUSE, { workflowId })),
    [run],
  );

  const resumeWorkflow = useCallback(
    (workflow: WorkflowView) =>
      run(() =>
        sendMessage(MessageType.WORKFLOW_RESUME, {
          workflowId: workflow.workflowId,
          workflowHash: workflow.workflowHash,
        }),
      ),
    [run],
  );

  const cancelWorkflow = useCallback(
    (workflowId: string) =>
      run(() => sendMessage(MessageType.WORKFLOW_CANCEL, { workflowId })),
    [run],
  );

  const refreshWorkflow = useCallback(
    (workflowId: string) =>
      run(() => sendMessage(MessageType.WORKFLOW_STATUS, { workflowId })),
    [run],
  );

  const confirmMemory = useCallback(
    (previewId: string) =>
      run(() =>
        sendMessage(MessageType.MEMORY_CONFIRM, { previewId, source }),
      ),
    [run, source],
  );

  const reset = useCallback(() => {
    runSeqRef.current += 1;
    lastExecuteRef.current = null;
    setState({ phase: 'idle', result: null, errorMessage: null });
  }, []);

  const cancelMemory = useCallback(
    async (previewId: string) => {
      // Fire-and-forget withdrawal: the preview simply stops being
      // pending, and the UI clears the confirmation card.
      void sendMessage(MessageType.MEMORY_CANCEL, { previewId });
      reset();
    },
    [reset],
  );

  const cancelPlan = useCallback(
    async (planId: string) => {
      // Fire-and-forget withdrawal (sendMessage never throws); the UI
      // state resets regardless of the transport outcome.
      void sendMessage(MessageType.ACTION_CANCEL, { planId });
      reset();
    },
    [reset],
  );

  const retry = useCallback(async () => {
    const execute = lastExecuteRef.current;
    if (!execute) return;
    await run(execute);
  }, [run]);

  return {
    phase: state.phase,
    result: state.result,
    errorMessage: state.errorMessage,
    submitText,
    submitQuickAction,
    executePlan,
    cancelPlan,
    approveWorkflow,
    pauseWorkflow,
    resumeWorkflow,
    cancelWorkflow,
    refreshWorkflow,
    confirmMemory,
    cancelMemory,
    retry,
    reset,
  };
}
