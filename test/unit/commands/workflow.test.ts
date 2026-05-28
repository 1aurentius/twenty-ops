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
import { registerWorkflowCommands } from '../../../src/commands/workflow.js';
import { runCli } from '../../helpers/cli-harness.js';
import { type FetchStub, stubFetch } from '../../helpers/graphql-mock.js';

const WF_ID = '11111111-1111-4111-8111-111111111111';
const VER_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';

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

function writeFile(name: string, content: string): string {
  const path = join(HOME.current, name);
  writeFileSync(path, content);
  return path;
}

interface GqlBody {
  query: string;
  variables?: Record<string, unknown>;
}
const body = (call: { body: unknown }): GqlBody => call.body as GqlBody;

const runWf = (...args: string[]) => runCli(registerWorkflowCommands, ['workflow', ...args]);

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-wf-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('workflow list', () => {
  it('hits the core endpoint with the default limit of 50', async () => {
    fetchStub.reply('/graphql', { data: { workflows: { edges: [] } } });
    await runWf('list');

    const call = fetchStub.calls[0]!;
    expect(call.url).toBe('http://localhost:3001/graphql');
    expect(body(call).query).toContain('workflows');
    expect(body(call).variables).toEqual({ first: 50 });
  });

  it('forwards --limit', async () => {
    fetchStub.reply('/graphql', { data: { workflows: { edges: [] } } });
    await runWf('list', '--limit', '5');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ first: 5 });
  });

  it('flattens edges → nodes for the output', async () => {
    fetchStub.reply('/graphql', {
      data: {
        workflows: {
          edges: [
            { node: { id: WF_ID, name: 'A', statuses: ['ACTIVE'], lastPublishedVersionId: VER_ID } },
          ],
        },
      },
    });
    const { stdout } = await runWf('list', '--json');
    expect(JSON.parse(stdout.trim())).toMatchObject({ id: WF_ID, name: 'A' });
  });
});

describe('workflow get', () => {
  it('flattens version + run edges into arrays', async () => {
    fetchStub.reply('/graphql', {
      data: {
        workflow: {
          id: WF_ID,
          name: 'W',
          statuses: ['DRAFT'],
          lastPublishedVersionId: null,
          versions: { edges: [{ node: { id: VER_ID, name: 'v1', status: 'DRAFT' } }] },
          runs: { edges: [] },
        },
      },
    });
    const { stdout } = await runWf('get', WF_ID, '--json');
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.versions).toEqual([{ id: VER_ID, name: 'v1', status: 'DRAFT' }]);
    expect(parsed.runs).toEqual([]);
  });

  it('maps a null workflow to exit code 4 (NOT_FOUND)', async () => {
    fetchStub.reply('/graphql', { data: { workflow: null } });
    const err = await runWf('get', WF_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });
});

describe('workflow create', () => {
  it('creates the workflow then queries for the auto-created DRAFT version', async () => {
    fetchStub.reply('/graphql', {
      data: { createWorkflow: { id: WF_ID, name: 'New', statuses: ['DRAFT'], lastPublishedVersionId: null } },
    });
    fetchStub.reply('/graphql', {
      data: { workflowVersions: { edges: [{ node: { id: VER_ID, name: 'v1', status: 'DRAFT', workflowId: WF_ID, trigger: null, steps: null } }] } },
    });

    const { stdout } = await runWf('create', '--name', 'New', '--json');

    expect(fetchStub.calls).toHaveLength(2);
    expect(body(fetchStub.calls[0]!).query).toContain('createWorkflow');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ data: { name: 'New' } });
    expect(body(fetchStub.calls[1]!).query).toContain('workflowVersions');
    expect(JSON.parse(stdout.trim())).toEqual({ workflowId: WF_ID, versionId: VER_ID, name: 'New' });
  });

  it('handles the case where no draft version was found (versionId=null)', async () => {
    fetchStub.reply('/graphql', {
      data: { createWorkflow: { id: WF_ID, name: 'New', statuses: ['DRAFT'], lastPublishedVersionId: null } },
    });
    fetchStub.reply('/graphql', { data: { workflowVersions: { edges: [] } } });

    const { stdout } = await runWf('create', '--name', 'New', '--json');
    expect(JSON.parse(stdout.trim())).toEqual({ workflowId: WF_ID, versionId: null, name: 'New' });
  });
});

