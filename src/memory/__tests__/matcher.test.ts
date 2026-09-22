import { describe, expect, it } from 'vitest';
import {
  findRelation,
  mentionsProject,
  resolveConflicts,
  retrieveRelevant,
  sameAttribute,
  searchRecords,
  similarity,
} from '../matcher';
import { MemoryScope } from '../types';
import { makeRecord, FIXTURE_NOW } from './fixtures';

describe('memory matcher — similarity and relations', () => {
  it('scores identical text as a perfect match and unrelated text as zero', () => {
    expect(similarity('I prefer TypeScript', 'I prefer TypeScript')).toBe(1);
    expect(similarity('I prefer TypeScript', 'the weather is nice')).toBe(0);
  });

  it('detects an exact duplicate', () => {
    const records = [makeRecord({ content: 'I prefer TypeScript' })];
    const relation = findRelation(records, {
      kind: 'PREFERENCE',
      content: 'i prefer   typescript!',
    });
    expect(relation.relation).toBe('DUPLICATE');
  });

  it('detects a near-duplicate as a similar memory', () => {
    const records = [
      makeRecord({ content: 'I prefer TypeScript for frontend projects' }),
    ];
    const relation = findRelation(records, {
      kind: 'PREFERENCE',
      content: 'I prefer TypeScript for frontend work',
    });
    expect(relation.relation).toBe('SIMILAR');
  });

  it('detects an explicit replacement ("I now prefer …")', () => {
    const records = [makeRecord({ content: 'I prefer JavaScript' })];
    const relation = findRelation(records, {
      kind: 'PREFERENCE',
      content: 'I now prefer TypeScript',
    });
    expect(relation.relation).toBe('REPLACEMENT');
  });

  it('flags a same-attribute conflict without a change marker', () => {
    const records = [makeRecord({ content: 'I prefer JavaScript' })];
    const relation = findRelation(records, {
      kind: 'PREFERENCE',
      content: 'I prefer TypeScript',
    });
    expect(relation.relation).toBe('CONFLICT');
  });

  it('does not see different attributes of the same kind as conflicting', () => {
    expect(
      sameAttribute('I prefer TypeScript for frontend work', 'I prefer dark mode'),
    ).toBe(false);
    const records = [
      makeRecord({ content: 'I prefer TypeScript for frontend work' }),
    ];
    const relation = findRelation(records, {
      kind: 'PREFERENCE',
      content: 'I prefer dark mode',
    });
    expect(relation.relation).toBe('NONE');
  });

  it('never relates memories stored under a different scope', () => {
    const records = [
      makeRecord({
        content: 'we use TypeScript',
        kind: 'PROJECT_CONTEXT',
        scope: MemoryScope.Project,
        project: 'CommandLayer',
      }),
    ];
    expect(
      findRelation(records, {
        kind: 'PROJECT_CONTEXT',
        content: 'we use TypeScript',
      }).relation,
    ).toBe('NONE');
  });

  it('treats byte-identical text as a duplicate regardless of category', () => {
    // Storing the same sentence twice under two categories would be a
    // duplicate row, not a second memory.
    const records = [
      makeRecord({ content: 'I prefer TypeScript', kind: 'WORK_STYLE' }),
    ];
    expect(
      findRelation(records, { kind: 'PREFERENCE', content: 'I prefer TypeScript' })
        .relation,
    ).toBe('DUPLICATE');
  });

  it('ignores disabled records', () => {
    const records = [
      makeRecord({ content: 'I prefer TypeScript', enabled: false }),
    ];
    expect(
      findRelation(records, { kind: 'PREFERENCE', content: 'I prefer TypeScript' })
        .relation,
    ).toBe('NONE');
  });
});

