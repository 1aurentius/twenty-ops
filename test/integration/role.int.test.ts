import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerRoleCommands } from '../../src/commands/role.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote, tag } from '../helpers/integration-setup.js';

const TAG = `roleint${tag()}`;
const runRole = (...args: string[]) =>
  runCli(registerRoleCommands, ['--remote', REMOTE, 'role', ...args]);

describe.skipIf(!INTEGRATION)('role integration', () => {
  const cleanup: string[] = [];

  beforeAll(assertLocalRemote);
  afterAll(async () => {
    for (const id of cleanup) await runRole('delete', id, '--force').catch(() => undefined);
  });

  it('lists the seeded admin role', async () => {
    const { stdout } = await runRole('list', '--json');
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { label: string; canBeAssignedToApiKeys: boolean });
    expect(rows.some((r) => r.canBeAssignedToApiKeys)).toBe(true);
  });

  it('creates a throwaway role, updates its label, then deletes it', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'role-int-'));

    const createFile = join(dir, 'create.json');
    writeFileSync(createFile, JSON.stringify({
      label: TAG,
      description: 'integration test',
      canBeAssignedToUsers: true,
      canBeAssignedToApiKeys: false,
    }));
    const created = await runRole('create', '--file', createFile, '--json');
    const createdRow = JSON.parse(created.stdout.trim()) as { id: string; label: string };
    cleanup.push(createdRow.id);
    expect(createdRow.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(createdRow.label).toBe(TAG);

    // get by label
    const got = await runRole('get', TAG, '--json');
    expect((JSON.parse(got.stdout.trim()) as { id: string }).id).toBe(createdRow.id);

    // update
    const patchFile = join(dir, 'patch.json');
    writeFileSync(patchFile, JSON.stringify({ label: `${TAG}-renamed` }));
    await runRole('update', TAG, '--file', patchFile);

    const reread = await runRole('get', `${TAG}-renamed`, '--json');
    expect((JSON.parse(reread.stdout.trim()) as { label: string }).label).toBe(`${TAG}-renamed`);

    // delete without --force → USAGE
    const err = await runRole('delete', `${TAG}-renamed`).catch((e: unknown) => e) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.USAGE);

    // delete with --force
    await runRole('delete', `${TAG}-renamed`, '--force');
    cleanup.pop();

    const post = await runRole('get', `${TAG}-renamed`).catch((e: unknown) => e) as { exitCode?: number };
    expect(post.exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('NOT_FOUND for an unknown role ref', async () => {
    const err = await runRole('get', `${TAG}-nosuch`).catch((e: unknown) => e) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.NOT_FOUND);
  });
});
