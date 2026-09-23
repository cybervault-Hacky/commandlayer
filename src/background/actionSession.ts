/**
 * Phase 4 — background action session: execution environment + the
 * approve/execute and cancel entry points used by the message handlers.
 *
 * Everything privileged (tabs API, content-script channel, page capture)
 * lives here, in the background. The UI only ever sees plans, previews,
 * and typed results — and must send an explicit ACTION_EXECUTE to run
 * anything.
 */
import { buildGitHubUrl, type GitHubNavTarget } from '@/github/patterns';
import { getPageContext } from './pageContext';
import { pageContentDigest } from '@/page-intelligence/hash';
import { executePlan, type ExecutorEnvironment } from '@/actions/executor';
import { permissionLedger } from '@/actions/permissions';
import { actionSessionStore } from '@/actions/session';
import { ActionEvent } from '@/actions/machine';
import { ACTION_LIMITS } from '@/actions/limits';
import { ActionErrorCode, ActionKind, type ReadPageData } from '@/actions/types';
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
    async captureContentHash(plan) {
      // The developer capture profile (metadata + headings + text + links +
      // the typed GitHub context) is the one a GitHub navigation plan was
      // bound against, so freshness is checked against exactly that.
      const needsGitHub = plan.actions.some(
        (step) => step.action.type === ActionKind.NavigateGitHub,
      );
      const fresh = await getPageContext({
        sections: needsGitHub
          ? ['metadata', 'headings', 'text', 'links', 'github']
          : ['metadata', 'headings', 'text'],
      });
      if (fresh.state !== 'ready' && fresh.state !== 'partial') return '';
      return pageContentDigest(fresh);
    },
    /**
     * Phase 7 — GitHub navigation. The URL is rebuilt here from the typed
     * target (never taken from a carried string), and only github.com is ever
     * loaded. Navigation is bounded: we wait briefly for the tab to settle and
     * report the URL that is actually loaded.
     */
    async navigateTo(
      tabId: number,
      target: GitHubNavTarget,
    ): Promise<{ url: string } | null> {
      if (typeof chrome === 'undefined' || !chrome.tabs?.update) return null;
      const url = buildGitHubUrl(target);
      if (url === null) return null;
      try {
        await chrome.tabs.update(tabId, { url });
      } catch {
        return null;
      }
      await waitForTabSettled(tabId);
      return { url };
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

/** Bounded wait (≤2.5s) for a navigated tab to finish loading. */
async function waitForTabSettled(tabId: number): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.get) return;
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.status === 'complete') return;
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
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
