/**
 * Phase 4 — pending plan session store (background service worker).
 *
 * Plans exist ONLY here, in worker memory, for a bounded lifetime:
 * - created by the planner when a command maps to an action request
 * - previewed to the user (never executed on creation)
 * - approved explicitly via ACTION_EXECUTE with a matching plan hash
 * - consumed on first execution; never persisted anywhere
 *
 * The UI never receives authority to execute: it only gets the plan to
 * render the preview, and execution is keyed by planId + planHash
 * against this store.
 */
import { ACTION_LIMITS } from './limits';
import { ActionEvent, transition } from './machine';
import {
  ActionSessionState,
  type ActionPlan,
} from './types';

export interface PlanRecord {
  plan: ActionPlan;
  state: ActionSessionState;
}

class ActionSessionStore {
  private readonly plans = new Map<string, PlanRecord>();
  private now: () => number = Date.now;

  setClock(clock: () => number): void {
    this.now = clock;
  }

  /** Store a freshly planned plan in PREVIEW (awaiting the user). */
  addPlan(plan: ActionPlan): void {
    this.sweep();
    if (this.plans.size >= ACTION_LIMITS.MAX_PENDING_PLANS) {
      // Evict the oldest plan; the store must stay bounded.
      const oldest = this.plans.keys().next().value;
      if (oldest !== undefined) this.plans.delete(oldest);
    }
    this.plans.set(plan.planId, {
      plan,
      state: ActionSessionState.Preview,
    });
    // PREVIEW implies the permission request is pending.
    this.apply(plan.planId, ActionEvent.RequestPermission);
  }

  get(planId: string): PlanRecord | undefined {
    const record = this.plans.get(planId);
    if (!record) return undefined;
    if (this.isExpired(record.plan)) {
      this.plans.delete(planId);
      return undefined;
    }
    return record;
  }

  /** Apply a state-machine event; returns false on invalid transition. */
  apply(planId: string, event: ActionEvent): boolean {
    const record = this.plans.get(planId);
    if (!record) return false;
    const next = transition(record.state, event);
    if (next === null) return false;
    record.state = next;
    return true;
  }

  state(planId: string): ActionSessionState | undefined {
    return this.plans.get(planId)?.state;
  }

  /** Remove the plan (after a terminal state or cancellation). */
  dispose(planId: string): void {
    this.plans.delete(planId);
  }

  clear(): void {
    this.plans.clear();
  }

  size(): number {
    return this.plans.size;
  }

  private isExpired(plan: ActionPlan): boolean {
    const expiry = Date.parse(plan.expiresAt);
    return Number.isFinite(expiry) && this.now() > expiry;
  }

  private sweep(): void {
    for (const [id, record] of this.plans) {
      if (this.isExpired(record.plan)) this.plans.delete(id);
    }
  }
}

/** Worker-scoped singleton: worker lifetime == session lifetime. */
export const actionSessionStore = new ActionSessionStore();
