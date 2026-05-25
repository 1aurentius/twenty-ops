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
import { registerObjectCommands } from '../../../src/commands/object.js';
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

/** Most subcommands resolve `--object person` via metadata first. */
function scriptObjectsList(stub: FetchStub, override?: Record<string, unknown>): void {
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
              labelPlural: 'People',
              icon: 'IconUser',
              isCustom: false,
              isActive: true,
              ...override,
            },
          },
          {
            node: {
              id: 'obj-archived',
              nameSingular: 'archivedThing',
              namePlural: 'archivedThings',
              labelSingular: 'Archived',
              labelPlural: 'Archived',
              icon: null,
              isCustom: true,
              isActive: false,
            },
          },
        ],
      },
    },
  });
}

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-object-'));
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

describe('object list', () => {
  it('lists only active objects by default', async () => {
    scriptObjectsList(fetchStub);
    const { stdout } = await runCli(registerObjectCommands, ['object', 'list']);
    expect(stdout).toContain('person');
    expect(stdout).not.toContain('archivedThing');
  });

  it('--include-inactive shows all', async () => {
    scriptObjectsList(fetchStub);
    const { stdout } = await runCli(registerObjectCommands, ['object', 'list', '--include-inactive']);
    expect(stdout).toContain('person');
    expect(stdout).toContain('archivedThing');
  });
});

describe('object get', () => {
  it('resolves nameSingular and fetches by id', async () => {
    scriptObjectsList(fetchStub);
    fetchStub.reply('/metadata', {
      data: {
        object: {
          id: 'obj-person',
          nameSingular: 'person',
          namePlural: 'people',
          labelSingular: 'Person',
          labelPlural: 'People',
          icon: 'IconUser',
          isCustom: false,
          isActive: true,
        },
      },
    });

    const { stdout } = await runCli(registerObjectCommands, ['object', 'get', 'person']);
    expect(stdout).toContain('nameSingular=person');
    expect(stdout).toContain('labelSingular=Person');

    const getCall = fetchStub.calls.find((c) =>
      (c.body as { query?: string } | undefined)?.query?.includes('object(id:'),
    );
    expect(getCall).toBeTruthy();
    expect((getCall!.body as { variables: { id: string } }).variables.id).toBe('obj-person');
  });

  it('--json emits all OBJECT_SUMMARY fields, not just text-mode projection', async () => {
    scriptObjectsList(fetchStub);
    fetchStub.reply('/metadata', {
      data: {
        object: {
          id: 'obj-person',
          nameSingular: 'person',
          namePlural: 'people',
          labelSingular: 'Person',
          labelPlural: 'People',
          icon: 'IconUser',
          isCustom: false,
          isActive: true,
        },
      },
    });
    const { stdout } = await runCli(registerObjectCommands, ['object', 'get', 'person', '--json']);
    const got = JSON.parse(stdout.trim());
    expect(got.namePlural).toBe('people');
    expect(got.labelPlural).toBe('People');
    expect(got.icon).toBe('IconUser');
    expect(got.isCustom).toBe(false);
  });

  it('returns NOT_FOUND when the resolved object query returns null', async () => {
    scriptObjectsList(fetchStub);
    fetchStub.reply('/metadata', { data: { object: null } });
    const err = await runCli(registerObjectCommands, ['object', 'get', 'person']).catch((e: unknown) => e);
    expect((err as { exitCode?: number; message?: string }).exitCode).toBe(EXIT.NOT_FOUND);
    expect((err as { message: string }).message).toContain('person');
  });

  it('returns NOT_FOUND when the ref does not resolve at all', async () => {
    fetchStub.reply('/metadata', { data: { objects: { edges: [] } } });
    const err = await runCli(registerObjectCommands, ['object', 'get', 'nosuchobject']).catch((e: unknown) => e);
    expect((err as { exitCode?: number; message?: string }).exitCode).toBe(EXIT.NOT_FOUND);
    expect((err as { message: string }).message).toContain('nosuchobject');
  });
});

