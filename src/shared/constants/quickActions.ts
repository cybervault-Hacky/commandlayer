/**
 * Quick actions are the Phase 1 entry points into the command pipeline.
 * They build structured CommandRequests (see @/commands) — they never
 * perform web operations themselves.
 */
export const QuickActionId = {
  Analyze: 'analyze',
  Research: 'research',
  Summarize: 'summarize',
  Compare: 'compare',
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
    id: 'research',
    label: 'Research',
    description: 'Dig into the details',
    template: 'Research the current page',
  },
  {
    id: 'summarize',
    label: 'Summarize',
    description: 'Get the key points',
    template: 'Summarize the current page',
  },
  {
    id: 'compare',
    label: 'Compare',
    description: 'Weigh things side by side',
    template: 'Compare the current page',
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
