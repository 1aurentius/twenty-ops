import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerSkillCommands } from '../../src/commands/skill.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote, tag } from '../helpers/integration-setup.js';

const TAG = `skillint${tag()}`;
const runSk = (...args: string[]) =>
  runCli(registerSkillCommands, ['--remote', REMOTE, 'skill', ...args]);

describe.skipIf(!INTEGRATION)('skill integration', () => {
  const cleanup: string[] = [];

  beforeAll(assertLocalRemote);
  afterAll(async () => {
    for (const id of cleanup) await runSk('delete', id).catch(() => undefined);
  });

  it('list returns a (possibly empty) array', async () => {
    const { stdout } = await runSk('list', '--json');
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('NOT_FOUND for an unknown skill name', async () => {
    const err = await runSk('get', `${TAG}-nosuch`).catch((e: unknown) => e) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('CRUD + activate/deactivate lifecycle', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'skill-int-'));

    const createFile = join(dir, 'create.json');
    writeFileSync(createFile, JSON.stringify({
      name: TAG,
      label: 'Integration Skill',
      description: 'test',
      content: 'You are a test skill. Echo the input.',
    }));

    let skId = '';
    try {
      const out = await runSk('create', '--file', createFile, '--json');
      const row = JSON.parse(out.stdout.trim()) as { id: string; name: string };
      skId = row.id;
      cleanup.push(skId);
      expect(row.name).toBe(TAG);
    } catch (err) {
      const e = err as { exitCode?: number; message?: string };
      if (e.exitCode === EXIT.API || e.exitCode === EXIT.AUTH) {
        // eslint-disable-next-line no-console
        console.warn(`skill create gated (${e.exitCode}): ${e.message}`);
        return;
      }
      throw err;
    }

    // get
    const got = await runSk('get', skId, '--json');
    expect((JSON.parse(got.stdout.trim()) as { id: string }).id).toBe(skId);

    // update label
    const patchFile = join(dir, 'patch.json');
    writeFileSync(patchFile, JSON.stringify({ label: 'Renamed' }));
    await runSk('update', skId, '--file', patchFile);
    const reread = await runSk('get', skId, '--json');
    expect((JSON.parse(reread.stdout.trim()) as { label: string }).label).toBe('Renamed');

    // deactivate (active by default after create)
    await runSk('deactivate', skId);
    const afterDeact = await runSk('get', skId, '--json');
    expect((JSON.parse(afterDeact.stdout.trim()) as { isActive: boolean }).isActive).toBe(false);

    // activate
    await runSk('activate', skId);
    const afterAct = await runSk('get', skId, '--json');
    expect((JSON.parse(afterAct.stdout.trim()) as { isActive: boolean }).isActive).toBe(true);

    // delete
    await runSk('delete', skId);
    cleanup.pop();
    const post = await runSk('get', skId).catch((e: unknown) => e) as { exitCode?: number };
    expect(post.exitCode).toBe(EXIT.NOT_FOUND);
  });
});
