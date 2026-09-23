/**
 * Phase 5 — session-scoped workflow store.
 *
 * Workflows exist ONLY here, in worker memory, for a bounded lifetime:
 * created by the planner, previewed to the user, approved explicitly,
 * executed one step at a time, and then disposed. Nothing is written to
 * storage, no history is kept, and expired records are swept away.
 *
 * The store is the authority for:
 * - the state machine (invalid transitions are rejected, not applied)
 * - the approval binding (approve a hash once, for one workflow)
 * - one running workflow per tab (typed conflict instead of interference)
 * - the bounded event transcript used by the progress UI
 */
import { WORKFLOW_LIMITS } from './limits';
import {
  isTerminalWorkflowStatus,
  transition,
  WorkflowEvent,
} from './machine';
import {
  WorkflowEventType,
  WorkflowStatus,
  type Workflow,
  type WorkflowEventRecord,
  type WorkflowStepView,
  type WorkflowView,
} from './types';

export interface WorkflowRecord {
  workflow: Workflow;
  events: WorkflowEventRecord[];
  /** Exactly the hash the user approved (cleared when it is consumed). */
  approvedHash?: string;
  approvedAtMs?: number;
  /** Tab currently claimed by a running workflow. */
  runningTabId?: number;
  /** Bounded replans already produced by this workflow. */
  replansUsed: number;
}

const RUNNING_STATES: ReadonlySet<WorkflowStatus> = new Set([
  WorkflowStatus.Approved,
  WorkflowStatus.Running,
  WorkflowStatus.Verifying,
  WorkflowStatus.Paused,
]);

export class WorkflowStore {
  private readonly records = new Map<string, WorkflowRecord>();
  private now: () => number = Date.now;

  /** Hard bound on stored records (terminal history included). */
  private static readonly MAX_RECORDS = 25;

  /** Test seam: deterministic clocks. */
  setClock(clock: () => number): void {
    this.now = clock;
  }

  create(
    workflow: Workflow,
    options: { validated?: boolean } = {},
  ): WorkflowRecord {
    this.sweep();
    if (this.pendingCount() >= WORKFLOW_LIMITS.MAX_PENDING_WORKFLOWS) {
      // Evict the oldest pending (non-running) workflow: the store must
      // stay bounded. Running workflows are never evicted.
      for (const [id, record] of this.records) {
        if (!RUNNING_STATES.has(record.workflow.status)) {
          this.records.delete(id);
          break;
        }
      }
    }

    if (this.records.size >= WorkflowStore.MAX_RECORDS) {
      // Drop the oldest TERMINAL record first; running workflows are kept.
      for (const [id, existing] of this.records) {
        if (isTerminalWorkflowStatus(existing.workflow.status)) {
          this.records.delete(id);
          break;
        }
      }
    }

    const record: WorkflowRecord = {
      workflow: { ...workflow },
      events: [],
      replansUsed: 0,
    };
    this.records.set(workflow.workflowId, record);
    this.appendEvent(workflow.workflowId, {
      type: WorkflowEventType.Created,
      at: workflow.createdAt,
      message: 'Workflow prepared.',
    });
    if (options.validated !== false) {
      this.apply(workflow.workflowId, WorkflowEvent.Validate);
      this.appendEvent(workflow.workflowId, {
        type: WorkflowEventType.Validated,
        at: this.nowIso(),
        message: 'Workflow validated against the action allowlist.',
      });
      this.apply(workflow.workflowId, WorkflowEvent.Present);
      this.appendEvent(workflow.workflowId, {
        type: WorkflowEventType.Previewed,
        at: this.nowIso(),
        message: 'Preview ready — waiting for your approval.',
      });
    }
    return record;
  }

  get(workflowId: string): WorkflowRecord | undefined {
    const record = this.records.get(workflowId);
    if (!record) return undefined;
    if (this.isExpired(record)) {
      this.expire(record);
      return record;
    }
    return record;
  }

  has(workflowId: string): boolean {
    return this.records.has(workflowId);
  }

  /** Apply a state-machine event; returns false on invalid transitions. */
  apply(workflowId: string, event: WorkflowEvent): boolean {
    const record = this.records.get(workflowId);
    if (!record) return false;
    const next = transition(record.workflow.status, event);
    if (next === null) return false;
    record.workflow.status = next;
    if (isTerminalWorkflowStatus(next)) {
      record.workflow.finishedAt = this.nowIso();
    }
    return true;
  }

  /** Append a bounded transcript entry (oldest entries are dropped). */
  appendEvent(
    workflowId: string,
    event: WorkflowEventRecord,
  ): WorkflowEventRecord | undefined {
    const record = this.records.get(workflowId);
    if (!record) return undefined;
    record.events.push(event);
    if (record.events.length > WORKFLOW_LIMITS.MAX_EVENTS) {
      record.events.splice(0, record.events.length - WORKFLOW_LIMITS.MAX_EVENTS);
    }
    return event;
  }

  events(workflowId: string): readonly WorkflowEventRecord[] {
    return this.records.get(workflowId)?.events ?? [];
  }

  /** Record the user's explicit approval of one exact workflow hash. */
  approve(workflowId: string, workflowHash: string): boolean {
    const record = this.records.get(workflowId);
    if (!record) return false;
    if (record.approvedHash !== undefined) return false; // single-use
    record.approvedHash = workflowHash;
    record.approvedAtMs = this.now();
    record.workflow.approvedAt = this.nowIso();
    return true;
  }

  approvalFor(workflowId: string): { hash: string; at: number } | undefined {
    const record = this.records.get(workflowId);
    if (!record?.approvedHash || record.approvedAtMs === undefined) {
      return undefined;
    }
    return { hash: record.approvedHash, at: record.approvedAtMs };
  }

