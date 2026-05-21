import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { HOME } = vi.hoisted(() => ({ HOME: { current: '' } }));
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => HOME.current };
});

import { EXIT } from '../../../src/api/errors.js';
import { registerWhoamiCommand } from '../../../src/commands/whoami.js';
import { runCli } from '../../helpers/cli-harness.js';
import { type FetchStub, stubFetch } from '../../helpers/graphql-mock.js';

function writeRemote(): void {
  mkdirSync(join(HOME.current, '.twenty'), { recursive: true });
  writeFileSync(
    join(HOME.current, '.twenty', 'config.json'),
    JSON.stringify({
      remotes: { test: { apiUrl: 'http://localhost:3001', apiKey: 'test-key' } },
      defaultRemote: 'test',
    }),
  );
}

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-whoami-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('whoami command', () => {
  it('queries the metadata endpoint and prints workspace info', async () => {
    fetchStub.reply('/metadata', {
      data: {
        currentWorkspace: { id: 'ws-1', displayName: 'Acme Co', activationStatus: 'ACTIVE' },
      },
    });

    const { stdout } = await runCli(registerWhoamiCommand, ['whoami']);

    expect(stdout).toContain('remote=test');
    expect(stdout).toContain('apiUrl=http://localhost:3001');
    expect(stdout).toContain('workspaceId=ws-1');
    expect(stdout).toContain('workspace=Acme Co');
    expect(stdout).toContain('activationStatus=ACTIVE');

    expect(fetchStub.calls).toHaveLength(1);
    const call = fetchStub.calls[0]!;
    expect(call.url).toBe('http://localhost:3001/metadata');
    expect(call.method).toBe('POST');
    expect(call.headers['authorization']).toBe('Bearer test-key');
    expect((call.body as { query: string }).query).toContain('currentWorkspace');
  });

  it('--json emits a single JSON object', async () => {
    fetchStub.reply('/metadata', {
      data: { currentWorkspace: { id: 'ws-1', displayName: 'Acme', activationStatus: 'ACTIVE' } },
    });

    const { stdout } = await runCli(registerWhoamiCommand, ['whoami', '--json']);

    expect(JSON.parse(stdout)).toEqual({
      remote: 'test',
      apiUrl: 'http://localhost:3001',
      workspaceId: 'ws-1',
      workspace: 'Acme',
      activationStatus: 'ACTIVE',
    });
  });

  it('maps GraphQL UNAUTHENTICATED to exit code 3 (AUTH)', async () => {
    fetchStub.reply('/metadata', {
      errors: [{ message: 'No payload', extensions: { code: 'UNAUTHENTICATED' } }],
    });

    const err = await runCli(registerWhoamiCommand, ['whoami']).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.AUTH);
  });

  it('--remote flag picks a specific remote', async () => {
    writeFileSync(
      join(HOME.current, '.twenty', 'config.json'),
      JSON.stringify({
        remotes: {
          test: { apiUrl: 'http://localhost:3001', apiKey: 'key-a' },
          other: { apiUrl: 'http://localhost:4002', apiKey: 'key-b' },
        },
        defaultRemote: 'test',
      }),
    );
    fetchStub.reply('/metadata', {
      data: { currentWorkspace: { id: 'ws-2', displayName: 'B', activationStatus: 'ACTIVE' } },
    });

    const { stdout } = await runCli(registerWhoamiCommand, ['--remote', 'other', 'whoami']);

    expect(stdout).toContain('remote=other');
    expect(fetchStub.calls[0]!.url).toBe('http://localhost:4002/metadata');
    expect(fetchStub.calls[0]!.headers['authorization']).toBe('Bearer key-b');
  });
});
