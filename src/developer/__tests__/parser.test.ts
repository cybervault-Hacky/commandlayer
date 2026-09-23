import { describe, expect, it } from 'vitest';
import { extractDeveloperQuery, isDeveloperRequest, parseDeveloperRequest } from '../parser';
import { DeveloperIntent } from '../intents';

/**
 * Phase 7 — deterministic developer command parsing.
 *
 * The rule that matters most: developer phrasing is claimed ONLY when it is
 * clearly developer work, so no existing Phase 1–6 command changes meaning.
 */
describe('developer command parsing', () => {
  it('maps developer phrasings to their intents', () => {
    const cases: Array<[string, DeveloperIntent]> = [
      ['Explain this file', DeveloperIntent.ExplainFile],
      ['what does this code do', DeveloperIntent.ExplainCode],
      ['Explain this repository', DeveloperIntent.ExplainRepository],
      ['summarize this codebase', DeveloperIntent.ExplainRepository],
      ['Find where the authentication middleware is defined', DeveloperIntent.FindCode],
      ['which files use the session token', DeveloperIntent.FindCode],
      ['show me the important changes in this PR', DeveloperIntent.AnalyzeDiff],
      ['Analyze this diff', DeveloperIntent.AnalyzeDiff],
      ['Review this pull request', DeveloperIntent.ReviewPullRequest],
      ['Summarize this issue', DeveloperIntent.AnalyzeIssue],
      ['summarize this commit', DeveloperIntent.SummarizeCommit],
      ['compare these files', DeveloperIntent.CompareCode],
      ['find the TODOs in this repository', DeveloperIntent.FindTodos],
      ['find potential bugs in this change', DeveloperIntent.FindPotentialBugs],
      ['turn this issue into an implementation plan', DeveloperIntent.GenerateChangePlan],
      ['make a change plan for this pull request', DeveloperIntent.GenerateChangePlan],
    ];

    for (const [text, intent] of cases) {
      expect(parseDeveloperRequest(text)?.intent, text).toBe(intent);
    }
  });

  it('does not claim ordinary page commands', () => {
    for (const text of [
      'Summarize this page',
      'explain this page',
      'find "token rotation"',
      'scroll to the bottom',
      'click "Sign in"',
      'type "hello" into "Search"',
      'Remember that I prefer TypeScript',
      'what do you remember about my preferences',
      'What is the pricing?',
      '',
    ]) {
      expect(parseDeveloperRequest(text), text).toBeNull();
    }
  });

  it('bounds the command and the extracted query', () => {
    const long = `Explain this file ${'x'.repeat(1000)}`;
    expect(parseDeveloperRequest(long)).toBeNull();

    const request = parseDeveloperRequest(
      'Find where the authentication middleware is defined',
    );
    expect(request?.query.length).toBeLessThanOrEqual(120);
  });

  it('prefers a quoted target and strips command filler otherwise', () => {
    expect(
      extractDeveloperQuery('Find where the "session middleware" is defined'),
    ).toBe('session middleware');
    expect(extractDeveloperQuery('Explain this file')).toBe('Explain this file');
    expect(
      extractDeveloperQuery('Find where the authentication middleware is defined'),
    ).toContain('authentication middleware');
  });

  it('is total for non-string input', () => {
    expect(isDeveloperRequest('Explain this file')).toBe(true);
    expect(parseDeveloperRequest(undefined as unknown as string)).toBeNull();
    expect(parseDeveloperRequest(42 as unknown as string)).toBeNull();
  });
});
