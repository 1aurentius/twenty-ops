import { beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerInvitationCommands } from '../../src/commands/invitation.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote, tag } from '../helpers/integration-setup.js';

const TAG = `inv${tag()}`;
const runInv = (...args: string[]) =>
  runCli(registerInvitationCommands, ['--remote', REMOTE, 'invitation', ...args]);

/**
 * Live integration is partial — Twenty rejects API-key-driven
 * sendInvitations / resend / revoke as "Forbidden resource"; the underlying
 * mutations are user-actor scoped (invitations are issued by a person, not a
 * system token). The unit suite covers send/resend/revoke wire shapes; this
 * integration suite verifies the read path against the live stack and pins
 * the API-key authorization gate.
 */
describe.skipIf(!INTEGRATION)('invitation integration', () => {
  beforeAll(assertLocalRemote);

  it('lists pending invitations (likely empty against the seeded workspace)', async () => {
    const { stdout } = await runInv('list', '--json');
    const lines = stdout.trim().split('\n').filter(Boolean);
    // Any line that parses as JSON with an `id` field passes — count may be 0
    for (const l of lines) {
      const row = JSON.parse(l) as { id: string };
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('send via API key is rejected with AUTH exit code (user-actor scoped)', async () => {
    const err = await runInv(
      'send',
      '--emails', `${TAG}@invitation.test`,
    ).catch((e: unknown) => e) as { exitCode?: number; message?: string };
    expect(err.exitCode).toBe(EXIT.AUTH);
    expect(err.message ?? '').toMatch(/forbidden|unauthorized|not allowed/i);
  });
});
