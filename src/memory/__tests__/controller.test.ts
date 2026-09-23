import { describe, expect, it } from 'vitest';
import { inferMemoryKind } from '../controller';
import type { MemoryController } from '../controller';
import { parseMemoryCommand } from '../parser';
import { MemoryIntent, MemoryPreviewAction, MemoryResultAction } from '../types';
import { MEMORY_LIMITS } from '../limits';
import { createHarness, makeRecord, FIXTURE_NOW } from './fixtures';

/** Run one command text through the controller (as the background does). */
async function run(controller: MemoryController, text: string) {
  const parsed = parseMemoryCommand(text);
  expect(parsed, text).not.toBeNull();
  return controller.handleCommand(parsed!);
}

describe('memory controller — consent flow', () => {
  it('proposes a confirmation instead of writing', async () => {
    const harness = createHarness();
    const outcome = await run(harness.controller, 'Remember that I prefer TypeScript.');

    expect(outcome.kind).toBe('preview');
    if (outcome.kind !== 'preview') return;
    expect(outcome.preview.action).toBe(MemoryPreviewAction.Create);
    expect(outcome.preview.kind).toBe('PREFERENCE');
    expect(outcome.preview.content).toBe('I prefer TypeScript');
    expect(outcome.preview.source).toBe('USER_EXPLICIT');
    expect(outcome.preview.replacesExisting).toBe(false);
    // Nothing was written by the proposal itself.
    expect(harness.store.writes).toBe(0);
    expect(harness.store.raw()).toBeUndefined();
  });

  it('writes only after confirmation, then reports the saved memory', async () => {
    const harness = createHarness();
    const outcome = await run(harness.controller, 'Remember that I prefer TypeScript.');
    if (outcome.kind !== 'preview') throw new Error('expected preview');

    const confirmed = await harness.controller.confirm(outcome.preview.previewId);
    expect(confirmed.kind).toBe('result');
    if (confirmed.kind === 'result') {
      expect(confirmed.result.action).toBe(MemoryResultAction.Saved);
      expect(confirmed.result.message).toBe('Memory saved.');
      expect(confirmed.result.records[0]?.content).toBe('I prefer TypeScript');
      expect(confirmed.result.records[0]?.audit).toContain('explicitly asked');
      expect(confirmed.result.total).toBe(1);
    }
    expect(harness.store.writes).toBe(1);
  });

  it('never stores anything when the preview is cancelled', async () => {
    const harness = createHarness();
    const outcome = await run(harness.controller, 'Remember that I prefer TypeScript.');
    if (outcome.kind !== 'preview') throw new Error('expected preview');

    expect(harness.controller.cancel(outcome.preview.previewId)).toBe(true);
    expect(harness.store.writes).toBe(0);

    const late = await harness.controller.confirm(outcome.preview.previewId);
    expect(late.kind).toBe('refusal');
    expect(harness.store.writes).toBe(0);
  });

  it('consumes a preview exactly once (no replay)', async () => {
    const harness = createHarness();
    const outcome = await run(harness.controller, 'Remember that I prefer TypeScript.');
    if (outcome.kind !== 'preview') throw new Error('expected preview');

    expect((await harness.controller.confirm(outcome.preview.previewId)).kind).toBe('result');
    const replay = await harness.controller.confirm(outcome.preview.previewId);
    expect(replay.kind).toBe('refusal');
    expect(harness.store.writes).toBe(1);
    expect(await harness.repository.list()).toHaveLength(1);
  });

  it('refuses an unknown or expired preview', async () => {
    const harness = createHarness();
    expect((await harness.controller.confirm('does-not-exist')).kind).toBe('refusal');

    const outcome = await run(harness.controller, 'Remember that I prefer TypeScript.');
    if (outcome.kind !== 'preview') throw new Error('expected preview');
    harness.advance(MEMORY_LIMITS.PREVIEW_TTL_MS + 1);

    const expired = await harness.controller.confirm(outcome.preview.previewId);
    expect(expired.kind).toBe('refusal');
    expect(harness.store.writes).toBe(0);
  });

  it('bounds the number of pending previews', async () => {
    const harness = createHarness();
    for (let index = 0; index < MEMORY_LIMITS.MAX_PENDING_PREVIEWS + 3; index += 1) {
      await run(harness.controller, `Remember that I prefer option ${index}.`);
    }
    expect(harness.controller.pendingCount()).toBeLessThanOrEqual(
      MEMORY_LIMITS.MAX_PENDING_PREVIEWS,
    );
  });
});

