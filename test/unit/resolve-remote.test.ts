import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { HOME } = vi.hoisted(() => ({ HOME: { current: '' } }));
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => HOME.current };
});

import { CliError, EXIT } from '../../src/api/errors.js';
import { resolveRemote } from '../../src/config/resolve-remote.js';

function writeConfig(config: object): void {
  mkdirSync(join(HOME.current, '.twenty'), { recursive: true });
  writeFileSync(join(HOME.current, '.twenty', 'config.json'), JSON.stringify(config));
}

const ENV_KEYS = ['TWENTY_API_URL', 'TWENTY_API_KEY', 'TWENTY_REMOTE'] as const;
let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-rs-'));
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('resolveRemote precedence', () => {
  it('TWENTY_API_URL + TWENTY_API_KEY env vars beat every other source', () => {
    writeConfig({
      remotes: { local: { apiUrl: 'http://config', apiKey: 'config-key' } },
      defaultRemote: 'local',
    });
    process.env.TWENTY_API_URL = 'http://env';
    process.env.TWENTY_API_KEY = 'env-key';

    expect(resolveRemote('local')).toEqual({ name: 'env', apiUrl: 'http://env', apiKey: 'env-key' });
  });

  it('--remote flag beats TWENTY_REMOTE beats defaultRemote', () => {
    writeConfig({
      remotes: {
        a: { apiUrl: 'http://a', apiKey: 'ka' },
        b: { apiUrl: 'http://b', apiKey: 'kb' },
        c: { apiUrl: 'http://c', apiKey: 'kc' },
      },
      defaultRemote: 'c',
    });

    expect(resolveRemote('a')).toMatchObject({ name: 'a', apiUrl: 'http://a' });

    process.env.TWENTY_REMOTE = 'b';
    expect(resolveRemote('a')).toMatchObject({ name: 'a' });
    expect(resolveRemote()).toMatchObject({ name: 'b' });

    delete process.env.TWENTY_REMOTE;
    expect(resolveRemote()).toMatchObject({ name: 'c' });
  });

  it('falls back to twentyCLIAccessToken when apiKey is missing', () => {
    writeConfig({
      remotes: { sdk: { apiUrl: 'http://sdk', twentyCLIAccessToken: 'cli-token' } },
      defaultRemote: 'sdk',
    });
    expect(resolveRemote()).toEqual({ name: 'sdk', apiUrl: 'http://sdk', apiKey: 'cli-token' });
  });

  it('throws USAGE error when no remote configured at all', () => {
    let caught: CliError | undefined;
    try { resolveRemote(); } catch (e) { caught = e as CliError; }
    expect(caught).toBeInstanceOf(CliError);
    expect(caught?.exitCode).toBe(EXIT.USAGE);
  });

  it('throws AUTH error when the selected remote has neither apiKey nor twentyCLIAccessToken', () => {
    writeConfig({
      remotes: { broken: { apiUrl: 'http://broken' } },
      defaultRemote: 'broken',
    });
    let caught: CliError | undefined;
    try { resolveRemote(); } catch (e) { caught = e as CliError; }
    expect(caught).toBeInstanceOf(CliError);
    expect(caught?.exitCode).toBe(EXIT.AUTH);
  });

  it('throws NOT_FOUND when --remote names an unknown remote', () => {
    writeConfig({ remotes: { a: { apiUrl: 'http://a', apiKey: 'ka' } }, defaultRemote: 'a' });
    let caught: CliError | undefined;
    try { resolveRemote('missing'); } catch (e) { caught = e as CliError; }
    expect(caught).toBeInstanceOf(CliError);
    expect(caught?.exitCode).toBe(EXIT.NOT_FOUND);
  });
});
