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
import { registerLogicFunctionCommands } from '../../../src/commands/logic-function.js';
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

const ID = '00000000-0000-4000-8000-000000000001';
const FN = { id: ID, name: 'sum', description: null, runtime: 'NODE', timeoutSeconds: 30, sourceHandlerPath: 'src/handler.ts', handlerName: 'main', applicationId: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-lf-cmd-'));
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

describe('logic-function list', () => {
  it('lists functions via findManyLogicFunctions under --json', async () => {
    fetchStub.reply('/metadata', { data: { findManyLogicFunctions: [FN] } });
    const { stdout } = await runCli(registerLogicFunctionCommands, ['logic-function', 'list', '--json']);
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { name: string });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('sum');
  });
});

describe('logic-function get', () => {
  it('resolves UUID and emits the matching function', async () => {
    fetchStub.reply('/metadata', { data: { findOneLogicFunction: FN } });
    fetchStub.reply('/metadata', { data: { findOneLogicFunction: FN } });
    const { stdout } = await runCli(registerLogicFunctionCommands, ['logic-function', 'get', ID, '--json']);
    const got = JSON.parse(stdout.trim()) as { id: string };
    expect(got.id).toBe(ID);
  });

  it('NOT_FOUND when findOneLogicFunction returns null after resolveLogicFunctionId succeeds', async () => {
    fetchStub.reply('/metadata', { data: { findOneLogicFunction: FN } });        // resolveLogicFunctionId
    fetchStub.reply('/metadata', { data: { findOneLogicFunction: null } });      // action's own fetch
    const err = await runCli(registerLogicFunctionCommands, ['logic-function', 'get', ID]).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });
});

describe('logic-function create', () => {
  it('sends createOneLogicFunction with the JSON file passed through verbatim', async () => {
    fetchStub.reply('/metadata', { data: { createOneLogicFunction: FN } });
    const metaFile = writeFile('meta.json', { name: 'sum', description: 'add two numbers', source: { foo: 'bar' } });
    await runCli(registerLogicFunctionCommands, [
      'logic-function', 'create', '--file', metaFile, '--json',
    ]);
    const createCall = fetchStub.calls.find((c) => /createOneLogicFunction/.test(JSON.stringify(c.body)));
    expect(createCall).toBeDefined();
    const body = createCall!.body as { variables: { input: { name: string; source: { foo: string } } } };
    expect(body.variables.input.name).toBe('sum');
    expect(body.variables.input.source.foo).toBe('bar');
  });

  it('USAGE when --file lacks required "name" field', async () => {
    const metaFile = writeFile('meta.json', { description: 'no name' });
    const err = await runCli(registerLogicFunctionCommands, ['logic-function', 'create', '--file', metaFile]).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });
});

describe('logic-function update', () => {
  it('wraps payload as { id, update } and re-fetches after Boolean mutation', async () => {
    fetchStub.reply('/metadata', { data: { findOneLogicFunction: FN } });        // resolveLogicFunctionId
    fetchStub.reply('/metadata', { data: { updateOneLogicFunction: true } });    // mutation
    fetchStub.reply('/metadata', { data: { findOneLogicFunction: { ...FN, description: 'new' } } }); // refetch
    const patchFile = writeFile('patch.json', { description: 'new' });
    const { stdout } = await runCli(registerLogicFunctionCommands, [
      'logic-function', 'update', ID,
      '--file', patchFile, '--json',
    ]);
    const updated = JSON.parse(stdout.trim()) as { description: string };
    expect(updated.description).toBe('new');

    const mutCall = fetchStub.calls.find((c) =>
      /updateOneLogicFunction/.test(JSON.stringify(c.body)),
    );
    expect(mutCall).toBeDefined();
    const body = mutCall!.body as { variables: { input: { id: string; update: Record<string, unknown> } } };
    expect(body.variables.input.id).toBe(ID);
    expect(body.variables.input.update.description).toBe('new');
  });

  it('passes sourceHandlerCode through when present in the JSON file', async () => {
    fetchStub.reply('/metadata', { data: { findOneLogicFunction: FN } });
    fetchStub.reply('/metadata', { data: { updateOneLogicFunction: true } });
    fetchStub.reply('/metadata', { data: { findOneLogicFunction: FN } });
    const patchFile = writeFile('patch.json', { sourceHandlerCode: 'export const main = () => 42;' });
    await runCli(registerLogicFunctionCommands, [
      'logic-function', 'update', ID, '--file', patchFile,
    ]);
    const mutCall = fetchStub.calls.find((c) =>
      /updateOneLogicFunction/.test(JSON.stringify(c.body)),
    );
    const body = mutCall!.body as { variables: { input: { update: { sourceHandlerCode: string } } } };
    expect(body.variables.input.update.sourceHandlerCode).toContain('=> 42');
  });
});

