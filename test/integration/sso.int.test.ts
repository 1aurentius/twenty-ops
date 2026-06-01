import { beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerSsoCommands } from '../../src/commands/sso.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote } from '../helpers/integration-setup.js';

const runSso = (...args: string[]) =>
  runCli(registerSsoCommands, ['--remote', REMOTE, 'sso', ...args]);

/**
 * `getSSOIdentityProviders` returns exit 5 against the seeded API key with
 * a quirky internal error ("Cannot read properties of undefined (reading
 * 'headers')") instead of a clean AUTH gate. Pin the failure mode so we
 * notice when Twenty's server-side handling stabilizes.
 */
describe.skipIf(!INTEGRATION)('sso integration', () => {
  beforeAll(assertLocalRemote);

  it('list is server-gated for the seeded API key actor', async () => {
    const err = await runSso('list').catch((e: unknown) => e) as { exitCode?: number; message?: string };
    // Accept either AUTH (user-context expected) or API (the server-side
    // bug observed on the pinned image) — both indicate a working CLI wire
    // shape that the server itself can't satisfy with an API key.
    expect([EXIT.AUTH, EXIT.API]).toContain(err.exitCode);
  });
});
