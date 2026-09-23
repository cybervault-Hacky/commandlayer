/**
 * Phase 7 — developer context builder.
 *
 * Turns (validated PageContext + validated GitHub context + a parsed developer
 * request) into:
 *   - a DeveloperContextBundle: everything the deterministic analysis needs,
 *   - an AIDeveloperContext: the bounded excerpt handed to the model.
 *
 * Nothing here fetches, clones, or recurses: the context is exactly what the
 * user's own page already displayed, capped by DEVELOPER_LIMITS and
 * GITHUB_LIMITS. When there is not enough to work with, the result says so
 * (`available: false` + a reason) instead of producing a hollow answer.
 */
import { AI_LIMITS } from '@/ai/limits';
import type { AIDeveloperContext } from '@/ai/types';
import { GITHUB_LIMITS } from '@/github/limits';
import { GitHubSurface, type GitHubPageContext } from '@/github/types';
import type { PageContext } from '@/shared/types/page';
import { summarizeChange } from './diff';
import { summarizeIssue } from './issue';
import { DeveloperIntent } from './intents';
import { currentFileContext } from './file';
import { repositoryObservations, summarizeRepository } from './repository';
import { searchDeveloperContext } from './search';
import type {
  DeveloperContextBundle,
  DeveloperRepositorySummary,
  DeveloperRequest,
} from './types';

export type DeveloperContextReason = 'no-github-context' | 'unsupported-surface';

export interface DeveloperContextResult {
  available: boolean;
  reason: DeveloperContextReason | null;
  github: GitHubPageContext | null;
  bundle: DeveloperContextBundle;
  ai: AIDeveloperContext | null;
}

export interface DeveloperContextInput {
  page: PageContext;
  request: DeveloperRequest;
  now?: () => number;
}

function emptyRepositorySummary(): DeveloperRepositorySummary {
  return {
    slug: null,
    surface: GitHubSurface.Unknown,
    ref: null,
    path: null,
    language: null,
    fileCount: 0,
    files: [],
    configFiles: [],
    frameworkHints: [],
    readmeExcerpt: null,
  };
}

function pageText(page: PageContext): string {
  return page.paragraphs.join('\n\n');
}

/** Intents that benefit from the bounded local code search. */
const SEARCH_INTENTS: ReadonlySet<string> = new Set([
  DeveloperIntent.FindCode,
  DeveloperIntent.CompareCode,
  DeveloperIntent.FindPotentialBugs,
]);

/** Intents that receive the bounded code slice of the current file. */
const CODE_INTENTS: ReadonlySet<string> = new Set([
  DeveloperIntent.ExplainCode,
  DeveloperIntent.ExplainFile,
  DeveloperIntent.FindPotentialBugs,
  DeveloperIntent.FindTodos,
  DeveloperIntent.FindCode,
]);

/** Intents that receive the bounded diff excerpt / change set. */
const DIFF_INTENTS: ReadonlySet<string> = new Set([
  DeveloperIntent.AnalyzeDiff,
  DeveloperIntent.ReviewPullRequest,
  DeveloperIntent.SummarizeCommit,
  DeveloperIntent.CompareCode,
  DeveloperIntent.GenerateChangePlan,
]);

