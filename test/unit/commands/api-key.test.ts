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
import { registerApiKeyCommands } from '../../../src/commands/api-key.js';
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

function scriptRolesQuery(stub: FetchStub): void {
  stub.reply('/metadata', {
    data: {
      getRoles: [
        { id: 'role-admin', label: 'Admin', canBeAssignedToApiKeys: true },
        { id: 'role-member', label: 'Member', canBeAssignedToApiKeys: false },
      ],
    },
  });
}

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-apikey-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('api-key list', () => {
  it('filters out revoked keys by default', async () => {
    fetchStub.reply('/metadata', {
      data: {
        apiKeys: [
          { id: 'k1', name: 'alpha', expiresAt: '2099-01-01T00:00:00Z', revokedAt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', role: { id: 'r1', label: 'Admin' } },
          { id: 'k2', name: 'beta', expiresAt: '2099-01-01T00:00:00Z', revokedAt: '2026-01-02T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', role: { id: 'r1', label: 'Admin' } },
        ],
      },
    });
    const { stdout } = await runCli(registerApiKeyCommands, ['api-key', 'list', '--json']);
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { name: string });
    expect(rows.map((r) => r.name)).toEqual(['alpha']);
  });

  it('--include-revoked shows everything', async () => {
    fetchStub.reply('/metadata', {
      data: {
        apiKeys: [
          { id: 'k1', name: 'alpha', expiresAt: '2099-01-01T00:00:00Z', revokedAt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', role: { id: 'r1', label: 'Admin' } },
          { id: 'k2', name: 'beta', expiresAt: '2099-01-01T00:00:00Z', revokedAt: '2026-01-02T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', role: { id: 'r1', label: 'Admin' } },
        ],
      },
    });
    const { stdout } = await runCli(registerApiKeyCommands, ['api-key', 'list', '--include-revoked', '--json']);
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { name: string });
    expect(rows.map((r) => r.name).sort()).toEqual(['alpha', 'beta']);
  });
});

describe('api-key get', () => {
  it('queries apiKey(input: { id }) and emits all fields under --json', async () => {
    fetchStub.reply('/metadata', {
      data: {
        apiKey: {
          id: 'k1',
          name: 'demo',
          expiresAt: '2099-01-01T00:00:00Z',
          revokedAt: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          role: { id: 'r1', label: 'Admin' },
        },
      },
    });
    const { stdout } = await runCli(registerApiKeyCommands, ['api-key', 'get', 'k1', '--json']);
    const got = JSON.parse(stdout.trim());
    expect(got).toMatchObject({ id: 'k1', name: 'demo', role: { id: 'r1', label: 'Admin' } });

    const call = fetchStub.calls[0]!;
    expect((call.body as { variables: { input: { id: string } } }).variables.input.id).toBe('k1');
  });

  it('returns NOT_FOUND with the id when the query returns null', async () => {
    fetchStub.reply('/metadata', { data: { apiKey: null } });
    const err = await runCli(registerApiKeyCommands, ['api-key', 'get', 'k-nope']).catch((e: unknown) => e);
    expect((err as { exitCode?: number; message?: string }).exitCode).toBe(EXIT.NOT_FOUND);
    expect((err as { message: string }).message).toContain('k-nope');
  });
});

