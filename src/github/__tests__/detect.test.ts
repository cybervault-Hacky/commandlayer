import { describe, expect, it } from 'vitest';
import { detectGitHub } from '../detect';
import { GitHubSurface } from '../types';

/**
 * Phase 7 — GitHub surface detection is URL-first: deterministic, total, and
 * testable without a DOM. Every case below is a URL a user can actually be on.
 */
describe('GitHub detection — URL first', () => {
  it('detects the supported surfaces from their canonical URLs', () => {
    const cases: Array<[string, GitHubSurface]> = [
      ['https://github.com/octocat/hello-world', GitHubSurface.Repository],
      [
        'https://github.com/octocat/hello-world/tree/main/src',
        GitHubSurface.Directory,
      ],
      [
        'https://github.com/octocat/hello-world/blob/main/src/index.ts',
        GitHubSurface.File,
      ],
      [
        'https://github.com/octocat/hello-world/commit/5f2a1b3c4d5e6f708192a3b4c5d6e7f8091a2b3c',
        GitHubSurface.Commit,
      ],
      ['https://github.com/octocat/hello-world/pull/42', GitHubSurface.PullRequest],
      ['https://github.com/octocat/hello-world/pull/42/files', GitHubSurface.PullRequest],
      ['https://github.com/octocat/hello-world/issues/17', GitHubSurface.Issue],
      ['https://github.com/octocat/hello-world/discussions/9', GitHubSurface.Discussion],
      [
        'https://github.com/octocat/hello-world/releases/tag/v1.2.0',
        GitHubSurface.Release,
      ],
      ['https://github.com/search?q=react+hooks&type=code', GitHubSurface.Search],
      [
        'https://github.com/octocat/hello-world/search?q=router&type=code',
        GitHubSurface.Search,
      ],
    ];

    for (const [url, surface] of cases) {
      const detection = detectGitHub(url);
      expect(detection.isGitHub, url).toBe(true);
      expect(detection.surface, url).toBe(surface);
    }
  });

  it('reads the identity from the URL', () => {
    const detection = detectGitHub(
      'https://github.com/octocat/hello-world/blob/main/src/core/router.ts',
    );
    expect(detection.owner).toBe('octocat');
    expect(detection.repository).toBe('hello-world');
    expect(detection.branch).toBe('main');
    expect(detection.path).toBe('src/core/router.ts');
  });

  it('reads PR, issue, discussion, commit and release identifiers', () => {
    expect(
      detectGitHub('https://github.com/a/b/pull/123').pullRequestNumber,
    ).toBe(123);
    expect(detectGitHub('https://github.com/a/b/issues/9').issueNumber).toBe(9);
    expect(
      detectGitHub('https://github.com/a/b/discussions/4').discussionNumber,
    ).toBe(4);
    expect(
      detectGitHub('https://github.com/a/b/commit/abc123def456').commitSha,
    ).toBe('abc123def456');
    expect(
      detectGitHub('https://github.com/a/b/releases/tag/v2.0.0').releaseTag,
    ).toBe('v2.0.0');
  });

  it('reads the search query, bounded and control-character free', () => {
    expect(
      detectGitHub('https://github.com/search?q=useState&type=code').searchQuery,
    ).toBe('useState');

    // A query is DATA: it is decoded, length-capped, and stripped of control
    // characters. It is never interpreted as markup or as a destination —
    // anything query-shaped and oversized simply does not survive.
    const hostile = detectGitHub(
      'https://github.com/search?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E%00',
    );
    expect(hostile.searchQuery ?? '').not.toContain('\u0000');
    expect((hostile.searchQuery ?? '').length).toBeLessThanOrEqual(200);

    const oversized = detectGitHub(
      `https://github.com/search?q=${'a'.repeat(500)}&type=code`,
    );
    expect((oversized.searchQuery ?? '').length).toBeLessThanOrEqual(200);
  });

  it('classifies unknown sub-routes as an unknown surface, keeping identity', () => {
    for (const route of ['actions', 'branches', 'projects', 'wiki', 'settings']) {
      const detection = detectGitHub(`https://github.com/octocat/hello-world/${route}`);
      expect(detection.surface, route).toBe(GitHubSurface.Unknown);
      expect(detection.owner, route).toBe('octocat');
      expect(detection.repository, route).toBe('hello-world');
    }
  });

  it('never claims a non-GitHub page', () => {
    for (const url of [
      'https://gitlab.com/octocat/hello-world',
      'https://github.com.evil.example/octocat/hello-world',
      'https://notgithub.com/octocat/hello-world',
      'https://gist.github.com/octocat/abc',
      'chrome://extensions',
      'about:blank',
      '',
      undefined,
      null,
      'not a url',
      'file:///etc/passwd',
      'javascript:alert(1)',
    ]) {
      const detection = detectGitHub(url ?? undefined);
      expect(detection.isGitHub, String(url)).toBe(false);
      expect(detection.surface, String(url)).toBe(GitHubSurface.Unknown);
    }
  });

  it('treats github.com itself and global routes as GitHub but not a surface', () => {
    for (const url of [
      'https://github.com/',
      'https://github.com/settings/profile',
      'https://github.com/notifications',
      'https://github.com/octocat',
      'https://github.com/marketplace',
    ]) {
      const detection = detectGitHub(url);
      expect(detection.isGitHub, url).toBe(true);
      expect(detection.surface, url).toBe(GitHubSurface.Unknown);
    }
  });

  it('is total: hostile and oversized URLs never throw', () => {
    const hostile = [
      'https://github.com/' + 'a'.repeat(5000),
      'https://github.com/../../etc/passwd',
      'https://github.com/octocat/hello-world/blob/main/' + '../'.repeat(40),
      'https://github.com/%00/%00',
      'https://github.com/octocat/hello-world/pull/99999999999999999999',
    ];
    for (const url of hostile) {
      expect(() => detectGitHub(url)).not.toThrow();
    }
    // Traversal never survives into a resolved path.
    const traversal = detectGitHub(
      'https://github.com/octocat/hello-world/blob/main/..%2f..%2fetc/passwd',
    );
    expect(traversal.path ?? '').not.toContain('..');
  });
});
