import { beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerDomainCommands } from '../../src/commands/domain.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote } from '../helpers/integration-setup.js';

const runDom = (...args: string[]) =>
  runCli(registerDomainCommands, ['--remote', REMOTE, 'domain', ...args]);

describe.skipIf(!INTEGRATION)('domain integration', () => {
  beforeAll(assertLocalRemote);

  it('approved list returns a (possibly empty) array', async () => {
    const { stdout } = await runDom('approved', 'list', '--json');
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('public list returns a (possibly empty) array', async () => {
    const { stdout } = await runDom('public', 'list', '--json');
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('emailing list returns a (possibly empty) array', async () => {
    const { stdout } = await runDom('emailing', 'list', '--json');
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('custom check returns either records or NOT_FOUND', async () => {
    const result = await runDom('custom', 'check', '--json').catch((e: unknown) => e);
    if ('exitCode' in (result as object)) {
      expect((result as { exitCode: number }).exitCode).toBe(EXIT.NOT_FOUND);
    } else {
      const out = JSON.parse((result as { stdout: string }).stdout.trim()) as { domain: string };
      expect(typeof out.domain).toBe('string');
    }
  });
});
