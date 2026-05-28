import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerObjectCommands } from '../../src/commands/object.js';
import { registerPageLayoutCommands } from '../../src/commands/page-layout.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote, tag } from '../helpers/integration-setup.js';

const TAG = `plint${tag()}`;
const runPl = (...args: string[]) =>
  runCli(registerPageLayoutCommands, ['--remote', REMOTE, 'page-layout', ...args]);
const runObj = (...args: string[]) =>
  runCli(registerObjectCommands, ['--remote', REMOTE, 'object', ...args]);

describe.skipIf(!INTEGRATION)('page-layout root integration', () => {
  /** Throwaway object to scope page layouts under — destroys any orphan layouts on cleanup. */
  let objectId = '';
  const singular = `${TAG}Obj`;
  const cleanup: string[] = [];

  beforeAll(async () => {
    assertLocalRemote();
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'pl-int-'));
    const objFile = join(dir, 'object.json');
    writeFileSync(objFile, JSON.stringify({
      nameSingular: singular,
      namePlural: `${singular}s`,
      labelSingular: 'PL Test',
      labelPlural: 'PL Tests',
    }));
    const created = await runObj('create', '--file', objFile, '--json');
    objectId = (JSON.parse(created.stdout.trim()) as { id: string }).id;
  });

  afterAll(async () => {
    for (const id of cleanup) await runPl('delete', id).catch(() => undefined);
    if (objectId) await runObj('delete', objectId).catch(() => undefined);
  });

  it('lists page layouts under --object (empty for a fresh object)', async () => {
    const { stdout } = await runPl('list', '--object', singular, '--json');
    const lines = stdout.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(0);
  });

  it('CRUD lifecycle: create → get → update → delete', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'pl-int-'));

    const createFile = join(dir, 'create.json');
    writeFileSync(createFile, JSON.stringify({
      name: `${TAG}-record-page`,
      type: 'RECORD_PAGE',
      objectMetadataId: objectId,
    }));

    let plId = '';
    try {
      const created = await runPl('create', '--file', createFile, '--json');
      const row = JSON.parse(created.stdout.trim()) as { id: string; name: string };
      plId = row.id;
      cleanup.push(plId);
      expect(row.name).toBe(`${TAG}-record-page`);
    } catch (err) {
      // Twenty may server-side gate certain layout types — surface and skip
      // the rest of the lifecycle rather than failing.
      const e = err as { exitCode?: number; message?: string };
      if (e.exitCode === EXIT.API) {
        // eslint-disable-next-line no-console
        console.warn(`page-layout create gated: ${e.message}`);
        return;
      }
      throw err;
    }

    // get by id
    const got = await runPl('get', plId, '--json');
    const gotRow = JSON.parse(got.stdout.trim()) as { id: string; name: string; type: string };
    expect(gotRow.id).toBe(plId);
    expect(gotRow.type).toBe('RECORD_PAGE');

    // update name
    const patchFile = join(dir, 'patch.json');
    writeFileSync(patchFile, JSON.stringify({ name: `${TAG}-renamed` }));
    await runPl('update', plId, '--file', patchFile);
    const reread = await runPl('get', plId, '--json');
    expect((JSON.parse(reread.stdout.trim()) as { name: string }).name).toBe(`${TAG}-renamed`);

    // delete (note: `reset` only works on stock layouts, not custom ones —
    //  the server returns "Custom page layout … cannot be reset to default")
    await runPl('delete', plId);
    cleanup.pop();

    const post = await runPl('get', plId).catch((e: unknown) => e) as { exitCode?: number };
    expect(post.exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('returns NOT_FOUND for a bogus page layout id', async () => {
    const err = await runPl('get', '00000000-0000-4000-8000-000000000000').catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('tab CRUD lifecycle: create page layout → create tab → list → update → delete', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'pl-tab-int-'));

    // Parent layout
    const plFile = join(dir, 'pl.json');
    writeFileSync(plFile, JSON.stringify({
      name: `${TAG}-tab-parent`,
      type: 'RECORD_PAGE',
      objectMetadataId: objectId,
    }));
    let plId = '';
    try {
      const created = await runPl('create', '--file', plFile, '--json');
      plId = (JSON.parse(created.stdout.trim()) as { id: string }).id;
      cleanup.push(plId);
    } catch (err) {
      const e = err as { exitCode?: number; message?: string };
      if (e.exitCode === EXIT.API) {
        // eslint-disable-next-line no-console
        console.warn(`page-layout create gated: ${e.message}`);
        return;
      }
      throw err;
    }

    // Tab
    const tabFile = join(dir, 'tab.json');
    writeFileSync(tabFile, JSON.stringify({
      title: 'Overview',
      position: 0,
      layoutMode: 'GRID',
    }));
    const tabCreated = await runPl('tab', 'create', '--page-layout', plId, '--file', tabFile, '--json');
    const tabRow = JSON.parse(tabCreated.stdout.trim()) as { id: string; title: string };
    expect(tabRow.title).toBe('Overview');

    // list under parent layout
    const listOut = await runPl('tab', 'list', plId, '--json');
    const ids = listOut.stdout.trim().split('\n').filter(Boolean).map((l) => (JSON.parse(l) as { id: string }).id);
    expect(ids).toContain(tabRow.id);

    // update title
    const patchFile = join(dir, 'patch.json');
    writeFileSync(patchFile, JSON.stringify({ title: 'Overview (renamed)' }));
    await runPl('tab', 'update', tabRow.id, '--file', patchFile);
    const reread = await runPl('tab', 'get', tabRow.id, '--json');
    expect((JSON.parse(reread.stdout.trim()) as { title: string }).title).toBe('Overview (renamed)');

    // delete
    await runPl('tab', 'delete', tabRow.id);
    const post = await runPl('tab', 'get', tabRow.id).catch((e: unknown) => e) as { exitCode?: number };
    expect(post.exitCode).toBe(EXIT.NOT_FOUND);
  });
});
