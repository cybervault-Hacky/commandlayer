/**
 * Phase 3 — intent resolution.
 *
 * Intents are deterministic and reasoning-only. Quick actions always
 * supply an explicit intent (INTENT_FOR_QUICK_ACTION); free-text commands
 * are resolved by keyword rules with a conservative default (ANSWER).
 * There is intentionally NO dependency on unstructured model-based
 * classification.
 */
import type { QuickActionId } from '@/shared/types/command';
import { DEVELOPER_INTENT_LABELS } from '@/developer/intents';
import { AIIntent } from './types';

export const INTENT_ORDER: AIIntent[] = [
  AIIntent.Summarize,
  AIIntent.Analyze,
  AIIntent.Explain,
  AIIntent.Extract,
  AIIntent.Answer,
];

export const INTENT_LABELS: Record<AIIntent, string> = {
  [AIIntent.Summarize]: 'Summarize',
  [AIIntent.Analyze]: 'Analyze',
  [AIIntent.Explain]: 'Explain',
  [AIIntent.Extract]: 'Extract',
  [AIIntent.Answer]: 'Answer',
  // Phase 7 — developer labels are owned by the developer domain.
  ...DEVELOPER_INTENT_LABELS,
};

/**
 * Map of quick actions → explicit reasoning intent. Every quick action
 * routes through the AI reasoning engine; there are no faked or disabled
 * actions in this set.
 */
export const INTENT_FOR_QUICK_ACTION: Record<QuickActionId, AIIntent> = {
  analyze: AIIntent.Analyze,
  summarize: AIIntent.Summarize,
  explain: AIIntent.Explain,
  extract: AIIntent.Extract,
};

/** The reasoning intent for a quick action, if one exists. */
export function intentForQuickAction(
  actionId: QuickActionId,
): AIIntent | undefined {
  return INTENT_FOR_QUICK_ACTION[actionId];
}

/**
 * Deterministic keyword resolver for free-text commands. Order matters:
 * more specific intents are checked before the ANSWER fallback. Matching
 * is purely local and predictable — there is no dependency on any
 * model-based classifier, so behavior never varies between runs.
 */
const INTENT_PATTERNS: ReadonlyArray<readonly [AIIntent, RegExp]> = [
  [
    AIIntent.Summarize,
    /\b(summari[sz]e|summari[sz]ation|tl;?dr|short version|in short|condense|give me the gist)\b/,
  ],
  [
    AIIntent.Explain,
    /\b(explain|what does this (page|site|doc|documentation)|what is this about|what is this page|tell me about|how does this work|walk me through|elaborate|clarify|help me understand)\b/,
  ],
  [
    AIIntent.Analyze,
    /\b(analy[sz]e|analysis|break ?down|key points|key takeaways|main idea|main point|important (points|information|details)|takeaways|pros and cons|evaluate|assess|critique|review)\b/,
  ],
  [
    AIIntent.Extract,
    /\b(extract|pull out|list (the|all|out)|find all|enumerate|gather the|collect the|scrape)\b/,
  ],
];

export function resolveIntent(text: string): AIIntent {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const [intent, pattern] of INTENT_PATTERNS) {
    if (pattern.test(t)) return intent;
  }
  return AIIntent.Answer;
}
