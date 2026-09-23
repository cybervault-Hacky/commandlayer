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
import { planAction, looksLikeActionRequest, finalizePlan } from '@/actions/planner';
import { actionSessionStore } from '@/actions/session';
import { parseDeveloperRequest } from '@/developer/parser';
import { buildDeveloperContext } from '@/developer/context';
import { analyzeDeveloperContext } from '@/developer/analysis';
import { buildDeveloperResult } from '@/developer';
import { toNavigationTargets } from '@/developer/plan';
import type {
  DeveloperRequest,
  DeveloperResultView,
} from '@/developer/types';
import { planWorkflow } from '@/workflows/planner';
import {
  analyzeGoalText,
  TaskKind,
} from '@/workflows/understanding';
import { toWorkflowView, workflowSessionStore } from '@/workflows/state';
import type { TaskUnderstanding } from '@/workflows/understanding';
import type { WorkflowView } from '@/workflows/types';
import { actionRegistry } from '@/actions/registry';
import { pageContentDigest } from '@/page-intelligence/hash';
import { ACTION_LIMITS } from '@/actions/limits';
import {
  ActionKind,
  type Action,
  type ActionPlan,
} from '@/actions/types';
import type { PageContext } from '@/shared/types/page';
import {
  isCommandSource,
  type CommandRequest,
  type CommandResult,
  type CommandSource,
} from '@/shared/types/command';
import { parseMemoryCommand } from '@/memory/parser';
import { memoryController } from '@/memory/controller';
import {
  MemoryPreviewAction,
  MemoryResultAction,
  toAISavedMemories,
  type MemoryPreviewView,
  type MemoryResultView,
  type MemoryUsedView,
} from '@/memory/types';

