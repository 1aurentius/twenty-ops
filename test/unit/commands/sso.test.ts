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
import { registerSsoCommands } from '../../../src/commands/sso.js';
import { runCli } from '../../helpers/cli-harness.js';
import { type FetchStub, stubFetch } from '../../helpers/graphql-mock.js';

function writeRemote(): void {
  mkdirSync(join(HOME.current, '.twenty'), { recursive: true });
  writeFileSync(
    join(HOME.current, '.twenty', 'config.json'),
    JSON.stringify({
      remotes: { test: { apiUrl: 'http://localhost:3001', apiKey: 'k' } },
      defaultRemote: 'test',
    }),
  );
}

function writeFile(name: string, content: unknown): string {
  const path = join(HOME.current, name);
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
}

const SSO_ID = '11111111-1111-4111-8111-111111111111';
const SSO = { id: SSO_ID, name: 'Okta OIDC', type: 'OIDC', status: 'Active', issuer: 'https://acme.okta.com' };

interface GqlBody { query: string; variables?: Record<string, unknown> }
const body = (call: { body: unknown }): GqlBody => call.body as GqlBody;

const runSso = (...args: string[]) => runCli(registerSsoCommands, ['sso', ...args]);

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-sso-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('sso list', () => {
  it('emits providers as JSON Lines', async () => {
    fetchStub.reply('/metadata', { data: { getSSOIdentityProviders: [SSO] } });
    const { stdout } = await runSso('list', '--json');
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { id: string });
    expect(rows[0]?.id).toBe(SSO_ID);
  });
});

describe('sso create-oidc', () => {
  it('USAGE when required fields are missing', async () => {
    const f = writeFile('s.json', { name: 'X', issuer: 'Y' }); // missing clientID, clientSecret
    const err = await runSso('create-oidc', '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('passes SetupOIDCSsoInput verbatim', async () => {
    const f = writeFile('s.json', { name: 'Okta', issuer: 'https://okta.example/sso', clientID: 'cid', clientSecret: 'sec' });
    fetchStub.reply('/metadata', { data: { createOIDCIdentityProvider: SSO } });
    await runSso('create-oidc', '--file', f);
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('createOIDCIdentityProvider(input: $input)');
    expect(body(call).variables?.input).toMatchObject({ name: 'Okta', clientID: 'cid' });
  });
});

describe('sso create-saml', () => {
  it('USAGE when ssoURL is missing', async () => {
    const f = writeFile('s.json', { name: 'X', issuer: 'Y', id: '00000000-0000-4000-8000-000000000000', certificate: 'PEM' });
    const err = await runSso('create-saml', '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('passes SetupSAMLSsoInput verbatim including fingerprint', async () => {
    const f = writeFile('s.json', { name: 'Okta SAML', issuer: 'Y', id: SSO_ID, ssoURL: 'https://idp/saml', certificate: 'PEM', fingerprint: 'abc' });
    fetchStub.reply('/metadata', { data: { createSAMLIdentityProvider: SSO } });
    await runSso('create-saml', '--file', f);
    expect(body(fetchStub.calls[0]!).variables?.input).toMatchObject({ ssoURL: 'https://idp/saml', fingerprint: 'abc' });
  });
});

describe('sso set-status', () => {
  it('USAGE when --status is not one of the allowed values', async () => {
    const err = await runSso('set-status', SSO_ID, '--status', 'enabled').catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('sends editSSOIdentityProvider with the EditSsoInput shape', async () => {
    fetchStub.reply('/metadata', { data: { editSSOIdentityProvider: SSO } });
    await runSso('set-status', SSO_ID, '--status', 'Inactive');
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('editSSOIdentityProvider(input: $input)');
    expect(body(call).variables?.input).toEqual({ id: SSO_ID, status: 'Inactive' });
  });
});

describe('sso delete', () => {
  it('uses identityProviderId arg name (not id)', async () => {
    fetchStub.reply('/metadata', { data: { deleteSSOIdentityProvider: { identityProviderId: SSO_ID } } });
    await runSso('delete', SSO_ID);
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('deleteSSOIdentityProvider(input: $input)');
    expect(body(call).variables?.input).toEqual({ identityProviderId: SSO_ID });
  });
});
