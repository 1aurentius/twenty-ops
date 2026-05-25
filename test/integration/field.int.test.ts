import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerFieldCommands } from '../../src/commands/field.js';
import { registerObjectCommands } from '../../src/commands/object.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote, tag } from '../helpers/integration-setup.js';

const TAG = `fldint${tag()}`;
const runField = (...args: string[]) =>
  runCli(registerFieldCommands, ['--remote', REMOTE, 'field', ...args]);
const runObj = (...args: string[]) =>
  runCli(registerObjectCommands, ['--remote', REMOTE, 'object', ...args]);

describe.skipIf(!INTEGRATION)('field integration', () => {
  /** Track the throwaway object id so we always clean it up, even on test failure. */
  let objectId = '';
  let objectSingular = '';
  const fieldCleanup: string[] = [];

  beforeAll(async () => {
    assertLocalRemote();
    objectSingular = `${TAG}Probe`;
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'fld-int-'));
    const f = join(dir, 'object.json');
    writeFileSync(f, JSON.stringify({
      nameSingular: objectSingular,
      namePlural: `${TAG}Probes`,
      labelSingular: 'Probe',
      labelPlural: 'Probes',
      icon: 'IconFlask',
    }));
    const created = await runObj('create', '--file', f, '--json');
    objectId = (JSON.parse(created.stdout.trim()) as { id: string }).id;
  });

  afterAll(async () => {
    for (const id of fieldCleanup) await runField('delete', id).catch(() => undefined);
    if (objectId) await runObj('delete', objectId).catch(() => undefined);
  });

  it('creates a TEXT field, gets it, updates its label, and deletes', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'fld-int-'));

    const createFile = join(dir, 'field.json');
    writeFileSync(createFile, JSON.stringify({
      name: 'demoText',
      label: 'Demo Text',
      type: 'TEXT',
      description: 'integration test',
    }));
    const created = await runField('create', '--object', objectSingular, '--file', createFile, '--json');
    const createdRow = JSON.parse(created.stdout.trim()) as { id: string; type: string };
    fieldCleanup.push(createdRow.id);
    expect(createdRow.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(createdRow.type).toBe('TEXT');

    const got = await runField('get', createdRow.id, '--json');
    const gotRow = JSON.parse(got.stdout.trim()) as { id: string; label: string };
    expect(gotRow.label).toBe('Demo Text');

    const patchFile = join(dir, 'patch.json');
    writeFileSync(patchFile, JSON.stringify({ label: 'Demo Text (updated)' }));
    await runField('update', createdRow.id, '--file', patchFile);

    const reread = await runField('get', createdRow.id, '--json');
    expect((JSON.parse(reread.stdout.trim()) as { label: string }).label).toBe('Demo Text (updated)');

    await runField('delete', createdRow.id);
    fieldCleanup.pop();

    const err = await runField('get', createdRow.id).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('lists fields scoped to the throwaway object', async () => {
    const { stdout } = await runField('list', '--object', objectSingular, '--json');
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { objectMetadataId: string });
    expect(rows.length).toBeGreaterThanOrEqual(1); // at least the default name field that Twenty adds
    for (const r of rows) expect(r.objectMetadataId).toBe(objectId);
  });

  it('NOT_FOUND for a bogus field id', async () => {
    const err = await runField('get', '00000000-0000-4000-8000-000000000000').catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });
});
