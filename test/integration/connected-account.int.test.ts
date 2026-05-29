import { beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerConnectedAccountCommands } from '../../src/commands/connected-account.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote } from '../helpers/integration-setup.js';

const runCa = (...args: string[]) =>
  runCli(registerConnectedAccountCommands, ['--remote', REMOTE, 'connected-account', ...args]);

describe.skipIf(!INTEGRATION)('connected-account integration', () => {
  beforeAll(assertLocalRemote);

  it('list returns a (possibly empty) array', async () => {
    const { stdout } = await runCa('list', '--json');
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('NOT_FOUND for an unknown account id', async () => {
    const err = await runCa('get', '00000000-0000-4000-8000-000000000000').catch(
      (e: unknown) => e,
    ) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.NOT_FOUND);
  });

  /**
   * `myConnectedAccounts` is metadata-side and verified user-context only:
   * the API key actor returns AUTH "user context required". Mirror the v0.5/
   * v0.8 pattern of pinning the gate so a future stack that lifts it trips
   * the test.
   */
  it('my rejects API key actor with AUTH (user context required)', async () => {
    const err = await runCa('my').catch((e: unknown) => e) as { exitCode?: number; message?: string };
    expect(err.exitCode).toBe(EXIT.AUTH);
    expect(err.message).toMatch(/user context/i);
  });
});