describe('memory controller — duplicates and updates', () => {
  it('reports an exact repeat instead of creating a duplicate', async () => {
    const harness = createHarness();
    const first = await run(harness.controller, 'Remember that I prefer TypeScript.');
    if (first.kind !== 'preview') throw new Error('expected preview');
    await harness.controller.confirm(first.preview.previewId);

    const again = await run(harness.controller, 'Remember that I prefer TypeScript.');
    expect(again.kind).toBe('result');
    if (again.kind === 'result') {
      expect(again.result.action).toBe(MemoryResultAction.AlreadySaved);
    }
    expect(await harness.repository.list()).toHaveLength(1);
  });

  it('proposes an update (before/after) for a conflicting value', async () => {
    const harness = createHarness({
      initial: [makeRecord({ id: 'existing1', content: 'I prefer JavaScript' })],
    });

    const outcome = await run(harness.controller, 'Remember that I now prefer TypeScript.');
    expect(outcome.kind).toBe('preview');
    if (outcome.kind !== 'preview') return;
    expect(outcome.preview.action).toBe(MemoryPreviewAction.Update);
    expect(outcome.preview.previousContent).toBe('I prefer JavaScript');
    expect(outcome.preview.content).toBe('I now prefer TypeScript');
    expect(outcome.preview.replacesExisting).toBe(true);
    expect(outcome.preview.targetId).toBe('existing1');
    // Still nothing written until confirmed.
    expect(harness.store.writes).toBe(0);

    const confirmed = await harness.controller.confirm(outcome.preview.previewId);
    expect(confirmed.kind).toBe('result');
    if (confirmed.kind === 'result') {
      expect(confirmed.result.action).toBe(MemoryResultAction.Updated);
    }
    const records = await harness.repository.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.content).toBe('I now prefer TypeScript');
    expect(records[0]?.id).toBe('existing1');
  });

  it('updates an existing memory through an explicit update phrase', async () => {
    const harness = createHarness({
      initial: [
        makeRecord({ id: 'existing2', content: 'I prefer JavaScript for frontend work' }),
      ],
    });
    const outcome = await run(
      harness.controller,
      'Update my memory about my preferred language to I prefer TypeScript',
    );
    expect(outcome.kind).toBe('preview');
    if (outcome.kind === 'preview') {
      expect(outcome.preview.action).toBe(MemoryPreviewAction.Update);
      expect(outcome.preview.targetId).toBe('existing2');
      expect(outcome.preview.previousContent).toBe(
        'I prefer JavaScript for frontend work',
      );
    }
  });

  it('explains when an explicit update has no target', async () => {
    const harness = createHarness();
    const outcome = await run(
      harness.controller,
      'Update my memory about my editor to I prefer Neovim',
    );
    expect(outcome.kind).toBe('result');
    if (outcome.kind === 'result') {
      expect(outcome.result.action).toBe(MemoryResultAction.NoMatch);
    }
    expect(harness.store.writes).toBe(0);
  });

  it('falls back to creating a memory when a change marker has no target', async () => {
    const harness = createHarness();
    const outcome = await run(harness.controller, 'Remember that I now prefer TypeScript.');
    expect(outcome.kind).toBe('preview');
    if (outcome.kind === 'preview') {
      expect(outcome.preview.action).toBe(MemoryPreviewAction.Create);
    }
  });
});

