import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerDashboardCommands } from '../../src/commands/dashboard.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote, tag } from '../helpers/integration-setup.js';

const TAG = `dashint${tag()}`;
const runDash = (...args: string[]) =>
  runCli(registerDashboardCommands, ['--remote', REMOTE, 'dashboard', ...args]);

describe.skipIf(!INTEGRATION)('dashboard integration', () => {
  const cleanup: string[] = [];

  beforeAll(assertLocalRemote);
  afterAll(async () => {
    for (const id of cleanup) await runDash('delete', id).catch(() => undefined);
  });

  it('list returns a (possibly empty) array', async () => {
    const { stdout } = await runDash('list', '--json');
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('NOT_FOUND for an unknown dashboard id', async () => {
    const err = await runDash('get', '00000000-0000-4000-8000-000000000000').catch(
      (e: unknown) => e,
    ) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('CRUD + restore lifecycle: create → get → update → delete → restore → re-delete', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'dash-int-'));

    const createFile = join(dir, 'create.json');
    writeFileSync(createFile, JSON.stringify({ title: `${TAG}-dash` }));

    let dId = '';
    try {
      const out = await runDash('create', '--file', createFile, '--json');
      const row = JSON.parse(out.stdout.trim()) as { id: string; title: string };
      dId = row.id;
      cleanup.push(dId);
      expect(row.title).toBe(`${TAG}-dash`);
    } catch (err) {
      const e = err as { exitCode?: number; message?: string };
      if (e.exitCode === EXIT.API) {
        // eslint-disable-next-line no-console
        console.warn(`dashboard create gated: ${e.message}`);
        return;
      }
      throw err;
    }

    // get
    const got = await runDash('get', dId, '--json');
    expect((JSON.parse(got.stdout.trim()) as { id: string }).id).toBe(dId);

    // update
    const patchFile = join(dir, 'patch.json');
    writeFileSync(patchFile, JSON.stringify({ title: `${TAG}-dash-renamed` }));
    await runDash('update', dId, '--file', patchFile);
    const reread = await runDash('get', dId, '--json');
    expect((JSON.parse(reread.stdout.trim()) as { title: string }).title).toBe(`${TAG}-dash-renamed`);

    // delete (soft)
    await runDash('delete', dId);
    const postDel = await runDash('get', dId).catch((e: unknown) => e) as { exitCode?: number };
    expect(postDel.exitCode).toBe(EXIT.NOT_FOUND);

    // restore
    await runDash('restore', dId);
    const postRestore = await runDash('get', dId, '--json');
    expect((JSON.parse(postRestore.stdout.trim()) as { id: string }).id).toBe(dId);

    // re-delete for cleanup
    await runDash('delete', dId);
    cleanup.pop();
  });
});
