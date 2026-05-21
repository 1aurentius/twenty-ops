import { beforeAll, describe, expect, it } from 'vitest';

import { registerWhoamiCommand } from '../../src/commands/whoami.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote } from '../helpers/integration-setup.js';

describe.skipIf(!INTEGRATION)('whoami integration', () => {
  beforeAll(assertLocalRemote);

  it('returns the seeded workspace', async () => {
    const { stdout } = await runCli(registerWhoamiCommand, ['--remote', REMOTE, 'whoami', '--json']);
    const parsed = JSON.parse(stdout.trim()) as {
      remote: string;
      workspace: string;
      activationStatus: string;
      workspaceId: string;
    };
    expect(parsed.remote).toBe(REMOTE);
    expect(parsed.workspace).toBe('twenty-ops-test');
    expect(parsed.activationStatus).toBe('ACTIVE');
    expect(parsed.workspaceId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
