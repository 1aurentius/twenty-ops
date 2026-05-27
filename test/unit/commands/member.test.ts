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
import { registerMemberCommands } from '../../../src/commands/member.js';
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

const MEMBER = {
  id: 'a29a67a4-4ed2-46e7-8c59-604cb9ad189a',
  userEmail: 'admin@example.com',
  name: { firstName: 'Admin', lastName: 'User' },
  locale: 'en',
  colorScheme: 'Light',
  timeZone: null,
  dateFormat: null,
  timeFormat: null,
  calendarStartDay: null,
  numberFormat: null,
  roles: [{ id: 'role-admin', label: 'Admin' }],
};

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-member-'));
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

describe('member list', () => {
  it('hits the CORE endpoint (not metadata) and emits node rows', async () => {
    fetchStub.reply('/graphql', {
      data: { workspaceMembers: { edges: [{ node: MEMBER }] } },
    });
    const { stdout } = await runCli(registerMemberCommands, ['member', 'list', '--json']);
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { id: string; userEmail: string });
    expect(rows[0]?.id).toBe(MEMBER.id);
    expect(rows[0]?.userEmail).toBe(MEMBER.userEmail);

    const call = fetchStub.calls[0]!;
    expect(call.url).toBe('http://localhost:3001/graphql'); // not /metadata
  });
});

describe('member get', () => {
  it('resolves an email via workspaceMember(filter: { userEmail: { eq } })', async () => {
    fetchStub.reply('/graphql', { data: { workspaceMember: MEMBER } });
    const { stdout } = await runCli(registerMemberCommands, ['member', 'get', 'admin@example.com', '--json']);
    const got = JSON.parse(stdout.trim()) as { id: string; roles: { label: string }[] };
    expect(got.id).toBe(MEMBER.id);
    expect(got.roles[0]?.label).toBe('Admin');

    const call = fetchStub.calls[0]!;
    const v = (call.body as { variables: { filter: { userEmail: { eq: string } } } }).variables;
    expect(v.filter.userEmail.eq).toBe('admin@example.com');
  });

  it('resolves a UUID via filter.id.eq', async () => {
    fetchStub.reply('/graphql', { data: { workspaceMember: MEMBER } });
    await runCli(registerMemberCommands, ['member', 'get', MEMBER.id]);
    const v = (fetchStub.calls[0]!.body as { variables: { filter: { id: { eq: string } } } }).variables;
    expect(v.filter.id.eq).toBe(MEMBER.id);
  });

  it('NOT_FOUND with the email in the message', async () => {
    fetchStub.reply('/graphql', { data: { workspaceMember: null } });
    const err = await runCli(registerMemberCommands, ['member', 'get', 'noone@example.com']).catch((e: unknown) => e) as { exitCode?: number; message?: string };
    expect(err.exitCode).toBe(EXIT.NOT_FOUND);
    expect(err.message).toContain('noone@example.com');
  });
});

describe('member set-role', () => {
  it('resolves both member + role then calls updateWorkspaceMemberRole', async () => {
    // resolveRoleId fetches getRoles via metadata
    fetchStub.reply('/metadata', {
      data: {
        getRoles: [
          { id: 'role-admin', label: 'Admin', description: null, icon: null, canBeAssignedToUsers: true, canBeAssignedToApiKeys: true, isEditable: false },
        ],
      },
    });
    // resolveMemberId for email → CORE workspaceMember(filter)
    fetchStub.reply('/graphql', { data: { workspaceMember: MEMBER } });
    // The mutation itself
    fetchStub.reply('/metadata', { data: { updateWorkspaceMemberRole: { id: MEMBER.id } } });

    const { stdout } = await runCli(registerMemberCommands, [
      'member', 'set-role',
      '--member', 'admin@example.com',
      '--role', 'Admin',
    ]);
    expect(stdout).toContain(`assigned role role-admin to member ${MEMBER.id}`);

    const mutCall = fetchStub.calls.find((c) =>
      (c.body as { query?: string } | undefined)?.query?.includes('updateWorkspaceMemberRole'),
    );
    const v = (mutCall!.body as { variables: { workspaceMemberId: string; roleId: string } }).variables;
    expect(v.workspaceMemberId).toBe(MEMBER.id);
    expect(v.roleId).toBe('role-admin');
  });
});

describe('member set-settings', () => {
  it('wraps the file contents as { workspaceMemberId, update: JSON }', async () => {
    fetchStub.reply('/graphql', { data: { workspaceMember: MEMBER } });
    fetchStub.reply('/metadata', { data: { updateWorkspaceMemberSettings: true } });

    const file = writeFile('settings.json', { locale: 'fi', dateFormat: 'DAY_FIRST' });
    const { stdout } = await runCli(registerMemberCommands, [
      'member', 'set-settings', 'admin@example.com', '--file', file,
    ]);
    expect(stdout).toContain(`updated settings for member ${MEMBER.id}`);

    const mutCall = fetchStub.calls.find((c) =>
      (c.body as { query?: string } | undefined)?.query?.includes('updateWorkspaceMemberSettings'),
    );
    const v = (mutCall!.body as { variables: { input: { workspaceMemberId: string; update: Record<string, unknown> } } }).variables;
    expect(v.input.workspaceMemberId).toBe(MEMBER.id);
    expect(v.input.update).toEqual({ locale: 'fi', dateFormat: 'DAY_FIRST' });
  });

  it('USAGE error when file is an array', async () => {
    const file = writeFile('bad.json', [{ locale: 'fi' }]);
    const err = await runCli(registerMemberCommands, [
      'member', 'set-settings', 'admin@example.com', '--file', file,
    ]).catch((e: unknown) => e) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.USAGE);
  });
});

describe('member remove', () => {
  it('USAGE + stderr warning without --force', async () => {
    const err = await runCli(registerMemberCommands, ['member', 'remove', 'admin@example.com']).catch((e: unknown) => e) as { exitCode?: number; stderr?: string };
    expect(err.exitCode).toBe(EXIT.USAGE);
    expect(err.stderr ?? '').toContain('refusing to remove member');
    expect(err.stderr ?? '').toContain('--force');
  });

  it('calls deleteUserFromWorkspace with the resolved id as String! arg', async () => {
    fetchStub.reply('/graphql', { data: { workspaceMember: MEMBER } });
    fetchStub.reply('/metadata', { data: { deleteUserFromWorkspace: { id: MEMBER.id } } });

    const { stdout } = await runCli(registerMemberCommands, ['member', 'remove', 'admin@example.com', '--force']);
    expect(stdout).toContain(`removed member ${MEMBER.id}`);

    const delCall = fetchStub.calls.find((c) =>
      (c.body as { query?: string } | undefined)?.query?.includes('deleteUserFromWorkspace'),
    );
    const v = (delCall!.body as { variables: { id: string } }).variables;
    expect(v.id).toBe(MEMBER.id);
  });
});
