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
import { registerDashboardCommands } from '../../../src/commands/dashboard.js';
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

const D_ID = '11111111-1111-4111-8111-111111111111';
const D = {
  id: D_ID, title: 'Sales', position: 0, pageLayoutId: null,
  createdAt: '2026-05-25T00:00:00Z', updatedAt: '2026-05-25T00:00:00Z',
};

interface GqlBody { query: string; variables?: Record<string, unknown> }
const body = (call: { body: unknown }): GqlBody => call.body as GqlBody;

const runDash = (...args: string[]) => runCli(registerDashboardCommands, ['dashboard', ...args]);

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-dash-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('dashboard list', () => {
  it('queries /graphql with the default --limit of 50', async () => {
    fetchStub.reply('/graphql', { data: { dashboards: { edges: [{ node: D }] } } });
    const { stdout } = await runDash('list', '--json');
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { id: string });
    expect(rows[0]?.id).toBe(D_ID);
    expect(fetchStub.calls[0]!.url).toBe('http://localhost:3001/graphql');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ first: 50, after: undefined });
  });

  it('forwards --limit and --starting-after as paging vars', async () => {
    fetchStub.reply('/graphql', { data: { dashboards: { edges: [] } } });
    await runDash('list', '--limit', '5', '--starting-after', 'cursor-X');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ first: 5, after: 'cursor-X' });
  });
});

describe('dashboard get', () => {
  it('NOT_FOUND when dashboard is null', async () => {
    fetchStub.reply('/graphql', { data: { dashboard: null } });
    const err = await runDash('get', D_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('uses filter:{id:{eq}} shape', async () => {
    fetchStub.reply('/graphql', { data: { dashboard: D } });
    await runDash('get', D_ID, '--json');
    expect(body(fetchStub.calls[0]!).query).toContain('dashboard(filter: { id: { eq: $id } })');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: D_ID });
  });
});

describe('dashboard create/update/delete/restore', () => {
  it('create passes file contents as data', async () => {
    const f = writeFile('d.json', { title: 'New', position: 0 });
    fetchStub.reply('/graphql', { data: { createDashboard: D } });
    await runDash('create', '--file', f);
    expect(body(fetchStub.calls[0]!).query).toContain('createDashboard(data: $data)');
    expect(body(fetchStub.calls[0]!).variables?.data).toMatchObject({ title: 'New', position: 0 });
  });

  it('USAGE when --file is an array', async () => {
    const f = writeFile('d.json', JSON.stringify([{ title: 'no' }]));
    const err = await runDash('create', '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('update uses (id, data) shape', async () => {
    const f = writeFile('patch.json', { title: 'Renamed' });
    fetchStub.reply('/graphql', { data: { updateDashboard: D } });
    await runDash('update', D_ID, '--file', f);
    expect(body(fetchStub.calls[0]!).query).toContain('updateDashboard(id: $id, data: $data)');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: D_ID, data: { title: 'Renamed' } });
  });

  it('delete calls deleteDashboard with just the id', async () => {
    fetchStub.reply('/graphql', { data: { deleteDashboard: { id: D_ID } } });
    await runDash('delete', D_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('deleteDashboard(id: $id)');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: D_ID });
  });

  it('restore calls restoreDashboard', async () => {
    fetchStub.reply('/graphql', { data: { restoreDashboard: D } });
    await runDash('restore', D_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('restoreDashboard(id: $id)');
  });
});
