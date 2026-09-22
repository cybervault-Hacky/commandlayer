import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../repository';
import { MemoryScope } from '../types';
import { toStoredMemoryState, MEMORY_SCHEMA_VERSION } from '../schema';
import { MEMORY_LIMITS } from '../limits';
import { createFakeStore, makeRecord, FIXTURE_NOW } from './fixtures';

function repositoryWith(store = createFakeStore()) {
  return {
    store,
    repository: new MemoryRepository({
      load: store.load,
      save: store.save,
      now: () => FIXTURE_NOW,
      newId: (() => {
        let n = 0;
        return () => `generated${(n += 1).toString().padStart(3, '0')}`;
      })(),
    }),
  };
}

describe('memory repository — core CRUD', () => {
  it('creates, reads, updates, and deletes a memory', async () => {
    const { repository, store } = repositoryWith();

    const created = await repository.create({
      kind: 'PREFERENCE',
      content: 'I prefer TypeScript',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.record.id).toMatch(/^generated\d{3}$/);
    expect(created.record.source).toBe('USER_EXPLICIT');
    expect(created.record.confidence).toBe('HIGH');
    expect(created.record.enabled).toBe(true);
    expect(store.writes).toBe(1);

    expect((await repository.list()).map((r) => r.content)).toEqual([
      'I prefer TypeScript',
    ]);
    expect((await repository.get(created.record.id))?.content).toBe(
      'I prefer TypeScript',
    );

    const updated = await repository.update(created.record.id, {
      kind: 'PREFERENCE',
      content: 'I prefer TypeScript for frontend work',
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.record.content).toBe('I prefer TypeScript for frontend work');
      expect(updated.record.createdAt).toBe(created.record.createdAt);
      expect(updated.record.updatedAt).toBeGreaterThanOrEqual(
        created.record.createdAt,
      );
      expect(updated.replaced?.content).toBe('I prefer TypeScript');
    }

    const removed = await repository.remove(created.record.id);
    expect(removed.ok).toBe(true);
    expect(await repository.list()).toHaveLength(0);
  });

  it('reports unknown ids instead of inventing records', async () => {
    const { repository } = repositoryWith();
    expect(await repository.get('nope')).toBeUndefined();
    const update = await repository.update('nope', {
      kind: 'PREFERENCE',
      content: 'I prefer TypeScript',
    });
    expect(update.ok).toBe(false);
    if (!update.ok) expect(update.code).toBe('MEMORY_NOT_FOUND');
    const removal = await repository.remove('nope');
    expect(removal.ok).toBe(false);
    if (!removal.ok) expect(removal.code).toBe('MEMORY_NOT_FOUND');
  });

  it('rejects sensitive content and over-long content before writing', async () => {
    const { repository, store } = repositoryWith();

    const sensitive = await repository.create({
      kind: 'USER_FACT',
      content: 'my password is hunter2',
    });
    expect(sensitive.ok).toBe(false);
    if (!sensitive.ok) expect(sensitive.code).toBe('MEMORY_SENSITIVE_BLOCKED');

    const long = await repository.create({
      kind: 'USER_FACT',
      content: 'x'.repeat(MEMORY_LIMITS.MAX_MEMORY_CONTENT_LENGTH + 1),
    });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.code).toBe('MEMORY_CONTENT_TOO_LONG');

    expect(store.writes).toBe(0);
    expect(store.raw()).toBeUndefined();
  });

  it('enforces the record limit', async () => {
    const initial = Array.from(
      { length: MEMORY_LIMITS.MAX_MEMORY_RECORDS },
      (_value, index) =>
        makeRecord({ id: `seed${index.toString().padStart(8, '0')}`, content: `fact ${index}` }),
    );
    const { repository, store } = repositoryWith(createFakeStore(initial));
    const writesBefore = store.writes;

    const created = await repository.create({
      kind: 'USER_FACT',
      content: 'one too many',
    });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.code).toBe('MEMORY_LIMIT_EXCEEDED');
    expect(store.writes).toBe(writesBefore);
    expect(await repository.list()).toHaveLength(MEMORY_LIMITS.MAX_MEMORY_RECORDS);
  });

  it('rolls back when persistence fails', async () => {
    const { repository, store } = repositoryWith();
    store.failNextWrite();

    const created = await repository.create({
      kind: 'PREFERENCE',
      content: 'I prefer TypeScript',
    });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.code).toBe('MEMORY_STORAGE_FAILED');
    // Nothing was written and the in-memory view is unchanged.
    expect(store.raw()).toBeUndefined();
    expect(await repository.list()).toHaveLength(0);
  });

  it('degrades gracefully when storage is unavailable', async () => {
    const repository = new MemoryRepository({
      load: async () => {
        throw new Error('storage unavailable');
      },
      save: async () => false,
      now: () => FIXTURE_NOW,
    });

    expect(await repository.list()).toEqual([]);
    const status = await repository.status();
    expect(status.storageAvailable).toBe(false);

    const created = await repository.create({
      kind: 'PREFERENCE',
      content: 'I prefer TypeScript',
    });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.code).toBe('MEMORY_STORAGE_FAILED');
  });

  it('clears everything and reports how many were removed', async () => {
    const { repository } = repositoryWith(
      createFakeStore([
        makeRecord({ id: 'aaaaaaaa', content: 'I prefer TypeScript' }),
        makeRecord({ id: 'bbbbbbbb', content: 'I live in Pune' }),
      ]),
    );
    const cleared = await repository.clearAll();
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.removed).toBe(2);
    expect(await repository.list()).toHaveLength(0);
    expect((await repository.status()).total).toBe(0);
  });

  it('serializes concurrent writes without losing data', async () => {
    const { repository } = repositoryWith();
    await Promise.all([
      repository.create({ kind: 'PREFERENCE', content: 'I prefer TypeScript' }),
      repository.create({ kind: 'USER_FACT', content: 'I live in Pune' }),
      repository.create({ kind: 'WORK_STYLE', content: 'I write tests first' }),
    ]);
    expect(await repository.list()).toHaveLength(3);
  });
});

