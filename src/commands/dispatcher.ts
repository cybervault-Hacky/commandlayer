/**
 * Command pipeline dispatcher (Phase 3 reasoning + Phase 4 actions).
 *
 *   Quick Action / Command Input
 *            ↓
 *      CommandRequest (structured, validated)
 *            ↓
 *      CommandDispatcher (per-source cancellation)
 *            ↓
 *      CommandHandler (AICommandHandler)
 *            ├─ deterministic action planner → ActionPlan (preview,
 *            │   explicit approval required — nothing executes here)
 *            └─ reasoning engine → validated AIResponse
 *            ↓
 *      CommandResult (validated data or typed error)
 *
 * Safety: the planner's output is stored in the background session
 * store and only ever executes through ACTION_EXECUTE (plan-hash bound,
 * single-use approval). There is no execution path in this module.
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
import { planAction, looksLikeActionRequest } from '@/actions/planner';
import { actionSessionStore } from '@/actions/session';
import { actionRegistry } from '@/actions/registry';
import { pageContentDigest } from '@/page-intelligence/hash';
import type { ActionPlan } from '@/actions/types';
import {
  isCommandSource,
  type CommandRequest,
  type CommandResult,
  type CommandSource,
} from '@/shared/types/command';

export type HandlerResult =
  | { kind: 'success'; response: AIResponse }
  | { kind: 'error'; error: AIError; intent?: AIIntent }
  | { kind: 'plan'; plan: ActionPlan };

export interface CommandHandler {
  handle(request: CommandRequest, signal: AbortSignal): Promise<HandlerResult>;
}

/**
 * Routes every command: quick actions keep their explicit reasoning
 * intent; free text first passes the deterministic action planner, then
 * falls through to the reasoning engine (keyword rules, ANSWER
 * fallback). No model-based classification anywhere.
 */
export class AICommandHandler implements CommandHandler {
  async handle(
    request: CommandRequest,
    signal: AbortSignal,
  ): Promise<HandlerResult> {
    const text = request.text.trim();

    if (request.quickAction !== undefined) {
      const intent =
        intentForQuickAction(request.quickAction) ?? resolveIntent(text);
      return this.reason(request, text, intent, signal);
    }

    // Phase 4: explicit action phrasings produce a PLAN, never direct
    // execution. Planning requires a real page context to bind to.
    if (looksLikeActionRequest(text)) {
      const planResult = this.plan(request, text);
      if (planResult !== null) return planResult;
      // Not plannable (e.g. no page bound) → fall through to reasoning.
    }

    return this.reason(request, text, resolveIntent(text), signal);
  }

  private plan(
    request: CommandRequest,
    text: string,
  ): HandlerResult | null {
    if (request.context === null || request.tabId === undefined) {
      return null;
    }
    const context = request.context;
    if (context.state !== 'ready' && context.state !== 'partial') {
      return null;
    }
    const outcome = planAction(text, {
      requestId: request.id,
      tabId: request.tabId,
      url: context.url ?? '',
      contentHash: pageContentDigest(context),
    });
    if (outcome.plan) {
      // The plan lives in the background session store; execution needs
      // a separate explicit approval bound to this exact hash.
      actionSessionStore.addPlan(outcome.plan);
      return { kind: 'plan', plan: outcome.plan };
    }
    return null;
  }

  private async reason(
    request: CommandRequest,
    text: string,
    intent: AIIntent,
    signal: AbortSignal,
  ): Promise<HandlerResult> {
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

function planSummary(plan: ActionPlan): string {
  const count = plan.actions.length;
  const first = plan.actions[0];
  if (count === 1 && first) {
    return `Proposed action: ${first.preview}`;
  }
  return `Proposed ${count} actions — review before allowing.`;
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

      if (output.kind === 'plan') {
        // A proposal is a successful COMMAND, not an execution: nothing
        // runs until the user approves the exact stored plan.
        return {
          id: request.id,
          status: 'completed',
          text: planSummary(output.plan),
          ...base,
          plan: output.plan,
          retryable: false,
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

/** Risk label helper reused by the UI (single source of truth). */
export function riskLabel(risk: string): string {
  switch (risk) {
    case 'READ_ONLY':
      return 'Read-only';
    case 'LOW_RISK':
      return 'Low risk';
    case 'CONFIRMATION_REQUIRED':
      return 'Requires confirmation';
    default:
      return actionRegistry.isRegistered(risk) ? 'Requires confirmation' : 'Unknown';
  }
}
