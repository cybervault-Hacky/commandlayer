import type { PageContext } from './page';
import type { QuickActionId as QuickActionIdType } from '../constants/quickActions';
import type { AIIntent, AIResponse } from '@/ai/types';
import type { ActionPlan, ActionExecutionResult } from '@/actions/types';
import type {
  WorkflowRunResult,
  WorkflowView,
} from '@/workflows/types';

export type QuickActionId = QuickActionIdType;

/** Which extension surface originated the command. */
export const CommandSource = {
  SidePanel: 'sidepanel',
  Popup: 'popup',
  CommandCenter: 'command-center',
} as const;

export type CommandSource = (typeof CommandSource)[keyof typeof CommandSource];

export function isCommandSource(value: unknown): value is CommandSource {
  return (
    typeof value === 'string' &&
    Object.values(CommandSource).includes(value as CommandSource)
  );
}

export type CommandStatus = 'completed' | 'failed';

/**
 * A structured, validated command request. This is the stable contract the
 * reasoning layer consumes — the UI only ever produces these.
 */
export interface CommandRequest {
  id: string;
  text: string;
  source: CommandSource;
  quickAction?: QuickActionId;
  context: PageContext | null;
  /**
   * Phase 4 — the tab the command was issued against. Required for
   * action planning (freshness binding); absent for pure reasoning in
   * contexts without a tab identity.
   */
  tabId?: number;
  createdAt: string;
}

/**
 * Phase 5 — deterministic task understanding, surfaced to the UI so the
 * user can see what CommandLayer understood before anything is approved.
 */
export interface WorkflowUnderstandingView {
  /** ACTION | WORKFLOW | REASONING | UNSUPPORTED */
  kind: string;
  goal: string;
  expectedOutcome: string;
  /** Ordered step intents the plan is expected to contain. */
  intents: string[];
  /** Page Intelligence sections the plan needed. */
  contextRequirements: string[];
  supported: boolean;
  reason?: string;
}

/** The terminal result of a command, safe to render in the UI. */
export interface CommandResult {
  id: string;
  status: CommandStatus;
  /** User-safe result text (the AI answer, or a safe error message). */
  text: string;
  /** The user's command, trimmed (for logs and echoes). */
  commandText?: string;
  source: CommandSource;
  quickAction?: QuickActionId;
  /** The reasoning intent that handled this command. */
  intent?: AIIntent;
  /** The validated AI response (present on completed commands). */
  ai?: AIResponse;
  /**
   * Phase 4 — a proposed action plan awaiting the user's explicit
   * approval (status is 'completed'; nothing has executed).
   */
  plan?: ActionPlan;
  /** Phase 4 — the terminal outcome of an executed action plan. */
  execution?: ActionExecutionResult;
  /**
   * Phase 5 — a bounded multi-step workflow prepared for review (status
   * is 'completed'; nothing has run) or the latest state of one that was
   * approved and executed.
   */
  workflow?: WorkflowView;
  /** Phase 5 — the bounded outcome of a workflow run that executed. */
  workflowRun?: WorkflowRunResult;
  /** Phase 5 — how the request was understood (deterministic analysis). */
  understanding?: WorkflowUnderstandingView;
  /** Whether a retry may succeed (transient errors only). */
  retryable?: boolean;
  errorCode?: string;
  startedAt: string;
  finishedAt: string;
}
