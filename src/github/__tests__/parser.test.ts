import { describe, expect, it } from 'vitest';
import { parseGitHubContext } from '../parse';
import { GitHubSurface } from '../types';

/**
 * Phase 7 — content-side GitHub capture.
 *
 * The fixtures below are deliberately SIMPLE: CommandLayer reads structure
 * (URL, metadata, link shapes, data attributes), never one fragile selector.
 * Each test also asserts what was NOT collected.
 */
/**
 * The capture API takes the page URL as an explicit argument (page
 * intelligence already knows it), so a fixture never has to fake a location.
 */
function doc(html: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><head><title>Fixture</title></head><body>${html}</body></html>`,
    'text/html',
  );
}

describe('GitHub page capture — structure over scraping', () => {
  it('captures a repository page: identity, listing and README excerpt', () => {
    const html = `
      <meta name="octolytics-dimension-repository_nwo" content="octocat/hello-world">
      <meta name="octolytics-dimension-repository_public" content="true">
      <div role="rowheader"><a href="/octocat/hello-world/blob/main/src/index.ts">index.ts</a></div>
      <div role="rowheader"><a href="/octocat/hello-world/tree/main/src">src</a></div>
      <article class="markdown-body"><h1>Hello World</h1><p>A minimal repository used for testing.</p></article>
      <input type="text" value="never-collected">
      <form><input name="token" value="ghp_secretvalue"></form>
    `;
    const context = parseGitHubContext(
      doc(html),
      'https://github.com/octocat/hello-world',
    );

    expect(context).not.toBeNull();
    expect(context?.surface).toBe(GitHubSurface.Repository);
    expect(context?.owner).toBe('octocat');
    expect(context?.repository).toBe('hello-world');
    expect(context?.visibility).toBe('public');
    expect(context?.files.map((file) => file.path)).toContain('src/index.ts');
    expect(context?.readmeExcerpt).toContain('minimal repository');

    // Over-collection guard: form values are NEVER read, even when the page
    // contains one (Phase 2 rule, preserved for GitHub capture).
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain('ghp_secretvalue');
    expect(serialized).not.toContain('never-collected');
  });

  it('captures a file page: bounded code lines with their numbers', () => {
    const html = `
      <table class="highlight">
        <tr data-line-number="1"><td class="blob-code">export const answer = 42;</td></tr>
        <tr data-line-number="2"><td class="blob-code">export function useToken() { return null; }</td></tr>
      </table>
    `;
    const url = 'https://github.com/octocat/hello-world/blob/main/src/index.ts';
    const context = parseGitHubContext(doc(html), url);

    expect(context?.surface).toBe(GitHubSurface.File);
    expect(context?.path).toBe('src/index.ts');
    expect(context?.branch).toBe('main');
    expect(context?.codeLines.length).toBeGreaterThan(0);
    for (const line of context?.codeLines ?? []) {
      expect(typeof line.number).toBe('number');
      expect(line.text.length).toBeLessThanOrEqual(200);
    }
  });

  it('captures a pull request page: changed files and a diff excerpt', () => {
    const html = `
      <meta name="octolytics-dimension-repository_nwo" content="octocat/hello-world">
      <a href="/octocat/hello-world/blob/main/src/auth/token.ts">src/auth/token.ts</a>
      <div data-path="src/auth/token.ts">
        <span class="diffstat">+12 −4</span>
      </div>
      <table>
        <tr><td class="blob-code blob-code-addition" data-line-number="10">+const refreshed = await refresh(token);</td></tr>
        <tr><td class="blob-code blob-code-deletion" data-line-number="11">-return null;</td></tr>
      </table>
    `;
    const url = 'https://github.com/octocat/hello-world/pull/42/files';
    const context = parseGitHubContext(doc(html), url);

    expect(context?.surface).toBe(GitHubSurface.PullRequest);
    expect(context?.pullRequestNumber).toBe(42);
    expect(context?.changedFiles.map((file) => file.path)).toContain('src/auth/token.ts');
    expect(context?.diffLines.length).toBeGreaterThan(0);
    expect(context?.evidence.dom).toBe(true);
  });

  it('captures an issue page: number and title', () => {
    const url = 'https://github.com/octocat/hello-world/issues/17';
    const context = parseGitHubContext(
      doc('<h1>Login fails after session expiry</h1>'),
      url,
    );
    expect(context?.surface).toBe(GitHubSurface.Issue);
    expect(context?.issueNumber).toBe(17);
  });

  it('degrades gracefully on hostile or empty markup', () => {
    const url = 'https://github.com/octocat/hello-world/pull/42';
    const hostile = `
      <div data-path="../../etc/passwd"></div>
      <div data-path="${'a'.repeat(1000)}"></div>
      <table><tr data-line-number="not-a-number"><td class="blob-code">x</td></tr></table>
      <script>window.__pwned = true;</script>
      <img src=x onerror="window.__pwned = true">
    `;
    const context = parseGitHubContext(doc(hostile), url);
    expect(context).not.toBeNull();
    for (const file of context?.changedFiles ?? []) {
      expect(file.path).not.toContain('..');
      expect(file.path.length).toBeLessThanOrEqual(400);
    }
    for (const line of context?.diffLines ?? []) {
      expect(line.text.length).toBeLessThanOrEqual(200);
    }

    const empty = parseGitHubContext(doc(''), url);
    expect(empty?.surface).toBe(GitHubSurface.PullRequest);
    expect(empty?.diffLines).toEqual([]);
  });

  it('returns null for a non-GitHub page so nothing GitHub-shaped is attached', () => {
    const url = 'https://example.org/docs';
    expect(parseGitHubContext(doc('<h1>Docs</h1>'), url)).toBeNull();
  });

  it('never walks an unbounded DOM (caps are enforced on huge pages)', () => {
    const rows = Array.from(
      { length: 5000 },
      (_, index) =>
        `<div data-path="src/file-${index}.ts"><span class="diffstat">+1 −1</span></div>`,
    ).join('');
    const url = 'https://github.com/octocat/hello-world/pull/7/files';
    const context = parseGitHubContext(doc(rows), url);

    expect(context?.changedFiles.length).toBeLessThanOrEqual(50);
    expect(context?.truncated).toBe(true);
  });
});
