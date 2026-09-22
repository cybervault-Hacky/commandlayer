/**
 * Phase 3 — command pipeline dispatcher.
 *
 *   Quick Action / Command Input
 *            ↓
 *      CommandRequest (structured, validated)
 *            ↓
 *      CommandDispatcher (per-source cancellation)
 *            ↓
 *      CommandHandler (AICommandHandler → reasoning engine)
 *            ↓
 *      CommandResult (validated AI response or typed error)
 *
 * Reasoning-only: the handler never performs browser actions. Every
 * result is either a validated AIResponse or a user-safe typed error.
 */
import {
  ErrorCode,
  USER_ERROR_MESSAGES,
} from '@/shared/constants/errors';
import { COMMAND_TEXT_MAX } from '@/shared/constants/app';
import { aiError } from '@/ai/errors';
import { buildAIContext } from '@/ai/context';
import { resolveIntent, intentForQuickAction } from '@/ai/intents';
import { runAIRequest } from '@/ai/client';
import {
  AIErrorCode,
  type AIError,
  type AIIntent,
  type AIResponse,
} from '@/ai/types';
import {
  isCommandSource,
  type CommandRequest,
  type CommandResult,
  type CommandSource,
} from '@/shared/types/command';

export type HandlerResult =
  | { kind: 'success'; response: AIResponse }
  | { kind: 'error'; error: AIError; intent?: AIIntent };

export interface CommandHandler {
  handle(request: CommandRequest, signal: AbortSignal): Promise<HandlerResult>;
}

/**
 * Routes every command through the AI reasoning engine. Quick actions
 * use their explicit intent; free text is classified deterministically
 * (keyword rules, ANSWER fallback). No model-based classification.
 */
export class AICommandHandler implements CommandHandler {
  async handle(
    request: CommandRequest,
    signal: AbortSignal,
  ): Promise<HandlerResult> {
    const text = request.text.trim();
    const intent: AIIntent =
      request.quickAction !== undefined
        ? intentForQuickAction(request.quickAction) ??
          resolveIntent(text)
        : resolveIntent(text);

    if (request.context === null) {
      return {
        kind: 'error',
        error: aiError(AIErrorCode.AI_PAGE_UNAVAILABLE),
        intent,
      };
    }

    const context = buildAIContext(request.context, intent);
    if (context === null) {
      return {
        kind: 'error',
        error: aiError(AIErrorCode.AI_PAGE_UNAVAILABLE),
        intent,
      };
    }

    const result = await runAIRequest({
      requestId: request.id,
      intent,
      userPrompt: text,
      context,
      signal,
    });

    if (!result.ok) {
      return { kind: 'error', error: result.error, intent };
    }
    return { kind: 'success', response: result.response };
  }
}

interface RequestProblem {
  code: ErrorCode;
  message: string;
}

function trimmedRequestText(request: CommandRequest): string {
  return typeof request.text === 'string' ? request.text.trim() : '';
}

function validateCommandRequest(
  request: CommandRequest,
): RequestProblem | null {
  if (!request || typeof request !== 'object') {
    return {
      code: ErrorCode.INVALID_PAYLOAD,
      message: USER_ERROR_MESSAGES[ErrorCode.INVALID_PAYLOAD],
    };
  }
  if (typeof request.id !== 'string' || request.id.length === 0) {
    return {
      code: ErrorCode.INVALID_PAYLOAD,
      message: USER_ERROR_MESSAGES[ErrorCode.INVALID_PAYLOAD],
    };
  }
  if (!isCommandSource(request.source)) {
    return {
      code: ErrorCode.INVALID_PAYLOAD,
      message: USER_ERROR_MESSAGES[ErrorCode.INVALID_PAYLOAD],
    };
  }
  const text = trimmedRequestText(request);
  if (text.length === 0) {
    return {
      code: ErrorCode.EMPTY_COMMAND,
      message: USER_ERROR_MESSAGES[ErrorCode.EMPTY_COMMAND],
    };
  }
  if (text.length > COMMAND_TEXT_MAX) {
    return {
      code: ErrorCode.INVALID_PAYLOAD,
      message: `Commands must be ${COMMAND_TEXT_MAX} characters or fewer.`,
    };
  }
  return null;
}

export class CommandDispatcher {
  /** Per-source in-flight request; a new dispatch cancels the old one. */
  private readonly inFlight = new Map<CommandSource, AbortController>();

  constructor(
    private readonly handler: CommandHandler = new AICommandHandler(),
  ) {}

  /** Dispatch a command; always resolves to a user-safe CommandResult. */
  async dispatch(request: CommandRequest): Promise<CommandResult> {
    const startedAt = new Date().toISOString();
    const commandText = trimmedRequestText(request);
    const base = {
      ...(commandText ? { commandText } : {}),
      source: request.source,
      ...(request.quickAction ? { quickAction: request.quickAction } : {}),
    };

    const problem = validateCommandRequest(request);
    if (problem) {
      return {
        id: request.id,
        status: 'failed',
        text: problem.message,
        ...base,
        errorCode: problem.code,
        startedAt,
        finishedAt: startedAt,
      };
    }

    // Supersede: cancel any in-flight request from the same surface.
    this.inFlight.get(request.source)?.abort();
    const controller = new AbortController();
    this.inFlight.set(request.source, controller);

    try {
      const output = await this.handler.handle(request, controller.signal);
      const finishedAt = new Date().toISOString();

      if (output.kind === 'error') {
        return {
          id: request.id,
          status: 'failed',
          text: output.error.message,
          ...base,
          ...(output.intent ? { intent: output.intent } : {}),
          errorCode: output.error.code,
          retryable: output.error.retryable,
          startedAt,
          finishedAt,
        };
      }

      return {
        id: request.id,
        status: 'completed',
        text: output.response.answer,
        ...base,
        intent: output.response.intent,
        ai: output.response,
        retryable: false,
        startedAt,
        finishedAt,
      };
    } catch {
      const finishedAt = new Date().toISOString();
      return {
        id: request.id,
        status: 'failed',
        text: USER_ERROR_MESSAGES[ErrorCode.UNEXPECTED_ERROR],
        ...base,
        errorCode: ErrorCode.UNEXPECTED_ERROR,
        startedAt,
        finishedAt,
      };
    } finally {
      if (this.inFlight.get(request.source) === controller) {
        this.inFlight.delete(request.source);
      }
    }
  }
}
