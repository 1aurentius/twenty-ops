import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerApiKeyCommands } from '../../src/commands/api-key.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote, tag } from '../helpers/integration-setup.js';

const TAG = `aki${tag()}`;
const runAk = (...args: string[]) =>
  runCli(registerApiKeyCommands, ['--remote', REMOTE, 'api-key', ...args]);

describe.skipIf(!INTEGRATION)('api-key integration', () => {
  const cleanup: string[] = [];

  beforeAll(assertLocalRemote);
  afterAll(async () => {
    for (const id of cleanup) await runAk('revoke', id).catch(() => undefined);
  });

  it('creates → lists → rotates → revokes a key', async () => {
    const created = await runAk('create', '--name', TAG, '--json');
    const payload = JSON.parse(created.stdout.trim()) as { token: string; apiKey: { id: string; name: string } };
    cleanup.push(payload.apiKey.id);
    expect(payload.token).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(payload.apiKey.name).toBe(TAG);

    const list = await runAk('list', '--json');
    const rows = list.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { id: string });
    expect(rows.some((r) => r.id === payload.apiKey.id)).toBe(true);

    const got = await runAk('get', payload.apiKey.id, '--json');
    expect((JSON.parse(got.stdout.trim()) as { id: string }).id).toBe(payload.apiKey.id);

    const rotated = await runAk('rotate', payload.apiKey.id, '--json');
    const rotPayload = JSON.parse(rotated.stdout.trim()) as { token: string };
    expect(rotPayload.token).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(rotPayload.token).not.toBe(payload.token);

    await runAk('revoke', payload.apiKey.id);
    cleanup.pop();

    // After revoke, the key should still be queryable, but listed only with --include-revoked
    const reread = await runAk('get', payload.apiKey.id, '--json');
    expect((JSON.parse(reread.stdout.trim()) as { revokedAt: string | null }).revokedAt).not.toBeNull();
  });

  it('returns NOT_FOUND for a bogus key id', async () => {
    const err = await runAk('get', '00000000-0000-4000-8000-000000000000').catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });
});
