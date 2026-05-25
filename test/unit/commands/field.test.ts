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
import { registerFieldCommands } from '../../../src/commands/field.js';
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

function scriptObjectsList(stub: FetchStub): void {
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
            },
          },
        ],
      },
    },
  });
}

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-field-'));
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

describe('field list', () => {
  it('resolves --object name, queries fields with filter, and prints rows', async () => {
    scriptObjectsList(fetchStub);
    fetchStub.reply('/metadata', {
      data: {
        fields: {
          edges: [
            { node: { id: 'f1', name: 'name', label: 'Name', type: 'FULL_NAME', isCustom: false, isActive: true, isNullable: false, objectMetadataId: 'obj-person', description: null, icon: null } },
            { node: { id: 'f2', name: 'inactive', label: 'Inactive', type: 'TEXT', isCustom: false, isActive: false, isNullable: true, objectMetadataId: 'obj-person', description: null, icon: null } },
          ],
        },
      },
    });
    const { stdout } = await runCli(registerFieldCommands, ['field', 'list', '--object', 'person']);
    expect(stdout).toContain('name');
    expect(stdout).not.toContain('inactive');

    const listCall = fetchStub.calls.find((c) =>
      (c.body as { query?: string } | undefined)?.query?.includes('fields(filter:'),
    );
    expect((listCall!.body as { variables: { id: string } }).variables.id).toBe('obj-person');
  });

  it('--include-inactive shows everything', async () => {
    scriptObjectsList(fetchStub);
    fetchStub.reply('/metadata', {
      data: {
        fields: {
          edges: [
            { node: { id: 'f1', name: 'name', label: 'Name', type: 'TEXT', isCustom: false, isActive: true, isNullable: false, objectMetadataId: 'obj-person', description: null, icon: null } },
            { node: { id: 'f2', name: 'inactive', label: 'Inactive', type: 'TEXT', isCustom: false, isActive: false, isNullable: true, objectMetadataId: 'obj-person', description: null, icon: null } },
          ],
        },
      },
    });
    const { stdout } = await runCli(registerFieldCommands, ['field', 'list', '--object', 'person', '--include-inactive']);
    expect(stdout).toContain('inactive');
  });
});

describe('field get', () => {
  it('queries field(id) and emits all fields under --json', async () => {
    fetchStub.reply('/metadata', {
      data: {
        field: {
          id: 'f-sel',
          name: 'category',
          label: 'Category',
          type: 'SELECT',
          isCustom: true,
          isActive: true,
          isNullable: true,
          objectMetadataId: 'obj-person',
          description: null,
          icon: null,
          options: [{ value: 'A', label: 'A', color: 'red', position: 0 }],
        },
      },
    });
    const { stdout } = await runCli(registerFieldCommands, ['field', 'get', 'f-sel', '--json']);
    const got = JSON.parse(stdout.trim());
    expect(got.type).toBe('SELECT');
    expect(got.options).toHaveLength(1);
  });

  it('returns NOT_FOUND with the id in the message', async () => {
    fetchStub.reply('/metadata', { data: { field: null } });
    const err = await runCli(registerFieldCommands, ['field', 'get', 'f-nope']).catch((e: unknown) => e);
    expect((err as { exitCode?: number; message?: string }).exitCode).toBe(EXIT.NOT_FOUND);
    expect((err as { message: string }).message).toContain('f-nope');
  });
});

describe('field create', () => {
  it('POSTs createOneField with input.field including the resolved objectMetadataId', async () => {
    scriptObjectsList(fetchStub);
    fetchStub.reply('/metadata', {
      data: {
        createOneField: {
          id: 'f-new', name: 'demoText', label: 'Demo Text', type: 'TEXT',
          isCustom: true, isActive: true, isNullable: true,
          objectMetadataId: 'obj-person', description: null, icon: null,
        },
      },
    });

    const file = writeFile('field.json', {
      name: 'demoText',
      label: 'Demo Text',
      type: 'TEXT',
    });

    const { stdout } = await runCli(registerFieldCommands, ['field', 'create', '--object', 'person', '--file', file]);
    expect(stdout).toContain('created field f-new (demoText)');

    const call = fetchStub.calls.find((c) =>
      (c.body as { query?: string } | undefined)?.query?.includes('createOneField'),
    );
    const v = (call!.body as { variables: { input: { field: Record<string, unknown> } } }).variables;
    expect(v.input.field).toMatchObject({
      name: 'demoText',
      label: 'Demo Text',
      type: 'TEXT',
      objectMetadataId: 'obj-person',
    });
  });

  it('USAGE error when input lacks required fields', async () => {
    const file = writeFile('bad.json', { name: 'demoText' }); // missing label, type
    const err = await runCli(registerFieldCommands, ['field', 'create', '--object', 'person', '--file', file]).catch((e: unknown) => e);
    expect((err as { exitCode?: number; message?: string }).exitCode).toBe(EXIT.USAGE);
    expect((err as { message: string }).message).toMatch(/label|type/);
  });
});

describe('field update', () => {
  it('PATCHes updateOneField with {id, update: ...}', async () => {
    fetchStub.reply('/metadata', {
      data: {
        updateOneField: {
          id: 'f1', name: 'demoText', label: 'Renamed', type: 'TEXT',
          isCustom: true, isActive: true, isNullable: true,
          objectMetadataId: 'obj-person', description: null, icon: null,
        },
      },
    });

    const file = writeFile('patch.json', { label: 'Renamed' });
    const { stdout } = await runCli(registerFieldCommands, ['field', 'update', 'f1', '--file', file]);
    expect(stdout).toContain('updated field f1');

    const call = fetchStub.calls[0]!;
    const v = (call.body as { variables: { input: { id: string; update: Record<string, unknown> } } }).variables;
    expect(v.input.id).toBe('f1');
    expect(v.input.update).toEqual({ label: 'Renamed' });
  });
});

describe('field delete', () => {
  it('issues deleteOneField by id', async () => {
    fetchStub.reply('/metadata', { data: { deleteOneField: { id: 'f1' } } });

    const { stdout } = await runCli(registerFieldCommands, ['field', 'delete', 'f1']);
    expect(stdout).toContain('deleted field f1');

    const call = fetchStub.calls[0]!;
    expect((call.body as { variables: { input: { id: string } } }).variables.input.id).toBe('f1');
  });
});
