/**
 * Phase 6 — the memory controller: consent, previews, and commit.
 *
 *   memory command → parse → policy → preview → USER CONFIRMS → commit
 *
 * Every persistent change follows that path. The controller never writes
 * from a command, from retrieval, or from AI output: a write happens only
 * when the user presses "Remember"/"Update"/"Forget" on a preview that
 * this module created.
 *
 * Previews are held in worker memory only (never persisted), are
 * single-use, expire after MEMORY_LIMITS.PREVIEW_TTL_MS, and are bounded
 * in number. Confirming re-runs the policy and the limits at commit time,
 * so a preview can never smuggle a stale or tampered record into storage.
 */
import { getSettings } from '@/storage/settings';
import { MEMORY_LIMITS } from './limits';
import {
  MemoryIntent,
  MemoryPreviewAction,
  MemoryResultAction,
  MemoryScope,
  MEMORY_AUDIT_TEXT,
  type MemoryInput,
  type MemoryKind,
  type MemoryPreviewAction as PreviewAction,
  type MemoryPreviewView,
  type MemoryRecord,
  type MemoryRecordView,
  type MemoryResultView,
  type MemoryRetrieval,
  type MemoryScope as MemoryScopeType,
  type MemoryStatusView,
  type ParsedMemoryCommand,
} from './types';
import { kindFilterFromQuery } from './parser';
import { memoryRepository, type MemoryFailureCode, type MemoryRepository } from './repository';
import { cleanMemoryText } from './sanitizer';

/** Worker-side: is the memory privacy switch on? */
export type MemoryEnabledCheck = () => Promise<boolean>;

export type MemoryCommandOutcome =
  | { kind: 'preview'; preview: MemoryPreviewView }
  | { kind: 'result'; result: MemoryResultView }
  | { kind: 'refusal'; code: MemoryFailureCode | 'MEMORY_DISABLED'; message: string };

interface PendingPreview {
  preview: MemoryPreviewView;
  input: MemoryInput;
  action: PreviewAction;
  targetId: string | null;
  expiresAtMs: number;
}

