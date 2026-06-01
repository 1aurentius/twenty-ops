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
import { registerDomainCommands } from '../../../src/commands/domain.js';
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

interface GqlBody { query: string; variables?: Record<string, unknown> }
const body = (call: { body: unknown }): GqlBody => call.body as GqlBody;

const runDom = (...args: string[]) => runCli(registerDomainCommands, ['domain', ...args]);

const APPR_ID = '11111111-1111-4111-8111-111111111111';
const APPR = { id: APPR_ID, domain: 'acme.com', isValidated: false, createdAt: '2026-01-01' };
const PUB = { id: '22222222-2222-4222-8222-222222222222', domain: 'app.acme.com', isValidated: true, applicationId: null, createdAt: '2026-01-01' };
const EM = { id: '33333333-3333-4333-8333-333333333333', domain: 'mail.acme.com', driver: 'AWS_SES', status: 'PENDING', verifiedAt: null, verificationRecords: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' };

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-domain-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('domain approved', () => {
  it('list calls getApprovedAccessDomains', async () => {
    fetchStub.reply('/metadata', { data: { getApprovedAccessDomains: [APPR] } });
    const { stdout } = await runDom('approved', 'list', '--json');
    expect(JSON.parse(stdout.trim().split('\n')[0]!).id).toBe(APPR_ID);
  });

  it('create sends { domain, email } as the input', async () => {
    fetchStub.reply('/metadata', { data: { createApprovedAccessDomain: APPR } });
    await runDom('approved', 'create', '--domain', 'acme.com', '--email', 'admin@acme.com');
    expect(body(fetchStub.calls[0]!).variables?.input).toEqual({ domain: 'acme.com', email: 'admin@acme.com' });
  });

  it('validate passes the token + id into ValidateApprovedAccessDomainInput', async () => {
    fetchStub.reply('/metadata', { data: { validateApprovedAccessDomain: { ...APPR, isValidated: true } } });
    await runDom('approved', 'validate', APPR_ID, '--token', 'TOK');
    expect(body(fetchStub.calls[0]!).variables?.input).toEqual({ approvedAccessDomainId: APPR_ID, validationToken: 'TOK' });
  });

  it('delete uses DeleteApprovedAccessDomainInput { id }', async () => {
    fetchStub.reply('/metadata', { data: { deleteApprovedAccessDomain: true } });
    await runDom('approved', 'delete', APPR_ID);
    expect(body(fetchStub.calls[0]!).variables?.input).toEqual({ id: APPR_ID });
  });
});

describe('domain public', () => {
  it('list calls findManyPublicDomains', async () => {
    fetchStub.reply('/metadata', { data: { findManyPublicDomains: [PUB] } });
    const { stdout } = await runDom('public', 'list', '--json');
    expect(JSON.parse(stdout.trim().split('\n')[0]!).domain).toBe('app.acme.com');
  });

  it('create uses flat (domain, applicationId?) args', async () => {
    fetchStub.reply('/metadata', { data: { createPublicDomain: PUB } });
    await runDom('public', 'create', '--domain', 'app.acme.com', '--application', 'app-1');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ domain: 'app.acme.com', applicationId: 'app-1' });
  });

  it('update is keyed by domain (no id)', async () => {
    fetchStub.reply('/metadata', { data: { updatePublicDomain: PUB } });
    await runDom('public', 'update', '--domain', 'app.acme.com');
    expect(body(fetchStub.calls[0]!).query).toContain('updatePublicDomain(domain: $domain, applicationId: $applicationId)');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ domain: 'app.acme.com', applicationId: undefined });
  });

  it('delete is keyed by domain', async () => {
    fetchStub.reply('/metadata', { data: { deletePublicDomain: true } });
    await runDom('public', 'delete', '--domain', 'app.acme.com');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ domain: 'app.acme.com' });
  });

  it('check returns the records list', async () => {
    fetchStub.reply('/metadata', { data: { checkPublicDomainValidRecords: { id: 'd1', domain: 'app.acme.com', records: [{ validationType: 'CNAME', type: 'CNAME', status: 'pending', key: 'app', value: 'cname.target' }] } } });
    const { stdout } = await runDom('public', 'check', '--domain', 'app.acme.com', '--json');
    expect(JSON.parse(stdout.trim()).domain).toBe('app.acme.com');
  });
});

describe('domain emailing', () => {
  it('list calls getEmailingDomains', async () => {
    fetchStub.reply('/metadata', { data: { getEmailingDomains: [EM] } });
    const { stdout } = await runDom('emailing', 'list', '--json');
    expect(JSON.parse(stdout.trim().split('\n')[0]!).id).toBe(EM.id);
  });

  it('create passes (domain, driver) with driver uppercased', async () => {
    fetchStub.reply('/metadata', { data: { createEmailingDomain: EM } });
    await runDom('emailing', 'create', '--domain', 'mail.acme.com', '--driver', 'aws_ses');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ domain: 'mail.acme.com', driver: 'AWS_SES' });
  });

  it('verify calls verifyEmailingDomain(id)', async () => {
    fetchStub.reply('/metadata', { data: { verifyEmailingDomain: EM } });
    await runDom('emailing', 'verify', EM.id);
    expect(body(fetchStub.calls[0]!).query).toContain('verifyEmailingDomain(id: $id)');
  });

  it('delete calls deleteEmailingDomain(id)', async () => {
    fetchStub.reply('/metadata', { data: { deleteEmailingDomain: true } });
    await runDom('emailing', 'delete', EM.id);
    expect(body(fetchStub.calls[0]!).query).toContain('deleteEmailingDomain(id: $id)');
  });
});

describe('domain custom', () => {
  it('check calls checkCustomDomainValidRecords with no args', async () => {
    fetchStub.reply('/metadata', { data: { checkCustomDomainValidRecords: { id: 'd1', domain: 'acme.io', records: [] } } });
    const { stdout } = await runDom('custom', 'check', '--json');
    expect(JSON.parse(stdout.trim()).domain).toBe('acme.io');
  });

  it('NOT_FOUND when checkCustomDomainValidRecords returns null', async () => {
    fetchStub.reply('/metadata', { data: { checkCustomDomainValidRecords: null } });
    const err = await runDom('custom', 'check').catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });
});