export function buildDeveloperContext(
  input: DeveloperContextInput,
): DeveloperContextResult {
  const { page, request } = input;
  const github = page.github ?? null;

  const emptyBundle: DeveloperContextBundle = {
    repository: emptyRepositorySummary(),
    change: null,
    issue: null,
    search: null,
    observations: [],
    notes: [],
    truncated: false,
  };

  if (!github) {
    return {
      available: false,
      reason: 'no-github-context',
      github: null,
      bundle: emptyBundle,
      ai: null,
    };
  }

  const repository = summarizeRepository(github);
  const slug = repository.slug;

  // An unsupported surface still works for "explain this repository" when the
  // identity is known — nothing else can be grounded, so nothing else runs.
  const supported =
    github.surface !== GitHubSurface.Unknown && github.surface !== GitHubSurface.Search;
  if (!supported) {
    const identityOnly =
      request.intent === DeveloperIntent.ExplainRepository &&
      (slug !== null || github.surface === GitHubSurface.Search);
    if (!identityOnly) {
      return {
        available: false,
        reason: 'unsupported-surface',
        github,
        bundle: { ...emptyBundle, repository },
        ai: null,
      };
    }
  }

  const change = summarizeChange(github);
  const issue = summarizeIssue(github, pageText(page));
  const search = SEARCH_INTENTS.has(request.intent)
    ? searchDeveloperContext({
        query: request.query,
        github,
        pageText: pageText(page),
        now: input.now,
      })
    : null;

  const observations = repositoryObservations(github, repository);
  const notes: string[] = [];

  if (github.surface === GitHubSurface.Search) {
    notes.push(
      'This is a GitHub search page, so only the paths visible in the results could be read.',
    );
  }
  if (github.truncated) {
    notes.push('Some captured sections were truncated by CommandLayer limits.');
  }
  if ((request.intent === DeveloperIntent.AnalyzeDiff ||
      request.intent === DeveloperIntent.ReviewPullRequest) &&
    change !== null &&
    !change.hasDiffExcerpt) {
    notes.push(
      'The rendered diff excerpt was not available on this page, so the review uses the change set and file listing only.',
    );
  }
  if (request.intent === DeveloperIntent.FindTodos &&
    github.codeLines.length === 0 &&
    github.diffLines.length === 0) {
    notes.push(
      'No code or diff lines were captured on this page, so TODO markers could not be read.',
    );
  }
  if (search && search.hits.length === 0 && SEARCH_INTENTS.has(request.intent)) {
    notes.push(
      `No matches for “${request.query}” were found in the captured context.`,
    );
  }

  const bundle: DeveloperContextBundle = {
    repository,
    change,
    issue,
    search,
    observations,
    notes,
    truncated: github.truncated,
  };

  const ai = buildAIDeveloperContext({
    github,
    request,
    repository,
    code: CODE_INTENTS.has(request.intent) ? currentFileContext(github) : null,
    diff: DIFF_INTENTS.has(request.intent) ? github.diffLines : null,
    search,
    observations,
    notes,
    page,
  });

  return {
    available: true,
    reason: null,
    github,
    bundle,
    ai,
  };
}

interface BuildAIInput {
  github: GitHubPageContext;
  request: DeveloperRequest;
  repository: DeveloperRepositorySummary;
  code: ReturnType<typeof currentFileContext>;
  diff: GitHubPageContext['diffLines'] | null;
  search: ReturnType<typeof searchDeveloperContext> | null;
  observations: readonly string[];
  notes: readonly string[];
  page: PageContext;
}

function buildAIDeveloperContext(input: BuildAIInput): AIDeveloperContext {
  const { github } = input;
  const change = input.github.changedFiles.slice(0, GITHUB_LIMITS.MAX_DEVELOPER_CHANGED_FILES);

  return {
    surface: github.surface,
    repository: input.repository.slug,
    ref: github.branch,
    path: github.path,
    language: input.repository.language,
    intent: input.request.intent,
    files: input.repository.files.slice(0, GITHUB_LIMITS.MAX_DEVELOPER_FILES),
    changedFiles: change.map((file) => ({
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
    })),
    additions: github.additions,
    deletions: github.deletions,
    code: input.code
      ? {
          path: input.code.path,
          language: input.code.language,
          lines: input.code.lines.slice(0, GITHUB_LIMITS.MAX_DEVELOPER_CODE_LINES),
        }
      : null,
    diff: input.diff
      ? input.diff
          .slice(0, GITHUB_LIMITS.MAX_DEVELOPER_DIFF_LINES)
          .map((row) => ({ kind: row.kind, text: row.text }))
      : null,
    search:
      input.search && input.search.hits.length > 0
        ? {
            query: input.search.query,
            hits: input.search.hits
              .slice(0, GITHUB_LIMITS.MAX_DEVELOPER_SEARCH_RESULTS)
              .map((hit) => ({
                path: hit.path,
                line: hit.line,
                snippet: hit.snippet,
              })),
          }
        : null,
    observations: input.observations.slice(0, AI_LIMITS.MAX_DEVELOPER_OBSERVATIONS),
    notes: input.notes.slice(0, AI_LIMITS.MAX_DEVELOPER_OBSERVATIONS),
    truncated: github.truncated,
  };
}
