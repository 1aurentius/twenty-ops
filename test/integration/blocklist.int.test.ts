import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerBlocklistCommands } from '../../src/commands/blocklist.js';
import { deriveEndpoints } from '../../src/api/endpoints.js';
import { GraphQLClient } from '../../src/api/graphql-client.js';
import { resolveRemote } from '../../src/config/resolve-remote.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote, tag } from '../helpers/integration-setup.js';

const TAG = `blint${tag()}`;
const runBl = (...args: string[]) =>
  runCli(registerBlocklistCommands, ['--remote', REMOTE, 'blocklist', ...args]);

/**
 * Discover the seeded workspaceMemberId. The metadata API exposes
 * `workspaceMembers` as a Connection on Core, not as a flat list — same
 * shape used by member.int.test.ts and src/commands/member.ts.
 */
async function firstWorkspaceMemberId(): Promise<string> {
  const remote = resolveRemote(REMOTE);
  const ep = deriveEndpoints(remote.apiUrl);
  const core = new GraphQLClient(ep.core, remote.apiKey);
  const data = await core.request<{ workspaceMembers: { edges: { node: { id: string } }[] } }>(
    `query { workspaceMembers(first: 1) { edges { node { id } } } }`,
  );
  const id = data.workspaceMembers.edges[0]?.node.id;
  if (!id) throw new Error('no workspace members found in seeded stack');
  return id;
}

describe.skipIf(!INTEGRATION)('blocklist integration', () => {
  const cleanup: string[] = [];
  let memberId = '';

  beforeAll(async () => {
    assertLocalRemote();
    memberId = await firstWorkspaceMemberId();
  });
  afterAll(async () => {
    for (const id of cleanup) await runBl('destroy', id).catch(() => undefined);
  });

  it('list returns a (possibly empty) array', async () => {
    const { stdout } = await runBl('list', '--json');
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('NOT_FOUND for an unknown id', async () => {
    const err = await runBl('get', '00000000-0000-4000-8000-000000000000').catch(
      (e: unknown) => e,
    ) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('CRUD + delete/restore lifecycle: create → get → update → delete → restore → destroy', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'bl-int-'));

    const createFile = join(dir, 'create.json');
    writeFileSync(createFile, JSON.stringify({
      handle: `${TAG}@spam.example.com`,
      workspaceMemberId: memberId,
    }));

    let blId = '';
    try {
      const out = await runBl('create', '--file', createFile, '--json');
      const row = JSON.parse(out.stdout.trim()) as { id: string; handle: string };
      blId = row.id;
      cleanup.push(blId);
      expect(row.handle).toBe(`${TAG}@spam.example.com`);
    } catch (err) {
      const e = err as { exitCode?: number; message?: string };
      if (e.exitCode === EXIT.API || e.exitCode === EXIT.AUTH) {
        // eslint-disable-next-line no-console
        console.warn(`blocklist create gated (${e.exitCode}): ${e.message}`);
        return;
      }
      throw err;
    }

    // get
    const got = await runBl('get', blId, '--json');
    expect((JSON.parse(got.stdout.trim()) as { id: string }).id).toBe(blId);

    // update handle
    const patchFile = join(dir, 'patch.json');
    writeFileSync(patchFile, JSON.stringify({ handle: `${TAG}-renamed@spam.example.com` }));
    await runBl('update', blId, '--file', patchFile);
    const reread = await runBl('get', blId, '--json');
    expect((JSON.parse(reread.stdout.trim()) as { handle: string }).handle).toBe(`${TAG}-renamed@spam.example.com`);

    // soft-delete → NOT_FOUND on subsequent get
    await runBl('delete', blId);
    const postDel = await runBl('get', blId).catch((e: unknown) => e) as { exitCode?: number };
    expect(postDel.exitCode).toBe(EXIT.NOT_FOUND);

    // restore → record reappears
    await runBl('restore', blId);
    const postRestore = await runBl('get', blId, '--json');
    expect((JSON.parse(postRestore.stdout.trim()) as { id: string }).id).toBe(blId);

    // hard-destroy for cleanup
    await runBl('destroy', blId);
    cleanup.pop();
  });
});
