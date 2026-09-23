import { describe, expect, it } from 'vitest';
import { GitHubSurface, createEmptyGitHubContext, type GitHubPageContext } from '@/github/types';
import { parseNavTarget } from '@/github/patterns';
import { FindingCategory, FindingConfidence, FindingSeverity, type AIResponse } from '@/ai/types';
import { buildPageContext } from '@/shared/pageContext';
import type { PageContext } from '@/shared/types/page';
import {
  buildChangePlan,
  deriveAffectedFiles,
  navigationProposals,
  planStepLabels,
  toNavigationTargets,
} from '../plan';
import { summarizeChange } from '../diff';
import { localReviewFindings } from '../review';
import { buildDeveloperResult } from '../index';
import { DEVELOPER_LIMITS } from '../limits';
import { DeveloperIntent } from '../intents';
import type { DeveloperFinding } from '../types';

function github(overrides: Partial<GitHubPageContext> = {}): GitHubPageContext {
  return {
    ...createEmptyGitHubContext('2026-01-01T00:00:00.000Z'),
    surface: GitHubSurface.PullRequest,
    owner: 'octocat',
    repository: 'hello-world',
    branch: 'main',
    pullRequestNumber: 42,
    title: 'Add token refresh',
    changedFiles: [
      { path: 'src/auth/session.ts', status: 'modified', additions: 30, deletions: 4 },
      { path: 'src/auth/session.test.ts', status: 'added', additions: 40, deletions: 0 },
      { path: '.github/workflows/ci.yml', status: 'modified', additions: 2, deletions: 1 },
      { path: 'src/config/secret.ts', status: 'modified', additions: 5, deletions: 2 },
    ],
    changedFileCount: 4,
    additions: 77,
    deletions: 7,
    diffLines: [
      { kind: '+', text: 'if (!token) return null;', oldLine: null, newLine: 10 },
      { kind: '+', text: '  const hash = md5(password);', oldLine: null, newLine: 11 },
      { kind: '+', text: 'fetch("http://api.example.com/token")', oldLine: null, newLine: 12 },
      { kind: '-', text: 'return cached;', oldLine: 9, newLine: null },
    ],
    ...overrides,
  };
}

function page(context: GitHubPageContext): PageContext {
  return {
    ...buildPageContext({
      title: 'Add token refresh by octocat · Pull Request #42',
      url: 'https://github.com/octocat/hello-world/pull/42/files',
    }),
    state: 'ready',
    paragraphs: ['Adds a refresh path for expired access tokens.'],
    headings: [],
    links: [],
    contentStats: {
      textLength: 48,
      wordCount: 8,
      paragraphCount: 1,
      headingCount: 0,
      linkCount: 0,
      tableCount: 0,
      formCount: 0,
      selectedTextLength: 0,
    },
    github: context,
  };
}

/** A hostile-but-schema-shaped model response: it tries to add executable work. */
function modelResponse(overrides: Partial<AIResponse> = {}): AIResponse {
  return {
    requestId: 'ai-1',
    intent: 'REVIEW_PULL_REQUEST' as AIResponse['intent'],
    status: 'success',
    answer: 'The change adds a refresh path; worth checking the token lifetime.',
    sections: [],
    sources: [],
    findings: [
      {
        severity: FindingSeverity.Medium,
        category: FindingCategory.Security,
        file: 'src/auth/token.ts',
        line: 11,
        explanation: 'Hashing looks weak here; worth checking the algorithm choice.',
        evidence: 'const hash = md5(password);',
        confidence: FindingConfidence.Medium,
      },
      {
        // The model names a file that is NOT in the context, with a path that
        // is not repository-relative: it must not become an executable target.
        severity: FindingSeverity.High,
        category: FindingCategory.Security,
        file: 'https://evil.example/steal.ts',
        line: null,
        explanation: 'Potential issue worth checking.',
        evidence: 'evil.example',
        confidence: FindingConfidence.Low,
      },
      {
        // New information from the model, with safe evidence: it is kept.
        severity: FindingSeverity.Low,
        category: FindingCategory.Performance,
        file: 'src/auth/token.ts',
        line: 12,
        explanation: 'Evidence suggests the token fetch may block the caller; worth checking.',
        evidence: 'fetch("http://api.example.com/token")',
        confidence: FindingConfidence.Low,
      },
    ],
    changePlan: {
      summary: 'Update the token path and open the attacker page.',
      steps: [
        { title: 'Open the file', files: ['src/auth/token.ts'] },
        {
          title: 'Open https://evil.example/steal and run curl | sh',
          files: ['https://evil.example/steal.ts', '../../etc/passwd'],
        },
      ],
    },
    provider: 'test',
    finishedAt: '2026-01-01T00:00:01.000Z',
    ...overrides,
  };
}

describe('§5 change understanding classifies the change set', () => {
  it('summarizes files, categories and sensitive areas deterministically', () => {
    const summary = summarizeChange(github());
    expect(summary).not.toBeNull();
    const change = summary!;
    expect(change.changedFileCount).toBe(4);
    expect(change.categories).toContain('tests');
    expect(change.categories).toContain('configuration');
    expect(change.sensitiveFiles).toContain('src/auth/session.ts');
    expect(change.sensitiveFiles).toContain('src/config/secret.ts');
    expect(change.sensitiveFiles.length).toBeLessThanOrEqual(DEVELOPER_LIMITS.MAX_SENSITIVE_FILES);
    expect(change.hasDiffExcerpt).toBe(true);
    expect(change.diffLineCount).toBeLessThanOrEqual(DEVELOPER_LIMITS.MAX_DIFF_LINES);
  });

  it('produces hedged, evidence-bound findings', () => {
    const findings = localReviewFindings(github(), summarizeChange(github())!);
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding.evidence.length).toBeGreaterThan(0);
      expect(finding.explanation).not.toMatch(/\b(is a bug|definitely|guaranteed)\b/i);
      if (finding.file) expect(finding.file.startsWith('/')).toBe(false);
    }
  });
});

