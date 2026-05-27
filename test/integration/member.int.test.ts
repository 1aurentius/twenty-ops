import { beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerMemberCommands } from '../../src/commands/member.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote } from '../helpers/integration-setup.js';

const runMember = (...args: string[]) =>
  runCli(registerMemberCommands, ['--remote', REMOTE, 'member', ...args]);

describe.skipIf(!INTEGRATION)('member integration', () => {
  beforeAll(assertLocalRemote);

  it('lists the seeded workspace member', async () => {
    const { stdout } = await runMember('list', '--json');
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { userEmail: string });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.userEmail).toBe('cli-test@twenty-ops.local');
  });

  it('fetches the seeded member by email + by id', async () => {
    const byEmail = await runMember('get', 'cli-test@twenty-ops.local', '--json');
    const member = JSON.parse(byEmail.stdout.trim()) as { id: string };
    expect(member.id).toMatch(/^[0-9a-f-]{36}$/);

    const byId = await runMember('get', member.id, '--json');
    expect((JSON.parse(byId.stdout.trim()) as { id: string }).id).toBe(member.id);
  });

  it('updates settings and round-trips the change', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'member-int-'));
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ locale: 'fi' }));

    await runMember('set-settings', 'cli-test@twenty-ops.local', '--file', file);

    const reread = await runMember('get', 'cli-test@twenty-ops.local', '--json');
    expect((JSON.parse(reread.stdout.trim()) as { locale: string }).locale).toBe('fi');

    // restore
    writeFileSync(file, JSON.stringify({ locale: 'en' }));
    await runMember('set-settings', 'cli-test@twenty-ops.local', '--file', file);
  });

  it('remove without --force exits USAGE', async () => {
    const err = await runMember('remove', 'cli-test@twenty-ops.local').catch((e: unknown) => e) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.USAGE);
  });

  it('NOT_FOUND for an unknown member email', async () => {
    const err = await runMember('get', 'no-such-member@example.com').catch((e: unknown) => e) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.NOT_FOUND);
  });
});
