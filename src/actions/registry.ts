/**
 * Phase 4 — centralized action registry.
 *
 * The registry is the ONLY source of truth for which actions exist,
 * their deterministic risk classification, and their preview wording.
 * The executor refuses to run anything that is not registered here.
 *
 * Risk is owned by the registry — never by AI output, never by the
 * request, and never configurable at runtime.
 */
import { describeTarget } from './targets';
import {
  ActionKind,
  ActionRisk,
  type Action,
} from './types';

export interface ActionDefinition {
  readonly type: ActionKind;
  readonly risk: ActionRisk;
  /** Short imperative label for progress UI, e.g. 'Click'. */
  readonly verb: string;
  /** Generate the human-readable preview line for one action. */
  preview(action: Action): string;
}

const DEFINITIONS: Record<ActionKind, ActionDefinition> = {
  [ActionKind.ReadPage]: {
    type: ActionKind.ReadPage,
    risk: ActionRisk.ReadOnly,
    verb: 'Read',
    preview: () => 'Read this page’s structure (read-only)',
  },
  [ActionKind.FindText]: {
    type: ActionKind.FindText,
    risk: ActionRisk.ReadOnly,
    verb: 'Find',
    preview: (a) =>
      a.type === ActionKind.FindText
        ? `Find text “${a.query}” (read-only)`
        : '',
  },
  [ActionKind.Scroll]: {
    type: ActionKind.Scroll,
    risk: ActionRisk.Low,
    verb: 'Scroll',
    preview: (a) => {
      if (a.type !== ActionKind.Scroll) return '';
      switch (a.direction) {
        case 'top':
          return 'Scroll to the top of the page';
        case 'bottom':
          return 'Scroll to the bottom of the page';
        case 'up':
          return `Scroll up ${a.distancePx ?? 600}px`;
        case 'down':
          return `Scroll down ${a.distancePx ?? 600}px`;
      }
    },
  },
  [ActionKind.ClickElement]: {
    type: ActionKind.ClickElement,
    risk: ActionRisk.Confirmation,
    verb: 'Click',
    preview: (a) =>
      a.type === ActionKind.ClickElement
        ? `Click ${describeTarget(a.target)}`
        : '',
  },
  [ActionKind.TypeText]: {
    type: ActionKind.TypeText,
    risk: ActionRisk.Confirmation,
    verb: 'Type',
    preview: (a) => {
      if (a.type !== ActionKind.TypeText) return '';
      // Preview the value (never sensitive: sensitive fields are blocked
      // at execution, and the planner only proposes what the user asked).
      const shown =
        a.text.length > 80 ? `${a.text.slice(0, 79)}…` : a.text;
      return `Type “${shown}” into ${describeTarget(a.target)}`;
    },
  },
  [ActionKind.SelectOption]: {
    type: ActionKind.SelectOption,
    risk: ActionRisk.Confirmation,
    verb: 'Select',
    preview: (a) =>
      a.type === ActionKind.SelectOption
        ? `Select “${a.option}” in ${describeTarget(a.target)}`
        : '',
  },
};

class ActionRegistry {
  /** Risk is fixed per action kind; the AI cannot influence it. */
  riskOf(kind: ActionKind): ActionRisk {
    return DEFINITIONS[kind].risk;
  }

  definition(kind: ActionKind): ActionDefinition {
    return DEFINITIONS[kind];
  }

  isRegistered(kind: string): kind is ActionKind {
    return kind in DEFINITIONS;
  }

  /** Highest risk among a set of actions (READ_ONLY < LOW_RISK < CONFIRMATION_REQUIRED). */
  combinedRisk(actions: readonly Action[]): ActionRisk {
    let risk: ActionRisk = ActionRisk.ReadOnly;
    for (const action of actions) {
      const r = this.riskOf(action.type);
      if (r === ActionRisk.Confirmation) return ActionRisk.Confirmation;
      if (r === ActionRisk.Low) risk = ActionRisk.Low;
    }
    return risk;
  }

  /** All registered kinds (used by docs/tests; never by execution). */
  registeredKinds(): readonly ActionKind[] {
    return Object.keys(DEFINITIONS) as ActionKind[];
  }
}

export const actionRegistry = new ActionRegistry();
