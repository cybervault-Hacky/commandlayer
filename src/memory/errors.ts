/**
 * Phase 6 — memory domain errors.
 *
 * Every failure is a typed CommandLayerError carrying a stable code whose
 * user-facing wording lives in USER_ERROR_MESSAGES (single source of
 * truth). Raw storage errors, quota details, and record internals are
 * never surfaced.
 */
import {
  USER_ERROR_MESSAGES,
  type ErrorCode as ErrorCodeType,
} from '@/shared/constants/errors';
import { CommandLayerError } from '@/shared/security/errors';

export type MemoryErrorCode = Extract<ErrorCodeType, `MEMORY_${string}`>;

export function memoryError(code: MemoryErrorCode): CommandLayerError {
  return new CommandLayerError(code, USER_ERROR_MESSAGES[code]);
}

export const MEMORY_SAFE_REFUSAL =
  'I can’t save passwords, codes, payment details, keys, or tokens as memory.';
