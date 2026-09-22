/**
 * Permission utilities. Phase 1 requests the minimum set:
 *
 * - storage:    local settings/preferences
 * - tabs:       read the active tab's title/URL for current-page context
 * - sidePanel:  open and control the Side Panel
 * - commands:   the Ctrl+Shift+L keyboard shortcut (manifest key)
 *
 * No host permissions are requested.
 */

/** Permissions the chrome.permissions API can check at runtime. */
export const RUNTIME_CHECKED_PERMISSIONS: readonly chrome.runtime.ManifestPermission[] = [
  'sidePanel',
  'storage',
  'tabs',
];

/** Every permission declared in the manifest (informational). */
export const DECLARED_PERMISSIONS: readonly string[] = [
  ...RUNTIME_CHECKED_PERMISSIONS,
  'commands',
];

async function hasPermission(
  permission: chrome.runtime.ManifestPermission,
): Promise<boolean> {
  try {
    // The API resolves to a PermissionsContainsResult object; some type
    // revisions model it as a boolean — handle both defensively.
    const result: unknown = await chrome.permissions.contains({
      permissions: [permission],
    });
    return typeof result === 'boolean'
      ? result
      : (result as { hasPermission?: unknown }).hasPermission === true;
  } catch {
    return false;
  }
}

/** Which declared permissions are actually granted at runtime. */
export async function getGrantedPermissions(): Promise<string[]> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.contains) {
    // Preview/dev context: no permission system, assume declared set.
    return [...DECLARED_PERMISSIONS];
  }
  const granted: string[] = ['commands'];
  for (const permission of RUNTIME_CHECKED_PERMISSIONS) {
    if (await hasPermission(permission)) granted.push(permission);
  }
  return granted;
}
