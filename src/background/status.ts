import {
  APP_VERSION,
} from '@/shared/constants/app';
import { getGrantedPermissions } from '@/permissions';
import { getAIStatusInfo } from '@/ai';
import type {
  ExtensionStatus,
  RuntimeEnvironment,
} from '@/shared/types/status';

/** Extension status for the UI: version, environment, permissions. */
export async function getExtensionStatus(): Promise<ExtensionStatus> {
  let version = APP_VERSION;
  if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
    try {
      version = chrome.runtime.getManifest().version ?? APP_VERSION;
    } catch {
      // Keep the compiled fallback version.
    }
  }

  const environment: RuntimeEnvironment =
    typeof chrome !== 'undefined' && !!chrome.runtime?.id
      ? 'extension'
      : 'preview';

  const permissionsGranted = await getGrantedPermissions();
  const ai = getAIStatusInfo();

  return { version, environment, ready: true, permissionsGranted, ai };
}
