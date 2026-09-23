import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageType } from '@/shared/constants/messages';
import { sendMessage } from '@/shared/messaging/client';
import type { CommandSource } from '@/shared/types/command';
import {
  isTerminalWorkflowStatus,
  WorkflowStatus,
  type WorkflowRunResult,
  type WorkflowView,
} from '@/workflows/types';

/**
 * UI-side workflow controller (Phase 5).
 *
 * The workflow itself lives in the background session. This hook only
 * holds the latest bounded VIEW, sends identity-only messages (workflowId
 * + the reviewed workflowHash), and polls a bounded number of status
 * snapshots while an approved run is in flight so the progress card can
 * show "Step 2 of 3" — there is no unbounded watching and the poller
 * stops on the first terminal status, on unmount, and at a hard cap.
 */
const DEFAULT_POLL_INTERVAL_MS = 900;
const DEFAULT_MAX_POLLS = 150;

export type WorkflowPhase = 'idle' | 'preview' | 'working' | 'running' | 'done';

export interface UseWorkflowControllerOptions {
  /** Test seam: shorten the bounded progress poll interval. */
  pollIntervalMs?: number;
  maxPolls?: number;
}

export interface UseWorkflowControllerResult {
  workflow: WorkflowView | null;
  run: WorkflowRunResult | null;
  phase: WorkflowPhase;
  /** Inline, user-safe failure wording (never a raw exception). */
  notice: string | null;
  /** Load a created workflow (preview) or a follow-up proposal. */
  open: (workflow: WorkflowView) => void;
  approve: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  cancel: () => Promise<void>;
  dismiss: () => void;
}

interface ControllerState {
  workflow: WorkflowView | null;
  run: WorkflowRunResult | null;
  phase: WorkflowPhase;
  notice: string | null;
}

const IDLE: ControllerState = {
  workflow: null,
  run: null,
  phase: 'idle',
  notice: null,
};

function phaseFor(status: WorkflowStatus): WorkflowPhase {
  if (status === WorkflowStatus.AwaitingApproval) return 'preview';
  if (status === WorkflowStatus.Paused) return 'running';
  if (isTerminalWorkflowStatus(status)) return 'done';
  return 'running';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function useWorkflowController(
  source: CommandSource,
  options: UseWorkflowControllerOptions = {},
): UseWorkflowControllerResult {
  const [state, setState] = useState<ControllerState>(IDLE);
  /** Latest state for event handlers (synced in an effect, never on render). */
  const stateRef = useRef<ControllerState>(IDLE);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /** Run generation: a newer action invalidates older polls and replies. */
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const pollInterval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPolls = options.maxPolls ?? DEFAULT_MAX_POLLS;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const applyResult = useCallback(
    (generation: number, workflowId: string, data: unknown) => {
      if (generationRef.current !== generation) return;
      const result = data as {
        workflow?: WorkflowView;
        workflowRun?: WorkflowRunResult;
        status?: string;
        text?: string;
      };
      setState((prev) => {
        const workflow = result.workflow ?? prev.workflow;
        if (!workflow || workflow.workflowId !== workflowId) {
          return prev;
        }
        const run = result.workflowRun ?? prev.run;
        return {
          workflow,
          run,
          phase: phaseFor(workflow.status),
          notice:
            result.status === 'failed' && result.text ? result.text : null,
        };
      });
    },
    [],
  );

  /** Bounded progress polling: stops at a terminal status or the cap. */
  const poll = useCallback(
    async (generation: number, workflowId: string) => {
      for (let attempt = 0; attempt < maxPolls; attempt += 1) {
        await delay(pollInterval);
        if (!mountedRef.current || generationRef.current !== generation) return;
        const result = await sendMessage(MessageType.WORKFLOW_STATUS, {
          workflowId,
        });
        if (!mountedRef.current || generationRef.current !== generation) return;
        if (!result.ok) return;
        if (result.data.workflow) {
          applyResult(generation, workflowId, result.data);
          const status = result.data.workflow.status;
          if (isTerminalWorkflowStatus(status) || status === WorkflowStatus.Paused) {
            return;
          }
        }
      }
    },
    [applyResult, maxPolls, pollInterval],
  );

  const send = useCallback(
    async (
      generate: (generation: number) => Promise<
        { ok: true; data: unknown } | { ok: false; error: { message: string } }
      >,
      options: { pollWhileRunning: boolean },
    ) => {
      const current = stateRef.current.workflow;
      if (!current) return;
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      setState((prev) => ({ ...prev, phase: 'working', notice: null }));
      const pending = generate(generation);
      if (options.pollWhileRunning) {
        void poll(generation, current.workflowId);
      }
      const result = await pending;
      if (!mountedRef.current || generationRef.current !== generation) return;
      if (result.ok) {
        applyResult(generation, current.workflowId, result.data);
        return;
      }
      setState((prev) => ({
        ...prev,
        phase: prev.workflow ? phaseFor(prev.workflow.status) : 'idle',
        notice: result.error.message,
      }));
    },
    [applyResult, poll],
  );

  const open = useCallback((workflow: WorkflowView) => {
    generationRef.current += 1;
    setState({
      workflow,
      run: null,
      phase: phaseFor(workflow.status),
      notice: null,
    });
  }, []);

  const approve = useCallback(async () => {
    const current = stateRef.current.workflow;
    if (!current) return;
    await send(
      () =>
        sendMessage(MessageType.WORKFLOW_APPROVE, {
          workflowId: current.workflowId,
          workflowHash: current.workflowHash,
          source,
        }).then((result) =>
          result.ok
            ? { ok: true as const, data: result.data }
            : { ok: false as const, error: result.error },
        ),
      { pollWhileRunning: true },
    );
  }, [send, source]);

  const pause = useCallback(async () => {
    const current = stateRef.current.workflow;
    if (!current) return;
    await send(
      () =>
        sendMessage(MessageType.WORKFLOW_PAUSE, {
          workflowId: current.workflowId,
        }).then((result) =>
          result.ok
            ? { ok: true as const, data: result.data }
            : { ok: false as const, error: result.error },
        ),
      { pollWhileRunning: false },
    );
  }, [send]);

  const resume = useCallback(async () => {
    const current = stateRef.current.workflow;
    if (!current) return;
    await send(
      () =>
        sendMessage(MessageType.WORKFLOW_RESUME, {
          workflowId: current.workflowId,
          workflowHash: current.workflowHash,
        }).then((result) =>
          result.ok
            ? { ok: true as const, data: result.data }
            : { ok: false as const, error: result.error },
        ),
      { pollWhileRunning: true },
    );
  }, [send]);

  const cancel = useCallback(async () => {
    const current = stateRef.current.workflow;
    if (!current) return;
    await send(
      () =>
        sendMessage(MessageType.WORKFLOW_CANCEL, {
          workflowId: current.workflowId,
        }).then((result) =>
          result.ok
            ? { ok: true as const, data: result.data }
            : { ok: false as const, error: result.error },
        ),
      { pollWhileRunning: true },
    );
  }, [send]);

  const dismiss = useCallback(() => {
    generationRef.current += 1;
    setState(IDLE);
  }, []);

  return {
    workflow: state.workflow,
    run: state.run,
    phase: state.phase,
    notice: state.notice,
    open,
    approve,
    pause,
    resume,
    cancel,
    dismiss,
  };
}
