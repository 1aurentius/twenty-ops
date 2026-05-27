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
import { registerInvitationCommands } from '../../../src/commands/invitation.js';
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

const INVITATION = {
  id: '11111111-2222-4333-8444-555566667777',
  email: 'invitee@example.com',
  roleId: 'role-member',
  expiresAt: '2099-01-01T00:00:00Z',
};

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-inv-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('invitation list', () => {
  it('queries findWorkspaceInvitations and emits rows', async () => {
    fetchStub.reply('/metadata', { data: { findWorkspaceInvitations: [INVITATION] } });
    const { stdout } = await runCli(registerInvitationCommands, ['invitation', 'list', '--json']);
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { email: string });
    expect(rows[0]?.email).toBe(INVITATION.email);
  });
});

describe('invitation send', () => {
  it('parses --emails comma-list and sends with the resolved roleId', async () => {
    // resolveRoleId
    fetchStub.reply('/metadata', {
      data: {
        getRoles: [
          { id: 'role-member', label: 'Member', description: null, icon: null, canBeAssignedToUsers: true, canBeAssignedToApiKeys: false, isEditable: true },
        ],
      },
    });
    fetchStub.reply('/metadata', {
      data: {
        sendInvitations: {
          success: true, errors: [], result: [INVITATION],
        },
      },
    });

    const { stdout } = await runCli(registerInvitationCommands, [
      'invitation', 'send',
      '--emails', 'a@example.com, b@example.com',
      '--role', 'Member',
    ]);
    expect(stdout).toContain('sent 1 invitation');

    const sendCall = fetchStub.calls.find((c) =>
      (c.body as { query?: string } | undefined)?.query?.includes('sendInvitations'),
    );
    const v = (sendCall!.body as { variables: { emails: string[]; roleId: string } }).variables;
    expect(v.emails).toEqual(['a@example.com', 'b@example.com']);
    expect(v.roleId).toBe('role-member');
  });

  it('passes undefined roleId when --role is omitted', async () => {
    fetchStub.reply('/metadata', {
      data: { sendInvitations: { success: true, errors: [], result: [INVITATION] } },
    });
    await runCli(registerInvitationCommands, [
      'invitation', 'send',
      '--emails', 'a@example.com',
    ]);
    const sendCall = fetchStub.calls[0]!;
    const v = (sendCall.body as { variables: { roleId?: string } }).variables;
    expect(v.roleId).toBeUndefined();
  });

  it('USAGE error when --emails is empty/whitespace', async () => {
    const err = await runCli(registerInvitationCommands, [
      'invitation', 'send', '--emails', ' , ,',
    ]).catch((e: unknown) => e) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.USAGE);
  });

  it('throws CliError when SendInvitations.success is false', async () => {
    fetchStub.reply('/metadata', {
      data: { sendInvitations: { success: false, errors: ['rejected'], result: [] } },
    });
    const err = await runCli(registerInvitationCommands, [
      'invitation', 'send', '--emails', 'a@example.com',
    ]).catch((e: unknown) => e) as { exitCode?: number; message?: string };
    expect(err.exitCode).toBe(EXIT.API);
    expect(err.message).toContain('rejected');
  });
});

describe('invitation resend', () => {
  it('calls resendWorkspaceInvitation(appTokenId)', async () => {
    fetchStub.reply('/metadata', { data: { resendWorkspaceInvitation: true } });
    const { stdout } = await runCli(registerInvitationCommands, ['invitation', 'resend', INVITATION.id]);
    expect(stdout).toContain(`resent invitation ${INVITATION.id}`);

    const v = (fetchStub.calls[0]!.body as { variables: { id: string } }).variables;
    expect(v.id).toBe(INVITATION.id);
  });
});

describe('invitation revoke', () => {
  it('calls deleteWorkspaceInvitation(appTokenId)', async () => {
    fetchStub.reply('/metadata', { data: { deleteWorkspaceInvitation: true } });
    const { stdout } = await runCli(registerInvitationCommands, ['invitation', 'revoke', INVITATION.id]);
    expect(stdout).toContain(`revoked invitation ${INVITATION.id}`);

    const v = (fetchStub.calls[0]!.body as { variables: { id: string } }).variables;
    expect(v.id).toBe(INVITATION.id);
  });
});
