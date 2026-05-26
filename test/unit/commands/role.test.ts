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
import { registerRoleCommands } from '../../../src/commands/role.js';
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

const ROLES = [
  { id: '00000000-0000-4000-8000-000000000001', label: 'Admin', description: 'admin role', icon: 'IconCrown', canBeAssignedToUsers: true, canBeAssignedToApiKeys: true, isEditable: false },
  { id: '00000000-0000-4000-8000-000000000002', label: 'Member', description: null, icon: null, canBeAssignedToUsers: true, canBeAssignedToApiKeys: false, isEditable: true },
];

function scriptRolesList(stub: FetchStub): void {
  stub.reply('/metadata', { data: { getRoles: ROLES } });
}

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-role-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function writeFile(name: string, content: unknown): string {
  const path = join(HOME.current, name);
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
}

describe('role list', () => {
  it('emits all roles as JSON Lines under --json', async () => {
    scriptRolesList(fetchStub);
    const { stdout } = await runCli(registerRoleCommands, ['role', 'list', '--json']);
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { label: string });
    expect(rows.map((r) => r.label).sort()).toEqual(['Admin', 'Member']);
  });
});

describe('role get', () => {
  it('resolves a label and emits the matching role under --json', async () => {
    scriptRolesList(fetchStub);
    scriptRolesList(fetchStub); // resolveRoleId + post-resolve listRoles share a query, but the harness scripts per call
    const { stdout } = await runCli(registerRoleCommands, ['role', 'get', 'Member', '--json']);
    const got = JSON.parse(stdout.trim()) as { id: string; label: string; canBeAssignedToUsers: boolean };
    expect(got.id).toBe(ROLES[1]!.id);
    expect(got.label).toBe('Member');
    expect(got.canBeAssignedToUsers).toBe(true);
  });

  it('NOT_FOUND when the ref does not match any role', async () => {
    scriptRolesList(fetchStub);
    const err = await runCli(registerRoleCommands, ['role', 'get', 'NoSuchRole']).catch((e: unknown) => e);
    expect((err as { exitCode?: number; message?: string }).exitCode).toBe(EXIT.NOT_FOUND);
    expect((err as { message: string }).message).toContain('NoSuchRole');
  });
});

describe('role create', () => {
  it('POSTs createOneRole with `createRoleInput` arg (NOT the input wrapper)', async () => {
    fetchStub.reply('/metadata', {
      data: {
        createOneRole: {
          id: 'r-new', label: 'Engineering', description: null, icon: null,
          canBeAssignedToUsers: true, canBeAssignedToApiKeys: false, isEditable: true,
        },
      },
    });

    const file = writeFile('role.json', { label: 'Engineering', canBeAssignedToUsers: true });
    const { stdout } = await runCli(registerRoleCommands, ['role', 'create', '--file', file]);
    expect(stdout).toContain('created role r-new (Engineering)');

    const call = fetchStub.calls[0]!;
    const query = (call.body as { query: string }).query;
    expect(query).toContain('createOneRole(createRoleInput:');
    const v = (call.body as { variables: { input: Record<string, unknown> } }).variables;
    expect(v.input).toEqual({ label: 'Engineering', canBeAssignedToUsers: true });
  });

  it('USAGE error when input lacks `label`', async () => {
    const file = writeFile('bad.json', { description: 'no label' });
    const err = await runCli(registerRoleCommands, ['role', 'create', '--file', file]).catch((e: unknown) => e);
    expect((err as { exitCode?: number; message?: string }).exitCode).toBe(EXIT.USAGE);
    expect((err as { message: string }).message).toContain('label');
  });
});

describe('role update', () => {
  it('resolves ref, then PATCHes updateOneRole with {id, ...update}', async () => {
    scriptRolesList(fetchStub);
    fetchStub.reply('/metadata', {
      data: {
        updateOneRole: {
          id: ROLES[1]!.id, label: 'Member (renamed)', description: null, icon: null,
          canBeAssignedToUsers: true, canBeAssignedToApiKeys: false, isEditable: true,
        },
      },
    });

    const file = writeFile('patch.json', { label: 'Member (renamed)' });
    const { stdout } = await runCli(registerRoleCommands, ['role', 'update', 'Member', '--file', file]);
    expect(stdout).toContain(`updated role ${ROLES[1]!.id}`);

    const updateCall = fetchStub.calls.find((c) =>
      (c.body as { query?: string } | undefined)?.query?.includes('updateOneRole'),
    );
    const v = (updateCall!.body as { variables: { input: { id: string; update: { label: string } } } }).variables;
    expect(v.input.id).toBe(ROLES[1]!.id);
    expect(v.input.update).toEqual({ label: 'Member (renamed)' });
  });
});

describe('role delete', () => {
  it('USAGE error with stderr warning when --force is omitted', async () => {
    const err = await runCli(registerRoleCommands, ['role', 'delete', 'Member']).catch((e: unknown) => e) as { exitCode?: number; stderr?: string };
    expect(err.exitCode).toBe(EXIT.USAGE);
    expect(err.stderr ?? '').toContain('refusing to delete role');
    expect(err.stderr ?? '').toContain('--force');
  });

  it('resolves ref then issues deleteOneRole(roleId) with --force', async () => {
    scriptRolesList(fetchStub);
    fetchStub.reply('/metadata', { data: { deleteOneRole: { id: ROLES[1]!.id } } });

    const { stdout } = await runCli(registerRoleCommands, ['role', 'delete', 'Member', '--force']);
    expect(stdout).toContain(`deleted role ${ROLES[1]!.id}`);

    const delCall = fetchStub.calls.find((c) =>
      (c.body as { query?: string } | undefined)?.query?.includes('deleteOneRole'),
    );
    const v = (delCall!.body as { variables: { id: string } }).variables;
    expect(v.id).toBe(ROLES[1]!.id);
  });
});
