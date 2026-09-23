/**
 * Phase 7 — developer domain barrel.
 *
 * Everything a caller needs: the typed model, URL-first detection, the
 * content-side parser, the trust-boundary validator, the navigation-target
 * patterns, and the hard capture limits.
 */
export * from './types';
export * from './limits';
export * from './patterns';
export { detectGitHub } from './detect';
export type { GitHubDetection } from './detect';
export { parseGitHubContext } from './parse';
export { parseGitHubPageContext } from './validator';