describe('workflow update + delete', () => {
  it('update renames via updateWorkflow', async () => {
    fetchStub.reply('/graphql', {
      data: { updateWorkflow: { id: WF_ID, name: 'Renamed', statuses: ['DRAFT'], lastPublishedVersionId: null } },
    });
    await runWf('update', WF_ID, '--name', 'Renamed');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: WF_ID, data: { name: 'Renamed' } });
  });

  it('delete calls deleteWorkflow with the id', async () => {
    fetchStub.reply('/graphql', { data: { deleteWorkflow: { id: WF_ID } } });
    const { stdout } = await runWf('delete', WF_ID);
    expect(stdout).toContain(`deleted workflow ${WF_ID}`);
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: WF_ID });
  });
});

describe('workflow versions / version get', () => {
  it('versions filters by workflowId', async () => {
    fetchStub.reply('/graphql', { data: { workflowVersions: { edges: [] } } });
    await runWf('versions', WF_ID);
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: WF_ID });
  });

  it('version get returns the trigger and steps', async () => {
    fetchStub.reply('/graphql', {
      data: {
        workflowVersion: {
          id: VER_ID,
          name: 'v1',
          status: 'DRAFT',
          workflowId: WF_ID,
          trigger: { type: 'MANUAL_TRIGGER', settings: {} },
          steps: null,
        },
      },
    });
    const { stdout } = await runWf('version', 'get', VER_ID, '--json');
    expect(JSON.parse(stdout.trim())).toMatchObject({
      id: VER_ID,
      trigger: { type: 'MANUAL_TRIGGER', settings: {} },
    });
  });

  it('version get on a missing id maps to NOT_FOUND', async () => {
    fetchStub.reply('/graphql', { data: { workflowVersion: null } });
    const err = await runWf('version', 'get', VER_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });
});

describe('workflow set-trigger (file shapes)', () => {
  it('accepts a bare trigger object', async () => {
    const file = writeFile('t.json', JSON.stringify({ type: 'MANUAL_TRIGGER', settings: {} }));
    fetchStub.reply('/graphql', {
      data: { updateWorkflowVersion: { id: VER_ID, name: 'v1', status: 'DRAFT', workflowId: WF_ID, trigger: { type: 'MANUAL_TRIGGER' }, steps: null } },
    });
    await runWf('set-trigger', VER_ID, '--file', file);
    expect(body(fetchStub.calls[0]!).variables).toEqual({
      id: VER_ID,
      data: { trigger: { type: 'MANUAL_TRIGGER', settings: {} } },
    });
  });

  it('accepts a {name, trigger} wrapper and forwards both', async () => {
    const file = writeFile('t.json', JSON.stringify({
      name: 'v1-renamed',
      trigger: { type: 'DATABASE_EVENT', settings: { eventName: 'person.created' } },
    }));
    fetchStub.reply('/graphql', {
      data: { updateWorkflowVersion: { id: VER_ID, name: 'v1-renamed', status: 'DRAFT', workflowId: WF_ID, trigger: null, steps: null } },
    });
    await runWf('set-trigger', VER_ID, '--file', file);
    expect(body(fetchStub.calls[0]!).variables).toEqual({
      id: VER_ID,
      data: {
        trigger: { type: 'DATABASE_EVENT', settings: { eventName: 'person.created' } },
        name: 'v1-renamed',
      },
    });
  });
});

