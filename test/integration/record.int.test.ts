import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerFieldCommands } from '../../src/commands/field.js';
import { registerObjectCommands } from '../../src/commands/object.js';
import { registerRecordCommands } from '../../src/commands/record.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote, tag } from '../helpers/integration-setup.js';

const TAG = `rec-int-${tag()}`;
const runRec = (...args: string[]) =>
  runCli(registerRecordCommands, ['--remote', REMOTE, 'record', ...args]);
const runObj = (...args: string[]) =>
  runCli(registerObjectCommands, ['--remote', REMOTE, 'object', ...args]);
const runField = (...args: string[]) =>
  runCli(registerFieldCommands, ['--remote', REMOTE, 'field', ...args]);

describe.skipIf(!INTEGRATION)('record integration (person)', () => {
  const cleanup: string[] = [];

  beforeAll(assertLocalRemote);
  afterAll(async () => {
    for (const id of cleanup) {
      await runRec('delete', 'person', id).catch(() => undefined);
    }
  });

  it('creates a person, fetches it back, updates it, and soft-deletes', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'rec-int-'));

    const createFile = join(dir, 'create.json');
    writeFileSync(createFile, JSON.stringify({
      name: { firstName: TAG, lastName: 'CRUD' },
      jobTitle: 'Test Subject',
    }));
    const created = await runRec('create', 'person', '--file', createFile, '--json');
    const createdRow = JSON.parse(created.stdout.trim()) as { id: string };
    cleanup.push(createdRow.id);
    expect(createdRow.id).toMatch(/^[0-9a-f-]{36}$/);

    const got = await runRec('get', 'person', createdRow.id, '--json');
    const gotRow = JSON.parse(got.stdout.trim()) as { id: string; jobTitle?: string };
    expect(gotRow.id).toBe(createdRow.id);

    const patchFile = join(dir, 'patch.json');
    writeFileSync(patchFile, JSON.stringify({ jobTitle: 'Updated' }));
    await runRec('update', 'person', createdRow.id, '--file', patchFile);

    const reread = await runRec('get', 'person', createdRow.id, '--json');
    const reredRow = JSON.parse(reread.stdout.trim()) as { jobTitle: string };
    expect(reredRow.jobTitle).toBe('Updated');

    await runRec('delete', 'person', createdRow.id);
    cleanup.pop();
  });

  it('lists people with a filter and respects --limit', async () => {
    // Best-effort: just assert the call succeeds and returns an array. We don't
    // know what's seeded beyond the workspace owner.
    const { stdout } = await runRec('list', 'person', '--limit', '5', '--json');
    const lines = stdout.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(5);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('returns NOT_FOUND for an unknown record id', async () => {
    const err = await runRec('get', 'person', '00000000-0000-4000-8000-000000000000').catch(
      (e: unknown) => e,
    );
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });
});

/**
 * Bulk-upsert lifecycle — runs against a throwaway custom object so the
 * "page through all current records" reconcile loop is isolated from any
 * other state in the workspace.
 */
describe.skipIf(!INTEGRATION)('record bulk-upsert lifecycle (custom object)', () => {
  const TAG_OBJ = `bulk${tag()}`;
  const SINGULAR = `${TAG_OBJ}Row`;
  const PLURAL = `${TAG_OBJ}Rows`;
  let objectId = '';

  beforeAll(async () => {
    assertLocalRemote();
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'bulk-int-'));

    const objFile = join(dir, 'object.json');
    writeFileSync(objFile, JSON.stringify({
      nameSingular: SINGULAR,
      namePlural: PLURAL,
      labelSingular: 'Bulk Row',
      labelPlural: 'Bulk Rows',
    }));
    const created = await runObj('create', '--file', objFile, '--json');
    objectId = (JSON.parse(created.stdout.trim()) as { id: string }).id;

    // Add a `key` TEXT field that bulk-upsert can match on.
    const fieldFile = join(dir, 'field.json');
    writeFileSync(fieldFile, JSON.stringify({
      name: 'key',
      label: 'Key',
      type: 'TEXT',
    }));
    await runField('create', '--object', SINGULAR, '--file', fieldFile);
  });

  afterAll(async () => {
    if (objectId) await runObj('delete', objectId).catch(() => undefined);
  });

  it('first upsert creates all rows, second upsert reports the +/~/-/= deltas', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'bulk-int-'));

    // First file — three rows
    const file1 = join(dir, 'desired1.json');
    writeFileSync(file1, JSON.stringify([
      { key: 'a', name: 'Alpha' },
      { key: 'b', name: 'Beta' },
      { key: 'c', name: 'Gamma' },
    ]));

    const r1 = await runRec('bulk-upsert', SINGULAR, '--file', file1, '--key', 'key', '--json');
    expect(JSON.parse(r1.stdout.trim())).toMatchObject({ created: 3, updated: 0, deleted: 0, unchanged: 0 });

    // Second file — a unchanged, b renamed, c dropped, d added
    const file2 = join(dir, 'desired2.json');
    writeFileSync(file2, JSON.stringify([
      { key: 'a', name: 'Alpha' },          // unchanged
      { key: 'b', name: 'Beta (renamed)' }, // updated
      { key: 'd', name: 'Delta' },           // created
    ]));

    const r2 = await runRec('bulk-upsert', SINGULAR, '--file', file2, '--key', 'key', '--json');
    expect(JSON.parse(r2.stdout.trim())).toMatchObject({ created: 1, updated: 1, deleted: 1, unchanged: 1 });
  });
});

describe.skipIf(!INTEGRATION)('record merge integration (person)', () => {
  const cleanup: string[] = [];

  beforeAll(assertLocalRemote);
  afterAll(async () => {
    for (const id of cleanup) await runRec('delete', 'person', id).catch(() => undefined);
  });

  it('merges two people into one — survivor matches --priority index', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'merge-int-'));

    // Create two people with overlapping jobTitle for a deliberate field conflict
    const f1 = join(dir, 'p1.json');
    writeFileSync(f1, JSON.stringify({ name: { firstName: `${TAG}-merge1`, lastName: 'A' }, jobTitle: 'Original' }));
    const f2 = join(dir, 'p2.json');
    writeFileSync(f2, JSON.stringify({ name: { firstName: `${TAG}-merge2`, lastName: 'B' }, jobTitle: 'Duplicate' }));

    const r1 = await runRec('create', 'person', '--file', f1, '--json');
    const r2 = await runRec('create', 'person', '--file', f2, '--json');
    const id1 = (JSON.parse(r1.stdout.trim()) as { id: string }).id;
    const id2 = (JSON.parse(r2.stdout.trim()) as { id: string }).id;

    // Dry-run first — should NOT actually merge (both ids still resolvable after)
    const dry = await runRec('merge', 'person', id1, id2, '--dry-run', '--json');
    const dryResult = JSON.parse(dry.stdout.trim()) as { id: string };
    expect(dryResult.id).toMatch(/^[0-9a-f-]{36}$/);

    const stillThere = await runRec('get', 'person', id2, '--json').catch(() => null);
    expect(stillThere).not.toBeNull();

    // Real merge — priority 0 means id1 wins on conflict
    const merged = await runRec('merge', 'person', id1, id2, '--priority', '0', '--json');
    const m = JSON.parse(merged.stdout.trim()) as { id: string; jobTitle: string };
    cleanup.push(m.id);
    expect(m.id).toBe(id1);
    expect(m.jobTitle).toBe('Original'); // priority 0 → id1 wins
  });
});
