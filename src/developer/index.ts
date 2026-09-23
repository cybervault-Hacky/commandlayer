/**
 * Phase 7 — developer intelligence.
 *
 * Public surface of the domain. The flow for one developer command is:
 *
 *   PageContext (Phase 2, incl. validated GitHub context)
 *     → buildDeveloperContext   (bounded context, deterministic)
 *     → analyzeDeveloperContext (deterministic findings + advisory plan)
 *     → AI reasoning            (narrative; validated, evidence-checked)
 *     → buildDeveloperResult    (this file: the typed result view)
 *     → UI                      (validated again before rendering)
 *
 * GitHub navigation leaves this domain as a TYPED PROPOSAL only: the Action
 * Engine (Phase 4) validates it, previews it, and waits for the user's
 * explicit approval before anything moves.
 */
export * from './types';
export * from './intents';
export { DEVELOPER_LIMITS } from './limits';
export {
  languageForPath,
  languageHint,
  isConfigFile,
  isTestFile,
  isDocumentationFile,
  isSensitivePath,
  frameworkHintsFrom,
} from './language';
export { parseDeveloperRequest, extractDeveloperQuery, isDeveloperRequest } from './parser';
export { searchDeveloperContext, findWorkMarkers, diffText } from './search';
export type { DeveloperSearchInput, WorkMarkerHit } from './search';
export { summarizeChange, classifyChange, describeChange } from './diff';
export { localReviewFindings, localCodeFindings, diffSmells } from './review';
export { summarizeIssue, issueObservations } from './issue';
export { summarizeRepository, repositoryObservations, describeRepository } from './repository';
export { currentFileContext, describeFile, fileObservations } from './file';
export type { DeveloperFileContext } from './file';
export {
  buildChangePlan,
  deriveAffectedFiles,
  navigationProposals,
  toNavigationTargets,
  planStepLabels,
} from './plan';
export type { BuildPlanInput } from './plan';
export { analyzeDeveloperContext, dedupeFindings } from './analysis';
export type { AnalyzeInput } from './analysis';
export {
  buildDeveloperContext,
} from './context';
export type { DeveloperContextInput, DeveloperContextResult, DeveloperContextReason } from './context';
export { parseDeveloperResultView } from './validator';

import type { AIDeveloperContext, AIResponse } from '@/ai/types';
import type { GitHubPageContext } from '@/github/types';
import type { PageContext } from '@/shared/types/page';
import { analyzeDeveloperContext } from './analysis';
import type { DeveloperContextResult } from './context';
import { buildDeveloperContext } from './context';
import { DEVELOPER_INTENTS } from './intents';
import { isSafeRepoPath } from '@/github/patterns';
import { DEVELOPER_LIMITS } from './limits';
import { deriveAffectedFiles } from './plan';
import { dedupeFindings } from './analysis';
import type {
  DeveloperAnalysis,
  DeveloperContextBundle,
  DeveloperFinding,
  DeveloperRequest,
  DeveloperResultView,
} from './types';

export interface BuildDeveloperResultInput {
  pageContext: PageContext;
  request: DeveloperRequest;
  /** Validated AI response for this command, when one was produced. */
  ai: AIResponse | null;
  /**
   * Precomputed developer context / analysis. The dispatcher builds these
   * once per command (to also produce the AI request) and passes them back
   * so nothing is extracted or analysed twice.
   */
  context?: DeveloperContextResult;
  analysis?: DeveloperAnalysis;
  now?: () => number;
}

export interface DeveloperResultOutcome {
  available: boolean;
  reason: 'no-github-context' | 'unsupported-surface' | null;
  result: DeveloperResultView | null;
  analysis: DeveloperAnalysis | null;
  bundle: DeveloperContextBundle | null;
  github: GitHubPageContext | null;
  /** The bounded developer context for the AI request (null if unavailable). */
  aiContext: AIDeveloperContext | null;
}

/**
 * Compose the final developer result.
 *
 * LOCAL EVIDENCE WINS: deterministic findings come first and de-duplicate the
 * model's, and navigation can only ever come from the deterministic analysis
 * (the model cannot add, widen, or redirect an executable step).
 */
