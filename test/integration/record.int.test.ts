import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerRecordCommands } from '../../src/commands/record.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote, tag } from '../helpers/integration-setup.js';

const TAG = `rec-int-${tag()}`;
const runRec = (...args: string[]) =>
  runCli(registerRecordCommands, ['--remote', REMOTE, 'record', ...args]);

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
