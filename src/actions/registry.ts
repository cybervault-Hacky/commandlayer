import type { Action, ActionContext } from './types';

/**
 * Central action registry. Phase 1 keeps it empty of user-facing actions;
 * the registry API is what future phases build on.
 */
class ActionRegistry {
  private readonly actions = new Map<string, Action>();

  register(action: Action): void {
    if (this.actions.has(action.id)) {
      throw new Error(`Action "${action.id}" is already registered.`);
    }
    this.actions.set(action.id, action);
  }

  get(id: string): Action | undefined {
    return this.actions.get(id);
  }

  /** Actions that are registered and executable in the given context. */
  available(context: ActionContext): Action[] {
    return [...this.actions.values()].filter((action) => action.canExecute(context));
  }

  async execute(id: string, context: ActionContext) {
    const action = this.actions.get(id);
    if (!action) return { ok: false, message: `Unknown action "${id}".` } as const;
    if (!action.canExecute(context)) {
      return { ok: false, message: `"${action.title}" is not available right now.` } as const;
    }
    return action.execute(context);
  }

  clear(): void {
    this.actions.clear();
  }
}

export const actionRegistry = new ActionRegistry();
