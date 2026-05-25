import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { HOME } = vi.hoisted(() => ({ HOME: { current: '' } }));
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => HOME.current };
});

import { registerSettingsCommands } from '../../../src/commands/settings.js';
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
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-settings-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const sampleWorkspace = {
  id: 'ws-1',
  displayName: 'Acme Co',
  activationStatus: 'ACTIVE',
  subdomain: 'acme',
  customDomain: null,
  workspaceMembersCount: 5,
  metadataVersion: 12,
  trashRetentionDays: 30,
  eventLogRetentionDays: 90,
  allowImpersonation: false,
  isPublicInviteLinkEnabled: true,
  isGoogleAuthEnabled: true,
  isPasswordAuthEnabled: true,
  isTwoFactorAuthenticationEnforced: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

describe('settings get', () => {
  it('queries currentWorkspace and emits a key=value table by default', async () => {
    fetchStub.reply('/metadata', { data: { currentWorkspace: sampleWorkspace } });
    const { stdout } = await runCli(registerSettingsCommands, ['settings', 'get']);
    expect(stdout).toContain('id=ws-1');
    expect(stdout).toContain('displayName=Acme Co');
    expect(stdout).toContain('activationStatus=ACTIVE');
    expect(stdout).toContain('subdomain=acme');
    expect(stdout).toContain('allowImpersonation=false');
  });

  it('--json emits every selected field, including booleans + nulls', async () => {
    fetchStub.reply('/metadata', { data: { currentWorkspace: sampleWorkspace } });
    const { stdout } = await runCli(registerSettingsCommands, ['settings', 'get', '--json']);
    const got = JSON.parse(stdout.trim());
    expect(got).toMatchObject({
      id: 'ws-1',
      activationStatus: 'ACTIVE',
      subdomain: 'acme',
      customDomain: null,
      isPublicInviteLinkEnabled: true,
      metadataVersion: 12,
    });
  });

  it('queries the metadata endpoint with the conservative field set', async () => {
    fetchStub.reply('/metadata', { data: { currentWorkspace: sampleWorkspace } });
    await runCli(registerSettingsCommands, ['settings', 'get']);
    const call = fetchStub.calls[0]!;
    const query = (call.body as { query: string }).query;
    // Sanity: every field we care about is in the projection.
    for (const f of ['displayName', 'activationStatus', 'subdomain', 'allowImpersonation', 'metadataVersion']) {
      expect(query).toContain(f);
    }
    // And the giant nested lists are NOT — those belong under `view list`.
    expect(query).not.toContain('viewFields');
    expect(query).not.toContain('viewFilters');
  });
});
