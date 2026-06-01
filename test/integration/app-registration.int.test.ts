import { beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerAppRegistrationCommands } from '../../src/commands/app-registration.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote } from '../helpers/integration-setup.js';

const runAr = (...args: string[]) =>
  runCli(registerAppRegistrationCommands, ['--remote', REMOTE, 'app-registration', ...args]);

describe.skipIf(!INTEGRATION)('app-registration integration', () => {
  beforeAll(assertLocalRemote);

  it('list returns an array', async () => {
    const { stdout } = await runAr('list', '--json');
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('NOT_FOUND for an unknown id', async () => {
    const err = await runAr('get', '00000000-0000-4000-8000-000000000000').catch(
      (e: unknown) => e,
    ) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('find-by-client-id NOT_FOUND on unknown clientId', async () => {
    const err = await runAr('find-by-client-id', 'no-such-client').catch(
      (e: unknown) => e,
    ) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.NOT_FOUND);
  });
});
