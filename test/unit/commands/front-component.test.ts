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
import { registerFrontComponentCommands } from '../../../src/commands/front-component.js';
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

const FC_ID = '11111111-1111-4111-8111-111111111111';
const FC = {
  id: FC_ID, name: 'AcmeWidget', description: null,
  componentName: 'AcmeWidget',
  sourceComponentPath: 'src/AcmeWidget.tsx',
  builtComponentPath: 'dist/AcmeWidget.js',
  builtComponentChecksum: 'sha256:xyz',
  applicationId: '00000000-0000-4000-8000-000000000000',
  universalIdentifier: null, isHeadless: false, usesSdkClient: false,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

interface GqlBody { query: string; variables?: Record<string, unknown> }
const body = (call: { body: unknown }): GqlBody => call.body as GqlBody;

const runFc = (...args: string[]) => runCli(registerFrontComponentCommands, ['front-component', ...args]);

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-fc-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('front-component list/get', () => {
  it('list calls frontComponents()', async () => {
    fetchStub.reply('/metadata', { data: { frontComponents: [FC] } });
    const { stdout } = await runFc('list', '--json');
    expect(JSON.parse(stdout.trim().split('\n')[0]!).id).toBe(FC_ID);
  });

  it('get NOT_FOUND on null', async () => {
    fetchStub.reply('/metadata', { data: { frontComponent: null } });
    const err = await runFc('get', FC_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });
});

describe('front-component create', () => {
  it('USAGE when required field is missing', async () => {
    const f = writeFile('fc.json', { name: 'X', componentName: 'X', sourceComponentPath: 's', builtComponentPath: 'b' });
    // missing builtComponentChecksum
    const err = await runFc('create', '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('passes the full input verbatim', async () => {
    const f = writeFile('fc.json', {
      name: 'AcmeWidget', componentName: 'AcmeWidget',
      sourceComponentPath: 'src/AcmeWidget.tsx',
      builtComponentPath: 'dist/AcmeWidget.js',
      builtComponentChecksum: 'sha256:xyz',
    });
    fetchStub.reply('/metadata', { data: { createFrontComponent: FC } });
    await runFc('create', '--file', f);
    expect(body(fetchStub.calls[0]!).variables?.input).toMatchObject({
      name: 'AcmeWidget', componentName: 'AcmeWidget',
    });
  });
});

describe('front-component update/delete', () => {
  it('update wraps as { id, update }', async () => {
    const f = writeFile('patch.json', { name: 'Renamed' });
    fetchStub.reply('/metadata', { data: { updateFrontComponent: FC } });
    await runFc('update', FC_ID, '--file', f);
    expect(body(fetchStub.calls[0]!).variables?.input).toEqual({ id: FC_ID, update: { name: 'Renamed' } });
  });

  it('delete passes id', async () => {
    fetchStub.reply('/metadata', { data: { deleteFrontComponent: { id: FC_ID } } });
    await runFc('delete', FC_ID);
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: FC_ID });
  });
});