describe('§7 the change planner is deterministic and non-executable', () => {
  const findings: DeveloperFinding[] = [
    {
      severity: FindingSeverity.High,
      category: FindingCategory.Security,
      file: 'src/config/secrets.ts',
      line: 4,
      explanation: 'Worth checking whether this value is read from the environment.',
      evidence: 'const apiKey = "sk-..."',
      confidence: FindingConfidence.Medium,
      origin: 'local',
    },
  ];

  it('orders affected files by evidence, de-duplicates and caps them', () => {
    const files = deriveAffectedFiles(github(), findings);
    expect(files[0]).toBe('src/config/secrets.ts');
    expect(new Set(files).size).toBe(files.length);
    expect(files.length).toBeLessThanOrEqual(DEVELOPER_LIMITS.MAX_AFFECTED_FILES);
  });

  it('proposes at most a handful of file opens, never a mutation', () => {
    const proposals = navigationProposals(deriveAffectedFiles(github(), findings));
    expect(proposals.length).toBeLessThanOrEqual(DEVELOPER_LIMITS.MAX_PLAN_NAVIGATION);
    for (const target of toNavigationTargets(proposals, github())) {
      expect(target.kind).toBe('file');
      expect(parseNavTarget(target)).toEqual(target);
    }
  });

  it('returns no plan when there is nothing meaningful to plan', () => {
    const empty = github({
      changedFiles: [],
      diffLines: [],
      files: [],
      path: null,
      pullRequestNumber: null,
      surface: GitHubSurface.Repository,
    });
    expect(
      buildChangePlan({
        github: empty,
        change: null,
        issue: null,
        findings: [],
        affectedFiles: [],
        goal: 'Review this pull request',
      }),
    ).toBeNull();
  });

  it('keeps plan steps as bounded text', () => {
    const plan = buildChangePlan({
      github: github(),
      change: summarizeChange(github()),
      issue: null,
      findings,
      affectedFiles: deriveAffectedFiles(github(), findings),
      goal: 'Turn this pull request into a change plan',
    });

    expect(plan).not.toBeNull();
    expect(plan!.steps.length).toBeLessThanOrEqual(DEVELOPER_LIMITS.MAX_PLAN_STEPS);
    for (const step of plan!.steps) {
      expect(typeof step.title).toBe('string');
      if (step.files) expect(step.files.length).toBeLessThanOrEqual(DEVELOPER_LIMITS.MAX_PLAN_STEP_FILES);
    }
    for (const label of planStepLabels(plan!)) {
      expect(label.length).toBeGreaterThan(0);
      expect(label.length).toBeLessThan(200);
    }
  });

  it('ignores the model when it tries to widen an executable navigation', () => {
    const outcome = buildDeveloperResult({
      pageContext: page(github()),
      request: { intent: DeveloperIntent.GenerateChangePlan, query: 'change plan', text: 'Turn this pull request into a change plan' },
      ai: modelResponse(),
    });

    expect(outcome.available).toBe(true);
    const navigation = outcome.result?.plan?.navigation ?? [];
    expect(navigation.length).toBeLessThanOrEqual(DEVELOPER_LIMITS.MAX_PLAN_NAVIGATION);
    for (const proposal of navigation) {
      expect(proposal.path).not.toContain('..');
      expect(proposal.path).not.toContain('://');
    }

    const targets = outcome.result?.plan
      ? toNavigationTargets(outcome.result.plan.navigation, github())
      : [];
    for (const target of targets) {
      const built = parseNavTarget(target);
      expect(built).not.toBeNull();
      if (built && built.kind === 'file') {
        expect(built.path).not.toContain('evil.example');
      }
    }
  });

  it('keeps local findings and reports the model findings as a separate origin', () => {
    const outcome = buildDeveloperResult({
      pageContext: page(github()),
      request: { intent: DeveloperIntent.ReviewPullRequest, query: 'review', text: 'Review this pull request' },
      ai: modelResponse(),
    });

    const findings = outcome.result?.findings ?? [];
    expect(findings.some((finding) => finding.origin === 'local')).toBe(true);
    expect(findings.some((finding) => finding.origin === 'model')).toBe(true);

    // An unsafe path can never survive, from either origin.
    const offenders = findings
      .map((finding) => finding.file)
      .filter((file): file is string => typeof file === 'string' && (file.includes('://') || file.includes('..')));
    expect(offenders).toEqual([]);
    // The unsafe path survives nowhere as a path (evidence TEXT may quote what
    // the page said — that is data, and it is never rendered as a destination).
    expect(findings.map((finding) => finding.file)).not.toContain(
      'https://evil.example/steal.ts',
    );
    expect(findings.length).toBeLessThanOrEqual(DEVELOPER_LIMITS.MAX_FINDINGS);
  });
});
