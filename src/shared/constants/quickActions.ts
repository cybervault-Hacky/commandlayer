/**
 * Quick actions are the entry points into the command pipeline.
 *
 * Phase 3: every quick action maps 1:1 to a real reasoning intent
 * (see @/ai/intents) and runs through the AI reasoning engine. The
 * Phase 1 "Research" and "Compare" actions were removed instead of
 * being faked — they need capabilities that do not exist yet
 * (multi-page research, cross-tab comparison) and are documented as
 * future roadmap items in the README.
 */
export const QuickActionId = {
  Analyze: 'analyze',
  Summarize: 'summarize',
  Explain: 'explain',
  Extract: 'extract',
} as const;

export type QuickActionId = (typeof QuickActionId)[keyof typeof QuickActionId];

export interface QuickAction {
  id: QuickActionId;
  label: string;
  description: string;
  /** Structured prompt template used when building the CommandRequest. */
  template: string;
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: 'analyze',
    label: 'Analyze',
    description: 'Understand this page',
    template: 'Analyze the current page',
  },
  {
    id: 'summarize',
    label: 'Summarize',
    description: 'Get the key points',
    template: 'Summarize the current page',
  },
  {
    id: 'explain',
    label: 'Explain',
    description: 'Plain-language explanation',
    template: 'Explain the current page',
  },
  {
    id: 'extract',
    label: 'Extract',
    description: 'Pull out key information',
    template: 'Extract the important information from this page',
  },
] as const satisfies readonly QuickAction[];

export function isQuickActionId(value: unknown): value is QuickActionId {
  return (
    typeof value === 'string' &&
    QUICK_ACTIONS.some((action) => action.id === value)
  );
}

export function getQuickAction(id: QuickActionId): QuickAction | undefined {
  return QUICK_ACTIONS.find((action) => action.id === id);
}
