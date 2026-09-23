/**
 * Phase 7 — developer result validation (defense in depth).
 *
 * A DeveloperResultView is produced in the background and crossed to the UI
 * over `chrome.runtime` messaging. Every Phase 1–6 boundary validates what it
 * receives rather than trusting it, and this is the developer equivalent: a
 * CLOSED schema (unknown keys reject), bounded arrays, bounded strings, closed
 * enumerations, and repository paths re-checked with the same pattern rules
 * the GitHub layer uses.
 *
 * A rejected view is not rendered. Nothing here can execute, and no field
 * carries an executable instruction — `navigation` is a typed path list that
 * still has to pass the Phase 4 validator and the user's approval.
 */
import { FindingCategory, FindingConfidence, FindingSeverity } from '@/ai/types';
import { GitHubChangeStatus, GitHubSurface } from '@/github/types';
import { isSafeRepoPath } from '@/github/patterns';
import { ChangeCategory, type DeveloperResultView } from './types';
import { isDeveloperIntent } from './intents';
import { DEVELOPER_LIMITS } from './limits';

const RESULT_FIELDS: ReadonlySet<string> = new Set([
  'intent',
  'surface',
  'repository',
  'ref',
  'path',
  'language',
  'summary',
  'findings',
  'observations',
  'affectedFiles',
  'search',
  'change',
  'issue',
  'plan',
  'notes',
  'truncated',
]);

const FINDING_FIELDS: ReadonlySet<string> = new Set([
  'severity',
  'category',
  'file',
  'line',
  'explanation',
  'evidence',
  'confidence',
  'origin',
]);

const MAX_TEXT = 600;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return false;
  }
  return true;
}

function closed<T extends string>(
  values: Record<string, T>,
  value: unknown,
): value is T {
  return typeof value === 'string' && Object.values(values).includes(value as T);
}

function text(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex -- deliberate sanitization
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (cleaned.length === 0 || cleaned.length > max) return null;
  return cleaned;
}

function textArray(value: unknown, maxItems: number, max = MAX_TEXT): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const out: string[] = [];
  for (const entry of value) {
    const parsed = text(entry, max);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

function optionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return text(value);
}

function integer(value: unknown, max: number): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
    return null;
  }
  return value;
}

function parseFinding(value: unknown): DeveloperResultView['findings'][number] | null {
  if (!isRecord(value) || !onlyKeys(value, FINDING_FIELDS)) return null;
  if (!closed(FindingSeverity, value.severity)) return null;
  if (!closed(FindingCategory, value.category)) return null;
  if (!closed(FindingConfidence, value.confidence)) return null;
  if (value.origin !== 'local' && value.origin !== 'model') return null;

  let file: string | null = null;
  if (value.file !== null && value.file !== undefined) {
    if (typeof value.file !== 'string' || !isSafeRepoPath(value.file)) return null;
    file = value.file;
  }

  const line = integer(value.line, 5_000_000);
  if (value.line !== null && value.line !== undefined && line === null) return null;

  const explanation = text(value.explanation, 400);
  if (explanation === null) return null;
  const evidence = text(value.evidence, 400);
  if (evidence === null) return null;

  return {
    severity: value.severity,
    category: value.category,
    file,
    line,
    explanation,
    evidence,
    confidence: value.confidence,
    origin: value.origin,
  };
}

/** undefined = rejected. */
function parseSearch(value: unknown): DeveloperResultView['search'] | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return undefined;
  if (!onlyKeys(value, new Set(['query', 'hits', 'scanned', 'truncated']))) return undefined;
  const query = text(value.query, 200);
  if (query === null) return undefined;
  if (!Array.isArray(value.hits) || value.hits.length > DEVELOPER_LIMITS.MAX_SEARCH_HITS) {
    return undefined;
  }
  const hits: NonNullable<DeveloperResultView['search']>['hits'] = [];
  for (const hit of value.hits) {
    if (!isRecord(hit)) return undefined;
    if (!onlyKeys(hit, new Set(['path', 'line', 'snippet', 'source']))) return undefined;
    const snippet = text(hit.snippet, DEVELOPER_LIMITS.MAX_SEARCH_SNIPPET);
    if (snippet === null) return undefined;
    let path: string | null = null;
    if (hit.path !== null && hit.path !== undefined) {
      if (typeof hit.path !== 'string' || !isSafeRepoPath(hit.path)) return undefined;
      path = hit.path;
    }
    const line = integer(hit.line, 5_000_000);
    if (hit.line !== null && hit.line !== undefined && line === null) return undefined;
    if (
      hit.source !== 'code' &&
      hit.source !== 'diff' &&
      hit.source !== 'page-text' &&
      hit.source !== 'file-list' &&
      hit.source !== 'link'
    ) {
      return undefined;
    }
    hits.push({ path, line, snippet, source: hit.source });
  }
  const scanned = integer(value.scanned, 10_000);
  if (scanned === null) return undefined;
  if (typeof value.truncated !== 'boolean') return undefined;
  return { query, hits, scanned, truncated: value.truncated };
}

