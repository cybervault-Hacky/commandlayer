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
import { describeNavTarget } from '@/github/patterns';
import { describeTarget } from './targets';
import {
  ActionKind,
  ActionRisk,
  ActionRetryPolicy,
  type Action,
  type ActionRetryPolicy as ActionRetryPolicyType,
} from './types';

export interface ActionDefinition {
  readonly type: ActionKind;
  readonly risk: ActionRisk;
  /** Deterministic retry characteristic (Phase 5 workflow retries). */
  readonly retryPolicy: ActionRetryPolicyType;
  /** Short imperative label for progress UI, e.g. 'Click'. */
  readonly verb: string;
  /** Generate the human-readable preview line for one action. */
  preview(action: Action): string;
}

const DEFINITIONS: Record<ActionKind, ActionDefinition> = {
  [ActionKind.ReadPage]: {
    type: ActionKind.ReadPage,
    retryPolicy: ActionRetryPolicy.Safe,
    risk: ActionRisk.ReadOnly,
    verb: 'Read',
    preview: () => 'Read this page’s structure (read-only)',
  },
  [ActionKind.FindText]: {
    type: ActionKind.FindText,
    retryPolicy: ActionRetryPolicy.Safe,
    risk: ActionRisk.ReadOnly,
    verb: 'Find',
    preview: (a) =>
      a.type === ActionKind.FindText
        ? `Find text “${a.query}” (read-only)`
        : '',
  },
  [ActionKind.Scroll]: {
    type: ActionKind.Scroll,
    retryPolicy: ActionRetryPolicy.Never,
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
  [ActionKind.NavigateGitHub]: {
    type: ActionKind.NavigateGitHub,
    // Navigation leaves the current page and loads a new one: always an
    // explicit, single-use approval, and never retried automatically.
    retryPolicy: ActionRetryPolicy.Never,
    risk: ActionRisk.Confirmation,
    verb: 'Open',
    preview: (a) =>
      a.type === ActionKind.NavigateGitHub
        ? `Open ${describeNavTarget(a.target)} in this tab`
        : '',
  },
  [ActionKind.ClickElement]: {
    type: ActionKind.ClickElement,
    retryPolicy: ActionRetryPolicy.Never,
    risk: ActionRisk.Confirmation,
    verb: 'Click',
    preview: (a) =>
      a.type === ActionKind.ClickElement
        ? `Click ${describeTarget(a.target)}`
        : '',
  },
  [ActionKind.TypeText]: {
    type: ActionKind.TypeText,
    retryPolicy: ActionRetryPolicy.Never,
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
    retryPolicy: ActionRetryPolicy.VerifyFirst,
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

  /**
   * Retry characteristic for a concrete action. Scroll is the one
   * direction-dependent case: absolute scrolls (top/bottom) are
   * idempotent, relative scrolls are not.
   */
  retryPolicyOf(action: Action): ActionRetryPolicyType {
    const base = DEFINITIONS[action.type].retryPolicy;
    if (action.type === ActionKind.Scroll) {
      return action.direction === 'top' || action.direction === 'bottom'
        ? ActionRetryPolicy.Safe
        : ActionRetryPolicy.Never;
    }
    return base;
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
