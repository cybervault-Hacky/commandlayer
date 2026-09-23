import { describe, expect, it } from 'vitest';
import { actionRegistry } from '../registry';
import { ActionKind, ActionRisk } from '../types';

describe('action registry — fixed risk allowlist (Phase 4)', () => {
  it('registers exactly the allowlisted action kinds', () => {
    // Phase 7 adds exactly ONE kind: typed GitHub navigation. Everything
    // else about the allowlist is unchanged.
    expect([...actionRegistry.registeredKinds()].sort()).toEqual(
      [
        'CLICK_ELEMENT',
        'FIND_TEXT',
        'NAVIGATE_GITHUB',
        'READ_PAGE',
        'SCROLL',
        'SELECT_OPTION',
        'TYPE_TEXT',
      ].sort(),
    );
  });

  it('fixes risk levels — never derived from AI or input', () => {
    expect(actionRegistry.riskOf(ActionKind.ReadPage)).toBe(ActionRisk.ReadOnly);
    expect(actionRegistry.riskOf(ActionKind.FindText)).toBe(ActionRisk.ReadOnly);
    expect(actionRegistry.riskOf(ActionKind.Scroll)).toBe(ActionRisk.Low);
    expect(actionRegistry.riskOf(ActionKind.ClickElement)).toBe(ActionRisk.Confirmation);
    expect(actionRegistry.riskOf(ActionKind.TypeText)).toBe(ActionRisk.Confirmation);
    expect(actionRegistry.riskOf(ActionKind.SelectOption)).toBe(ActionRisk.Confirmation);
    // Navigation always requires confirmation: it changes what the user sees.
    expect(actionRegistry.riskOf(ActionKind.NavigateGitHub)).toBe(
      ActionRisk.Confirmation,
    );
  });

  it('does not register anything executable beyond the allowlist', () => {
    expect(actionRegistry.isRegistered('EXECUTE_JAVASCRIPT')).toBe(false);
    expect(actionRegistry.isRegistered('SHELL_COMMAND')).toBe(false);
    expect(actionRegistry.isRegistered('NAVIGATE')).toBe(false);
    expect(actionRegistry.isRegistered('')).toBe(false);
  });

  it('combines risks conservatively (highest wins)', () => {
    expect(actionRegistry.combinedRisk([{ type: 'READ_PAGE' }])).toBe(
      ActionRisk.ReadOnly,
    );
    expect(
      actionRegistry.combinedRisk([{ type: 'READ_PAGE' }, { type: 'SCROLL', direction: 'down' }]),
    ).toBe(ActionRisk.Low);
    expect(
      actionRegistry.combinedRisk([
        { type: 'SCROLL', direction: 'down' },
        { type: 'CLICK_ELEMENT', target: { kind: 'text', text: 'Go' } },
      ]),
    ).toBe(ActionRisk.Confirmation);
  });

  it('produces non-empty previews for every registered kind', () => {
    const samples: Record<ActionKind, unknown> = {
      READ_PAGE: { type: 'READ_PAGE' },
      NAVIGATE_GITHUB: {
        type: 'NAVIGATE_GITHUB',
        target: { kind: 'repository', owner: 'octocat', repository: 'hello-world' },
      },
      SCROLL: { type: 'SCROLL', direction: 'down' },
      FIND_TEXT: { type: 'FIND_TEXT', query: 'alpha' },
      CLICK_ELEMENT: { type: 'CLICK_ELEMENT', target: { kind: 'text', text: 'Go' } },
      TYPE_TEXT: { type: 'TYPE_TEXT', target: { kind: 'text', text: 'Name' }, text: 'Ada' },
      SELECT_OPTION: { type: 'SELECT_OPTION', target: { kind: 'text', text: 'Country' }, option: 'India' },
    };
    for (const kind of actionRegistry.registeredKinds()) {
      const action = samples[kind];
      const preview = actionRegistry.definition(kind).preview(action as never);
      expect(preview.length).toBeGreaterThan(3);
    }
  });
});