describe('object create', () => {
  it('POSTs createOneObject with the input wrapped under `object`', async () => {
    fetchStub.reply('/metadata', {
      data: {
        createOneObject: {
          id: 'obj-new',
          nameSingular: 'demoEntity',
          namePlural: 'demoEntities',
          labelSingular: 'Demo Entity',
          labelPlural: 'Demo Entities',
          icon: 'IconFlask',
          isCustom: true,
          isActive: true,
        },
      },
    });

    const file = writeFile('object.json', {
      nameSingular: 'demoEntity',
      namePlural: 'demoEntities',
      labelSingular: 'Demo Entity',
      labelPlural: 'Demo Entities',
      icon: 'IconFlask',
    });

    const { stdout } = await runCli(registerObjectCommands, ['object', 'create', '--file', file]);
    expect(stdout).toContain('created object obj-new (demoEntity)');

    const call = fetchStub.calls.find((c) =>
      (c.body as { query?: string } | undefined)?.query?.includes('createOneObject'),
    );
    const variables = (call!.body as { variables: { input: { object: Record<string, unknown> } } }).variables;
    expect(variables.input.object).toMatchObject({
      nameSingular: 'demoEntity',
      namePlural: 'demoEntities',
      labelSingular: 'Demo Entity',
      labelPlural: 'Demo Entities',
      icon: 'IconFlask',
    });
  });

  it('rejects an array-shaped input file with USAGE exit', async () => {
    const file = writeFile('bad.json', [{ nameSingular: 'a' }]);
    const err = await runCli(registerObjectCommands, ['object', 'create', '--file', file]).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('rejects an input missing a required field with USAGE exit + helpful message', async () => {
    const file = writeFile('incomplete.json', { nameSingular: 'demo' });
    const err = await runCli(registerObjectCommands, ['object', 'create', '--file', file]).catch((e: unknown) => e);
    expect((err as { exitCode?: number; message?: string }).exitCode).toBe(EXIT.USAGE);
    expect((err as { message: string }).message).toContain('namePlural');
  });
});

describe('object update', () => {
  it('PATCHes updateOneObject with {id, update: ...}', async () => {
    scriptObjectsList(fetchStub);
    fetchStub.reply('/metadata', {
      data: {
        updateOneObject: {
          id: 'obj-person',
          nameSingular: 'person',
          namePlural: 'people',
          labelSingular: 'Contact',
          labelPlural: 'People',
          icon: 'IconUser',
          isCustom: false,
          isActive: true,
        },
      },
    });

    const file = writeFile('patch.json', { labelSingular: 'Contact' });
    const { stdout } = await runCli(registerObjectCommands, ['object', 'update', 'person', '--file', file]);
    expect(stdout).toContain('updated object obj-person');

    const call = fetchStub.calls.find((c) =>
      (c.body as { query?: string } | undefined)?.query?.includes('updateOneObject'),
    );
    const v = (call!.body as { variables: { input: { id: string; update: Record<string, unknown> } } }).variables;
    expect(v.input.id).toBe('obj-person');
    expect(v.input.update).toEqual({ labelSingular: 'Contact' });
  });
});

describe('object delete', () => {
  it('DELETEs by resolving the ref to an id first', async () => {
    scriptObjectsList(fetchStub);
    fetchStub.reply('/metadata', { data: { deleteOneObject: { id: 'obj-person' } } });

    const { stdout } = await runCli(registerObjectCommands, ['object', 'delete', 'person']);
    expect(stdout).toContain('deleted object obj-person (person)');

    const call = fetchStub.calls.find((c) =>
      (c.body as { query?: string } | undefined)?.query?.includes('deleteOneObject'),
    );
    expect((call!.body as { variables: { input: { id: string } } }).variables.input.id).toBe('obj-person');
  });
});