describe('memory matcher — retrieval', () => {
  it('retrieves only memories that share a topic with the request', () => {
    const records = [
      makeRecord({ content: 'I prefer TypeScript' }),
      makeRecord({ content: 'I live in Pune' }),
    ];
    const retrieval = retrieveRelevant(records, 'explain this code using my preferred language');
    expect(retrieval.memories.map((memory) => memory.content)).toEqual([
      'I prefer TypeScript',
    ]);
  });

  it('never retrieves the whole store for an unrelated request', () => {
    const records = [
      makeRecord({ content: 'I prefer TypeScript' }),
      makeRecord({ content: 'I live in Pune' }),
      makeRecord({ content: 'My project uses Next.js' }),
    ];
    const retrieval = retrieveRelevant(records, 'summarize this page');
    expect(retrieval.memories).toHaveLength(0);
  });

  it('is bounded by the retrieval limit', () => {
    const records = Array.from({ length: 10 }, (_value, index) =>
      makeRecord({
        content: `I prefer TypeScript option ${index}`,
        updatedAt: FIXTURE_NOW + index,
      }),
    );
    const retrieval = retrieveRelevant(records, 'prefer typescript');
    expect(retrieval.memories.length).toBeLessThanOrEqual(4);
  });

  it('keeps project memories out unless the request names the project', () => {
    const records = [
      makeRecord({
        content: 'we use TypeScript',
        kind: 'PROJECT_CONTEXT',
        scope: MemoryScope.Project,
        project: 'CommandLayer',
      }),
    ];
    expect(retrieveRelevant(records, 'use typescript').memories).toHaveLength(0);
    expect(
      retrieveRelevant(records, 'for the CommandLayer project, use typescript')
        .memories,
    ).toHaveLength(1);
    expect(mentionsProject('the CommandLayer project', 'CommandLayer')).toBe(true);
  });

  it('drops superseded values instead of sending contradictions', () => {
    const older = makeRecord({
      content: 'I prefer JavaScript',
      updatedAt: FIXTURE_NOW,
    });
    const newer = makeRecord({
      content: 'I prefer TypeScript',
      updatedAt: FIXTURE_NOW + 1000,
    });
    const retrieval = retrieveRelevant([older, newer], 'what do I prefer?');
    expect(retrieval.memories.map((memory) => memory.content)).toEqual([
      'I prefer TypeScript',
    ]);
    expect(retrieval.superseded).toBe(1);
  });

  it('resolves conflicts deterministically (newest first, stable)', () => {
    const older = makeRecord({ content: 'I prefer JavaScript', updatedAt: FIXTURE_NOW });
    const newer = makeRecord({ content: 'I prefer TypeScript', updatedAt: FIXTURE_NOW + 5 });
    const first = resolveConflicts([older, newer]);
    const second = resolveConflicts([older, newer]);
    expect(first.kept).toEqual(second.kept);
    expect(first.kept[0]?.content).toBe('I prefer TypeScript');
    expect(first.superseded).toBe(1);
  });

  it('keeps qualified attributes separate', () => {
    const frontend = makeRecord({
      content: 'I prefer TypeScript for frontend work',
    });
    const theme = makeRecord({ content: 'I prefer dark mode' });
    const { kept, superseded } = resolveConflicts([frontend, theme]);
    expect(kept).toHaveLength(2);
    expect(superseded).toBe(0);
  });

  it('searches by tokens and category, newest first', () => {
    const records = [
      makeRecord({ content: 'I prefer TypeScript', updatedAt: FIXTURE_NOW }),
      makeRecord({
        content: 'I prefer Neovim',
        kind: 'WORK_STYLE',
        updatedAt: FIXTURE_NOW + 10,
      }),
    ];
    expect(searchRecords(records, 'prefer').map((r) => r.content)).toEqual([
      'I prefer Neovim',
      'I prefer TypeScript',
    ]);
    expect(searchRecords(records, '', 'WORK_STYLE')).toHaveLength(1);
    expect(searchRecords(records, 'typescript', 'WORK_STYLE')).toHaveLength(0);
  });
});
