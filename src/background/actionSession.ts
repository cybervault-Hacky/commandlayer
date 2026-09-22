/**
 * Phase 4 — background action session: execution environment + the
 * approve/execute and cancel entry points used by the message handlers.
 *
 * Everything privileged (tabs API, content-script channel, page capture)
 * lives here, in the background. The UI only ever sees plans, previews,
 * and typed results — and must send an explicit ACTION_EXECUTE to run
 * anything.
 */
import { getPageContext } from './pageContext';
import { pageContentDigest } from '@/page-intelligence/hash';
import { executePlan, type ExecutorEnvironment } from '@/actions/executor';
import { permissionLedger } from '@/actions/permissions';
import { actionSessionStore } from '@/actions/session';
import { ActionEvent } from '@/actions/machine';
import { ACTION_LIMITS } from '@/actions/limits';
import { ActionErrorCode, type ReadPageData } from '@/actions/types';
import type { CommandResult, CommandSource } from '@/shared/types/command';

/** Build the privileged executor environment (injectable for tests). */
export function createExecutorEnvironment(): ExecutorEnvironment {
  return {
    async getActiveTab() {
      if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null;
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab || typeof tab.id !== 'number') return null;
        return { id: tab.id, url: tab.url };
      } catch {
        return null;
      }
    },
    async sendStep(tabId, message) {
      if (typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) {
        throw new Error('no content channel');
      }
      return chrome.tabs.sendMessage(tabId, message);
    },
    async captureContentHash() {
      const fresh = await getPageContext({
        sections: ['metadata', 'headings', 'text'],
      });
      if (fresh.state !== 'ready' && fresh.state !== 'partial') return '';
      return pageContentDigest(fresh);
    },
    async readPage(): Promise<ReadPageData | null> {
      const context = await getPageContext();
      if (context.state !== 'ready' && context.state !== 'partial') {
        return null;
      }
      const stats = `${context.contentStats.headingCount} headings · ${context.contentStats.paragraphCount} paragraphs · ${context.contentStats.linkCount} links`;
      return {
        kind: 'READ_PAGE',
        title: context.title ?? context.url ?? 'page',
        url: context.url ?? '',
        stats,
        topHeadings: context.headings
          .slice(0, ACTION_LIMITS.READ_PAGE_MAX_HEADINGS)
          .map((h) => h.text),
      };
    },
  };
}

/**
 * Approve and execute one stored plan. The caller supplies ONLY the
 * plan identity (planId + planHash); the plan body, its approval, and
 * all safety checks live on this side.
 */
export async function executeApprovedPlan(input: {
  planId: string;
  planHash: string;
  source: CommandSource;
  env?: ExecutorEnvironment;
}): Promise<CommandResult> {
  const startedAt = new Date().toISOString();
  const record = actionSessionStore.get(input.planId);

  // The ACTION_EXECUTE message IS the explicit approval event: record it
  // against the claimed hash, then let the executor consume it only if
  // the executed plan's hash matches exactly. A forged or stale request
  // fails the hash binding and never runs.
  permissionLedger.approve(input.planId, input.planHash);

  const env = input.env ?? createExecutorEnvironment();
  const outcome = await executePlan(input.planId, input.planHash, env);

  const finishedAt = new Date().toISOString();
  if (!outcome.ok) {
    return {
      id: input.planId,
      status: 'failed',
      text: outcome.error.message,
      source: input.source,
      errorCode: outcome.error.code,
      startedAt,
      finishedAt,
    };
  }

  const result = outcome.result;
  const planRequestId = record?.plan.requestId ?? input.planId;
  return {
    id: planRequestId,
    status: result.status === 'completed' ? 'completed' : 'failed',
    text: result.summary,
    source: input.source,
    execution: result,
    ...(result.status === 'completed'
      ? {}
      : { errorCode: executionErrorCode(result.status) }),
    startedAt,
    finishedAt,
  };
}

/** Cancel a pending plan: revokes approval and disposes the plan. */
export function cancelPlan(planId: string): void {
  permissionLedger.revoke(planId);
  actionSessionStore.apply(planId, ActionEvent.Cancel);
  actionSessionStore.dispose(planId);
}

function executionErrorCode(status: string): string {
  switch (status) {
    case 'blocked':
      return ActionErrorCode.ACTION_NOT_ALLOWED;
    case 'stale':
      return ActionErrorCode.ACTION_CONTEXT_STALE;
    case 'cancelled':
      return ActionErrorCode.ACTION_CANCELLED;
    default:
      return ActionErrorCode.ACTION_EXECUTION_FAILED;
  }
}

/** Test/diagnostic helper — never logs sensitive content. */
export function pendingPlanCount(): number {
  return actionSessionStore.size();
}
