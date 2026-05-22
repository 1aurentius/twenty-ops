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
import { registerRecordCommands } from '../../../src/commands/record.js';
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

/** Most record commands resolve `--object person` to its names via metadata. */
function scriptPersonObject(stub: FetchStub): void {
  stub.reply('/metadata', {
    data: {
      objects: {
        edges: [
          {
            node: {
              id: 'obj-person',
              nameSingular: 'person',
              namePlural: 'people',
              labelSingular: 'Person',
              isActive: true,
            },
          },
        ],
      },
    },
  });
}

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-record-'));
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

describe('record list', () => {
  it('GETs /rest/people with filter + limit, prints the rows', async () => {
    scriptPersonObject(fetchStub);
    fetchStub.reply('/rest/people', {
      data: {
        people: [
          { id: 'p1', name: 'Alice', createdAt: '2026-01-01T00:00:00Z' },
          { id: 'p2', name: 'Bob', createdAt: '2026-01-02T00:00:00Z' },
        ],
      },
    });

    const { stdout } = await runCli(registerRecordCommands, [
      'record', 'list', 'person',
      '--filter', 'name[like]:%lice%',
      '--limit', '10',
    ]);

    expect(stdout).toContain('Alice');
    expect(stdout).toContain('Bob');

    const restCall = fetchStub.calls.find((c) => c.url.includes('/rest/people'));
    expect(restCall).toBeTruthy();
    expect(restCall!.method).toBe('GET');
    expect(restCall!.url).toContain('filter=name%5Blike%5D%3A%25lice%25');
    expect(restCall!.url).toContain('limit=10');
  });

  it('--json emits JSON Lines', async () => {
    scriptPersonObject(fetchStub);
    fetchStub.reply('/rest/people', {
      data: { people: [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }] },
    });

    const { stdout } = await runCli(registerRecordCommands, ['record', 'list', 'person', '--json']);
    const lines = stdout.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ id: 'p1', name: 'Alice' });
  });
});

describe('record get', () => {
  it('GETs /rest/people/<id> and prints key=value', async () => {
    scriptPersonObject(fetchStub);
    fetchStub.reply('/rest/people', {
      data: { person: { id: 'p1', name: 'Alice', createdAt: '2026-01-01T00:00:00Z' } },
    });

    const { stdout } = await runCli(registerRecordCommands, ['record', 'get', 'person', 'p1']);
    expect(stdout).toContain('id=p1');
    expect(stdout).toContain('name=Alice');

    const restCall = fetchStub.calls.find((c) => c.url.includes('/rest/people/p1'));
    expect(restCall?.method).toBe('GET');
  });

  it('--json emits the FULL record, not just the default columns (regression)', async () => {
    // Records have many fields; --json must surface all of them so an agent can
    // read fields that aren't in the text-mode default projection. The earlier
    // bug projected to id+name+createdAt+updatedAt only, dropping jobTitle etc.
    scriptPersonObject(fetchStub);
    fetchStub.reply('/rest/people', {
      data: {
        person: {
          id: 'p1',
          name: { firstName: 'Alice', lastName: 'X' },
          jobTitle: 'CEO',
          city: 'Helsinki',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
        },
      },
    });

    const { stdout } = await runCli(registerRecordCommands, ['record', 'get', 'person', 'p1', '--json']);
    const got = JSON.parse(stdout.trim());
    expect(got.jobTitle).toBe('CEO');
    expect(got.city).toBe('Helsinki');
    expect(got.name).toEqual({ firstName: 'Alice', lastName: 'X' });
  });

  it('returns NOT_FOUND when REST returns 404', async () => {
    scriptPersonObject(fetchStub);
    fetchStub.reply('/rest/people', { error: 'not found' }, { status: 404, statusText: 'Not Found' });

    const err = await runCli(registerRecordCommands, ['record', 'get', 'person', 'nope']).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });
});

describe('record create', () => {
  it('POSTs the file contents to /rest/people', async () => {
    scriptPersonObject(fetchStub);
    fetchStub.reply('/rest/people', {
      data: { createPerson: { id: 'p-new', name: { firstName: 'Carol' } } },
    });

    const file = writeFile('person.json', { name: { firstName: 'Carol', lastName: 'Smith' } });
    const { stdout } = await runCli(registerRecordCommands, ['record', 'create', 'person', '--file', file]);

    expect(stdout).toContain('created person p-new');
    const postCall = fetchStub.calls.find((c) => c.method === 'POST' && c.url.includes('/rest/people'));
    expect(postCall).toBeTruthy();
    expect(postCall!.body).toEqual({ name: { firstName: 'Carol', lastName: 'Smith' } });
  });

  it('rejects array-shaped input with USAGE exit', async () => {
    scriptPersonObject(fetchStub);
    const file = writeFile('records.json', [{ name: 'A' }, { name: 'B' }]);
    const err = await runCli(registerRecordCommands, ['record', 'create', 'person', '--file', file])
      .catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });
});

