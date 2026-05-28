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
import { registerSkillCommands } from '../../../src/commands/skill.js';
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

const ID = '00000000-0000-4000-8000-000000000001';
const SK = { id: ID, name: 'summarize', label: 'Summarize', icon: null, description: null, content: '...', isCustom: true, isActive: true, applicationId: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' };

interface GqlBody { query: string; variables?: Record<string, unknown> }
const body = (call: { body: unknown }): GqlBody => call.body as GqlBody;

const runSk = (...args: string[]) => runCli(registerSkillCommands, ['skill', ...args]);

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-skill-cmd-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('skill list', () => {
  it('emits skills (without content) as JSON Lines under --json', async () => {
    fetchStub.reply('/metadata', { data: { skills: [SK] } });
    const { stdout } = await runSk('list', '--json');
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(rows[0]?.id).toBe(ID);
    // content is stripped from list output
    expect(rows[0]?.content).toBeUndefined();
  });
});

describe('skill get', () => {
  it('resolves a unique name and emits the skill (with content)', async () => {
    fetchStub.reply('/metadata', { data: { skills: [SK] } }); // resolveSkillId
    fetchStub.reply('/metadata', { data: { skill: SK } });   // action fetch
    const { stdout } = await runSk('get', 'summarize', '--json');
    const got = JSON.parse(stdout.trim()) as { id: string; content: string };
    expect(got.id).toBe(ID);
    expect(got.content).toBe('...');
  });

  it('NOT_FOUND for an unknown skill name', async () => {
    fetchStub.reply('/metadata', { data: { skills: [SK] } });
    const err = await runSk('get', 'noSuchSkill').catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });
});

describe('skill create', () => {
  it('USAGE when --file lacks name', async () => {
    const f = writeFile('s.json', { label: 'Hi', content: 'x' });
    const err = await runSk('create', '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('USAGE when --file lacks content', async () => {
    const f = writeFile('s.json', { name: 'n', label: 'L' });
    const err = await runSk('create', '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('passes CreateSkillInput verbatim', async () => {
    const f = writeFile('s.json', { name: 'summarize', label: 'Summarize', content: 'system prompt' });
    fetchStub.reply('/metadata', { data: { createSkill: SK } });
    await runSk('create', '--file', f);
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('createSkill(input: $input)');
    expect(body(call).variables?.input).toMatchObject({ name: 'summarize', label: 'Summarize', content: 'system prompt' });
  });
});

describe('skill update', () => {
  it('merges id into the update input (no wrapper)', async () => {
    fetchStub.reply('/metadata', { data: { skill: { id: ID } } });   // resolveSkillId
    const f = writeFile('patch.json', { label: 'Renamed' });
    fetchStub.reply('/metadata', { data: { updateSkill: SK } });
    await runSk('update', ID, '--file', f);
    const updCall = fetchStub.calls.find((c) => /updateSkill/.test(JSON.stringify(c.body)));
    expect(updCall).toBeDefined();
    const b = body(updCall!).variables?.input as { id: string; label: string };
    expect(b.id).toBe(ID);
    expect(b.label).toBe('Renamed');
  });
});

describe('skill activate/deactivate/delete', () => {
  it('activate calls activateSkill', async () => {
    fetchStub.reply('/metadata', { data: { skill: { id: ID } } });
    fetchStub.reply('/metadata', { data: { activateSkill: SK } });
    await runSk('activate', ID);
    const call = fetchStub.calls.find((c) => /activateSkill/.test(JSON.stringify(c.body)));
    expect(call).toBeDefined();
    expect(body(call!).variables).toEqual({ id: ID });
  });

  it('deactivate calls deactivateSkill', async () => {
    fetchStub.reply('/metadata', { data: { skill: { id: ID } } });
    fetchStub.reply('/metadata', { data: { deactivateSkill: SK } });
    await runSk('deactivate', ID);
    const call = fetchStub.calls.find((c) => /deactivateSkill/.test(JSON.stringify(c.body)));
    expect(call).toBeDefined();
  });

  it('delete calls deleteSkill', async () => {
    fetchStub.reply('/metadata', { data: { skill: { id: ID } } });
    fetchStub.reply('/metadata', { data: { deleteSkill: { id: ID } } });
    await runSk('delete', ID);
    const call = fetchStub.calls.find((c) => /deleteSkill/.test(JSON.stringify(c.body)));
    expect(call).toBeDefined();
    expect(body(call!).variables).toEqual({ id: ID });
  });
});
