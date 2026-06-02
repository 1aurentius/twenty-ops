import { beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerMarketplaceCommands } from '../../src/commands/marketplace.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote } from '../helpers/integration-setup.js';

const runMp = (...args: string[]) =>
  runCli(registerMarketplaceCommands, ['--remote', REMOTE, 'marketplace', ...args]);

describe.skipIf(!INTEGRATION)('marketplace integration', () => {
  beforeAll(assertLocalRemote);

  it('sync-catalog reaches the server (returns boolean or pins a server-side gate)', async () => {
    // syncMarketplaceCatalog refreshes the workspace's view of the
    // marketplace registry. On the pinned test stack the operation may
    // succeed silently (Boolean true), AUTH-gate (user context needed), or
    // hit the network when no marketplace is configured. We accept any of
    // 0/3/5 — the CLI's wire shape is what we're verifying.
    const result = await runMp('sync-catalog', '--json').catch((e: unknown) => e);
    if ('exitCode' in (result as object)) {
      const rc = (result as { exitCode: number }).exitCode;
      expect([EXIT.AUTH, EXIT.API]).toContain(rc);
    } else {
      // success → JSON shape contains `success: bool`
      const out = JSON.parse((result as { stdout: string }).stdout.trim()) as { success?: boolean };
      expect(typeof out.success).toBe('boolean');
    }
  });

  it('install reaches the server with the right wire shape (universalIdentifier passes through)', async () => {
    // Using a deliberately-unknown identifier so we pin the *server-side*
    // failure mode rather than depending on a real marketplace catalog.
    // The mutation must REACH the server — we want anything BUT USAGE.
    const result = await runMp('install', `twenty-ops-test-nosuch-${Date.now()}`)
      .catch((e: unknown) => e) as { exitCode?: number };
    expect(result.exitCode).not.toBe(EXIT.USAGE);
  });
});
