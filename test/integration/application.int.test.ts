import { beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerApplicationCommands } from '../../src/commands/application.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote } from '../helpers/integration-setup.js';

const runApp = (...args: string[]) =>
  runCli(registerApplicationCommands, ['--remote', REMOTE, 'application', ...args]);

describe.skipIf(!INTEGRATION)('application integration', () => {
  beforeAll(assertLocalRemote);

  it('list returns an array', async () => {
    const { stdout } = await runApp('list', '--json');
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('NOT_FOUND for an unknown id', async () => {
    const err = await runApp('get', '--id', '00000000-0000-4000-8000-000000000000').catch(
      (e: unknown) => e,
    ) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('USAGE when neither --id nor --identifier passed', async () => {
    const err = await runApp('get').catch((e: unknown) => e) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.USAGE);
  });
});
