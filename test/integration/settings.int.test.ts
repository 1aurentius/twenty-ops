import { beforeAll, describe, expect, it } from 'vitest';

import { registerSettingsCommands } from '../../src/commands/settings.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote } from '../helpers/integration-setup.js';

const runSet = (...args: string[]) =>
  runCli(registerSettingsCommands, ['--remote', REMOTE, 'settings', ...args]);

describe.skipIf(!INTEGRATION)('settings integration', () => {
  beforeAll(assertLocalRemote);

  it('emits currentWorkspace with the seeded display name + ACTIVE status', async () => {
    const { stdout } = await runSet('get', '--json');
    const got = JSON.parse(stdout.trim()) as {
      id: string;
      activationStatus: string;
      subdomain: string;
      metadataVersion: number;
    };
    expect(got.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(got.activationStatus).toBe('ACTIVE');
    expect(typeof got.subdomain).toBe('string');
    expect(typeof got.metadataVersion).toBe('number');
  });
});
