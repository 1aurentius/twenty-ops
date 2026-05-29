import { beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerCalendarChannelCommands } from '../../src/commands/calendar-channel.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote } from '../helpers/integration-setup.js';

const runCc = (...args: string[]) =>
  runCli(registerCalendarChannelCommands, ['--remote', REMOTE, 'calendar-channel', ...args]);

describe.skipIf(!INTEGRATION)('calendar-channel integration', () => {
  beforeAll(assertLocalRemote);

  it('list returns a (possibly empty) array', async () => {
    const { stdout } = await runCc('list', '--json');
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('NOT_FOUND for an unknown id', async () => {
    const err = await runCc('get', '00000000-0000-4000-8000-000000000000').catch(
      (e: unknown) => e,
    ) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.NOT_FOUND);
  });
});