/** Deterministic category inference (closed rules, no model). */
export function inferMemoryKind(
  content: string,
  scope: MemoryScopeType,
): MemoryKind {
  const text = content.toLowerCase();
  if (scope === MemoryScope.Project) return 'PROJECT_CONTEXT';
  if (
    /^(?:always|never)\b/.test(text) ||
    /\b(?:from now on|do not|don't)\b/.test(text) ||
    /\b(?:ask me first|confirm before|without asking)\b/.test(text) ||
    /\b(?:always|never)\s+(?:show|ask|use|do|include|avoid|prefer|be|keep)\b/.test(text)
  ) {
    return 'EXPLICIT_INSTRUCTION';
  }
  if (/\b(?:i|user)\s+(?:prefer|like|love|want|hate|dislike|rather)\b/.test(text) || /\bmy\s+preferred\b/.test(text)) {
    return 'PREFERENCE';
  }
  if (
    /\bprojects?\b/.test(text) ||
    /\b(?:my|our|the|we)\s+(?:team|stack|codebase)\b/.test(text)
  ) {
    return 'PROJECT_CONTEXT';
  }
  if (
    /\b(?:i|we|user)\s+(?:work|write|code|develop|build|ship|review)\b/.test(text) ||
    /\b(?:work\s?style|code\s?style|conventions?|style guide|tabs|indentation|linting|editor|language)\b/.test(text) ||
    /\b(?:frontend|backend|full[\s-]?stack)\s+(?:work|projects?|apps?|code)\b/.test(text)
  ) {
    return 'WORK_STYLE';
  }
  return 'USER_FACT';
}

export function toRecordView(record: MemoryRecord): MemoryRecordView {
  return {
    id: record.id,
    kind: record.kind,
    content: record.content,
    scope: record.scope,
    project: record.project,
    createdAt: new Date(record.createdAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
    enabled: record.enabled,
    audit: MEMORY_AUDIT_TEXT,
  };
}

function result(
  action: MemoryResultView['action'],
  message: string,
  records: readonly MemoryRecord[] = [],
  total?: number,
): MemoryResultView {
  return {
    action,
    message,
    records: records.map(toRecordView),
    total: total ?? records.length,
  };
}

function previewView(
  action: PreviewAction,
  previewId: string,
  input: MemoryInput,
  nowMs: number,
  target: MemoryRecord | null,
): MemoryPreviewView {
  return {
    previewId,
    action,
    kind: action === MemoryPreviewAction.Delete ? (target?.kind ?? null) : input.kind,
    content: action === MemoryPreviewAction.Delete ? (target?.content ?? input.content) : input.content,
    previousContent:
      action === MemoryPreviewAction.Update ? (target?.content ?? null) : null,
    scope:
      action === MemoryPreviewAction.Delete
        ? (target?.scope ?? MemoryScope.Global)
        : (input.scope ?? MemoryScope.Global),
    project:
      action === MemoryPreviewAction.Delete
        ? (target?.project ?? null)
        : (input.project ?? null),
    source: 'USER_EXPLICIT',
    replacesExisting: action === MemoryPreviewAction.Update,
    targetId: target?.id ?? null,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + MEMORY_LIMITS.PREVIEW_TTL_MS).toISOString(),
  };
}

export interface MemoryControllerOptions {
  repository?: MemoryRepository;
  now?: () => number;
  newId?: () => string;
  isEnabled?: MemoryEnabledCheck;
}

export class MemoryController {
  private readonly repository: MemoryRepository;
  private now: () => number;
  private newId: () => string;
  private readonly isEnabled: MemoryEnabledCheck;
  private readonly pending = new Map<string, PendingPreview>();

  constructor(options: MemoryControllerOptions = {}) {
    this.repository = options.repository ?? memoryRepository;
    this.now = options.now ?? (() => Date.now());
    this.newId =
      options.newId ??
      (() => `mp-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-6)}`);
    this.isEnabled =
      options.isEnabled ?? (async () => (await getSettings()).memoryEnabled);
  }

  /** Test seam: deterministic clock. */
  setClock(now: () => number): void {
    this.now = now;
  }

  /**
   * Drop worker-level memory state: the repository cache and any pending
   * previews. Mirrors a fresh worker (nothing stored is touched beyond
   * re-reading storage), and keeps tests independent.
   */
  reset(): void {
    this.pending.clear();
    this.repository.resetCache();
  }

  private sweep(): void {
    const nowMs = this.now();
    for (const [id, entry] of this.pending) {
      if (entry.expiresAtMs <= nowMs) this.pending.delete(id);
    }
  }

  private remember(entry: PendingPreview): void {
    this.sweep();
    if (this.pending.size >= MEMORY_LIMITS.MAX_PENDING_PREVIEWS) {
      const oldest = this.pending.keys().next();
      if (!oldest.done) this.pending.delete(oldest.value);
    }
    this.pending.set(entry.preview.previewId, entry);
  }

  pendingCount(): number {
    this.sweep();
    return this.pending.size;
  }

  /* ------------------------------ read ------------------------------ */

  async status(): Promise<MemoryStatusView> {
    const [base, enabled] = await Promise.all([
      this.repository.status(),
      this.isEnabled(),
    ]);
    return { ...base, enabled };
  }

  async list(
    query = '',
    kind: MemoryKind | null = null,
  ): Promise<MemoryResultView> {
    const records = await this.repository.search(query, kind);
    const total = (await this.repository.status()).total;
    const message =
      records.length === 0
        ? 'No saved memories match that.'
        : `You have ${records.length} saved ${records.length === 1 ? 'memory' : 'memories'}.`;
    return result(MemoryResultAction.Listed, message, records, total);
  }

  /** Bounded retrieval for one request; nothing is retrieved when off. */
  async retrieve(query: string): Promise<MemoryRetrieval> {
    if (!(await this.isEnabled())) {
      return { memories: [], superseded: 0, disabled: true };
    }
    return this.repository.retrieve(query);
  }

  /* ---------------------------- commands ---------------------------- */

  async handleCommand(cmd: ParsedMemoryCommand): Promise<MemoryCommandOutcome> {
    switch (cmd.intent) {
      case MemoryIntent.ListMemory: {
        const kind = kindFilterFromQuery(cmd.query);
        const listing = await this.list(cmd.query, kind);
        if (!(await this.isEnabled())) {
          return {
            kind: 'result',
            result: {
              ...listing,
              action: MemoryResultAction.Disabled,
              message:
                'Memory is off, so nothing is used in answers. These are the memories already saved — you can delete them in Settings.',
            },
          };
        }
        return { kind: 'result', result: listing };
      }
      case MemoryIntent.Forget:
        return this.prepareForget(cmd);
      case MemoryIntent.UpdateMemory:
        return this.prepareRemember(cmd, true);
      case MemoryIntent.Remember:
      default:
        return this.prepareRemember(cmd, false);
    }
  }

  /** REMEMBER / UPDATE: validate, detect duplicates, propose a preview. */
  private async prepareRemember(
    cmd: ParsedMemoryCommand,
    explicitUpdate: boolean,
  ): Promise<MemoryCommandOutcome> {
    if (!(await this.isEnabled())) {
      return {
        kind: 'refusal',
        code: 'MEMORY_DISABLED',
        message:
          'Memory is off, so I did not save anything. You can turn memory on in Settings.',
      };
    }

    const content = cleanMemoryText(cmd.content);
    if (content === null) {
      return { kind: 'refusal', code: 'MEMORY_INVALID', message: 'There was nothing to save.' };
    }

    const kind = inferMemoryKind(content, cmd.scope);
    const input: MemoryInput = {
      kind,
      content,
      scope: cmd.scope,
      project: cmd.project,
    };

    // Explicit "update my memory about X to Y" needs an existing memory.
    if (explicitUpdate && cmd.explicitUpdate) {
      const target = await this.repository.findByQuery(cmd.query);
      if (!target) {
        const candidates = await this.repository.searchAll(cmd.query);
        return {
          kind: 'result',
          result: result(
            MemoryResultAction.NoMatch,
            candidates.length === 0
              ? 'I don’t have a saved memory matching that.'
              : 'Several saved memories match that. Update the right one in Settings → Memory.',
            candidates,
          ),
        };
      }
      const validation = await this.repository.validate({
        ...input,
        kind: target.kind,
        scope: target.scope,
        project: target.project,
      });
      if (!validation.ok) {
        return { kind: 'refusal', code: validation.code, message: validation.message };
      }
      return this.proposeUpdate(input, target);
    }

    const validation = await this.repository.validate(input);
    if (!validation.ok) {
      return { kind: 'refusal', code: validation.code, message: validation.message };
    }

    const relation = await this.repository.relationFor(input);

    if (relation.relation === 'DUPLICATE') {
      return {
        kind: 'result',
        result: result(
          MemoryResultAction.AlreadySaved,
          'You already asked me to remember that — it is saved.',
          [relation.record],
        ),
      };
    }

    if (relation.relation !== 'NONE') {
      return this.proposeUpdate(input, relation.record);
    }

    return this.proposeCreate(input);
  }

  private proposeCreate(input: MemoryInput): MemoryCommandOutcome {
    const nowMs = this.now();
    const previewId = this.newId();
    const preview = previewView(
      MemoryPreviewAction.Create,
      previewId,
      input,
      nowMs,
      null,
    );
    this.remember({
      preview,
      input,
      action: MemoryPreviewAction.Create,
      targetId: null,
      expiresAtMs: nowMs + MEMORY_LIMITS.PREVIEW_TTL_MS,
    });
    return { kind: 'preview', preview };
  }

  private proposeUpdate(
    input: MemoryInput,
    target: MemoryRecord,
  ): MemoryCommandOutcome {
    const nowMs = this.now();
    const previewId = this.newId();
    const preview = previewView(
      MemoryPreviewAction.Update,
      previewId,
      { ...input, kind: target.kind, scope: target.scope, project: target.project },
      nowMs,
      target,
    );
    this.remember({
      preview,
      input: {
        ...input,
        kind: target.kind,
        scope: target.scope,
        project: target.project,
      },
      action: MemoryPreviewAction.Update,
      targetId: target.id,
      expiresAtMs: nowMs + MEMORY_LIMITS.PREVIEW_TTL_MS,
    });
    return { kind: 'preview', preview };
  }

  /** FORGET: find the one memory the user means and ask before deleting. */
  private async prepareForget(cmd: ParsedMemoryCommand): Promise<MemoryCommandOutcome> {
    const query = cleanMemoryText(cmd.query) ?? '';
    const candidates = await this.repository.searchAll(query);

    if (candidates.length === 0) {
      return {
        kind: 'result',
        result: result(
          MemoryResultAction.NoMatch,
          'I don’t have a saved memory matching that.',
        ),
      };
    }
    if (candidates.length > 1) {
      return {
        kind: 'result',
        result: result(
          MemoryResultAction.NoMatch,
          'Several saved memories match that. Delete the right one in Settings → Memory.',
          candidates,
        ),
      };
    }

    const target = candidates[0];
    if (!target) {
      return {
        kind: 'result',
        result: result(MemoryResultAction.NoMatch, 'I don’t have a saved memory matching that.'),
      };
    }

    const nowMs = this.now();
    const previewId = this.newId();
    const preview = previewView(
      MemoryPreviewAction.Delete,
      previewId,
      { kind: target.kind, content: target.content, scope: target.scope, project: target.project },
      nowMs,
      target,
    );
    this.remember({
      preview,
      input: {
        kind: target.kind,
        content: target.content,
        scope: target.scope,
        project: target.project,
      },
      action: MemoryPreviewAction.Delete,
      targetId: target.id,
      expiresAtMs: nowMs + MEMORY_LIMITS.PREVIEW_TTL_MS,
    });
    return { kind: 'preview', preview };
  }

  /** Withdraw a pending preview (user pressed Cancel). */
  cancel(previewId: string): boolean {
    return this.pending.delete(previewId);
  }

  /**
   * The ONLY path that persists a confirmable change. The preview is
   * consumed before the write, so a confirmation can never be replayed.
   */
  async confirm(previewId: string): Promise<MemoryCommandOutcome> {
    this.sweep();
    const entry = this.pending.get(previewId);
    if (!entry) {
      return {
        kind: 'refusal',
        code: 'MEMORY_INVALID',
        message: 'That memory request is no longer pending.',
      };
    }
    this.pending.delete(previewId);

    if (!(await this.isEnabled())) {
      return {
        kind: 'refusal',
        code: 'MEMORY_DISABLED',
        message:
          'Memory is off, so nothing was saved. You can turn memory on in Settings.',
      };
    }

    if (entry.action === MemoryPreviewAction.Delete) {
      if (entry.targetId === null) {
        return { kind: 'refusal', code: 'MEMORY_NOT_FOUND', message: 'That memory is no longer saved.' };
      }
      const removal = await this.repository.remove(entry.targetId);
      if (!removal.ok) {
        return { kind: 'refusal', code: removal.code, message: removal.message };
      }
      return {
        kind: 'result',
        result: result(MemoryResultAction.Deleted, 'Memory deleted.', [], await this.totalCount()),
      };
    }

    if (entry.action === MemoryPreviewAction.Update && entry.targetId !== null) {
      const updated = await this.repository.update(entry.targetId, entry.input);
      if (!updated.ok) {
        return { kind: 'refusal', code: updated.code, message: updated.message };
      }
      return {
        kind: 'result',
        result: result(
          MemoryResultAction.Updated,
          'Memory updated.',
          [updated.record],
          await this.totalCount(),
        ),
      };
    }

    // CREATE — re-check for a duplicate that appeared while pending.
    const relation = await this.repository.relationFor(entry.input);
    if (relation.relation === 'DUPLICATE') {
      return {
        kind: 'result',
        result: result(
          MemoryResultAction.AlreadySaved,
          'You already asked me to remember that — it is saved.',
          [relation.record],
          await this.totalCount(),
        ),
      };
    }

    const created = await this.repository.create(entry.input);
    if (!created.ok) {
      return { kind: 'refusal', code: created.code, message: created.message };
    }
    return {
      kind: 'result',
      result: result(
        MemoryResultAction.Saved,
        'Memory saved.',
        [created.record],
        await this.totalCount(),
      ),
    };
  }

  /* --------------------------- management -------------------------- */

  /** Explicit, user-confirmed deletion of one saved memory. */
  async remove(id: string): Promise<MemoryCommandOutcome> {
    const removal = await this.repository.remove(id);
    if (!removal.ok) {
      return { kind: 'refusal', code: removal.code, message: removal.message };
    }
    return {
      kind: 'result',
      result: result(MemoryResultAction.Deleted, 'Memory deleted.', [], await this.totalCount()),
    };
  }

  /** Explicit, user-confirmed deletion of everything. */
  async clearAll(): Promise<MemoryCommandOutcome> {
    const cleared = await this.repository.clearAll();
    if (!cleared.ok) {
      return { kind: 'refusal', code: cleared.code, message: cleared.message };
    }
    return {
      kind: 'result',
      result: result(
        MemoryResultAction.Cleared,
        cleared.removed === 0
          ? 'There were no saved memories to delete.'
          : `Deleted ${cleared.removed} saved ${cleared.removed === 1 ? 'memory' : 'memories'}.`,
        [],
        0,
      ),
    };
  }

  private async totalCount(): Promise<number> {
    return (await this.repository.status()).total;
  }
}

/** Worker-scoped singleton (the extension's memory authority). */
export const memoryController = new MemoryController();
