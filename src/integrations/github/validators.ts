/**
 * Phase 7 — GitHub integration validation.
 *
 * Two jobs:
 *  1. structurally validate what crosses the integration boundary (closed
 *     key sets, bounded strings, known enums);
 *  2. enforce the credential rule mechanically — a value that looks like a
 *     GitHub token (or any credential) is rejected wherever it appears, so
 *     no future change can quietly start carrying one.
 *
 * The token check is a guard, not a promise: CommandLayer has no code path
 * that acquires, stores, or transmits a GitHub token, and `validators.ts`
 * exists so a test can prove a token-shaped value never passes through.
 */
import {
  GitHubIntegrationErrorCode,
  gitHubIntegrationError,
  type GitHubIntegrationError,
} from './errors';
import type { GitHubApiRequest, GitHubIntegrationStatus } from './types';
import { GitHubIntegrationMode } from './types';

const MAX_PATH_LENGTH = 300;
const MAX_QUERY_VALUE_LENGTH = 200;

/**
 * Known credential shapes: GitHub classic/ fine-grained tokens, bearer
 * headers, and generic `token=...`/`ghp_...` material.
 */
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*/i,
  /\b(?:access_token|refresh_token|client_secret|private_key|api_key|password)\b\s*[:=]\s*\S{8,}/i,
];

/** True when a string carries credential-shaped material. */
export function containsCredentialMaterial(value: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value));
}

/** Failed validation returns a safe, typed error — never the offending value. */
export type ValidationOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: GitHubIntegrationError };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate an integration status payload (used when it crosses a boundary). */
export function parseIntegrationStatus(
  value: unknown,
): ValidationOutcome<GitHubIntegrationStatus> {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: gitHubIntegrationError(GitHubIntegrationErrorCode.GITHUB_INVALID_PAYLOAD),
    };
  }
  const { mode, pageContextAvailable, authenticatedAvailable, detail } = value;
  if (
    mode !== GitHubIntegrationMode.PageContext &&
    mode !== GitHubIntegrationMode.Authenticated
  ) {
    return {
      ok: false,
      error: gitHubIntegrationError(GitHubIntegrationErrorCode.GITHUB_INVALID_PAYLOAD),
    };
  }
  if (typeof pageContextAvailable !== 'boolean') {
    return {
      ok: false,
      error: gitHubIntegrationError(GitHubIntegrationErrorCode.GITHUB_INVALID_PAYLOAD),
    };
  }
  // The authenticated mode can never be reported as available in this version.
  if (authenticatedAvailable !== false) {
    return {
      ok: false,
      error: gitHubIntegrationError(GitHubIntegrationErrorCode.GITHUB_AUTH_DISABLED),
    };
  }
  if (typeof detail !== 'string' || detail.length === 0 || detail.length > 400) {
    return {
      ok: false,
      error: gitHubIntegrationError(GitHubIntegrationErrorCode.GITHUB_INVALID_PAYLOAD),
    };
  }
  if (containsCredentialMaterial(detail)) {
    return {
      ok: false,
      error: gitHubIntegrationError(GitHubIntegrationErrorCode.GITHUB_INVALID_PAYLOAD),
    };
  }
  return {
    ok: true,
    value: {
      mode,
      pageContextAvailable,
      authenticatedAvailable: false,
      detail,
    },
  };
}

/**
 * Validate an API request shape. Nothing constructs one today; this exists so
 * that if authenticated mode is ever implemented, the request boundary is
 * already closed and credential-free.
 */
export function parseApiRequest(value: unknown): ValidationOutcome<GitHubApiRequest> {
  const invalid = {
    ok: false as const,
    error: gitHubIntegrationError(GitHubIntegrationErrorCode.GITHUB_INVALID_PAYLOAD),
  };
  if (!isRecord(value)) return invalid;

  const { method, path, query } = value;
  if (
    method !== 'GET' &&
    method !== 'POST' &&
    method !== 'PATCH' &&
    method !== 'PUT' &&
    method !== 'DELETE'
  ) {
    return invalid;
  }
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH_LENGTH) {
    return invalid;
  }
  if (!path.startsWith('/') || path.includes('..') || path.includes('://')) {
    return invalid;
  }
  if (path.includes('?') || path.includes('#')) return invalid;
  if (containsCredentialMaterial(path)) return invalid;

  let parsedQuery: Record<string, string> | undefined;
  if (query !== undefined) {
    if (!isRecord(query)) return invalid;
    parsedQuery = {};
    for (const [key, entry] of Object.entries(query)) {
      if (typeof entry !== 'string') return invalid;
      if (entry.length > MAX_QUERY_VALUE_LENGTH) return invalid;
      if (containsCredentialMaterial(key) || containsCredentialMaterial(entry)) {
        return invalid;
      }
      parsedQuery[key] = entry;
    }
  }

  return {
    ok: true,
    value: { method, path, ...(parsedQuery ? { query: parsedQuery } : {}) },
  };
}
