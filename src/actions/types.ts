/**
 * Action abstraction — architecture only in Phase 1.
 *
 * An Action is a discrete, permissioned unit of work the command layer can
 * eventually perform. Phase 1 deliberately registers no user-facing actions
 * and performs no autonomous behavior: the types and registry exist so
 * future phases add actions without redesigning the pipeline.
 */
import type { CommandRequest } from '@/shared/types/command';
import type { PageContext } from '@/shared/types/page';

/**
 * Permission model. 'requires-confirmation' is the minimum bar for anything
 * that affects the user's page; 'blocked' is the Phase 1 default for
 * anything touching browser state.
 */
export type ActionPermission =
  | 'none'
  | 'requires-confirmation'
  | 'blocked';

export interface ActionContext {
  command?: CommandRequest;
  page?: PageContext | null;
}

export interface ActionResult {
  ok: boolean;
  /** User-safe summary. */
  message: string;
}

export interface Action {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly permission: ActionPermission;
  /** Whether the action could run right now (does not run it). */
  canExecute(context: ActionContext): boolean;
  execute(context: ActionContext): Promise<ActionResult>;
}
