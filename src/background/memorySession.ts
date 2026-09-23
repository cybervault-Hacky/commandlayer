/**
 * Phase 6 — background wire for persistent memory.
 *
 * The background worker owns every memory mutation; UI surfaces only ever
 * send identities (a preview id, a memory id) and receive bounded,
 * user-safe views. Confirming a preview produces a full CommandResult so
 * the same pipeline state machine used by commands, actions, and
 * workflows drives the memory UI too.
 */
import { ErrorCode, USER_ERROR_MESSAGES } from '@/shared/constants/errors';
import { memoryController } from '@/memory/controller';
import { MemoryResultAction } from '@/memory/types';
import type {
  MemoryKind,
  MemoryResultView,
  MemoryStatusView,
} from '@/memory/types';
import type { CommandResult, CommandSource } from '@/shared/types/command';
import type { MemoryListView } from '@/shared/types/message';

function blockedResult(
  message: string,
  action: MemoryResultView['action'] = MemoryResultAction.Blocked,
): MemoryResultView {
  return { action, message, records: [], total: 0 };
}

function resultOf(
  source: CommandSource,
  message: string,
  memoryResult: MemoryResultView,
  status: 'completed' | 'failed',
  errorCode?: string,
): CommandResult {
  const now = new Date().toISOString();
  return {
    id: `memory-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    status,
    text: message,
    source,
    memoryResult,
    ...(errorCode ? { errorCode } : {}),
    retryable: false,
    startedAt: now,
    finishedAt: now,
  };
}

/**
 * Commit ONE pending memory preview. The preview id is the only thing the
 * caller supplies; the memory body, its category, and its policy result
 * never cross this boundary.
 */
export async function confirmMemoryCommand(payload: {
  previewId: string;
  source: CommandSource;
}): Promise<CommandResult> {
  const outcome = await memoryController.confirm(payload.previewId);

  if (outcome.kind === 'result') {
    return resultOf(payload.source, outcome.result.message, outcome.result, 'completed');
  }
  if (outcome.kind === 'refusal') {
    return resultOf(
      payload.source,
      outcome.message,
      blockedResult(
        outcome.message,
        outcome.code === 'MEMORY_DISABLED'
          ? MemoryResultAction.Disabled
          : MemoryResultAction.Blocked,
      ),
      'failed',
      outcome.code,
    );
  }
  // Defensive: confirm() never returns a fresh preview.
  const message = USER_ERROR_MESSAGES[ErrorCode.MEMORY_INVALID];
  return resultOf(payload.source, message, blockedResult(message), 'failed', ErrorCode.MEMORY_INVALID);
}

/** Withdraw a pending preview (Cancel). Nothing was ever written. */
export function cancelMemoryCommand(previewId: string): { cancelled: boolean } {
  return { cancelled: memoryController.cancel(previewId) };
}

export async function memoryStatusCommand(): Promise<MemoryStatusView> {
  return memoryController.status();
}

/** Bounded listing for the management UI (explicit user inspection). */
export async function listMemoriesCommand(payload: {
  query?: string;
  kind?: MemoryKind | null;
}): Promise<MemoryListView> {
  const status = await memoryController.status();
  const listing = await memoryController.list(payload.query ?? '', payload.kind ?? null);
  return {
    records: listing.records,
    total: status.total,
    enabled: status.enabled,
    storageAvailable: status.storageAvailable,
  };
}

/** Explicit, user-confirmed deletion of one memory. */
export async function deleteMemoryCommand(
  memoryId: string,
): Promise<MemoryResultView> {
  const outcome = await memoryController.remove(memoryId);
  if (outcome.kind === 'result') return outcome.result;
  if (outcome.kind === 'refusal') return blockedResult(outcome.message);
  return blockedResult(USER_ERROR_MESSAGES[ErrorCode.MEMORY_INVALID]);
}

/** Explicit, user-confirmed deletion of every saved memory. */
export async function clearAllMemoryCommand(): Promise<MemoryResultView> {
  const outcome = await memoryController.clearAll();
  if (outcome.kind === 'result') return outcome.result;
  if (outcome.kind === 'refusal') return blockedResult(outcome.message);
  return blockedResult(USER_ERROR_MESSAGES[ErrorCode.MEMORY_INVALID]);
}
