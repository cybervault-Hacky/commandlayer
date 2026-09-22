/**
 * Phase 4 — permission layer.
 *
 * Approvals are:
 * - EXPLICIT: only the ACTION_EXECUTE message (driven by the Allow/Run
 *   button) grants permission. Free text like "yes"/"do it" never does.
 * - SINGLE-USE: one approval authorizes exactly one execution of exactly
 *   one plan, then it is consumed.
 * - TIME-BOXED: approvals expire (PLAN_TTL_MS).
 * - IN-MEMORY: nothing is persisted; closing the worker clears all.
 *
 * There is deliberately no ALLOW_ALL_ACTIONS permission and no way to
 * disable confirmations.
 */
import { createRequestId } from '@/shared/messaging/envelope';
import { ACTION_LIMITS } from './limits';
import { actionError } from './errors';
import { ActionErrorCode, type ActionError } from './types';

interface Approval {
  planId: string;
  planHash: string;
  approvalId: string;
  approvedAt: number;
  consumed: boolean;
}

class PermissionLedger {
  private readonly approvals = new Map<string, Approval>();
  private now: () => number = Date.now;

  /** Test seam: deterministic clocks. */
  setClock(clock: () => number): void {
    this.now = clock;
  }

  /** Record the user's explicit approval of a specific plan hash. */
  approve(planId: string, planHash: string): string {
    this.sweep();
    const approvalId = createRequestId('appr');
    this.approvals.set(planId, {
      planId,
      planHash,
      approvalId,
      approvedAt: this.now(),
      consumed: false,
    });
    return approvalId;
  }

  /**
   * Consume the approval for `planId` — but only when the executed plan
   * hash is EXACTLY the approved one and the approval is fresh. Single
   * use: a consumed approval can never authorize another run.
   */
  consume(
    planId: string,
    planHash: string,
  ): { ok: true; approvalId: string } | { ok: false; error: ActionError } {
    const approval = this.approvals.get(planId);
    if (!approval) {
      this.sweep();
      return { ok: false, error: actionError(ActionErrorCode.ACTION_PERMISSION_REQUIRED) };
    }
    // Expiry is checked BEFORE the hash so a time-boxed approval can
    // never be resurrected or confused with a plan change.
    if (this.now() - approval.approvedAt > ACTION_LIMITS.PLAN_TTL_MS) {
      this.approvals.delete(planId);
      return { ok: false, error: actionError(ActionErrorCode.ACTION_PERMISSION_EXPIRED) };
    }
    if (approval.consumed) {
      return { ok: false, error: actionError(ActionErrorCode.ACTION_PERMISSION_DENIED) };
    }
    if (approval.planHash !== planHash) {
      return { ok: false, error: actionError(ActionErrorCode.ACTION_PLAN_CHANGED) };
    }
    approval.consumed = true;
    return { ok: true, approvalId: approval.approvalId };
  }

  /** Withdraw approval (Cancel button / plan disposal). */
  revoke(planId: string): void {
    this.approvals.delete(planId);
  }

  has(planId: string): boolean {
    const approval = this.approvals.get(planId);
    if (!approval || approval.consumed) return false;
    return this.now() - approval.approvedAt <= ACTION_LIMITS.PLAN_TTL_MS;
  }

  clear(): void {
    this.approvals.clear();
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, approval] of this.approvals) {
      if (now - approval.approvedAt > ACTION_LIMITS.PLAN_TTL_MS) {
        this.approvals.delete(id);
      }
    }
  }
}

/** Process-wide ledger (background service worker lifetime = session). */
export const permissionLedger = new PermissionLedger();
