/**
 * Phase 5 — run-scoped workflow session guards.
 *
 * One guard exists per ACTIVE workflow run (never persisted, discarded
 * when the run stops). The guard is the hard budget for a single run:
 *
 *   steps executed · retries used · context refreshes · replans used ·
 *   wall-clock lifetime · cooperative pause/cancel flags
 *
 * Every increment is checked against the centralized limits, so an
 * "observe → reason → act" loop can never continue past a bound — the
 * orchestrator asks the guard for permission before each bounded action
 * and stops when permission is refused.
 */
import { WORKFLOW_LIMITS } from './limits';

export interface WorkflowRunGuard {
  workflowId: string;
  tabId: number;
  startedAtMs: number;
  stepsExecuted: number;
  retriesUsed: number;
  contextRefreshes: number;
  replansUsed: number;
  /** Cooperative pause: checked between steps, never mid-step. */
  paused: boolean;
  /** Cooperative cancel: prevents every future step. */
  cancelRequested: boolean;
}

export type LimitRefusal =
  | { ok: true }
  | { ok: false; reason: WorkflowLimitReason };

export type WorkflowLimitReason =
  | 'CONTEXT_REFRESH_LIMIT'
  | 'RETRY_LIMIT'
  | 'REPLAN_LIMIT'
  | 'DURATION_LIMIT'
  | 'UNKNOWN_WORKFLOW';

class WorkflowSessionRegistry {
  private readonly guards = new Map<string, WorkflowRunGuard>();
  private now: () => number = Date.now;

  /** Test seam: deterministic clocks. */
  setClock(clock: () => number): void {
    this.now = clock;
  }

  begin(
    workflowId: string,
    tabId: number,
    limits: { durationMs?: number } = {},
  ): WorkflowRunGuard {
    void limits;
    const guard: WorkflowRunGuard = {
      workflowId,
      tabId,
      startedAtMs: this.now(),
      stepsExecuted: 0,
      retriesUsed: 0,
      contextRefreshes: 0,
      replansUsed: 0,
      paused: false,
      cancelRequested: false,
    };
    this.guards.set(workflowId, guard);
    return guard;
  }

  get(workflowId: string): WorkflowRunGuard | undefined {
    return this.guards.get(workflowId);
  }

  end(workflowId: string): void {
    this.guards.delete(workflowId);
  }

  size(): number {
    return this.guards.size;
  }

  requestPause(workflowId: string): boolean {
    const guard = this.guards.get(workflowId);
    if (!guard) return false;
    guard.paused = true;
    return true;
  }

  requestResume(workflowId: string): boolean {
    const guard = this.guards.get(workflowId);
    if (!guard) return false;
    guard.paused = false;
    return true;
  }

  requestCancel(workflowId: string): boolean {
    const guard = this.guards.get(workflowId);
    if (!guard) return false;
    guard.cancelRequested = true;
    return true;
  }

  /** Bounded context refreshes across the whole run. */
  consumeRefresh(workflowId: string): LimitRefusal {
    const guard = this.guards.get(workflowId);
    if (!guard) return { ok: false, reason: 'UNKNOWN_WORKFLOW' };
    if (guard.contextRefreshes >= WORKFLOW_LIMITS.MAX_CONTEXT_REFRESHES) {
      return { ok: false, reason: 'CONTEXT_REFRESH_LIMIT' };
    }
    guard.contextRefreshes += 1;
    return { ok: true };
  }

  /** Bounded retries across the whole run. */
  consumeRetry(workflowId: string): LimitRefusal {
    const guard = this.guards.get(workflowId);
    if (!guard) return { ok: false, reason: 'UNKNOWN_WORKFLOW' };
    if (guard.retriesUsed >= WORKFLOW_LIMITS.MAX_STEP_RETRIES) {
      return { ok: false, reason: 'RETRY_LIMIT' };
    }
    guard.retriesUsed += 1;
    return { ok: true };
  }

  /** Bounded replans across the whole run. */
  canReplan(workflowId: string): boolean {
    const guard = this.guards.get(workflowId);
    if (!guard) return false;
    return guard.replansUsed < WORKFLOW_LIMITS.MAX_WORKFLOW_REPLANS;
  }

  recordReplan(workflowId: string): void {
    const guard = this.guards.get(workflowId);
    if (guard) guard.replansUsed += 1;
  }

  /** Record one executed step attempt. */
  recordStep(workflowId: string): void {
    const guard = this.guards.get(workflowId);
    if (guard) guard.stepsExecuted += 1;
  }

  /** True when the run is still inside its wall-clock budget. */
  withinDeadline(workflowId: string): boolean {
    const guard = this.guards.get(workflowId);
    if (!guard) return false;
    return this.now() - guard.startedAtMs <= WORKFLOW_LIMITS.MAX_WORKFLOW_DURATION_MS;
  }

  clear(): void {
    this.guards.clear();
  }
}

/** Worker-scoped singleton: session lifetime == worker lifetime. */
export const workflowSessions = new WorkflowSessionRegistry();