describe('memory repository — untrusted stored data', () => {
  it('loads valid records and discards malformed ones', async () => {
    const store = createFakeStore();
    store.setRaw({
      schema: MEMORY_SCHEMA_VERSION,
      records: [
        makeRecord({ id: 'goodrecord', content: 'I prefer TypeScript' }),
        { id: 'short', kind: 'PREFERENCE', content: 'I prefer TypeScript' },
        { ...makeRecord({ id: 'badkind01', content: 'x y z' }), kind: 'SECRET_KIND' },
        { ...makeRecord({ id: 'badtime01', content: 'I prefer TypeScript' }), createdAt: 'yesterday' },
        null,
        'not-a-record',
      ],
    });
    const { repository } = repositoryWith(store);

    const records = await repository.list();
    expect(records.map((record) => record.id)).toEqual(['goodrecord']);
    expect(repository.discardedOnLoad).toBe(5);
  });

  it('refuses to load a record whose content is sensitive (tampered store)', async () => {
    const store = createFakeStore();
    store.setRaw({
      schema: MEMORY_SCHEMA_VERSION,
      records: [
        makeRecord({ id: 'tampered1', content: 'my password is hunter2' }),
        makeRecord({ id: 'cleangood', content: 'I prefer TypeScript' }),
      ],
    });
    const { repository } = repositoryWith(store);
    expect((await repository.list()).map((r) => r.id)).toEqual(['cleangood']);
  });

  it('drops records from an unknown schema version', async () => {
    const store = createFakeStore();
    store.setRaw({
      schema: 99,
      records: [makeRecord({ id: 'futurever', content: 'I prefer TypeScript' })],
    });
    const { repository } = repositoryWith(store);
    expect(await repository.list()).toEqual([]);
    expect(repository.discardedOnLoad).toBe(1);
  });

  it('recovers from a completely corrupt blob', async () => {
    const store = createFakeStore();
    store.setRaw('###corrupted###');
    const { repository } = repositoryWith(store);
    expect(await repository.list()).toEqual([]);
    const created = await repository.create({
      kind: 'PREFERENCE',
      content: 'I prefer TypeScript',
    });
    expect(created.ok).toBe(true);
  });

  it('caps the number of records read back from storage', async () => {
    const store = createFakeStore();
    store.setRaw(
      toStoredMemoryState(
        Array.from({ length: MEMORY_LIMITS.MAX_MEMORY_RECORDS + 20 }, (_v, i) =>
          makeRecord({ id: `bulk${i.toString().padStart(5, '0')}`, content: `fact ${i}` }),
        ),
      ),
    );
    const { repository } = repositoryWith(store);
    expect(await repository.list()).toHaveLength(
      MEMORY_LIMITS.MAX_MEMORY_RECORDS,
    );
  });
});

describe('memory repository — scope and status', () => {
  it('keeps project scope in the record and rejects a missing label', async () => {
    const { repository } = repositoryWith();
    const created = await repository.create({
      kind: 'PROJECT_CONTEXT',
      content: 'we use TypeScript',
      scope: MemoryScope.Project,
      project: 'CommandLayer',
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.record.scope).toBe(MemoryScope.Project);
      expect(created.record.project).toBe('CommandLayer');
    }

    const invalid = await repository.create({
      kind: 'PROJECT_CONTEXT',
      content: 'we use TypeScript',
      scope: MemoryScope.Project,
    });
    expect(invalid.ok).toBe(false);
  });

  it('reports bounded, closed-key status counts', async () => {
    const { repository } = repositoryWith(
      createFakeStore([
        makeRecord({ id: 'aaaaaaaa', content: 'I prefer TypeScript' }),
        makeRecord({ id: 'bbbbbbbb', content: 'I prefer TypeScript too', kind: 'WORK_STYLE' }),
      ]),
    );
    const status = await repository.status();
    expect(status).toEqual({
      enabled: true,
      count: 2,
      total: 2,
      byKind: {
        PREFERENCE: 1,
        USER_FACT: 0,
        WORK_STYLE: 1,
        PROJECT_CONTEXT: 0,
        EXPLICIT_INSTRUCTION: 0,
      },
      storageAvailable: true,
    });
  });
});
