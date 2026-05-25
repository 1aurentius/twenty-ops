import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerWebhookCommands } from '../../src/commands/webhook.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote, tag } from '../helpers/integration-setup.js';

const TAG = `whi${tag()}`;
const runWh = (...args: string[]) =>
  runCli(registerWebhookCommands, ['--remote', REMOTE, 'webhook', ...args]);

describe.skipIf(!INTEGRATION)('webhook integration', () => {
  const cleanup: string[] = [];

  beforeAll(assertLocalRemote);
  afterAll(async () => {
    for (const id of cleanup) await runWh('delete', id).catch(() => undefined);
  });

  it('full CRUD: create → get → update → delete', async () => {
    const created = await runWh(
      'create',
      '--target-url', `https://example.com/${TAG}`,
      '--operations', '*.created',
      '--description', 'integration test',
      '--json',
    );
    const w = JSON.parse(created.stdout.trim()) as { id: string; targetUrl: string; operations: string[] };
    cleanup.push(w.id);
    expect(w.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(w.targetUrl).toBe(`https://example.com/${TAG}`);
    expect(w.operations).toContain('*.created');

    const got = await runWh('get', w.id, '--json');
    expect((JSON.parse(got.stdout.trim()) as { id: string }).id).toBe(w.id);

    await runWh('update', w.id, '--description', 'updated');
    const reread = await runWh('get', w.id, '--json');
    expect((JSON.parse(reread.stdout.trim()) as { description: string }).description).toBe('updated');

    await runWh('delete', w.id);
    cleanup.pop();

    const err = await runWh('get', w.id).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('NOT_FOUND for a bogus webhook id', async () => {
    const err = await runWh('get', '00000000-0000-4000-8000-000000000000').catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });
});
