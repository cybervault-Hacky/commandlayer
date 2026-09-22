/**
 * Typed message vocabulary for all extension-to-background communication.
 *
 * Every message crosses a trust boundary, so the transport layer validates
 * envelopes (see @/shared/messaging) before any handler sees them.
 */
export const MESSAGE_VERSION = 1;

export const MessageType = {
  PING: 'cl:ping',
  GET_EXTENSION_STATUS: 'cl:get-extension-status',
  GET_CURRENT_PAGE: 'cl:get-current-page',
  /** On-demand Page Intelligence capture of the active tab. */
  GET_PAGE_CONTEXT: 'cl:get-page-context',
  COMMAND_SUBMIT: 'cl:command-submit',
  QUICK_ACTION: 'cl:quick-action',
  /**
   * Phase 4 — explicit approval + execution of ONE stored plan. The
   * payload carries only planId + planHash; the plan itself is never
   * accepted from the caller.
   */
  ACTION_EXECUTE: 'cl:action-execute',
  /** Withdraw approval for a pending plan. */
  ACTION_CANCEL: 'cl:action-cancel',
  OPEN_COMMAND_CENTER: 'cl:open-command-center',
  OPEN_SIDE_PANEL: 'cl:open-side-panel',
  GET_SETTINGS: 'cl:get-settings',
  SET_SETTINGS: 'cl:set-settings',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];
