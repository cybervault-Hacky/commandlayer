/**
 * Phase 7 — the developer intent vocabulary.
 *
 * These are the typed developer requests CommandLayer understands. They are
 * defined here (not in the AI layer) because the developer domain owns them;
 * `AIIntent` composes this vocabulary so there is exactly ONE intent taxonomy
 * in the extension and no parallel duplicate.
 *
 * Every one of these is REASONING (or deterministic local analysis) only.
 * There is deliberately no intent for editing, committing, pushing, merging,
 * posting, or running anything: developer intents describe, search, compare,
 * review, and PLAN — they never mutate a repository.
 */
export const DeveloperIntent = {
  ExplainCode: 'EXPLAIN_CODE',
  ExplainFile: 'EXPLAIN_FILE',
  ExplainRepository: 'EXPLAIN_REPOSITORY',
  FindCode: 'FIND_CODE',
  AnalyzeDiff: 'ANALYZE_DIFF',
  ReviewPullRequest: 'REVIEW_PULL_REQUEST',
  AnalyzeIssue: 'ANALYZE_ISSUE',
  SummarizeCommit: 'SUMMARIZE_COMMIT',
  CompareCode: 'COMPARE_CODE',
  FindTodos: 'FIND_TODOS',
  FindPotentialBugs: 'FIND_POTENTIAL_BUGS',
  GenerateChangePlan: 'GENERATE_CHANGE_PLAN',
} as const;

export type DeveloperIntent = (typeof DeveloperIntent)[keyof typeof DeveloperIntent];

export const DEVELOPER_INTENTS: readonly DeveloperIntent[] =
  Object.values(DeveloperIntent);

export function isDeveloperIntent(value: unknown): value is DeveloperIntent {
  return (
    typeof value === 'string' &&
    DEVELOPER_INTENTS.includes(value as DeveloperIntent)
  );
}

export const DEVELOPER_INTENT_LABELS: Record<DeveloperIntent, string> = {
  [DeveloperIntent.ExplainCode]: 'Explain code',
  [DeveloperIntent.ExplainFile]: 'Explain file',
  [DeveloperIntent.ExplainRepository]: 'Explain repository',
  [DeveloperIntent.FindCode]: 'Find code',
  [DeveloperIntent.AnalyzeDiff]: 'Analyze changes',
  [DeveloperIntent.ReviewPullRequest]: 'Review pull request',
  [DeveloperIntent.AnalyzeIssue]: 'Analyze issue',
  [DeveloperIntent.SummarizeCommit]: 'Summarize commit',
  [DeveloperIntent.CompareCode]: 'Compare code',
  [DeveloperIntent.FindTodos]: 'Find TODOs',
  [DeveloperIntent.FindPotentialBugs]: 'Find potential bugs',
  [DeveloperIntent.GenerateChangePlan]: 'Change plan',
};