describe('record update', () => {
  it('PATCHes /rest/people/<id> with the file contents', async () => {
    scriptPersonObject(fetchStub);
    fetchStub.reply('/rest/people', {
      data: { updatePerson: { id: 'p1', jobTitle: 'CEO' } },
    });

    const file = writeFile('patch.json', { jobTitle: 'CEO' });
    const { stdout } = await runCli(registerRecordCommands, ['record', 'update', 'person', 'p1', '--file', file]);

    expect(stdout).toContain('updated person p1');
    const patchCall = fetchStub.calls.find((c) => c.method === 'PATCH');
    expect(patchCall?.url).toContain('/rest/people/p1');
    expect(patchCall?.body).toEqual({ jobTitle: 'CEO' });
  });
});

describe('record delete', () => {
  it('DELETEs /rest/people/<id>', async () => {
    scriptPersonObject(fetchStub);
    fetchStub.reply('/rest/people', { data: { deletePerson: { id: 'p1' } } });

    const { stdout } = await runCli(registerRecordCommands, ['record', 'delete', 'person', 'p1']);
    expect(stdout).toContain('deleted person p1');
    const deleteCall = fetchStub.calls.find((c) => c.method === 'DELETE');
    expect(deleteCall?.url).toContain('/rest/people/p1');
  });
});

describe('record restore', () => {
  it('calls the GraphQL restorePerson mutation', async () => {
    scriptPersonObject(fetchStub);
    fetchStub.reply('/graphql', { data: { restorePerson: { id: 'p1' } } });

    const { stdout } = await runCli(registerRecordCommands, ['record', 'restore', 'person', 'p1']);
    expect(stdout).toContain('restored person p1');

    const gqlCall = fetchStub.calls.find((c) => c.url.endsWith('/graphql'));
    const body = gqlCall?.body as { query: string; variables: { id: string } };
    expect(body.query).toContain('restorePerson');
    expect(body.variables.id).toBe('p1');
  });
});

describe('record bulk-upsert', () => {
  it('creates missing records and skips unchanged ones', async () => {
    scriptPersonObject(fetchStub);
    // Page 1 of current state: only Bob exists
    fetchStub.reply('/rest/people', {
      data: { people: [{ id: 'p-bob', email: 'bob@example.com', name: 'Bob' }] },
    });
    // Create Alice
    fetchStub.reply('/rest/people', { data: { createPerson: { id: 'p-alice' } } });

    const file = writeFile('upsert.json', [
      { email: 'alice@example.com', name: 'Alice' },
      { email: 'bob@example.com', name: 'Bob' },
    ]);

    const { stdout } = await runCli(registerRecordCommands, [
      'record', 'bulk-upsert', 'person',
      '--file', file,
      '--key', 'email',
      '--json',
    ]);

    const summary = JSON.parse(stdout.trim()) as { created: number; updated: number; unchanged: number };
    expect(summary).toMatchObject({ created: 1, unchanged: 1 });

    const posts = fetchStub.calls.filter((c) => c.method === 'POST' && c.url.includes('/rest/people'));
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ email: 'alice@example.com', name: 'Alice' });
  });

  it('refuses to run when a row is missing the match key', async () => {
    scriptPersonObject(fetchStub);
    const file = writeFile('bad.json', [{ name: 'No-email' }]);
    const err = await runCli(registerRecordCommands, [
      'record', 'bulk-upsert', 'person', '--file', file, '--key', 'email',
    ]).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('PATCHes records whose non-key fields changed', async () => {
    scriptPersonObject(fetchStub);
    fetchStub.reply('/rest/people', {
      data: { people: [{ id: 'p-alice', email: 'alice@example.com', jobTitle: 'IC' }] },
    });
    fetchStub.reply('/rest/people', { data: { updatePerson: { id: 'p-alice' } } });

    const file = writeFile('upsert.json', [{ email: 'alice@example.com', jobTitle: 'CEO' }]);
    const { stdout } = await runCli(registerRecordCommands, [
      'record', 'bulk-upsert', 'person',
      '--file', file, '--key', 'email', '--json',
    ]);

    const summary = JSON.parse(stdout.trim()) as { updated: number };
    expect(summary.updated).toBe(1);

    const patch = fetchStub.calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toContain('/rest/people/p-alice');
    // The match key (`email`) is dropped from the patch body — it's already correct.
    expect(patch?.body).toEqual({ jobTitle: 'CEO' });
  });
});