/**
 * Validate a developer result view. Returns null when the payload is not
 * exactly the contract — the caller renders nothing rather than guessing.
 */
export function parseDeveloperResultView(value: unknown): DeveloperResultView | null {
  if (!isRecord(value)) return null;
  if (!onlyKeys(value, RESULT_FIELDS)) return null;
  if (!isDeveloperIntent(value.intent)) return null;
  if (!closed(GitHubSurface, value.surface)) return null;
  if (typeof value.truncated !== 'boolean') return null;

  const summary = text(value.summary, 1_200);
  if (summary === null) return null;

  const observations = textArray(value.observations, DEVELOPER_LIMITS.MAX_OBSERVATIONS);
  if (observations === null) return null;

  const notes = textArray(value.notes, DEVELOPER_LIMITS.MAX_NOTES);
  if (notes === null) return null;

  if (!Array.isArray(value.findings) || value.findings.length > DEVELOPER_LIMITS.MAX_FINDINGS) {
    return null;
  }
  const findings: DeveloperResultView['findings'] = [];
  for (const entry of value.findings) {
    const finding = parseFinding(entry);
    if (finding === null) return null;
    findings.push(finding);
  }

  const affectedFiles = textArray(
    value.affectedFiles,
    DEVELOPER_LIMITS.MAX_AFFECTED_FILES,
    DEVELOPER_LIMITS.MAX_REASONABLE_FILE_CHARS,
  );
  if (affectedFiles === null) return null;
  for (const path of affectedFiles) {
    if (!isSafeRepoPath(path)) return null;
  }

  const repository = optionalText(value.repository);
  if (value.repository !== null && value.repository !== undefined && repository === null) return null;
  const ref = optionalText(value.ref);
  if (value.ref !== null && value.ref !== undefined && ref === null) return null;
  const path = optionalText(value.path);
  if (value.path !== null && value.path !== undefined && path === null) return null;
  const language = optionalText(value.language);
  if (value.language !== null && value.language !== undefined && language === null) return null;

  // The search block is validate-or-reject (no silent dropping).
  let search: DeveloperResultView['search'] = null;
  if (value.search !== null && value.search !== undefined) {
    const parsed = parseSearch(value.search);
    if (parsed === undefined) return null;
    search = parsed;
  }

  // Change / issue / plan blocks are validated structurally but kept simple:
  // they are numbers, bounded strings, and closed vocabularies, and a
  // malformed block rejects the whole view rather than half-rendering it.
  let change: DeveloperResultView['change'] = null;
  if (value.change !== null && value.change !== undefined) {
    if (!isRecord(value.change)) return null;
    const record = value.change;
    if (
      !onlyKeys(
        record,
        new Set([
          'changedFiles',
          'changedFileCount',
          'additions',
          'deletions',
          'categories',
          'sensitiveFiles',
          'hasDiffExcerpt',
          'diffLineCount',
        ]),
      )
    ) {
      return null;
    }
    if (!Array.isArray(record.changedFiles) || record.changedFiles.length > DEVELOPER_LIMITS.MAX_CHANGED_FILES) {
      return null;
    }
    const changedFiles: NonNullable<DeveloperResultView['change']>['changedFiles'] = [];
    for (const file of record.changedFiles) {
      if (!isRecord(file) || !onlyKeys(file, new Set(['path', 'status', 'additions', 'deletions']))) {
        return null;
      }
      if (typeof file.path !== 'string' || !isSafeRepoPath(file.path)) return null;
      // The change-status vocabulary is GitHub's own (including 'unknown',
      // which is what a page that does not state the status produces): the
      // validator accepts exactly what the capture can emit, nothing wider.
      if (!closed(GitHubChangeStatus, file.status)) return null;
      changedFiles.push({
        path: file.path,
        status: file.status,
        additions: integer(file.additions, 5_000_000),
        deletions: integer(file.deletions, 5_000_000),
      });
    }
    const changedFileCount = integer(record.changedFileCount, 100_000);
    if (changedFileCount === null) return null;
    if (!Array.isArray(record.categories)) return null;
    const categories: ChangeCategory[] = [];
    for (const category of record.categories) {
      if (!closed(ChangeCategory, category)) return null;
      categories.push(category);
    }
    const sensitiveFiles = textArray(record.sensitiveFiles, DEVELOPER_LIMITS.MAX_SENSITIVE_FILES, 400);
    if (sensitiveFiles === null) return null;
    for (const sensitive of sensitiveFiles) {
      if (!isSafeRepoPath(sensitive)) return null;
    }
    if (typeof record.hasDiffExcerpt !== 'boolean') return null;
    const diffLineCount = integer(record.diffLineCount, 100_000);
    if (diffLineCount === null) return null;
    change = {
      changedFiles,
      changedFileCount,
      additions: integer(record.additions, 5_000_000),
      deletions: integer(record.deletions, 5_000_000),
      categories,
      sensitiveFiles,
      hasDiffExcerpt: record.hasDiffExcerpt,
      diffLineCount,
    };
  }

  let issue: DeveloperResultView['issue'] = null;
  if (value.issue !== null && value.issue !== undefined) {
    if (!isRecord(value.issue)) return null;
    const record = value.issue;
    if (
      !onlyKeys(
        record,
        new Set(['number', 'title', 'requirements', 'acceptanceCriteria', 'relatedFiles', 'limitedContext']),
      )
    ) {
      return null;
    }
    const requirements = textArray(record.requirements, DEVELOPER_LIMITS.MAX_ISSUE_REQUIREMENTS);
    if (requirements === null) return null;
    const acceptanceCriteria = textArray(record.acceptanceCriteria, DEVELOPER_LIMITS.MAX_ISSUE_ACCEPTANCE);
    if (acceptanceCriteria === null) return null;
    const relatedFiles = textArray(record.relatedFiles, DEVELOPER_LIMITS.MAX_RELATED_FILES, 400);
    if (relatedFiles === null) return null;
    for (const related of relatedFiles) {
      if (!isSafeRepoPath(related)) return null;
    }
    if (typeof record.limitedContext !== 'boolean') return null;
    issue = {
      number: integer(record.number, 5_000_000),
      title: optionalText(record.title),
      requirements,
      acceptanceCriteria,
      relatedFiles,
      limitedContext: record.limitedContext,
    };
  }

  let plan: DeveloperResultView['plan'] = null;
  if (value.plan !== null && value.plan !== undefined) {
    if (!isRecord(value.plan)) return null;
    const record = value.plan;
    if (!onlyKeys(record, new Set(['summary', 'steps', 'files', 'navigation', 'executable']))) {
      return null;
    }
    const planSummary = text(record.summary, 1_200);
    if (planSummary === null) return null;
    if (!Array.isArray(record.steps) || record.steps.length === 0 || record.steps.length > DEVELOPER_LIMITS.MAX_PLAN_STEPS) {
      return null;
    }
    const steps: NonNullable<DeveloperResultView['plan']>['steps'] = [];
    for (const step of record.steps) {
      if (!isRecord(step) || !onlyKeys(step, new Set(['title', 'detail', 'files']))) return null;
      const title = text(step.title, 140);
      if (title === null) return null;
      const detail = step.detail === undefined ? undefined : text(step.detail, 400);
      if (step.detail !== undefined && detail === null) return null;
      let files: string[] | undefined;
      if (step.files !== undefined) {
        const parsed = textArray(step.files, DEVELOPER_LIMITS.MAX_PLAN_STEP_FILES, 400);
        if (parsed === null) return null;
        for (const file of parsed) {
          if (!isSafeRepoPath(file)) return null;
        }
        files = parsed;
      }
      steps.push({ title, ...(detail ? { detail } : {}), ...(files ? { files } : {}) });
    }
    const files = textArray(record.files, DEVELOPER_LIMITS.MAX_AFFECTED_FILES, 400);
    if (files === null) return null;
    for (const file of files) {
      if (!isSafeRepoPath(file)) return null;
    }
    if (!Array.isArray(record.navigation) || record.navigation.length > DEVELOPER_LIMITS.MAX_PLAN_NAVIGATION) {
      return null;
    }
    const navigation: NonNullable<DeveloperResultView['plan']>['navigation'] = [];
    for (const entry of record.navigation) {
      if (!isRecord(entry) || !onlyKeys(entry, new Set(['path', 'label']))) return null;
      if (typeof entry.path !== 'string' || !isSafeRepoPath(entry.path)) return null;
      const label = text(entry.label, 200);
      if (label === null) return null;
      navigation.push({ path: entry.path, label });
    }
    if (typeof record.executable !== 'boolean') return null;
    plan = {
      summary: planSummary,
      steps,
      files,
      navigation,
      executable: record.executable && navigation.length > 0,
    };
  }

  return {
    intent: value.intent,
    surface: value.surface,
    repository,
    ref,
    path,
    language,
    summary,
    findings,
    observations,
    affectedFiles,
    search,
    change,
    issue,
    plan,
    notes,
    truncated: value.truncated,
  };
}