export type HandlerResult =
  | {
      kind: 'success';
      response: AIResponse;
      /** Phase 6 — saved memories that informed this answer (bounded). */
      memoriesUsed?: MemoryUsedView[];
    }
  | { kind: 'error'; error: AIError; intent?: AIIntent }
  | { kind: 'memory'; preview: MemoryPreviewView }
  | { kind: 'memoryResult'; result: MemoryResultView }
  | { kind: 'memoryFailure'; code: string; message: string }
  | { kind: 'plan'; plan: ActionPlan }
  | {
      kind: 'developer';
      /** Phase 7 — typed developer result (deterministic + model-assisted). */
      result: DeveloperResultView;
      /**
       * Phase 7 — the bounded GitHub navigation plan (already stored in the
       * Phase 4 session store, awaiting the user's explicit approval). The
       * developer result itself carries no executable data.
       */
      plan?: ActionPlan;
      ai?: AIResponse;
      memoriesUsed?: MemoryUsedView[];
    }
  | {
      kind: 'workflow';
      workflow: WorkflowView;
      understanding: TaskUnderstanding;
    }
  | { kind: 'refusal'; understanding: TaskUnderstanding; errorCode: string };

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

    // Phase 6: explicit memory phrasing ("remember …", "forget …", "what do
    // you remember …") is handled by the deterministic memory path before
    // any planning or reasoning — a memory command is never turned into an
    // action, a workflow, or a prompt. Nothing is stored here: the reply is
    // a confirmation preview (or a bounded listing).
    const memory = await this.handleMemory(text);
    if (memory !== null) return memory;

    // Phase 7: developer intelligence. It only engages when the captured
    // page actually exposed a VALIDATED GitHub context — on any other page
    // the phrasing falls through to the Phase 1–6 routing unchanged, so
    // nothing about existing behaviour depends on GitHub being present.
    const developerRequest = request.context?.github
      ? parseDeveloperRequest(text)
      : null;
    if (developerRequest) {
      const developerResult = await this.developDeveloper(
        request,
        text,
        developerRequest,
        signal,
      );
      if (developerResult !== null) return developerResult;
    }

    // Phase 5: a multi-clause goal is planned as a bounded WORKFLOW
    // before any single-action planning, so a multi-step request is never
    // silently downgraded to one step. Refusals (code/browser/shell
    // requests, approval forgery) surface here too, before planning.
    const workflowResult = this.planWorkflow(request, text);
    if (workflowResult !== null) return workflowResult;

    // Phase 4: explicit action phrasings produce a PLAN, never execution.
    // Planning requires a real page context to bind to.
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

  /**
   * Phase 5: build a bounded workflow (2..MAX_WORKFLOW_STEPS steps) for a
   * multi-step goal. Returns null when the goal is not a supported
   * multi-step task — the caller then falls back to the Phase 4 single
   * action path. Nothing is approved or executed here: the plan is
   * stored awaiting explicit approval.
   */
  private planWorkflow(
    request: CommandRequest,
    text: string,
  ): HandlerResult | null {
    const analysis = analyzeGoalText(text);

    // Refusals are decided from the text alone (never from page content):
    // code/browser/shell requests and approval-forgery phrasings are
    // refused before any planner — or the AI — sees them.
    if (analysis.refusal) {
      return {
        kind: 'refusal',
        errorCode: analysis.refusal.code,
        understanding: {
          goal: analysis.goal,
          kind: TaskKind.Unsupported,
          intents: [],
          expectedOutcome: '',
          contextRequirements: [],
          supported: false,
          reason: analysis.refusal.message,
          errorCode: analysis.refusal.code,
        },
      };
    }

    const context = request.context;
    if (context === null || request.tabId === undefined) return null;
    if (context.state !== 'ready' && context.state !== 'partial') return null;

    const planned = planWorkflow({
      goal: text,
      requestId: request.id,
      context,
      tabId: request.tabId,
      now: new Date(),
    });

    if (!planned.workflow) {
      // A goal that is workflow-shaped but cannot be planned safely
      // (unresolvable/ambiguous target, too many steps, sensitive field)
      // is reported instead of being silently downgraded to one step.
      if (planned.error && planned.understanding.kind === TaskKind.Unsupported) {
        return {
          kind: 'refusal',
          understanding: planned.understanding,
          errorCode: planned.error.code,
        };
      }
      return null;
    }

    // The workflow lives in the background session store; it needs its own
    // explicit approval bound to this exact workflow hash.
    workflowSessionStore.create(planned.workflow);
    const record = workflowSessionStore.get(planned.workflow.workflowId);
    if (!record) return null;
    return {
      kind: 'workflow',
      workflow: toWorkflowView(record),
      understanding: planned.understanding,
    };
  }

  /**
   * Phase 7 — the developer path.
   *
   * Deterministic first: the bounded developer context and its analysis are
   * built from the validated page capture alone, and they stand on their own.
   * The model then adds narrative and extra (validated, evidence-bearing,
   * never-certain) findings on top. If the model is unavailable, the
   * deterministic result is still returned — labelled as such.
   *
   * GitHub navigation is derived from the deterministic analysis only (never
   * from model output), converted to typed targets, validated by the Phase 4
   * validator, and stored for explicit user approval. Nothing navigates here.
   */
  private async developDeveloper(
    request: CommandRequest,
    text: string,
    parsed: DeveloperRequest,
    signal: AbortSignal,
  ): Promise<HandlerResult | null> {
    const context = request.context;
    if (context === null) return null;

    const built = buildDeveloperContext({ page: context, request: parsed });
    if (!built.available || !built.github) return null;

    const analysis = analyzeDeveloperContext({
      github: built.github,
      request: parsed,
      bundle: built.bundle,
    });

    // Phase 6 retrieval is unchanged and bounded — and it can never grant
    // anything here: memory only ever adds a saved-context block.
    const retrieval = await memoryController.retrieve(text);

    let ai: AIResponse | null = null;
    const aiContext = built.ai;
    if (aiContext !== null) {
      const reasoningContext = buildAIContext(context, parsed.intent);
      if (reasoningContext !== null) {
        const result = await runAIRequest({
          requestId: request.id,
          intent: parsed.intent,
          userPrompt: text,
          context: reasoningContext,
          developer: aiContext,
          signal,
          ...(retrieval.memories.length > 0
            ? { memory: toAISavedMemories(retrieval) }
            : {}),
        });
        if (result.ok) ai = result.response;
      }
    }

    // A superseded request must never render output.
    if (signal.aborted) {
      return {
        kind: 'error',
        error: aiError(AIErrorCode.AI_CANCELLED),
        intent: parsed.intent,
      };
    }

    const composed = buildDeveloperResult({
      pageContext: context,
      request: parsed,
      ai,
      context: built,
      analysis,
    });
    if (composed.result === null) return null;

    const plan = this.planDeveloperNavigation(composed.result, request, context);

    return {
      kind: 'developer',
      result: composed.result,
      ...(plan ? { plan } : {}),
      ...(ai ? { ai } : {}),
      ...(retrieval.memories.length > 0
        ? { memoriesUsed: retrieval.memories }
        : {}),
    };
  }

  /**
   * Phase 7 — turn the analysed navigation proposals into a Phase 4 plan.
   *
   * The owner, repository and ref come from the validated page context; the
   * paths come from the deterministic analysis; every step is re-validated by
   * the shared action validator. The plan is stored awaiting approval and is
   * never executed here.
   */
  private planDeveloperNavigation(
    result: DeveloperResultView,
    request: CommandRequest,
    context: PageContext,
  ): ActionPlan | null {
    const plan = result.plan;
    if (!plan || !plan.executable || plan.navigation.length === 0) return null;
    if (request.tabId === undefined) return null;
    const github = context.github;
    if (!github) return null;

    const targets = toNavigationTargets(plan.navigation, github).slice(
      0,
      ACTION_LIMITS.MAX_ACTIONS_PER_PLAN,
    );
    if (targets.length === 0) return null;

    const actions: Action[] = targets.map((target) => ({
      type: ActionKind.NavigateGitHub,
      target,
    }));

    const outcome = finalizePlan(actions, {
      requestId: request.id,
      tabId: request.tabId,
      url: context.url ?? '',
      contentHash: pageContentDigest(context),
    });
    if (!outcome.plan) return null;

    actionSessionStore.addPlan(outcome.plan);
    return outcome.plan;
  }

  /**
   * Phase 6 — the memory path. Purely deterministic: parse → controller.
   * The controller never writes from a command; it returns a preview that
   * only a user confirmation can commit.
   */
  private async handleMemory(text: string): Promise<HandlerResult | null> {
    const parsed = parseMemoryCommand(text);
    if (!parsed) return null;

    const outcome = await memoryController.handleCommand(parsed);
    switch (outcome.kind) {
      case 'preview':
        return { kind: 'memory', preview: outcome.preview };
      case 'result':
        return { kind: 'memoryResult', result: outcome.result };
      default:
        return {
          kind: 'memoryFailure',
          code: outcome.code,
          message: outcome.message,
        };
    }
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

    // Phase 6: retrieval is gated by the memory switch, relevance-bound,
    // and capped (never the whole store). Nothing is retrieved when the
    // request shares no topic with any saved memory.
    const retrieval = await memoryController.retrieve(text);

    const result = await runAIRequest({
      requestId: request.id,
      intent,
      userPrompt: text,
      context,
      signal,
      ...(retrieval.memories.length > 0
        ? { memory: toAISavedMemories(retrieval) }
        : {}),
    });

    if (!result.ok) {
      return { kind: 'error', error: result.error, intent };
    }
    return {
      kind: 'success',
      response: result.response,
      ...(retrieval.memories.length > 0
        ? { memoriesUsed: retrieval.memories }
        : {}),
    };
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

/** One-line, user-safe summary of what a confirmation would do. */
function memoryPreviewSummary(preview: MemoryPreviewView): string {
  switch (preview.action) {
    case MemoryPreviewAction.Update:
      return 'This looks like something you already saved — review the update.';
    case MemoryPreviewAction.Delete:
      return 'Review this before I forget it.';
    default:
      return 'Review this before I save it.';
  }
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

      if (output.kind === 'memory') {
        // Phase 6: a memory change is a PROPOSAL, never a write. The body
        // stays in the background; confirming sends only the preview id.
        return {
          id: request.id,
          status: 'completed',
          text: memoryPreviewSummary(output.preview),
          ...base,
          memory: output.preview,
          retryable: false,
          startedAt,
          finishedAt,
        };
      }

      if (output.kind === 'memoryResult') {
        return {
          id: request.id,
          status: 'completed',
          text: output.result.message,
          ...base,
          memoryResult: output.result,
          retryable: false,
          startedAt,
          finishedAt,
        };
      }

      if (output.kind === 'memoryFailure') {
        // A refused memory (sensitive content, limit, memory off) is a
        // typed failure that still renders as a memory outcome — never as
        // an AI error, and never with the refused text echoed back.
        return {
          id: request.id,
          status: 'failed',
          text: output.message,
          ...base,
          memoryResult: {
            action: output.code === 'MEMORY_DISABLED'
              ? MemoryResultAction.Disabled
              : MemoryResultAction.Blocked,
            message: output.message,
            records: [],
            total: 0,
          },
          errorCode: output.code,
          retryable: false,
          startedAt,
          finishedAt,
        };
      }

      if (output.kind === 'workflow') {
        // A workflow proposal is a successful COMMAND, not an execution:
        // the run needs a separate approval bound to the workflow hash.
        const count = output.workflow.steps.length;
        return {
          id: request.id,
          status: 'completed',
          text: `I prepared a ${count}-step workflow. Review it before running anything.`,
          ...base,
          workflow: output.workflow,
          understanding: {
            kind: output.understanding.kind,
            goal: output.understanding.goal,
            expectedOutcome: output.understanding.expectedOutcome,
            intents: [...output.understanding.intents],
            contextRequirements: [...output.understanding.contextRequirements],
            supported: output.understanding.supported,
            ...(output.understanding.reason
              ? { reason: output.understanding.reason }
              : {}),
          },
          retryable: false,
          startedAt,
          finishedAt,
        };
      }

      if (output.kind === 'refusal') {
        // A refusal is a typed failure, never an executed action and never
        // an AI answer: the request is out of scope by policy.
        return {
          id: request.id,
          status: 'failed',
          text: output.understanding.reason ?? 'That request is not supported.',
          ...base,
          understanding: {
            kind: output.understanding.kind,
            goal: output.understanding.goal,
            expectedOutcome: output.understanding.expectedOutcome,
            intents: [...output.understanding.intents],
            contextRequirements: [...output.understanding.contextRequirements],
            supported: false,
            ...(output.understanding.reason
              ? { reason: output.understanding.reason }
              : {}),
          },
          errorCode: output.errorCode,
          retryable: false,
          startedAt,
          finishedAt,
        };
      }

      if (output.kind === 'developer') {
        // A developer result is a REPORT: it never executes anything. Any
        // navigation it proposes travels in `plan`, which still needs the
        // user's explicit approval (ACTION_EXECUTE bound to the plan hash).
        return {
          id: request.id,
          status: 'completed',
          text: output.result.summary,
          ...base,
          intent: output.result.intent,
          developer: output.result,
          ...(output.ai ? { ai: output.ai } : {}),
          ...(output.plan ? { plan: output.plan } : {}),
          ...(output.memoriesUsed && output.memoriesUsed.length > 0
            ? { memoriesUsed: output.memoriesUsed }
            : {}),
          retryable: false,
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
        ...(output.memoriesUsed && output.memoriesUsed.length > 0
          ? { memoriesUsed: output.memoriesUsed }
          : {}),
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
