/**
 * Phase 7 — deterministic review rules.
 *
 * These findings come from the captured change set alone — no model. They are
 * deliberately phrased as POTENTIAL issues ("worth checking", "this may"), and
 * every one carries concrete evidence (a path, a diff line, a marker). A rule
 * that has no evidence to cite produces no finding at all.
 *
 * The model may add further findings on top (see the AI validator, which
 * applies the same evidence and certainty rules). This module is what makes
 * the built-in, zero-configuration engine useful.
 */
import type { GitHubPageContext } from '@/github/types';
import { DEVELOPER_LIMITS } from './limits';
import { classifyChange } from './diff';
import { isSensitivePath, isTestFile } from './language';
import { findWorkMarkers } from './search';
import { FindingCategory, FindingConfidence, FindingSeverity } from '@/ai/types';
import type { ChangeCategory } from './types';
import type { DeveloperChangeSummary, DeveloperFinding } from './types';

const DEBUG_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bconsole\.(log|debug|warn|error)\s*\(/, 'console logging'],
  [/\bprint\s*\(/, 'print statement'],
  [/\bdebugger\b/, 'debugger statement'],
  [/\bSystem\.out\.println\s*\(/, 'print statement'],
  [/\bfmt\.Print(?:ln|f)?\s*\(/, 'print statement'],
];

const SECURITY_SMELLS: ReadonlyArray<readonly [RegExp, string]> = [
  [/https?:\/\/(?!localhost)[a-z0-9.-]+\//i, 'hard-coded absolute URL'],
  [/\b(?:md5|sha1)\s*\(/i, 'weak hash function'],
  [/\b(?:verify\s*=\s*false|rejectUnauthorized\s*:\s*false|verify=False)\b/i, 'disabled certificate verification'],
  [/\b(?:eval|exec)\s*\(/i, 'dynamic evaluation'],
];

const ERROR_HANDLING_SMELLS: ReadonlyArray<readonly [RegExp, string]> = [
  [/catch\s*(?:\([^)]*\))?\s*\{\s*\}/, 'empty catch block'],
  [/\bcatch\s*\(\s*\w*\s*\)\s*\{\s*(?:\/\/[^\n]*)?\}\s*$/i, 'silently swallowed error'],
];

function finding(
  severity: DeveloperFinding['severity'],
  category: DeveloperFinding['category'],
  explanation: string,
  evidence: string,
  confidence: DeveloperFinding['confidence'],
  file: string | null,
  line: number | null = null,
): DeveloperFinding {
  return { severity, category, file, line, explanation, evidence, confidence, origin: 'local' };
}

/**
 * Local review findings for a pull request or commit. Returns [] when the
 * captured context is too thin to say anything useful — silence is better
 * than speculation.
 */
export function localReviewFindings(
  github: GitHubPageContext,
  summary: DeveloperChangeSummary,
): DeveloperFinding[] {
  const findings: DeveloperFinding[] = [];

  // 1. Authentication / security-adjacent files changed.
  for (const path of summary.sensitiveFiles.slice(0, 3)) {
    findings.push(
      finding(
        FindingSeverity.Medium,
        FindingCategory.Security,
        `This change touches “${path}”, which looks security- or authentication-related. It may be worth checking that the change keeps the existing permission and validation behaviour intact.`,
        `changed file: ${path}`,
        FindingConfidence.Medium,
        path,
      ),
    );
  }

  // 2. Source changed with no test file in the same change set.
  const hasTests = summary.changedFiles.some((file) => isTestFile(file.path));
  const sourceFiles = summary.changedFiles
    .filter((file) => classifyChange(file.path) === ('source' satisfies ChangeCategory))
    .map((file) => file.path);
  if (!hasTests && sourceFiles.length > 0) {
    findings.push(
      finding(
        FindingSeverity.Info,
        FindingCategory.Testing,
        'No test file appears in the captured change set. Worth checking that the changed behaviour is covered elsewhere.',
        `source files changed: ${sourceFiles.slice(0, 3).join(', ')}`,
        FindingConfidence.Medium,
        null,
      ),
    );
  }

  // 3. Dependency / configuration changes are compatibility-relevant.
  const dependencyFiles = summary.changedFiles
    .filter((file) => classifyChange(file.path) === ('dependency' satisfies ChangeCategory))
    .map((file) => file.path);
  if (dependencyFiles.length > 0) {
    findings.push(
      finding(
        FindingSeverity.Info,
        FindingCategory.Compatibility,
        'This change updates dependency or lock files. It may affect the build or installed versions, so verification in a clean environment is worth considering.',
        `dependency files: ${dependencyFiles.slice(0, 3).join(', ')}`,
        FindingConfidence.Medium,
        dependencyFiles[0] ?? null,
      ),
    );
  }

  // 4. Large changes are harder to review safely.
  const totalLines = (summary.additions ?? 0) + (summary.deletions ?? 0);
  if (totalLines >= DEVELOPER_LIMITS.LARGE_CHANGE_LINES) {
    findings.push(
      finding(
        FindingSeverity.Info,
        FindingCategory.Maintainability,
        `This change set is large (${totalLines} changed lines across ${summary.changedFileCount} files). It may be worth splitting or reviewing in stages so nothing is skimmed.`,
        `diffstat: +${summary.additions ?? '?'} −${summary.deletions ?? '?'}`,
        FindingConfidence.Medium,
        null,
      ),
    );
  }

  // 5. Suspicious content in the bounded diff excerpt.
  const diffFindings = diffSmells(github);
  findings.push(...diffFindings);

  // 6. Unfinished-work markers added by the change.
  const markers = findWorkMarkers(github).slice(0, 2);
  for (const marker of markers) {
    findings.push(
      finding(
        FindingSeverity.Info,
        FindingCategory.Maintainability,
        `This change adds or keeps a ${marker.marker} marker. It may be worth confirming that is intentional for this pull request.`,
        `${marker.marker}: ${marker.text}`,
        FindingConfidence.High,
        marker.path,
        marker.line,
      ),
    );
  }

  return findings.slice(0, DEVELOPER_LIMITS.MAX_FINDINGS);
}

/** Content-based smells in the bounded diff excerpt (added lines only). */
export function diffSmells(github: GitHubPageContext): DeveloperFinding[] {
  const findings: DeveloperFinding[] = [];
  const added = github.diffLines.filter((row) => row.kind === '+');

  for (const row of added) {
    for (const [pattern, label] of DEBUG_PATTERNS) {
      if (!pattern.test(row.text)) continue;
      findings.push(
        finding(
          FindingSeverity.Info,
          FindingCategory.Maintainability,
          `This change adds a ${label}. It may be worth removing debugging output before merging.`,
          `+${row.text}`.slice(0, DEVELOPER_LIMITS.MAX_SEARCH_SNIPPET),
          FindingConfidence.High,
          github.path,
          row.newLine,
        ),
      );
      break;
    }
  }

  for (const row of added) {
    for (const [pattern, label] of SECURITY_SMELLS) {
      if (!pattern.test(row.text)) continue;
      findings.push(
        finding(
          FindingSeverity.Low,
          FindingCategory.Security,
          `This change introduces a ${label}. It may be worth checking whether that is intentional here.`,
          `+${row.text}`.slice(0, DEVELOPER_LIMITS.MAX_SEARCH_SNIPPET),
          FindingConfidence.Medium,
          github.path,
          row.newLine,
        ),
      );
      break;
    }
  }

  return findings.slice(0, 4);
}

/**
 * Local potential-bug analysis for a bounded code slice. Only mechanical,
 * evidence-backed observations are reported (unfinished error handling,
 * debugging output, dynamic evaluation); anything requiring judgement is left
 * to the model — and to the developer.
 */
export function localCodeFindings(github: GitHubPageContext): DeveloperFinding[] {
  const findings: DeveloperFinding[] = [];
  if (github.codeLines.length === 0) return findings;

  for (const line of github.codeLines) {
    for (const [pattern, label] of ERROR_HANDLING_SMELLS) {
      if (!pattern.test(line.text)) continue;
      findings.push(
        finding(
          FindingSeverity.Low,
          FindingCategory.Correctness,
          `This code contains an ${label}. It may be worth checking that the failure is handled or reported where it matters.`,
          `${line.number}: ${line.text}`.slice(0, DEVELOPER_LIMITS.MAX_SEARCH_SNIPPET),
          FindingConfidence.Medium,
          github.path,
          line.number,
        ),
      );
      break;
    }
  }

  const todos = findWorkMarkers(github).slice(0, 3);
  for (const marker of todos) {
    findings.push(
      finding(
        FindingSeverity.Info,
        FindingCategory.Maintainability,
        `This file carries a ${marker.marker} marker. It may indicate unfinished work in this area.`,
        `${marker.marker}: ${marker.text}`,
        FindingConfidence.High,
        marker.path,
        marker.line,
      ),
    );
  }

  if (github.path && isSensitivePath(github.path)) {
    findings.push(
      finding(
        FindingSeverity.Info,
        FindingCategory.Security,
        'This file looks authentication- or security-related. It may be worth a second reader before changes land.',
        `path: ${github.path}`,
        FindingConfidence.Low,
        github.path,
      ),
    );
  }

  return findings.slice(0, DEVELOPER_LIMITS.MAX_FINDINGS);
}
