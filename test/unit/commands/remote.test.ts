import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { HOME } = vi.hoisted(() => ({ HOME: { current: '' } }));
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => HOME.current };
});

import { registerRemoteCommands } from '../../../src/commands/remote.js';
import { runCli } from '../../helpers/cli-harness.js';

const runRemote = (...args: string[]) => runCli(registerRemoteCommands, ['remote', ...args]);

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-cmd-'));
});

afterEach(() => {
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('remote commands', () => {
  it('add then list round-trips a remote', async () => {
    const add = await runRemote('add', 'foo', '--url', 'http://localhost:3001', '--key', 'k1');
    expect(add.stdout.trim()).toBe('remote "foo" saved');

    const list = await runRemote('list');
    const rows = list.stdout.trim().split('\n');
    expect(rows[0]).toContain('name');
    expect(rows[1]).toContain('foo');
    expect(rows[1]).toContain('http://localhost:3001');
    expect(rows[1]).toContain('true');
  });

  it('list under --json emits JSON Lines', async () => {
    await runRemote('add', 'foo', '--url', 'http://a', '--key', 'k');
    const list = await runRemote('list', '--json');
    const lines = list.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      name: 'foo',
      apiUrl: 'http://a',
      hasKey: true,
      default: true,
    });
  });

  it('use changes the default remote', async () => {
    await runRemote('add', 'a', '--url', 'http://a', '--key', 'ka');
    await runRemote('add', 'b', '--url', 'http://b', '--key', 'kb');

    const before = await runRemote('current');
    expect(before.stdout).toContain('name=a');

    await runRemote('use', 'b');

    const after = await runRemote('current');
    expect(after.stdout).toContain('name=b');
  });

  it('remove deletes a remote and a follow-up `current` falls back to the next one', async () => {
    await runRemote('add', 'a', '--url', 'http://a', '--key', 'ka');
    await runRemote('add', 'b', '--url', 'http://b', '--key', 'kb');
    await runRemote('use', 'a');

    await runRemote('remove', 'a');

    const list = await runRemote('list');
    expect(list.stdout).not.toContain(' a ');
    const current = await runRemote('current');
    expect(current.stdout).toContain('name=b');
  });

  it('current with a --remote flag prefers it over the default', async () => {
    await runRemote('add', 'a', '--url', 'http://a', '--key', 'ka');
    await runRemote('add', 'b', '--url', 'http://b', '--key', 'kb');
    await runRemote('use', 'a');

    const result = await runRemote('current', '--remote', 'b');
    expect(result.stdout).toContain('name=b');
  });

  it('quiet suppresses the success line on add', async () => {
    const add = await runRemote('add', 'foo', '--url', 'http://a', '--key', 'k', '--quiet');
    expect(add.stdout).toBe('');
  });

  it('remove rejects unknown remote names', async () => {
    await expect(runRemote('remove', 'never-existed')).rejects.toThrow(/not found/);
  });
});
