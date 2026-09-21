/** 'extension' = real browser extension context; 'preview' = plain browser dev preview. */
export type RuntimeEnvironment = 'extension' | 'preview';

export interface ExtensionStatus {
  version: string;
  environment: RuntimeEnvironment;
  ready: true;
  /** Permissions granted at runtime (informational; Phase 1 requests them all). */
  permissionsGranted: string[];
}