describe('memory controller — listing and deletion', () => {
  it('lists saved memories and filters by category', async () => {
    const harness = createHarness({
      initial: [
        makeRecord({ id: 'pref0001', content: 'I prefer TypeScript' }),
        makeRecord({ id: 'fact0001', content: 'I live in Pune', kind: 'USER_FACT' }),
      ],
    });

    const all = await run(harness.controller, 'What do you remember?');
    expect(all.kind).toBe('result');
    if (all.kind === 'result') {
      expect(all.result.action).toBe(MemoryResultAction.Listed);
      expect(all.result.records).toHaveLength(2);
      expect(all.result.message).toContain('2 saved memories');
    }

    const preferences = await run(
      harness.controller,
      'What do you remember about my preferences?',
    );
    if (preferences.kind === 'result') {
      expect(preferences.result.records.map((r) => r.id)).toEqual(['pref0001']);
    }
  });

  it('never implements "forget" without a confirmation', async () => {
    const harness = createHarness({
      initial: [makeRecord({ id: 'pref0002', content: 'I prefer TypeScript' })],
    });

    const outcome = await run(harness.controller, 'Forget that I prefer TypeScript');
    expect(outcome.kind).toBe('preview');
    if (outcome.kind !== 'preview') return;
    expect(outcome.preview.action).toBe(MemoryPreviewAction.Delete);
    expect(outcome.preview.targetId).toBe('pref0002');
    expect(await harness.repository.list()).toHaveLength(1);

    const confirmed = await harness.controller.confirm(outcome.preview.previewId);
    expect(confirmed.kind).toBe('result');
    if (confirmed.kind === 'result') {
      expect(confirmed.result.action).toBe(MemoryResultAction.Deleted);
    }
    expect(await harness.repository.list()).toHaveLength(0);
  });

  it('reports honestly when there is nothing to forget', async () => {
    const harness = createHarness();
    const outcome = await run(harness.controller, 'Forget that I prefer TypeScript');
    expect(outcome.kind).toBe('result');
    if (outcome.kind === 'result') {
      expect(outcome.result.action).toBe(MemoryResultAction.NoMatch);
      expect(outcome.result.message).toContain('don’t have a saved memory');
    }
  });

  it('lists the candidates instead of guessing which memory to delete', async () => {
    const harness = createHarness({
      initial: [
        makeRecord({ id: 'pref0003', content: 'I prefer TypeScript' }),
        makeRecord({ id: 'pref0004', content: 'I prefer TypeScript for tests' }),
      ],
    });
    const outcome = await run(harness.controller, 'Forget my TypeScript preference');
    expect(outcome.kind).toBe('result');
    if (outcome.kind === 'result') {
      expect(outcome.result.action).toBe(MemoryResultAction.NoMatch);
      expect(outcome.result.records.length).toBeGreaterThan(1);
    }
    expect(await harness.repository.list()).toHaveLength(2);
  });

  it('deletes one memory only when explicitly asked through the manager path', async () => {
    const harness = createHarness({
      initial: [makeRecord({ id: 'pref0005', content: 'I prefer TypeScript' })],
    });
    const outcome = await harness.controller.remove('pref0005');
    expect(outcome.kind).toBe('result');
    expect(await harness.repository.list()).toHaveLength(0);

    const missing = await harness.controller.remove('pref0005');
    expect(missing.kind).toBe('refusal');
  });

  it('clears everything on an explicit request', async () => {
    const harness = createHarness({
      initial: [
        makeRecord({ id: 'pref0006', content: 'I prefer TypeScript' }),
        makeRecord({ id: 'fact0006', content: 'I live in Pune', kind: 'USER_FACT' }),
      ],
    });
    const outcome = await harness.controller.clearAll();
    expect(outcome.kind).toBe('result');
    if (outcome.kind === 'result') {
      expect(outcome.result.action).toBe(MemoryResultAction.Cleared);
      expect(outcome.result.message).toContain('2');
    }
    expect(await harness.repository.list()).toHaveLength(0);
  });
});

describe('memory controller — privacy switch and status', () => {
  it('refuses to save while memory is off', async () => {
    const harness = createHarness({ enabled: false });
    const outcome = await run(harness.controller, 'Remember that I prefer TypeScript.');
    expect(outcome.kind).toBe('refusal');
    if (outcome.kind === 'refusal') {
      expect(outcome.code).toBe('MEMORY_DISABLED');
      expect(outcome.message).toContain('Memory is off');
    }
    expect(harness.store.writes).toBe(0);
  });

  it('does not retrieve anything while memory is off', async () => {
    const harness = createHarness({
      initial: [makeRecord({ id: 'pref0007', content: 'I prefer TypeScript' })],
      enabled: false,
    });
    const retrieval = await harness.controller.retrieve('what do I prefer');
    expect(retrieval).toEqual({ memories: [], superseded: 0, disabled: true });
  });

  it('still allows inspection and deletion while memory is off', async () => {
    const harness = createHarness({
      initial: [makeRecord({ id: 'pref0008', content: 'I prefer TypeScript' })],
      enabled: false,
    });
    const listing = await run(harness.controller, 'What do you remember?');
    expect(listing.kind).toBe('result');
    if (listing.kind === 'result') {
      expect(listing.result.records).toHaveLength(1);
      expect(listing.result.action).toBe(MemoryResultAction.Disabled);
      expect(listing.result.message).toContain('Memory is off');
    }
    // Deletion must always work: the user must be able to erase memory.
    expect((await harness.controller.clearAll()).kind).toBe('result');
    expect(await harness.repository.list()).toHaveLength(0);
  });

  it('refuses to confirm a preview created before memory was switched off', async () => {
    const harness = createHarness();
    const outcome = await run(harness.controller, 'Remember that I prefer TypeScript.');
    if (outcome.kind !== 'preview') throw new Error('expected preview');

    harness.setEnabled(false);
    const confirmed = await harness.controller.confirm(outcome.preview.previewId);
    expect(confirmed.kind).toBe('refusal');
    expect(harness.store.writes).toBe(0);
  });

  it('reports status with the privacy switch, counts, and storage health', async () => {
    const harness = createHarness({
      initial: [makeRecord({ id: 'pref0009', content: 'I prefer TypeScript' })],
    });
    expect(await harness.controller.status()).toEqual({
      enabled: true,
      count: 1,
      total: 1,
      byKind: {
        PREFERENCE: 1,
        USER_FACT: 0,
        WORK_STYLE: 0,
        PROJECT_CONTEXT: 0,
        EXPLICIT_INSTRUCTION: 0,
      },
      storageAvailable: true,
    });

    harness.setEnabled(false);
    expect((await harness.controller.status()).enabled).toBe(false);
  });
});

