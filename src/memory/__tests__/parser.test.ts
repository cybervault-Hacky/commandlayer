import { describe, expect, it } from 'vitest';
import {
  isMemoryCommand,
  kindFilterFromQuery,
  parseMemoryCommand,
} from '../parser';
import { MemoryIntent, MemoryScope } from '../types';
import { MEMORY_LIMITS } from '../limits';

describe('memory command parsing', () => {
  it('recognizes explicit remember phrasings', () => {
    for (const text of [
      'Remember that I prefer TypeScript.',
      'remember I prefer TypeScript',
      'Please remember that I prefer TypeScript',
      'Keep in mind that I prefer TypeScript',
    ]) {
      const parsed = parseMemoryCommand(text);
      expect(parsed?.intent, text).toBe(MemoryIntent.Remember);
      expect(parsed?.content, text).toBe('I prefer TypeScript');
      expect(parsed?.scope).toBe(MemoryScope.Global);
    }
  });

  it('recognizes a change marker as an update intent', () => {
    const parsed = parseMemoryCommand('Remember that I now prefer TypeScript.');
    expect(parsed?.intent).toBe(MemoryIntent.UpdateMemory);
    expect(parsed?.explicitChange).toBe(true);
    expect(parsed?.explicitUpdate).toBe(false);
  });

  it('recognizes explicit update phrasings', () => {
    const parsed = parseMemoryCommand(
      'Update my memory about my preferred language to I prefer TypeScript',
    );
    expect(parsed?.intent).toBe(MemoryIntent.UpdateMemory);
    expect(parsed?.explicitUpdate).toBe(true);
    expect(parsed?.query).toBe('my preferred language');
    expect(parsed?.content).toBe('I prefer TypeScript');
  });

  it('recognizes forget phrasings', () => {
    for (const text of [
      'Forget that I prefer TypeScript',
      'forget about my TypeScript preference',
      'delete my memory about TypeScript',
      'remove the saved memory of TypeScript',
      'stop remembering my TypeScript preference',
    ]) {
      const parsed = parseMemoryCommand(text);
      expect(parsed?.intent, text).toBe(MemoryIntent.Forget);
      expect(parsed?.query.length, text).toBeGreaterThan(0);
    }
  });

  it('recognizes listing questions', () => {
    for (const text of [
      'What do you remember about my preferences?',
      'what do you remember?',
      'What do you know about me?',
      'list my memories',
      'Show me my saved memories',
      'my memories',
    ]) {
      const parsed = parseMemoryCommand(text);
      expect(parsed?.intent, text).toBe(MemoryIntent.ListMemory);
    }
  });

  it('maps listing questions to a category filter', () => {
    expect(kindFilterFromQuery('my preferences')).toBe('PREFERENCE');
    expect(kindFilterFromQuery('my work style')).toBe('WORK_STYLE');
    expect(kindFilterFromQuery('my projects')).toBe('PROJECT_CONTEXT');
    expect(kindFilterFromQuery('my instructions')).toBe('EXPLICIT_INSTRUCTION');
    expect(kindFilterFromQuery('facts about me')).toBe('USER_FACT');
    expect(kindFilterFromQuery('')).toBeNull();
    expect(kindFilterFromQuery('anything else')).toBeNull();
  });

  it('extracts an explicit project scope and strips it from the memory', () => {
    const parsed = parseMemoryCommand(
      'Remember for the "CommandLayer" project that we use TypeScript.',
    );
    expect(parsed?.scope).toBe(MemoryScope.Project);
    expect(parsed?.project).toBe('CommandLayer');
    expect(parsed?.content).toBe('we use TypeScript');

    const unquoted = parseMemoryCommand(
      'Remember for the CommandLayer project that we use Next.js',
    );
    expect(unquoted?.scope).toBe(MemoryScope.Project);
    expect(unquoted?.project).toBe('CommandLayer');
    expect(unquoted?.content).toBe('we use Next.js');

    const prefixed = parseMemoryCommand(
      'Remember for project "CommandLayer" that we use Next.js',
    );
    expect(prefixed?.scope).toBe(MemoryScope.Project);
    expect(prefixed?.project).toBe('CommandLayer');
    expect(prefixed?.content).toBe('we use Next.js');
  });

  it('never guesses a project scope', () => {
    const parsed = parseMemoryCommand('Remember that my project uses Next.js.');
    expect(parsed?.scope).toBe(MemoryScope.Global);
    expect(parsed?.project).toBeNull();
    expect(parsed?.content).toBe('my project uses Next.js');
  });

  it('rejects a project label that looks sensitive', () => {
    const parsed = parseMemoryCommand(
      'Remember for the "my password" project that we use TypeScript',
    );
    expect(parsed?.scope).toBe(MemoryScope.Global);
  });

  it('ignores ordinary commands and questions', () => {
    for (const text of [
      'Summarize this page',
      'find "pricing" and open it',
      'explain this code using my preferred language',
      'scroll down and read the page',
      '',
      '   ',
    ]) {
      expect(parseMemoryCommand(text), text).toBeNull();
      expect(isMemoryCommand(text), text).toBe(false);
    }
  });

  it('ignores overlong text (never treats a document as a memory command)', () => {
    const long = `remember that ${'x'.repeat(MEMORY_LIMITS.MAX_MEMORY_COMMAND_LENGTH)}`;
    expect(parseMemoryCommand(long)).toBeNull();
  });

  it('is deterministic', () => {
    const text = 'Remember that I prefer TypeScript over JavaScript.';
    expect(parseMemoryCommand(text)).toEqual(parseMemoryCommand(text));
  });

  it('returns no content for a remember command with nothing after it', () => {
    expect(parseMemoryCommand('Remember that')).toBeNull();
    expect(parseMemoryCommand('remember')).toBeNull();
  });
});
