import {
  ErrorCode,
  USER_ERROR_MESSAGES,
} from '@/shared/constants/errors';
import { CommandLayerError } from '@/shared/security/errors';
import {
  PREFERENCE_KEY_PREFIX,
  PREFERENCE_NAME_PATTERN,
} from './keys';
import { getStorageBackend } from './backend';

/**
 * Generic, namespaced preferences API for future phases.
 * Names are validated (no path traversal into other storage keys) and values
 * must be JSON-serializable.
 */
function assertPreferenceName(name: string): void {
  if (typeof name !== 'string' || !PREFERENCE_NAME_PATTERN.test(name)) {
    throw new CommandLayerError(
      ErrorCode.INVALID_PAYLOAD,
      'Preference name is invalid.',
    );
  }
}

function assertSerializable(value: unknown): void {
  try {
    JSON.stringify(value);
  } catch {
    throw new CommandLayerError(
      ErrorCode.INVALID_PAYLOAD,
      USER_ERROR_MESSAGES[ErrorCode.INVALID_PAYLOAD],
    );
  }
}

export async function getPreference<T>(
  name: string,
): Promise<T | undefined> {
  assertPreferenceName(name);
  try {
    const raw = await getStorageBackend().get(`${PREFERENCE_KEY_PREFIX}${name}`);
    return raw === undefined ? undefined : (raw as T);
  } catch {
    return undefined;
  }
}

export async function setPreference<T>(name: string, value: T): Promise<void> {
  assertPreferenceName(name);
  assertSerializable(value);
  await getStorageBackend().set(`${PREFERENCE_KEY_PREFIX}${name}`, value);
}
