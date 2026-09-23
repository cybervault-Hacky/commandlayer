/**
 * Phase 7 — issue intelligence.
 *
 * Requirements and acceptance criteria are extracted from the issue text the
 * page already shows (title, rendered body, checklists). Every extracted item
 * is a sentence from the issue — nothing is invented, and when the page gave
 * us very little the summary says so (`limitedContext`).
 */
import type { GitHubPageContext } from '@/github/types';
import { DEVELOPER_LIMITS } from './limits';
import type { DeveloperIssueSummary } from './types';

const REQUIREMENT_MARKER =
  /\b(should|must|needs? to|need to|we need|requires?|required|support|supports|allow|expects?|expected|fix(?:es|ed)?|add(?:s|ed)?|implement(?:s|ed)?|update(?:s|d)?|remove(?:s|d)?|prevent|ensure|handle|make sure)\b/i;

const CHECKBOX = /^\s*[-*]\s*\[(?: |x|X)\]\s*(.+)$/;
const ACCEPTANCE_HEADING = /^(?:##*\s*)?(acceptance criteria|definition of done|requirements|expected behaviour|expected behavior|test plan)\b[:\s]*$/i;
const GIVEN_WHEN_THEN = /\b(given|when|then|and)\b[^\n]{8,}/i;

function splitSentences(text: string): string[] {
  return text
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z0-9])|(?=^\s*[-*]\s)/m)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part.length >= 12);
}

/**
 * Build the issue summary, or null when the page is not an issue/discussion.
 */
export function summarizeIssue(
  github: GitHubPageContext,
  pageText: string,
): DeveloperIssueSummary | null {
  if (github.surface !== 'issue' && github.surface !== 'discussion') return null;

  const title = github.title ?? null;
  const body = [github.description ?? '', pageText].filter(Boolean).join('\n\n');
  const sentences = splitSentences(body);

  const requirements: string[] = [];
  for (const sentence of sentences) {
    if (!REQUIREMENT_MARKER.test(sentence)) continue;
    if (requirements.includes(sentence)) continue;
    requirements.push(sentence.slice(0, DEVELOPER_LIMITS.MAX_SEARCH_SNIPPET));
    if (requirements.length >= DEVELOPER_LIMITS.MAX_ISSUE_REQUIREMENTS) break;
  }

  const acceptanceCriteria: string[] = [];
  const lines = body.split('\n');
  let inAcceptanceSection = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const checkbox = CHECKBOX.exec(line);
    if (checkbox?.[1]) {
      acceptanceCriteria.push(
        checkbox[1].replace(/\s+/g, ' ').trim().slice(0, DEVELOPER_LIMITS.MAX_SEARCH_SNIPPET),
      );
    } else if (ACCEPTANCE_HEADING.test(line)) {
      inAcceptanceSection = true;
      continue;
    } else if (inAcceptanceSection && /^#/.test(line)) {
      inAcceptanceSection = false;
    } else if (inAcceptanceSection && GIVEN_WHEN_THEN.test(line)) {
      acceptanceCriteria.push(
        line.replace(/\s+/g, ' ').trim().slice(0, DEVELOPER_LIMITS.MAX_SEARCH_SNIPPET),
      );
    }

    if (acceptanceCriteria.length >= DEVELOPER_LIMITS.MAX_ISSUE_ACCEPTANCE) break;
  }

  // Likely-relevant captured files: path tokens that also appear in the issue
  // text. Pure matching — no file is fetched and no path is invented.
  const haystack = `${title ?? ''} ${body}`.toLowerCase();
  const relatedFiles: string[] = [];
  const candidates = [
    ...github.files.map((file) => file.path),
    ...github.changedFiles.map((file) => file.path),
  ];
  for (const path of candidates) {
    if (relatedFiles.length >= DEVELOPER_LIMITS.MAX_RELATED_FILES) break;
    const base = path.split('/').pop()?.toLowerCase() ?? '';
    const stem = base.replace(/\.[a-z0-9]+$/i, '');
    if (stem.length < 3) continue;
    if (haystack.includes(stem) || haystack.includes(base)) relatedFiles.push(path);
  }

  return {
    number: github.issueNumber ?? github.discussionNumber ?? null,
    title,
    requirements,
    acceptanceCriteria,
    relatedFiles,
    limitedContext: body.trim().length < 80,
  };
}

/** Deterministic observations about an issue (shown in the result card). */
export function issueObservations(summary: DeveloperIssueSummary): string[] {
  const observations: string[] = [];
  observations.push(
    `Issue context: ${summary.requirements.length} requirement sentence${summary.requirements.length === 1 ? '' : 's'} extracted`,
  );
  if (summary.acceptanceCriteria.length > 0) {
    observations.push(
      `Acceptance criteria found: ${summary.acceptanceCriteria.length}`,
    );
  }
  if (summary.relatedFiles.length > 0) {
    observations.push(`Related files visible on this page: ${summary.relatedFiles.length}`);
  }
  if (summary.limitedContext) {
    observations.push(
      'The page shows little issue text, so this analysis is limited to what is visible',
    );
  }
  return observations;
}