  /** Claim the tab for a running workflow, or report the conflict. */
  claimTab(
    workflowId: string,
    tabId: number,
  ): { ok: true } | { ok: false; conflictWorkflowId: string } {
    for (const [id, record] of this.records) {
      if (id === workflowId) continue;
      if (record.runningTabId === tabId && RUNNING_STATES.has(record.workflow.status)) {
        return { ok: false, conflictWorkflowId: id };
      }
    }
    const record = this.records.get(workflowId);
    if (!record) return { ok: false, conflictWorkflowId: '' };
    record.runningTabId = tabId;
    return { ok: true };
  }

  releaseTab(workflowId: string): void {
    const record = this.records.get(workflowId);
    if (record) delete record.runningTabId;
  }

  /** The workflow currently running (or paused) on a tab, if any. */
  runningWorkflowForTab(tabId: number): WorkflowRecord | undefined {
    for (const record of this.records.values()) {
      if (record.runningTabId === tabId && RUNNING_STATES.has(record.workflow.status)) {
        return record;
      }
    }
    return undefined;
  }

  dispose(workflowId: string): void {
    const record = this.records.get(workflowId);
    if (record) delete record.runningTabId;
    this.records.delete(workflowId);
  }

  size(): number {
    return this.records.size;
  }

  pendingCount(): number {
    let count = 0;
    for (const record of this.records.values()) {
      if (!isTerminalWorkflowStatus(record.workflow.status)) count += 1;
    }
    return count;
  }

  clear(): void {
    this.records.clear();
  }

  /** Worker-memory hygiene: expiry applies to every workflow status. */
  sweep(): void {
    for (const record of this.records.values()) {
      if (this.isExpired(record)) this.expire(record);
    }
  }

  private expire(record: WorkflowRecord): void {
    if (isTerminalWorkflowStatus(record.workflow.status)) return;
    this.apply(record.workflow.workflowId, WorkflowEvent.Expire);
    this.appendEvent(record.workflow.workflowId, {
      type: 'WORKFLOW_FAILED',
      at: this.nowIso(),
      message: 'Workflow expired.',
    });
  }

  private isExpired(record: WorkflowRecord): boolean {
    const expiry = Date.parse(record.workflow.expiresAt);
    return Number.isFinite(expiry) && this.now() > expiry;
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }
}

/** Worker-scoped singleton: worker lifetime == session lifetime. */
export const workflowSessionStore = new WorkflowStore();

/* ------------------------------- views ------------------------------ */

function stepView(
  record: WorkflowRecord,
  index: number,
): WorkflowStepView {
  const step = record.workflow.steps[index];
  if (!step) {
    return {
      stepId: `missing-${index}`,
      index,
      intent: 'READ',
      label: '',
      status: 'PENDING',
      attempts: 0,
    };
  }
  const action = step.actionPlan.actions[0]?.action;
  return {
    stepId: step.stepId,
    index: step.index,
    intent: step.intent,
    ...(action ? { kind: action.type } : {}),
    label: step.label,
    status: step.status,
    attempts: step.attempts,
    risk: step.actionPlan.risk,
    retryPolicy: step.retryPolicy,
    previews: step.actionPlan.actions.map((planned) => planned.preview),
    ...(step.result?.message ?? step.message
      ? { message: step.result?.message ?? step.message }
      : {}),
    ...(step.detail ? { detail: step.detail } : {}),
    ...(step.result?.data ? { data: step.result.data } : {}),
    ...(step.result?.verification
      ? { verified: step.result.verification.ok }
      : {}),
    ...(step.startedAt ? { startedAt: step.startedAt } : {}),
    ...(step.finishedAt ? { finishedAt: step.finishedAt } : {}),
    ...(step.observedUrl ? { observedUrl: step.observedUrl } : {}),
  };
}

/** Serialize a workflow for the UI (identity, progress, bounded results). */
export function toWorkflowView(record: WorkflowRecord): WorkflowView {
  const { workflow } = record;
  const completed = workflow.steps.filter(
    (step) => step.status === 'COMPLETED',
  ).length;
  const status = workflow.status;
  const running =
    status === WorkflowStatus.Running || status === WorkflowStatus.Verifying;

  return {
    workflowId: workflow.workflowId,
    workflowHash: workflow.workflowHash,
    goal: workflow.goal,
    status,
    risk: workflow.risk,
    requiresConfirmation: workflow.requiresConfirmation,
    steps: workflow.steps.map((_step, index) => stepView(record, index)),
    currentStepIndex: workflow.currentStepIndex,
    maxSteps: workflow.maxSteps,
    expectedOutcome: workflow.expectedOutcome.description,
    outcomeKind: workflow.expectedOutcome.kind,
    progress: { completed, total: workflow.steps.length },
    createdAt: workflow.createdAt,
    expiresAt: workflow.expiresAt,
    revision: workflow.revision,
    approved: record.approvedHash !== undefined,
    canApprove: status === WorkflowStatus.AwaitingApproval,
    canPause: running,
    canResume: status === WorkflowStatus.Paused,
    // Cancelling is always available for a non-terminal workflow: it
    // prevents every future step, even while a step is finishing.
    canCancel: !isTerminalWorkflowStatus(status),
    ...(workflow.outcome ? { outcome: workflow.outcome } : {}),
    ...(workflow.summary ? { summary: workflow.summary } : {}),
    ...(workflow.followUpWorkflowId
      ? { followUpWorkflowId: workflow.followUpWorkflowId }
      : {}),
    events: [...record.events],
  };
}
