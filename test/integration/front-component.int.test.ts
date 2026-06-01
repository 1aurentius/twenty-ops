import { beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerFrontComponentCommands } from '../../src/commands/front-component.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote } from '../helpers/integration-setup.js';

const runFc = (...args: string[]) =>
  runCli(registerFrontComponentCommands, ['--remote', REMOTE, 'front-component', ...args]);

describe.skipIf(!INTEGRATION)('front-component integration', () => {
  beforeAll(assertLocalRemote);

  it('list returns a (possibly empty) array', async () => {
    const { stdout } = await runFc('list', '--json');
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  // Live-verified: frontComponent(id) singular get returns AUTH "Forbidden
  // resource" for API key actors, while frontComponents() list path works
  // fine. Same surface-shape discoverable by an agent: list to find ids,
  // then probe the individual record via the UI (or user-token remote).
  it('singular get is AUTH-gated for the seeded API key actor', async () => {
    const err = await runFc('get', '00000000-0000-4000-8000-000000000000').catch(
      (e: unknown) => e,
    ) as { exitCode?: number };
    expect([EXIT.AUTH, EXIT.NOT_FOUND]).toContain(err.exitCode);
  });
});
