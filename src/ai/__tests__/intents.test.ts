import { describe, expect, it } from 'vitest';
import { AIIntent } from '../types';
import {
  INTENT_FOR_QUICK_ACTION,
  intentForQuickAction,
  resolveIntent,
} from '../intents';

describe('resolveIntent (deterministic keyword rules)', () => {
  it('maps summarize phrasings to SUMMARIZE', () => {
    expect(resolveIntent('Summarize this page')).toBe(AIIntent.Summarize);
    expect(resolveIntent('give me a tl;dr')).toBe(AIIntent.Summarize);
    expect(resolveIntent('condense the article')).toBe(AIIntent.Summarize);
  });

  it('maps explain phrasings to EXPLAIN', () => {
    expect(resolveIntent('Explain how this works')).toBe(AIIntent.Explain);
    expect(resolveIntent('what is this about?')).toBe(AIIntent.Explain);
    expect(resolveIntent('walk me through it')).toBe(AIIntent.Explain);
  });

  it('maps analyze phrasings to ANALYZE', () => {
    expect(resolveIntent('Analyze this page')).toBe(AIIntent.Analyze);
    expect(resolveIntent('what are the key points')).toBe(AIIntent.Analyze);
    expect(resolveIntent('break down the argument')).toBe(AIIntent.Analyze);
  });

  it('maps extract phrasings to EXTRACT', () => {
    expect(resolveIntent('Extract the dates')).toBe(AIIntent.Extract);
    expect(resolveIntent('list the prices')).toBe(AIIntent.Extract);
    expect(resolveIntent('pull out the names')).toBe(AIIntent.Extract);
  });

  it('falls back to ANSWER for unmatched free text', () => {
    expect(resolveIntent('Who won the 1998 world cup?')).toBe(AIIntent.Answer);
    expect(resolveIntent('hmm')).toBe(AIIntent.Answer);
    expect(resolveIntent('')).toBe(AIIntent.Answer);
  });

  it('prefers more specific intents over the fallback when both match', () => {
    // "summarize" appears before the ANSWER fallback is ever consulted.
    expect(resolveIntent('summarize and tell me about it')).toBe(
      AIIntent.Summarize,
    );
  });

  it('is deterministic across repeated calls and casing/whitespace', () => {
    const a = resolveIntent('  Summarize   THIS page ');
    const b = resolveIntent('summarize this page');
    expect(a).toBe(b);
    expect(a).toBe(AIIntent.Summarize);
  });

  it('maps every quick action to a real reasoning intent (none null)', () => {
    for (const [actionId, intent] of Object.entries(INTENT_FOR_QUICK_ACTION)) {
      expect(intent, actionId).toBeTruthy();
      expect(intentForQuickAction(actionId as never)).toBe(intent);
    }
  });
});
