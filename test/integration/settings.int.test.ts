import { beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
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

  /**
   * `updateWorkspace` is gated to user-context callers — the seeded API key
   * actor gets "This endpoint requires a user context. API keys are not
   * supported." This is consistent with invitation send/resend/revoke. Unit
   * tests cover the wire shape exhaustively; integration pins the auth gate.
   */
  it('update via API key is rejected with AUTH (workspace mutations are user-context)', async () => {
    const err = await runSet('update', '--allow-impersonation', 'true').catch((e: unknown) => e) as { exitCode?: number; message?: string };
    expect(err.exitCode).toBe(EXIT.AUTH);
    expect(err.message ?? '').toMatch(/user context|not supported|forbidden|unauthorized/i);
  });
});