describe('workflow runs / run get', () => {
  it('forwards workflowId + default limit, omits status filter when not passed', async () => {
    fetchStub.reply('/graphql', { data: { workflowRuns: { edges: [] } } });
    await runWf('runs', WF_ID);
    expect(body(fetchStub.calls[0]!).variables).toEqual({
      filter: { workflowId: { eq: WF_ID } },
      first: 25,
    });
  });

  it('uppercases and adds --status filter', async () => {
    fetchStub.reply('/graphql', { data: { workflowRuns: { edges: [] } } });
    await runWf('runs', WF_ID, '--status', 'completed', '--limit', '5');
    expect(body(fetchStub.calls[0]!).variables).toEqual({
      filter: { workflowId: { eq: WF_ID }, status: { eq: 'COMPLETED' } },
      first: 5,
    });
  });

  it('run get returns state field; null maps to NOT_FOUND', async () => {
    fetchStub.reply('/graphql', {
      data: {
        workflowRun: {
          id: RUN_ID,
          name: 'r1',
          status: 'COMPLETED',
          workflowId: WF_ID,
          workflowVersionId: VER_ID,
          startedAt: '2026-05-21T00:00:00Z',
          endedAt: '2026-05-21T00:00:01Z',
          state: { steps: {} },
        },
      },
    });
    const { stdout } = await runWf('run', 'get', RUN_ID, '--json');
    expect(JSON.parse(stdout.trim())).toMatchObject({ id: RUN_ID, state: { steps: {} } });

    fetchStub.reply('/graphql', { data: { workflowRun: null } });
    const err = await runWf('run', 'get', RUN_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });
});

describe('workflow trigger', () => {
  const TRIGGER_ID = '44444444-4444-4444-8444-444444444444';
  const TRIGGER = {
    id: TRIGGER_ID, workflowId: WF_ID, type: 'CRON',
    settings: { schedule: '0 0 * * *' },
    createdAt: '2026-05-25T00:00:00Z', updatedAt: '2026-05-25T00:00:00Z',
  };

  it('list filters workflowAutomatedTriggers by workflowId', async () => {
    fetchStub.reply('/graphql', { data: { workflowAutomatedTriggers: { edges: [{ node: TRIGGER }] } } });
    const { stdout } = await runWf('trigger', 'list', WF_ID, '--json');
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { id: string });
    expect(rows[0]?.id).toBe(TRIGGER_ID);

    const call = fetchStub.calls[0]!;
    expect(call.url).toBe('http://localhost:3001/graphql');
    expect(body(call).variables).toEqual({ id: WF_ID });
  });

  it('get NOT_FOUND when workflowAutomatedTrigger is null', async () => {
    fetchStub.reply('/graphql', { data: { workflowAutomatedTrigger: null } });
    const err = await runWf('trigger', 'get', TRIGGER_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('create requires settings in the file (USAGE otherwise)', async () => {
    const file = writeFile('bad.json', JSON.stringify({ type: 'CRON' }));
    const err = await runWf('trigger', 'create', '--workflow', WF_ID, '--file', file).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('create merges --workflow into the file data and calls core endpoint', async () => {
    const file = writeFile('good.json', JSON.stringify({
      type: 'CRON',
      settings: { schedule: '*/5 * * * *' },
    }));
    fetchStub.reply('/graphql', { data: { createWorkflowAutomatedTrigger: TRIGGER } });
    await runWf('trigger', 'create', '--workflow', WF_ID, '--file', file, '--json');
    const call = fetchStub.calls[0]!;
    expect(call.url).toBe('http://localhost:3001/graphql');
    expect(body(call).variables?.data).toMatchObject({
      workflowId: WF_ID,
      type: 'CRON',
      settings: { schedule: '*/5 * * * *' },
    });
  });

  it('update sends the file as data via (id, data) arg shape', async () => {
    const file = writeFile('patch.json', JSON.stringify({ settings: { schedule: '0 12 * * *' } }));
    fetchStub.reply('/graphql', { data: { updateWorkflowAutomatedTrigger: TRIGGER } });
    await runWf('trigger', 'update', TRIGGER_ID, '--file', file);
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('updateWorkflowAutomatedTrigger(id: $id, data: $data)');
    expect(body(call).variables).toMatchObject({ id: TRIGGER_ID, data: { settings: { schedule: '0 12 * * *' } } });
  });

  it('delete calls deleteWorkflowAutomatedTrigger with just the id', async () => {
    fetchStub.reply('/graphql', { data: { deleteWorkflowAutomatedTrigger: { id: TRIGGER_ID } } });
    await runWf('trigger', 'delete', TRIGGER_ID);
    const call = fetchStub.calls[0]!;
    expect(body(call).variables).toEqual({ id: TRIGGER_ID });
  });
});
