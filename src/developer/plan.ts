/**
 * Phase 7 — the developer change planner.
 *
 * A change plan is ADVICE: an ordered, bounded list of what a developer would
 * likely do. It is derived deterministically from the analysed context
 * (findings, affected files, change categories, issue criteria) and may be
 * enriched by the model. It never contains executable content.
 *
 * The one part with teeth is `navigation`: an optional, bounded list of
 * repository files worth opening. Those become typed `NAVIGATE_GITHUB` targets
 * that still have to pass the Phase 4 validator, the Phase 5 preview, and the
 * user's explicit approval before anything moves.
 */
import type { GitHubPageContext } from '@/github/types';
import type { GitHubNavTarget } from '@/github/patterns';
import { DEVELOPER_LIMITS } from './limits';
import { ChangeCategory, type DeveloperChangeSummary, type DeveloperChangePlan, type DeveloperFinding, type DeveloperIssueSummary, type DeveloperNavigationProposal } from './types';

export interface BuildPlanInput {
  github: GitHubPageContext;
  change: DeveloperChangeSummary | null;
  issue: DeveloperIssueSummary | null;
  findings: readonly DeveloperFinding[];
  /** Files the analysis considers relevant, most relevant first. */
  affectedFiles: readonly string[];
  /** The user's goal text (for the plan summary). */
  goal: string;
}

function unique(paths: readonly string[]): string[] {
  const out: string[] = [];
  for (const path of paths) {
    if (!path || out.includes(path)) continue;
    out.push(path);
    if (out.length >= DEVELOPER_LIMITS.MAX_AFFECTED_FILES) break;
  }
  return out;
}

/**
 * Files worth opening: findings first (they cite evidence), then the change
 * set, then the repository listing. Bounded, de-duplicated, path-validated
 * later by the action layer.
 */
export function deriveAffectedFiles(
  github: GitHubPageContext,
  findings: readonly DeveloperFinding[],
): string[] {
  const fromFindings = findings
    .map((finding) => finding.file)
    .filter((file): file is string => typeof file === 'string' && file.length > 0);
  const fromChange = github.changedFiles.map((file) => file.path);
  const fromFiles = github.files
    .filter((entry) => entry.kind === 'file')
    .map((entry) => entry.path);
  const current = github.path ? [github.path] : [];
  return unique([...fromFindings, ...fromChange, ...current, ...fromFiles]);
}

/** Navigation proposals (bounded) — always file opens, never mutations. */
export function navigationProposals(
  affectedFiles: readonly string[],
): DeveloperNavigationProposal[] {
  return affectedFiles
    .slice(0, DEVELOPER_LIMITS.MAX_PLAN_NAVIGATION)
    .map((path) => ({ path, label: `Open ${path}` }));
}

/**
 * Build the change plan. Returns null when there is nothing meaningful to
 * plan (no affected files and no issue criteria) — an empty plan would be
 * noise, and pretending to plan is worse than saying "nothing to plan".
 */
export function buildChangePlan(input: BuildPlanInput): DeveloperChangePlan | null {
  const files = deriveAffectedFiles(input.github, input.findings);
  const steps: DeveloperChangePlan['steps'] = [];

  if (input.issue && input.issue.acceptanceCriteria.length > 0) {
    steps.push({
      title: 'Confirm the acceptance criteria',
      detail: input.issue.acceptanceCriteria
        .slice(0, 3)
        .map((criterion) => `• ${criterion}`)
        .join('\n'),
      ...(input.issue.relatedFiles.length > 0
        ? { files: input.issue.relatedFiles.slice(0, DEVELOPER_LIMITS.MAX_PLAN_STEP_FILES) }
        : {}),
    });
  } else if (input.issue && input.issue.requirements.length > 0) {
    steps.push({
      title: 'Confirm the requirements',
      detail: input.issue.requirements
        .slice(0, 3)
        .map((requirement) => `• ${requirement}`)
        .join('\n'),
    });
  }

  for (const file of files.slice(0, 3)) {
    steps.push({
      title: `Review ${file}`,
      detail: 'Read the current behaviour in this file before changing it.',
      files: [file],
    });
  }

  const hasTests = input.change?.categories.includes(ChangeCategory.Tests) ?? false;
  if (!hasTests && files.length > 0) {
    steps.push({
      title: 'Add or update tests for the changed behaviour',
      detail: 'Cover the new or changed path, including the failure case you expect.',
    });
  }

  const touchesConfig =
    input.change?.categories.some(
      (category) =>
        category === ChangeCategory.Configuration ||
        category === ChangeCategory.Dependency,
    ) ?? false;
  if (touchesConfig) {
    steps.push({
      title: 'Verify configuration and dependency changes',
      detail: 'Reinstall or re-resolve dependencies and confirm the build still passes.',
    });
  }

  if (files.length === 0 && steps.length === 0) return null;

  steps.push({
    title: 'Verify the affected flow end to end',
    detail: 'Run the application, exercise the changed path, and confirm nothing adjacent broke.',
  });

  const navigation = navigationProposals(files);
  const summary =
    files.length > 0
      ? `A bounded plan for “${input.goal.slice(0, 90)}” covering ${files.length} file${files.length === 1 ? '' : 's'}. Nothing is changed automatically.`
      : `A bounded plan for “${input.goal.slice(0, 90)}”. Nothing is changed automatically.`;

  return {
    summary,
    steps: steps.slice(0, DEVELOPER_LIMITS.MAX_PLAN_STEPS),
    files: files.slice(0, DEVELOPER_LIMITS.MAX_AFFECTED_FILES),
    navigation,
    executable: navigation.length > 0,
  };
}

/**
 * Turn navigation proposals into typed, validated GitHub targets. The owner
 * and repository come from the validated page context — never from the text —
 * so a proposal can only ever open a path inside the repository the user is
 * actually looking at.
 */
export function toNavigationTargets(
  proposals: readonly DeveloperNavigationProposal[],
  github: GitHubPageContext,
): GitHubNavTarget[] {
  if (!github.owner || !github.repository) return [];
  const targets: GitHubNavTarget[] = [];
  for (const proposal of proposals.slice(0, DEVELOPER_LIMITS.MAX_PLAN_NAVIGATION)) {
    targets.push({
      kind: 'file',
      owner: github.owner,
      repository: github.repository,
      ...(github.branch ? { ref: github.branch } : {}),
      path: proposal.path,
    });
  }
  return targets;
}

/** A deterministic, user-facing line per plan step (for the UI card). */
export function planStepLabels(plan: DeveloperChangePlan): string[] {
  return plan.steps.map((step, index) => `${index + 1}. ${step.title}`);
}
