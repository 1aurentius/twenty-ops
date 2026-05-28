import { beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerChatCommands } from '../../src/commands/chat.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote, tag } from '../helpers/integration-setup.js';

const TAG = `chatint${tag()}`;
const runCh = (...args: string[]) =>
  runCli(registerChatCommands, ['--remote', REMOTE, 'chat', ...args]);

/**
 * The ENTIRE chat domain is user-context-scoped on Twenty's server — every
 * query and every mutation returns AUTH "This endpoint requires a user
 * context. API keys are not supported." with an API key actor. Verified live
 * during v0.8 Step 1 probes (writes) and during this Step 4 run (reads also
 * gated, contrary to the v0.5 pattern where invitation/settings reads worked).
 *
 * We pin every AUTH gate so a future stack that lifts any of them gets caught
 * by the failing test. The CLI wire shapes are tested hermetically in
 * test/unit/commands/chat.test.ts.
 */
describe.skipIf(!INTEGRATION)('chat integration (AUTH-gated for API keys)', () => {
  beforeAll(assertLocalRemote);

  it('list rejects API key actor with AUTH', async () => {
    const err = await runCh('list').catch((e: unknown) => e) as { exitCode?: number; message?: string };
    expect(err.exitCode).toBe(EXIT.AUTH);
    expect(err.message).toMatch(/user context/i);
  });

  it('get rejects API key actor with AUTH', async () => {
    const err = await runCh('get', '00000000-0000-4000-8000-000000000000').catch(
      (e: unknown) => e,
    ) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.AUTH);
  });

  it('create rejects API key actor with AUTH', async () => {
    const err = await runCh('create').catch((e: unknown) => e) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.AUTH);
  });

  it('rename rejects API key actor with AUTH', async () => {
    const err = await runCh('rename', '00000000-0000-4000-8000-000000000000', '--title', TAG)
      .catch((e: unknown) => e) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.AUTH);
  });

  it('archive rejects API key actor with AUTH', async () => {
    const err = await runCh('archive', '00000000-0000-4000-8000-000000000000').catch(
      (e: unknown) => e,
    ) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.AUTH);
  });

  it('delete rejects API key actor with AUTH', async () => {
    const err = await runCh('delete', '00000000-0000-4000-8000-000000000000').catch(
      (e: unknown) => e,
    ) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.AUTH);
  });

  it('messages rejects API key actor with AUTH', async () => {
    const err = await runCh('messages', '00000000-0000-4000-8000-000000000000').catch(
      (e: unknown) => e,
    ) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.AUTH);
  });
});
