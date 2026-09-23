import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubSurface, createEmptyGitHubContext } from '@/github/types';
import {
  GitHubIntegrationErrorCode,
  containsCredentialMaterial,
  describeGitHubIntegration,
  getGitHubIntegrationStatus,
  githubIntegration,
  githubRepositoryReference,
  isAuthenticatedModeAvailable,
  parseApiRequest,
  parseIntegrationStatus,
  requestGitHubApi,
} from '../index';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('§9 GitHub integration mode', () => {
  it('reports page-context mode and never claims a connection', () => {
    const status = getGitHubIntegrationStatus();
    expect(status.mode).toBe('page_context');
    expect(status.authenticatedAvailable).toBe(false);
    expect(status.detail).toContain('page you have open');
    expect(githubIntegration.status()).toBe('available');
    expect(githubIntegration.kind).toBe('service');
  });

  it('has no authenticated mode to enable', async () => {
    expect(isAuthenticatedModeAvailable()).toBe(false);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await requestGitHubApi({ method: 'GET', path: '/repos/octocat/hello-world' });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe(GitHubIntegrationErrorCode.GITHUB_AUTH_DISABLED);
      expect(response.error.message).toContain('not available');
    }
    // No network call was attempted — there is no OAuth shortcut hiding here.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a malformed request before it could ever be sent', async () => {
    for (const request of [
      { method: 'TRACE', path: '/repos/a/b' },
      { method: 'GET', path: 'repos/a/b' },
      { method: 'GET', path: '/repos/a/b?token=1' },
      { method: 'GET', path: '../../etc/passwd' },
      { method: 'GET', path: 'https://evil.example/' },
      'https://api.github.com/repos/a/b',
      null,
    ]) {
      const parsed = parseApiRequest(request);
      expect(parsed.ok, JSON.stringify(request)).toBe(false);

      const response = await requestGitHubApi(request);
      expect(response.ok, JSON.stringify(request)).toBe(false);
    }
  });

  it('mechanically refuses credential-shaped material anywhere', () => {
    const secrets = [
      'ghp_0123456789abcdefghijklmnopqrstuvwx',
      'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123',
      'access_token = supersecretvalue',
    ];
    for (const secret of secrets) {
      expect(containsCredentialMaterial(secret), secret).toBe(true);
    }
    expect(containsCredentialMaterial('octocat/hello-world')).toBe(false);

    // Credential-shaped query values and details are rejected, not sanitized.
    expect(parseApiRequest({ method: 'GET', path: '/x', query: { q: secrets[0]! } }).ok).toBe(false);
    expect(
      parseIntegrationStatus({
        mode: 'page_context',
        pageContextAvailable: true,
        authenticatedAvailable: false,
        detail: `token ${secrets[0]!}`,
      }).ok,
    ).toBe(false);
  });

  it('refuses to report the authenticated mode as available', () => {
    const forged = parseIntegrationStatus({
      mode: 'authenticated',
      pageContextAvailable: true,
      authenticatedAvailable: true,
      detail: 'Connected.',
    });
    expect(forged.ok).toBe(false);
    if (!forged.ok) {
      expect(forged.error.code).toBe(GitHubIntegrationErrorCode.GITHUB_AUTH_DISABLED);
    }
  });

  it('adapts a validated page context into a slug and an honest line', () => {
    const context = {
      ...createEmptyGitHubContext('2026-01-01T00:00:00.000Z'),
      surface: GitHubSurface.Repository,
      owner: 'octocat',
      repository: 'hello-world',
    };

    expect(githubRepositoryReference(context)).toEqual({
      owner: 'octocat',
      repository: 'hello-world',
      slug: 'octocat/hello-world',
    });
    expect(describeGitHubIntegration(getGitHubIntegrationStatus(true), context)).toContain(
      'octocat/hello-world',
    );
    expect(describeGitHubIntegration(getGitHubIntegrationStatus(false), null)).toBe(
      'No GitHub repository context on this page.',
    );
  });
});

describe('§13 no credentials can enter this codebase', () => {
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry === '__tests__' || entry === 'node_modules') continue;
        sourceFiles(path, out);
      } else if (/\.(ts|tsx)$/.test(entry)) {
        out.push(path);
      }
    }
    return out;
  }

  /**
   * Comments are allowed to say "there is no OAuth here" — what must not exist
   * is CODE that acquires, stores, or transmits credentials. So the scan runs
   * against source with comments removed.
   */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  }

  it('has no OAuth, identity, or token-storage code anywhere in src', () => {
    const files = sourceFiles('src');
    expect(files.length).toBeGreaterThan(50);

    const forbidden = [
      'chrome.identity',
      'getAuthToken',
      'localStorage.setItem',
      'localStorage.getItem',
      'import.meta.env.VITE_',
      'process.env.VITE_',
      'fetch("https://api.github.com',
      "fetch('https://api.github.com",
    ];

    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8')).toLowerCase();
      for (const term of forbidden) {
        expect(code.includes(term.toLowerCase()), `${file} → ${term}`).toBe(false);
      }
      // A credential-bearing request cannot be constructed here either.
      expect(/authorization["']?\s*[:,]\s*["']?(?:bearer|token)/i.test(code), file).toBe(false);
    }
  });

  it('carries no real-looking credentials in the GitHub integration', () => {
    for (const file of sourceFiles('src/integrations')) {
      const content = readFileSync(file, 'utf8');
      expect(containsCredentialMaterial(content), file).toBe(false);
    }
  });
});
