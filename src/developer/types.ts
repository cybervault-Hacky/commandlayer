/**
 * Phase 7 — developer intelligence contracts.
 *
 * The developer layer turns (PageContext + validated GitHub context) into a
 * bounded, typed understanding of the code the user is looking at, and then
 * into developer-facing RESULTS. Three rules hold throughout:
 *
 * 1. DETERMINISTIC FIRST. Anything that can be derived locally (language,
 *    file lists, change stats, TODO markers, code search, issue
 *    requirements) IS derived locally. The AI only adds narrative and
 *    judgement on top of evidence that already exists.
 * 2. EVIDENCE OR SILENCE. A finding without evidence is dropped.
 * 3. NO EXECUTION. Nothing in this domain executes, mutates, or authorizes
 *    anything: GitHub navigation travels through the Phase 4 Action Engine and
 *    the Phase 5 approval flow, and everything else is a plan or a report.
 */
import type {
  AIChangePlan,
  AIFinding,
} from '@/ai/types';
import type { GitHubChangedFile, GitHubSurface } from '@/github/types';
import { DeveloperIntent } from './intents';

export { DeveloperIntent };
export type { DeveloperIntent as DeveloperIntentType };

/** What the developer layer understood from one command. */
export interface DeveloperRequest {
  intent: DeveloperIntent;
  /** Free-text target: a symbol, a path fragment, a search query, a goal. */
  query: string;
  /** The user's own words (bounded, sanitized). */
  text: string;
}

/** One bounded local search hit (never a repository download). */
export interface DeveloperSearchHit {
  /** Repository-relative file path when known, else a page-section label. */
  path: string | null;
  line: number | null;
  snippet: string;
  /** Where the hit came from — reported honestly in the UI. */
  source: 'code' | 'diff' | 'page-text' | 'file-list' | 'link';
}

export interface DeveloperSearchOutcome {
  query: string;
  hits: DeveloperSearchHit[];
  /** Files scanned by the bounded local search. */
  scanned: number;
  truncated: boolean;
}

/** Repository-level understanding (identity + structure + hints). */
export interface DeveloperRepositorySummary {
  slug: string | null;
  surface: GitHubSurface;
  ref: string | null;
  path: string | null;
  language: string | null;
  fileCount: number;
  files: string[];
  /** Configuration / manifest files visible in the captured context. */
  configFiles: string[];
  /** Framework hints detected from visible config or manifest names. */
  frameworkHints: string[];
  readmeExcerpt: string | null;
}

/** Closed classification vocabulary for changed files. */
export const ChangeCategory = {
  Source: 'source',
  Tests: 'tests',
  Configuration: 'configuration',
  Documentation: 'documentation',
  Dependency: 'dependency',
  Assets: 'assets',
  Other: 'other',
} as const;

export type ChangeCategory = (typeof ChangeCategory)[keyof typeof ChangeCategory];

/** Change-set understanding for a pull request or commit. */
export interface DeveloperChangeSummary {
  changedFiles: GitHubChangedFile[];
  changedFileCount: number;
  additions: number | null;
  deletions: number | null;
  /** Categories present in the change set (deterministic classification). */
  categories: ChangeCategory[];
  /** Files whose change deserves extra attention (deterministic rules). */
  sensitiveFiles: string[];
  hasDiffExcerpt: boolean;
  diffLineCount: number;
}

/** Issue understanding. */
export interface DeveloperIssueSummary {
  number: number | null;
  title: string | null;
  requirements: string[];
  acceptanceCriteria: string[];
  /** Likely-relevant captured files (matched against the issue wording). */
  relatedFiles: string[];
  /** True when only the title/description was available. */
  limitedContext: boolean;
}

/**
 * One developer-facing finding. Same shape as the validated AI finding, plus
 * provenance so the UI can say where it came from.
 */
export interface DeveloperFinding extends AIFinding {
  origin: 'local' | 'model';
}

/** A bounded change plan: analysis + proposed steps (+ optional navigation). */
export interface DeveloperChangePlan extends AIChangePlan {
  /** Files the plan would touch (repository-relative, validated). */
  files: string[];
  /** Typed, non-executable navigation proposal (Phase 5 turns it into work). */
  navigation: DeveloperNavigationProposal[];
  /** True when the proposal has at least one step the Action Engine can run. */
  executable: boolean;
}

export interface DeveloperNavigationProposal {
  /** Repository-relative file to open (validated by the action layer). */
  path: string;
  label: string;
}

/** The complete developer result rendered by the UI. */
export interface DeveloperResultView {
  intent: DeveloperIntent;
  surface: GitHubSurface;
  repository: string | null;
  ref: string | null;
  path: string | null;
  language: string | null;
  summary: string;
  findings: DeveloperFinding[];
  /** Deterministic observations (counts, classifications) — always present. */
  observations: string[];
  affectedFiles: string[];
  search: DeveloperSearchOutcome | null;
  change: DeveloperChangeSummary | null;
  issue: DeveloperIssueSummary | null;
  plan: DeveloperChangePlan | null;
  /** Honest statement about what was and was not available. */
  notes: string[];
  truncated: boolean;
}

/** What the deterministic analysis produces before any AI call. */
export interface DeveloperAnalysis {
  observations: string[];
  findings: DeveloperFinding[];
  plan: DeveloperChangePlan | null;
  notes: string[];
}

/** Bounded developer context for one page (deterministic, no AI). */
export interface DeveloperContextBundle {
  repository: DeveloperRepositorySummary;
  change: DeveloperChangeSummary | null;
  issue: DeveloperIssueSummary | null;
  search: DeveloperSearchOutcome | null;
  observations: string[];
  notes: string[];
  truncated: boolean;
}