describe('logic-function delete', () => {
  it('calls deleteOneLogicFunction with { id }', async () => {
    fetchStub.reply('/metadata', { data: { findOneLogicFunction: FN } });  // resolveLogicFunctionId
    fetchStub.reply('/metadata', { data: { deleteOneLogicFunction: { id: ID } } });
    await runCli(registerLogicFunctionCommands, ['logic-function', 'delete', ID]);
    const delCall = fetchStub.calls.find((c) =>
      /deleteOneLogicFunction/.test(JSON.stringify(c.body)),
    );
    const body = delCall!.body as { variables: { input: { id: string } } };
    expect(body.variables.input.id).toBe(ID);
  });
});

describe('logic-function execute', () => {
  it('passes --input JSON as the payload variable', async () => {
    fetchStub.reply('/metadata', { data: { findOneLogicFunction: FN } });
    fetchStub.reply('/metadata', { data: { executeOneLogicFunction: { data: { result: 5 }, logs: '', duration: 12, status: 'SUCCESS', error: null } } });
    const { stdout } = await runCli(registerLogicFunctionCommands, [
      'logic-function', 'execute', ID,
      '--input', '{"a":2,"b":3}',
      '--json',
    ]);
    const r = JSON.parse(stdout.trim()) as { status: string; data: { result: number } };
    expect(r.status).toBe('SUCCESS');
    expect(r.data.result).toBe(5);

    const execCall = fetchStub.calls.find((c) =>
      /executeOneLogicFunction/.test(JSON.stringify(c.body)),
    );
    const body = execCall!.body as { variables: { input: { id: string; payload: { a: number; b: number } } } };
    expect(body.variables.input.payload).toEqual({ a: 2, b: 3 });
  });

  it('USAGE when --input is not valid JSON', async () => {
    fetchStub.reply('/metadata', { data: { findOneLogicFunction: FN } });
    const err = await runCli(registerLogicFunctionCommands, [
      'logic-function', 'execute', ID, '--input', 'not-json',
    ]).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('USAGE when both --input and --input-file are passed', async () => {
    const file = writeFile('p.json', { a: 1 });
    const err = await runCli(registerLogicFunctionCommands, [
      'logic-function', 'execute', ID,
      '--input', '{}', '--input-file', file,
    ]).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('exits API when status !== SUCCESS', async () => {
    fetchStub.reply('/metadata', { data: { findOneLogicFunction: FN } });
    fetchStub.reply('/metadata', { data: { executeOneLogicFunction: { data: null, logs: 'oops', duration: 1, status: 'FAILED', error: 'TypeError' } } });
    const err = await runCli(registerLogicFunctionCommands, [
      'logic-function', 'execute', ID, '--input', '{}',
    ]).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.API);
  });
});

describe('logic-function source', () => {
  it('prints the raw source code in text mode', async () => {
    fetchStub.reply('/metadata', { data: { findOneLogicFunction: FN } });
    fetchStub.reply('/metadata', { data: { getLogicFunctionSourceCode: 'export function main(){return 1}\n' } });
    const { stdout } = await runCli(registerLogicFunctionCommands, ['logic-function', 'source', ID]);
    expect(stdout).toContain('export function main');
  });

  it('wraps as { id, source } under --json', async () => {
    fetchStub.reply('/metadata', { data: { findOneLogicFunction: FN } });
    fetchStub.reply('/metadata', { data: { getLogicFunctionSourceCode: 'X' } });
    const { stdout } = await runCli(registerLogicFunctionCommands, ['logic-function', 'source', ID, '--json']);
    const r = JSON.parse(stdout.trim()) as { id: string; source: string };
    expect(r.id).toBe(ID);
    expect(r.source).toBe('X');
  });
});
