import {
  ErrorCode,
  USER_ERROR_MESSAGES,
} from '@/shared/constants/errors';
import { getActiveAIProvider } from '@/ai';
import { isAIError, type AIError, type AIRequest, type AIResponse } from '@/ai/types';
import { toUserFacingError } from '@/shared/security/errors';
import { COMMAND_TEXT_MAX } from '@/shared/constants/app';
import type { CommandRequest, CommandResult } from '@/shared/types/command';

/**
 * Command pipeline:
 *
 *   Quick Action / Command Input
 *            ↓
 *      CommandRequest (structured, validated)
 *            ↓
 *      CommandDispatcher
 *            ↓
 *   CommandHandler (Phase 1: AICommandHandler → mock AI provider)
 *            ↓
 *      CommandResult (user-safe)
 *
 * Handlers are swappable — future AI phases replace AICommandHandler
 * without touching the dispatcher or the UI.
 */
export interface CommandHandler {
  handle(request: CommandRequest): Promise<AIResponse | AIError>;
}

export class AICommandHandler implements CommandHandler {
  handle(request: CommandRequest): Promise<AIResponse | AIError> {
    const provider = getActiveAIProvider();
    const aiRequest: AIRequest = {
      id: request.id,
      prompt: request.text,
      context: { page: request.context ?? undefined },
    };
    return provider.complete(aiRequest);
  }
}

interface RequestProblem {
  code: (typeof ErrorCode)[keyof typeof ErrorCode];
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
  constructor(
    private readonly handler: CommandHandler = new AICommandHandler(),
  ) {}

  /** Dispatch a command; always resolves to a user-safe CommandResult. */
  async dispatch(request: CommandRequest): Promise<CommandResult> {
    const startedAt = new Date().toISOString();

  const commandText = trimmedRequestText(request);
  const problem = validateCommandRequest(request);
  if (problem) {
    return {
      id: request.id,
      status: 'failed',
      text: problem.message,
      ...(commandText ? { commandText } : {}),
      source: request.source,
      ...(request.quickAction ? { quickAction: request.quickAction } : {}),
      errorCode: problem.code,
      startedAt,
      finishedAt: startedAt,
    };
  }

  try {
    const output = await this.handler.handle(request);
    const finishedAt = new Date().toISOString();

    if (isAIError(output)) {
      const code =
        output.code === 'AI_INVALID_REQUEST'
          ? ErrorCode.EMPTY_COMMAND
          : ErrorCode.AI_UNAVAILABLE;
      return {
        id: request.id,
        status: 'failed',
        text: USER_ERROR_MESSAGES[code],
        ...(commandText ? { commandText } : {}),
        source: request.source,
        ...(request.quickAction ? { quickAction: request.quickAction } : {}),
        errorCode: code,
        startedAt,
        finishedAt,
      };
    }

    return {
      id: request.id,
      status: 'completed',
      text: output.text,
      commandText,
      source: request.source,
      ...(request.quickAction ? { quickAction: request.quickAction } : {}),
      startedAt,
      finishedAt,
    };
  } catch (error) {
    const safe = toUserFacingError(error);
    return {
      id: request.id,
      status: 'failed',
      text: safe.message,
      ...(commandText ? { commandText } : {}),
      source: request.source,
      ...(request.quickAction ? { quickAction: request.quickAction } : {}),
      errorCode: safe.code,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
  }
}
