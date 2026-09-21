import type { PageContext } from './page';
import type { QuickActionId as QuickActionIdType } from '../constants/quickActions';

export type QuickActionId = QuickActionIdType;

/** Which extension surface originated the command. */
export const CommandSource = {
  SidePanel: 'sidepanel',
  Popup: 'popup',
  CommandCenter: 'command-center',
} as const;

export type CommandSource = (typeof CommandSource)[keyof typeof CommandSource];

export type CommandStatus = 'completed' | 'failed';

/**
 * A structured, validated command request. This is the stable contract the
 * future AI/action layers will consume — the UI only ever produces these.
 */
export interface CommandRequest {
  id: string;
  text: string;
  source: CommandSource;
  quickAction?: QuickActionId;
  context: PageContext | null;
  createdAt: string;
}

/** The terminal result of a command, safe to render in the UI. */
export interface CommandResult {
  id: string;
  status: CommandStatus;
  /** User-safe result text (never a raw error). */
  text: string;
  /** The user's command, trimmed (for logs and echoes). */
  commandText?: string;
  source: CommandSource;
  quickAction?: QuickActionId;
  errorCode?: string;
  startedAt: string;
  finishedAt: string;
}