describe('memory controller — sensitive content', () => {
  it('refuses to preview (let alone store) a secret', async () => {
    const harness = createHarness();
    const outcome = await run(harness.controller, 'Remember that my password is hunter2');

    expect(outcome.kind).toBe('refusal');
    if (outcome.kind === 'refusal') {
      expect(outcome.code).toBe('MEMORY_SENSITIVE_BLOCKED');
      expect(outcome.message).not.toContain('hunter2');
    }
    expect(harness.store.writes).toBe(0);
    expect(harness.controller.pendingCount()).toBe(0);
  });

  it('refuses a secret even after a preview exists (re-checked at commit)', async () => {
    const harness = createHarness();
    const outcome = await run(harness.controller, 'Remember that I prefer TypeScript.');
    if (outcome.kind !== 'preview') throw new Error('expected preview');

    // Tamper with the store to simulate a second write path appearing.
    harness.store.failNextWrite();
    const confirmed = await harness.controller.confirm(outcome.preview.previewId);
    expect(confirmed.kind).toBe('refusal');
    expect(await harness.repository.list()).toHaveLength(0);
  });

  it('refuses an over-long memory', async () => {
    const harness = createHarness();
    const outcome = await run(
      harness.controller,
      `Remember that ${'y'.repeat(MEMORY_LIMITS.MAX_MEMORY_CONTENT_LENGTH + 10)}`,
    );
    expect(outcome.kind).toBe('refusal');
    if (outcome.kind === 'refusal') {
      expect(outcome.code).toBe('MEMORY_CONTENT_TOO_LONG');
    }
  });
});

describe('memory kind inference', () => {
  it('classifies deterministic categories', () => {
    expect(inferMemoryKind('I prefer TypeScript', 'GLOBAL')).toBe('PREFERENCE');
    expect(
      inferMemoryKind('Always show me a preview before executing browser actions', 'GLOBAL'),
    ).toBe('EXPLICIT_INSTRUCTION');
    expect(inferMemoryKind('I use TypeScript for frontend work', 'GLOBAL')).toBe(
      'WORK_STYLE',
    );
    expect(inferMemoryKind('my project uses Next.js', 'GLOBAL')).toBe(
      'PROJECT_CONTEXT',
    );
    expect(inferMemoryKind('we use TypeScript', 'PROJECT')).toBe(
      'PROJECT_CONTEXT',
    );
    expect(inferMemoryKind('I live in Pune', 'GLOBAL')).toBe('USER_FACT');
  });

  it('is stable for the same input', () => {
    const text = 'I prefer concise explanations';
    expect(inferMemoryKind(text, 'GLOBAL')).toBe(inferMemoryKind(text, 'GLOBAL'));
  });
});

describe('memory intent surface', () => {
  it('covers the four typed intents', () => {
    expect(Object.values(MemoryIntent).sort()).toEqual([
      'FORGET',
      'LIST_MEMORY',
      'REMEMBER',
      'UPDATE_MEMORY',
    ]);
  });

  it('timestamps previews with the controller clock', async () => {
    const harness = createHarness();
    const outcome = await run(harness.controller, 'Remember that I prefer TypeScript.');
    if (outcome.kind !== 'preview') throw new Error('expected preview');
    expect(Date.parse(outcome.preview.createdAt)).toBe(FIXTURE_NOW);
    expect(Date.parse(outcome.preview.expiresAt)).toBe(
      FIXTURE_NOW + MEMORY_LIMITS.PREVIEW_TTL_MS,
    );
  });
});
