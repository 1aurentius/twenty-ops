import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { HOME } = vi.hoisted(() => ({ HOME: { current: '' } }));
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => HOME.current };
});

import { CliError } from '../../src/api/errors.js';
import {
  configPath,
  getDefaultRemoteName,
  getRemote,
  listRemotes,
  readConfig,
  removeRemote,
  setDefaultRemote,
  upsertRemote,
} from '../../src/config/remote-config.js';

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-cfg-'));
});

afterEach(() => {
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('remote-config', () => {
  it('returns empty state when config file does not exist', () => {
    expect(listRemotes()).toEqual([]);
    expect(getDefaultRemoteName()).toBeUndefined();
  });

  it('upserts a remote, lists it, and marks the first one as the default', () => {
    upsertRemote('local', 'http://localhost:3001', 'key1');

    expect(listRemotes()).toEqual([
      { name: 'local', apiUrl: 'http://localhost:3001', hasKey: true, isDefault: true },
    ]);
    expect(getRemote('local')).toMatchObject({ apiUrl: 'http://localhost:3001', apiKey: 'key1' });
    expect(getDefaultRemoteName()).toBe('local');
  });

  it('preserves twenty-sdk-only keys at both top-level and per-remote', () => {
    mkdirSync(join(HOME.current, '.twenty'), { recursive: true });
    writeFileSync(configPath(), JSON.stringify({
      version: 1,
      remotes: {
        local: {
          apiUrl: 'http://old',
          apiKey: 'old',
          twentyCLIAccessToken: 'cli',
          sdkOnly: 'keep',
        },
      },
      defaultRemote: 'local',
      unknownTopLevel: 'keep-too',
    }));

    upsertRemote('local', 'http://new', 'new-key');

    const saved = JSON.parse(readFileSync(configPath(), 'utf8'));
    expect(saved.remotes.local).toEqual({
      apiUrl: 'http://new',
      apiKey: 'new-key',
      twentyCLIAccessToken: 'cli',
      sdkOnly: 'keep',
    });
    expect(saved.unknownTopLevel).toBe('keep-too');
  });

  it('falls back to another remote as the default when the current default is removed', () => {
    upsertRemote('a', 'http://a', 'ka');
    upsertRemote('b', 'http://b', 'kb');
    setDefaultRemote('a');

    removeRemote('a');

    expect(getDefaultRemoteName()).toBe('b');
    expect(() => getRemote('a')).toThrow(CliError);
  });

  it('clears defaultRemote when the last remote is removed', () => {
    upsertRemote('only', 'http://only', 'k');
    removeRemote('only');
    expect(getDefaultRemoteName()).toBeUndefined();
  });

  it('throws CliError on unknown remote name', () => {
    expect(() => getRemote('missing')).toThrow(/not found/);
    expect(() => setDefaultRemote('missing')).toThrow(/not found/);
    expect(() => removeRemote('missing')).toThrow(/not found/);
  });

  it('throws CliError on malformed JSON', () => {
    mkdirSync(join(HOME.current, '.twenty'), { recursive: true });
    writeFileSync(configPath(), '{{not json');
    expect(() => readConfig()).toThrow(CliError);
  });
});
