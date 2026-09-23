/**
 * Phase 7 — deterministic developer analysis.
 *
 * Runs BEFORE any model call and works with no model at all: language,
 * structure, change statistics, TODO markers, bounded search, issue
 * requirements, and the rule-based findings in `review.ts`. The AI then adds
 * narrative and extra opinion on top of this evidence — never the other way
 * round.
 *
 * Every branch here is bounded and every branch may return nothing. Reporting
 * "nothing found in what was captured" is a valid, honest result.
 */
import { FindingCategory, FindingConfidence, FindingSeverity } from '@/ai/types';
import { GitHubSurface, type GitHubPageContext } from '@/github/types';
import { DeveloperIntent } from './intents';
import { DEVELOPER_LIMITS } from './limits';
import { currentFileContext, fileObservations } from './file';
import { deriveAffectedFiles, buildChangePlan } from './plan';
import { localCodeFindings, localReviewFindings } from './review';
import { findWorkMarkers } from './search';
import type {
  DeveloperAnalysis,
  DeveloperChangePlan,
  DeveloperContextBundle,
  DeveloperFinding,
  DeveloperRequest,
} from './types';

/** Intents that produce a change plan (advisory, bounded, non-executable). */
const PLAN_INTENTS: ReadonlySet<string> = new Set([
  DeveloperIntent.GenerateChangePlan,
  DeveloperIntent.AnalyzeIssue,
  DeveloperIntent.ReviewPullRequest,
]);

export interface AnalyzeInput {
  github: GitHubPageContext;
  request: DeveloperRequest;
  bundle: DeveloperContextBundle;
}

export function analyzeDeveloperContext(input: AnalyzeInput): DeveloperAnalysis {
  const { github, request, bundle } = input;
  const findings: DeveloperFinding[] = [];
  const observations: string[] = [...bundle.observations];
  const notes: string[] = [...bundle.notes];

  // --- change analysis (pull requests, commits) ---------------------------
  if (bundle.change) {
    const change: DeveloperChangeSummaryLike = bundle.change;
    observations.push(
      `Change set: ${change.changedFileCount} file${change.changedFileCount === 1 ? '' : 's'}` +
        (change.additions !== null || change.deletions !== null
          ? ` (+${change.additions ?? '?'} −${change.deletions ?? '?'})`
          : ''),
    );
    if (change.categories.length > 0) {
      observations.push(`Change categories: ${change.categories.join(', ')}`);
    }
    if (change.sensitiveFiles.length > 0) {
      observations.push(
        `Security-adjacent files changed: ${change.sensitiveFiles.slice(0, 3).join(', ')}`,
      );
    }
    if (!change.hasDiffExcerpt) {
      observations.push('No rendered diff excerpt was captured on this page');
    }
    findings.push(...localReviewFindings(github, change));
  }

  // --- code analysis (file pages) -----------------------------------------
  const file = currentFileContext(github);
  if (file) {
    observations.push(...fileObservations(github, bundle.repository));
  }
  if (
    github.surface === GitHubSurface.File ||
    request.intent === DeveloperIntent.ExplainCode ||
    request.intent === DeveloperIntent.FindPotentialBugs
  ) {
    findings.push(...localCodeFindings(github));
  }

  // --- TODO / FIXME scanning ----------------------------------------------
  if (request.intent === DeveloperIntent.FindTodos) {
    const markers = findWorkMarkers(github);
    if (markers.length === 0) {
      notes.push('No TODO/FIXME/HACK markers were found in the captured code or diff.');
    } else {
      observations.push(`Work markers found: ${markers.length}`);
      findings.push(
        ...markers.slice(0, 3).map((marker) => ({
          severity: FindingSeverity.Info,
          category: FindingCategory.Maintainability,
          file: marker.path,
          line: marker.line,
          explanation: `${marker.marker} marker found in the captured code.`,
          evidence: `${marker.marker}: ${marker.text}`,
          confidence: FindingConfidence.High,
          origin: 'local' as const,
        })),
      );
    }
  }

  // --- bounded local search ------------------------------------------------
  if (bundle.search) {
    observations.push(
      `Local search “${bundle.search.query}”: ${bundle.search.hits.length} match${bundle.search.hits.length === 1 ? '' : 'es'} in the captured context`,
    );
    if (bundle.search.truncated) {
      notes.push('The local search stopped at its result or time limit.');
    }
  }

  // --- issue understanding --------------------------------------------------
  if (bundle.issue) {
    observations.push(
      `Issue #${bundle.issue.number ?? '—'}: ${bundle.issue.requirements.length} requirement sentence${bundle.issue.requirements.length === 1 ? '' : 's'} found`,
    );
    if (bundle.issue.acceptanceCriteria.length > 0) {
      observations.push(
        `Acceptance criteria found: ${bundle.issue.acceptanceCriteria.length}`,
      );
    }
  }

  // --- the change plan ------------------------------------------------------
  const plan: DeveloperChangePlan | null = PLAN_INTENTS.has(request.intent)
    ? buildChangePlan({
        github,
        change: bundle.change,
        issue: bundle.issue,
        findings,
        affectedFiles: deriveAffectedFiles(github, findings),
        goal: request.text,
      })
    : null;

  return {
    observations: dedupe(observations).slice(0, DEVELOPER_LIMITS.MAX_OBSERVATIONS),
    findings: dedupeFindings(findings).slice(0, DEVELOPER_LIMITS.MAX_FINDINGS),
    plan,
    notes: dedupe(notes).slice(0, DEVELOPER_LIMITS.MAX_NOTES),
  };
}

type DeveloperChangeSummaryLike = NonNullable<DeveloperContextBundle['change']>;

function dedupe(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

/**
 * De-duplicate findings by (path, line, evidence). A model finding that
 * repeats a local one with the same evidence is dropped, so the card never
 * shows the same observation twice.
 */
export function dedupeFindings(findings: readonly DeveloperFinding[]): DeveloperFinding[] {
  const out: DeveloperFinding[] = [];
  const seen = new Set<string>();
  for (const finding of findings) {
    const key = [
      finding.file ?? '',
      finding.line ?? '',
      finding.evidence.slice(0, 80).toLowerCase(),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}
