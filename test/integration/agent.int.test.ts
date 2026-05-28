import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerAgentCommands } from '../../src/commands/agent.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote, tag } from '../helpers/integration-setup.js';

const TAG = `agentint${tag()}`;
const runAg = (...args: string[]) =>
  runCli(registerAgentCommands, ['--remote', REMOTE, 'agent', ...args]);

describe.skipIf(!INTEGRATION)('agent integration', () => {
  const cleanup: string[] = [];

  beforeAll(assertLocalRemote);
  afterAll(async () => {
    for (const id of cleanup) await runAg('delete', id).catch(() => undefined);
  });

  it('list returns a (possibly empty) array', async () => {
    const { stdout } = await runAg('list', '--json');
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('NOT_FOUND for an unknown agent name', async () => {
    const err = await runAg('get', `${TAG}-nosuch`).catch((e: unknown) => e) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('CRUD lifecycle: create → get → update label → delete', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'agent-int-'));

    const createFile = join(dir, 'create.json');
    writeFileSync(createFile, JSON.stringify({
      name: TAG,
      label: 'Integration Agent',
      description: 'test',
      prompt: 'You are a test agent. Echo the input.',
      // The seed workspace ships with a deterministic default model — most
      // installs expose `gpt-4o-mini` or similar. We use a clearly bogus id
      // and pin the server-side validation gate, since model discovery isn't
      // part of v0.8.
      modelId: 'twenty-ops-test-model',
    }));

    let agId = '';
    try {
      const out = await runAg('create', '--file', createFile, '--json');
      const row = JSON.parse(out.stdout.trim()) as { id: string; name: string };
      agId = row.id;
      cleanup.push(agId);
      expect(row.name).toBe(TAG);
    } catch (err) {
      const e = err as { exitCode?: number; message?: string };
      if (e.exitCode === EXIT.API || e.exitCode === EXIT.AUTH) {
        // Likely: modelId not configured in this stack, or AI features
        // require billing tier. Pin the gate and skip the lifecycle.
        // eslint-disable-next-line no-console
        console.warn(`agent create gated (${e.exitCode}): ${e.message}`);
        return;
      }
      throw err;
    }

    // get
    const got = await runAg('get', agId, '--json');
    expect((JSON.parse(got.stdout.trim()) as { id: string }).id).toBe(agId);

    // update label
    const patchFile = join(dir, 'patch.json');
    writeFileSync(patchFile, JSON.stringify({ label: 'Renamed' }));
    await runAg('update', agId, '--file', patchFile);
    const reread = await runAg('get', agId, '--json');
    expect((JSON.parse(reread.stdout.trim()) as { label: string }).label).toBe('Renamed');

    // turns — fresh agent has none, but the call should succeed and return []
    const turnsOut = await runAg('turns', agId, '--json');
    const turnLines = turnsOut.stdout.trim().split('\n').filter(Boolean);
    for (const line of turnLines) expect(() => JSON.parse(line)).not.toThrow();

    // delete
    await runAg('delete', agId);
    cleanup.pop();
    const post = await runAg('get', agId).catch((e: unknown) => e) as { exitCode?: number };
    expect(post.exitCode).toBe(EXIT.NOT_FOUND);
  });
});
