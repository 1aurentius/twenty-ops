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
import { registerWebhookCommands } from '../../../src/commands/webhook.js';
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
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-webhook-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const sample = {
  id: 'wh-1',
  targetUrl: 'https://example.com/hook',
  operations: ['*.created'],
  description: 'demo',
  secret: 'shhh',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('webhook list', () => {
  it('queries webhooks and emits rows', async () => {
    fetchStub.reply('/metadata', { data: { webhooks: [sample] } });
    const { stdout } = await runCli(registerWebhookCommands, ['webhook', 'list', '--json']);
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(rows[0]).toMatchObject({ id: 'wh-1', targetUrl: 'https://example.com/hook' });
  });
});

describe('webhook get', () => {
  it('queries webhook(id) and emits all fields under --json', async () => {
    fetchStub.reply('/metadata', { data: { webhook: sample } });
    const { stdout } = await runCli(registerWebhookCommands, ['webhook', 'get', 'wh-1', '--json']);
    const got = JSON.parse(stdout.trim());
    expect(got).toMatchObject({ id: 'wh-1', secret: 'shhh' });

    const call = fetchStub.calls[0]!;
    expect((call.body as { variables: { id: string } }).variables.id).toBe('wh-1');
  });

  it('NOT_FOUND with the id in the message', async () => {
    fetchStub.reply('/metadata', { data: { webhook: null } });
    const err = await runCli(registerWebhookCommands, ['webhook', 'get', 'wh-nope']).catch((e: unknown) => e);
    expect((err as { exitCode?: number; message?: string }).exitCode).toBe(EXIT.NOT_FOUND);
    expect((err as { message: string }).message).toContain('wh-nope');
  });
});

describe('webhook create', () => {
  it('parses --operations as comma-list and sends as array', async () => {
    fetchStub.reply('/metadata', { data: { createWebhook: { ...sample, operations: ['person.created', 'person.updated'] } } });

    const { stdout } = await runCli(registerWebhookCommands, [
      'webhook', 'create',
      '--target-url', 'https://example.com/hook',
      '--operations', 'person.created, person.updated',
      '--description', 'demo',
    ]);
    expect(stdout).toContain('created webhook wh-1');

    const call = fetchStub.calls[0]!;
    const v = (call.body as { variables: { input: { targetUrl: string; operations: string[]; description: string } } }).variables;
    expect(v.input.operations).toEqual(['person.created', 'person.updated']);
    expect(v.input.targetUrl).toBe('https://example.com/hook');
    expect(v.input.description).toBe('demo');
  });

  it('USAGE error when --operations is empty / whitespace only', async () => {
    const err = await runCli(registerWebhookCommands, [
      'webhook', 'create',
      '--target-url', 'https://example.com/hook',
      '--operations', ' , ,',
    ]).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('omits unset optional fields from the input payload', async () => {
    fetchStub.reply('/metadata', { data: { createWebhook: sample } });

    await runCli(registerWebhookCommands, [
      'webhook', 'create',
      '--target-url', 'https://example.com/hook',
      '--operations', '*.created',
    ]);
    const call = fetchStub.calls[0]!;
    const v = (call.body as { variables: { input: Record<string, unknown> } }).variables;
    expect(v.input).toEqual({ targetUrl: 'https://example.com/hook', operations: ['*.created'] });
  });
});

describe('webhook update', () => {
  it('PATCHes updateWebhook(input: { id, update })', async () => {
    fetchStub.reply('/metadata', { data: { updateWebhook: { ...sample, description: 'renamed' } } });

    await runCli(registerWebhookCommands, [
      'webhook', 'update', 'wh-1',
      '--description', 'renamed',
      '--operations', '*.created,*.updated',
    ]);

    const call = fetchStub.calls[0]!;
    const v = (call.body as { variables: { input: { id: string; update: Record<string, unknown> } } }).variables;
    expect(v.input.id).toBe('wh-1');
    expect(v.input.update).toEqual({ description: 'renamed', operations: ['*.created', '*.updated'] });
  });

  it('USAGE error when no flags are passed', async () => {
    const err = await runCli(registerWebhookCommands, ['webhook', 'update', 'wh-1']).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });
});

describe('webhook delete', () => {
  it('deleteWebhook(id) — no input wrapper, unlike most metadata mutations', async () => {
    fetchStub.reply('/metadata', { data: { deleteWebhook: { id: 'wh-1' } } });
    const { stdout } = await runCli(registerWebhookCommands, ['webhook', 'delete', 'wh-1']);
    expect(stdout).toContain('deleted webhook wh-1');

    const call = fetchStub.calls[0]!;
    expect((call.body as { variables: { id: string } }).variables.id).toBe('wh-1');
  });
});