export function buildDeveloperResult(
  input: BuildDeveloperResultInput,
): DeveloperResultOutcome {
  const context =
    input.context
    ?? buildDeveloperContext({
      page: input.pageContext,
      request: input.request,
      now: input.now,
    });

  if (!context.available || !context.github) {
    return {
      available: false,
      reason: context.reason ?? 'no-github-context',
      result: null,
      analysis: null,
      bundle: context.bundle,
      github: context.github,
      aiContext: null,
    };
  }

  const analysis =
    input.analysis
    ?? analyzeDeveloperContext({
      github: context.github,
      request: input.request,
      bundle: context.bundle,
    });

  const modelFindings: DeveloperFinding[] = (input.ai?.findings ?? []).map((finding) => ({
    ...finding,
    // Defense in depth at composition time: a model-supplied path that is not
    // repository-relative is dropped rather than rendered (a finding may cite
    // nothing, but it may never cite a URL or a traversal path).
    file: finding.file !== null && isSafeRepoPath(finding.file) ? finding.file : null,
    line:
      finding.line !== null && Number.isInteger(finding.line) && finding.line > 0
        ? finding.line
        : null,
    origin: 'model' as const,
  }));

  const findings = dedupeFindings([...analysis.findings, ...modelFindings]).slice(
    0,
    DEVELOPER_LIMITS.MAX_FINDINGS,
  );

  const modelPlan = input.ai?.changePlan ?? null;
  const plan = analysis.plan
    ? {
        ...analysis.plan,
        // The model may propose an ordered narrative, but never the files or
        // the navigation: those stay exactly what the deterministic analysis
        // derived from the page.
        summary: modelPlan?.summary ?? analysis.plan.summary,
        steps: modelPlan?.steps.length ? modelPlan.steps : analysis.plan.steps,
        executable: analysis.plan.navigation.length > 0,
      }
    : null;

  const affectedFiles = plan?.files ?? deriveAffectedFiles(context.github, findings);

  const observations = [...analysis.observations];
  if (modelFindings.length > 0) {
    observations.push(
      `Model-assisted findings: ${modelFindings.length}`,
    );
  }

  const result: DeveloperResultView = {
    intent: input.request.intent,
    surface: context.github.surface,
    repository: context.bundle.repository.slug,
    ref: context.github.branch,
    path: context.github.path,
    language: context.bundle.repository.language,
    summary: buildSummary({
      ai: input.ai,
      analysis,
      github: context.github,
      repository: context.bundle.repository.slug,
    }),
    findings,
    observations: observations.slice(0, DEVELOPER_LIMITS.MAX_OBSERVATIONS),
    affectedFiles: affectedFiles.slice(0, DEVELOPER_LIMITS.MAX_AFFECTED_FILES),
    search: context.bundle.search,
    change: context.bundle.change,
    issue: context.bundle.issue,
    plan,
    notes: analysis.notes.slice(0, DEVELOPER_LIMITS.MAX_NOTES),
    truncated: context.bundle.truncated,
  };

  return {
    available: true,
    reason: null,
    result,
    analysis,
    bundle: context.bundle,
    github: context.github,
    aiContext: context.ai,
  };
}

function buildSummary(input: {
  ai: AIResponse | null;
  analysis: DeveloperAnalysis;
  github: GitHubPageContext;
  repository: string | null;
}): string {
  const { ai, analysis, github, repository } = input;
  const where = repository
    ? `${repository}${github.path ? `/${github.path}` : ''}`
    : 'this page';
  if (ai?.answer) {
    // The model's narrative is the primary summary; the deterministic counts
    // are appended by the UI from `observations`, so nothing is lost.
    const trimmed = ai.answer.trim();
    if (trimmed.length > 0) {
      return trimmed.length > 1_200 ? `${trimmed.slice(0, 1_199)}…` : trimmed;
    }
  }
  const findingsText =
    analysis.findings.length === 0
      ? 'No specific issues were identified in the captured context.'
      : `${analysis.findings.length} potential issue${analysis.findings.length === 1 ? '' : 's'} identified in the captured context.`;
  return `Read ${where} from the page you are viewing. ${findingsText}`;
}

/** True when this intent belongs to the developer intelligence domain. */
export function isDeveloperDomainIntent(intent: string): boolean {
  return (DEVELOPER_INTENTS as readonly string[]).includes(intent);
}