describe('api-key create', () => {
  it('picks an assignable role by default, creates the key, generates the token, and surfaces both', async () => {
    scriptRolesQuery(fetchStub);
    fetchStub.reply('/metadata', {
      data: {
        createApiKey: {
          id: 'k-new', name: 'demo',
          expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: null,
          createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          role: { id: 'role-admin', label: 'Admin' },
        },
      },
    });
    fetchStub.reply('/metadata', { data: { generateApiKeyToken: { token: 'tok-secret' } } });

    const { stdout } = await runCli(registerApiKeyCommands, ['api-key', 'create', '--name', 'demo']);
    expect(stdout).toContain('token=tok-secret');
    expect(stdout).toContain('id=k-new');

    const create = fetchStub.calls.find((c) =>
      (c.body as { query?: string } | undefined)?.query?.includes('createApiKey'),
    );
    const v = (create!.body as { variables: { input: { name: string; expiresAt: string; roleId: string } } }).variables;
    expect(v.input.name).toBe('demo');
    expect(v.input.roleId).toBe('role-admin');
    expect(typeof v.input.expiresAt).toBe('string');
  });

  it('--json bundles token + apiKey in a single object', async () => {
    scriptRolesQuery(fetchStub);
    fetchStub.reply('/metadata', {
      data: {
        createApiKey: {
          id: 'k-new', name: 'demo',
          expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: null,
          createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          role: { id: 'role-admin', label: 'Admin' },
        },
      },
    });
    fetchStub.reply('/metadata', { data: { generateApiKeyToken: { token: 'tok-secret' } } });

    const { stdout } = await runCli(registerApiKeyCommands, ['api-key', 'create', '--name', 'demo', '--json']);
    const parsed = JSON.parse(stdout.trim()) as { token: string; apiKey: { id: string } };
    expect(parsed.token).toBe('tok-secret');
    expect(parsed.apiKey.id).toBe('k-new');
  });

  it('--role resolves a label to its role id', async () => {
    scriptRolesQuery(fetchStub);
    fetchStub.reply('/metadata', {
      data: {
        createApiKey: {
          id: 'k-x', name: 'demo',
          expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: null,
          createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          role: { id: 'role-member', label: 'Member' },
        },
      },
    });
    fetchStub.reply('/metadata', { data: { generateApiKeyToken: { token: 'tok' } } });

    await runCli(registerApiKeyCommands, ['api-key', 'create', '--name', 'demo', '--role', 'Member']);

    const create = fetchStub.calls.find((c) =>
      (c.body as { query?: string } | undefined)?.query?.includes('createApiKey'),
    );
    expect((create!.body as { variables: { input: { roleId: string } } }).variables.input.roleId).toBe('role-member');
  });

  it('NOT_FOUND when --role does not match any role', async () => {
    scriptRolesQuery(fetchStub);
    const err = await runCli(registerApiKeyCommands, ['api-key', 'create', '--name', 'demo', '--role', 'Nope']).catch((e: unknown) => e);
    expect((err as { exitCode?: number; message?: string }).exitCode).toBe(EXIT.NOT_FOUND);
    expect((err as { message: string }).message).toContain('Nope');
  });
});

describe('api-key revoke', () => {
  it('issues revokeApiKey(input: { id })', async () => {
    fetchStub.reply('/metadata', { data: { revokeApiKey: { id: 'k1' } } });
    const { stdout } = await runCli(registerApiKeyCommands, ['api-key', 'revoke', 'k1']);
    expect(stdout).toContain('revoked api-key k1');

    const call = fetchStub.calls[0]!;
    expect((call.body as { variables: { input: { id: string } } }).variables.input.id).toBe('k1');
  });
});

describe('api-key rotate', () => {
  it('fetches existing expiresAt, generates new token, surfaces it', async () => {
    fetchStub.reply('/metadata', {
      data: {
        apiKey: {
          id: 'k1', name: 'demo',
          expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: null,
          createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          role: { id: 'r1', label: 'Admin' },
        },
      },
    });
    fetchStub.reply('/metadata', { data: { generateApiKeyToken: { token: 'tok-fresh' } } });

    const { stdout } = await runCli(registerApiKeyCommands, ['api-key', 'rotate', 'k1']);
    expect(stdout).toContain('token=tok-fresh');

    const gen = fetchStub.calls.find((c) =>
      (c.body as { query?: string } | undefined)?.query?.includes('generateApiKeyToken'),
    );
    const v = (gen!.body as { variables: { id: string; e: string } }).variables;
    expect(v.id).toBe('k1');
    expect(v.e).toBe('2099-01-01T00:00:00.000Z');
  });

  it('NOT_FOUND when the key does not exist', async () => {
    fetchStub.reply('/metadata', { data: { apiKey: null } });
    const err = await runCli(registerApiKeyCommands, ['api-key', 'rotate', 'k-nope']).catch((e: unknown) => e);
    expect((err as { exitCode?: number; message?: string }).exitCode).toBe(EXIT.NOT_FOUND);
    expect((err as { message: string }).message).toContain('k-nope');
  });
});
