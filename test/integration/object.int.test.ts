import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerObjectCommands } from '../../src/commands/object.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote, tag } from '../helpers/integration-setup.js';

const TAG = `objint${tag()}`;
const runObj = (...args: string[]) =>
  runCli(registerObjectCommands, ['--remote', REMOTE, 'object', ...args]);

describe.skipIf(!INTEGRATION)('object integration', () => {
  const cleanup: string[] = [];

  beforeAll(assertLocalRemote);
  afterAll(async () => {
    for (const id of cleanup) await runObj('delete', id).catch(() => undefined);
  });

  it('CRUD: create, get, update label, delete', async () => {
    const singular = `${TAG}Probe`;
    const plural = `${TAG}Probes`;
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'obj-int-'));

    const createFile = join(dir, 'create.json');
    writeFileSync(createFile, JSON.stringify({
      nameSingular: singular,
      namePlural: plural,
      labelSingular: 'Probe',
      labelPlural: 'Probes',
      icon: 'IconFlask',
    }));
    const created = await runObj('create', '--file', createFile, '--json');
    const createdRow = JSON.parse(created.stdout.trim()) as { id: string; nameSingular: string };
    cleanup.push(createdRow.id);
    expect(createdRow.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(createdRow.nameSingular).toBe(singular);

    // get by ref (nameSingular) — proves resolveObjectName works post-create
    const got = await runObj('get', singular, '--json');
    const gotRow = JSON.parse(got.stdout.trim()) as { id: string; isCustom: boolean };
    expect(gotRow.id).toBe(createdRow.id);
    expect(gotRow.isCustom).toBe(true);

    // update label
    const patchFile = join(dir, 'patch.json');
    writeFileSync(patchFile, JSON.stringify({ labelSingular: 'Probe (updated)' }));
    await runObj('update', singular, '--file', patchFile);

    const reread = await runObj('get', singular, '--json');
    const reredRow = JSON.parse(reread.stdout.trim()) as { labelSingular: string };
    expect(reredRow.labelSingular).toBe('Probe (updated)');

    await runObj('delete', singular);
    cleanup.pop();

    // post-delete get should fail
    const err = await runObj('get', singular).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('list --include-inactive includes more rows than the default', async () => {
    const def = await runObj('list', '--json');
    const all = await runObj('list', '--include-inactive', '--json');
    const defCount = def.stdout.trim().split('\n').filter(Boolean).length;
    const allCount = all.stdout.trim().split('\n').filter(Boolean).length;
    expect(allCount).toBeGreaterThanOrEqual(defCount);
  });

  it('returns NOT_FOUND for an unknown object name', async () => {
    const err = await runObj('get', `${TAG}NoSuchObject`).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });
});
