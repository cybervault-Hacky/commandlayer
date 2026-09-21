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
import type { CommandSource, QuickActionId } from '@/shared/types/command';
import type { CommandResult } from '@/shared/types/command';
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
  reset: () => void;
}

/**
 * The UI-side command pipeline. Free text and quick actions share one state
 * machine and both travel through the background dispatcher, so behavior is
 * identical to what future AI phases will replace.
 *
 * `onResult` is invoked (in an async callback, after state settles) with
 * every terminal result, so surfaces can react — e.g. the Command Center
 * session log — without effects.
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

  const run = useCallback(async (
    execute: () => Promise<MessageResult<CommandResult>>,
  ) => {
    setState({ phase: 'processing', result: null, errorMessage: null });
    const result = await execute();

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

  const reset = useCallback(() => {
    setState({ phase: 'idle', result: null, errorMessage: null });
  }, []);

  return {
    phase: state.phase,
    result: state.result,
    errorMessage: state.errorMessage,
    submitText,
    submitQuickAction,
    reset,
  };
}
