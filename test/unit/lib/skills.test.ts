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
import { deriveEndpoints } from '../../../src/api/endpoints.js';
import { GraphQLClient } from '../../../src/api/graphql-client.js';
import { resolveRemote } from '../../../src/config/resolve-remote.js';
import { listSkills, resolveSkillId } from '../../../src/lib/skills.js';
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

function makeCtx() {
  const remote = resolveRemote('test');
  const ep = deriveEndpoints(remote.apiUrl);
  return {
    metadata: new GraphQLClient(ep.metadata, remote.apiKey),
    core: new GraphQLClient(ep.core, remote.apiKey),
    out: {} as Record<string, never>,
    remote,
    rest: { get: () => { throw new Error('not used'); }, post: () => { throw new Error('not used'); }, patch: () => { throw new Error('not used'); }, delete: () => { throw new Error('not used'); } },
  };
}

const ID1 = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';
const SKILLS = [
  { id: ID1, name: 'summarize', label: 'Summarize', icon: null, description: null, content: '...', isCustom: true, isActive: true, applicationId: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: ID2, name: 'classify', label: 'Classify', icon: null, description: null, content: '...', isCustom: true, isActive: false, applicationId: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
];

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-skills-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('listSkills', () => {
  it('issues `skills` query and returns the rows', async () => {
    fetchStub.reply('/metadata', { data: { skills: SKILLS } });
    const rows = await listSkills(makeCtx().metadata);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.name).toBe('summarize');
  });
});

describe('resolveSkillId', () => {
  it('passes UUID through after confirming existence', async () => {
    fetchStub.reply('/metadata', { data: { skill: { id: ID1 } } });
    const id = await resolveSkillId(makeCtx() as unknown as Parameters<typeof resolveSkillId>[0], ID1);
    expect(id).toBe(ID1);
  });

  it('NOT_FOUND for an unknown UUID', async () => {
    fetchStub.reply('/metadata', { data: { skill: null } });
    const err = await resolveSkillId(makeCtx() as unknown as Parameters<typeof resolveSkillId>[0], '00000000-0000-4000-8000-000000000099').catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('resolves a unique name to its id', async () => {
    fetchStub.reply('/metadata', { data: { skills: SKILLS } });
    const id = await resolveSkillId(makeCtx() as unknown as Parameters<typeof resolveSkillId>[0], 'classify');
    expect(id).toBe(ID2);
  });

  it('NOT_FOUND when name does not match any skill, lists candidates', async () => {
    fetchStub.reply('/metadata', { data: { skills: SKILLS } });
    const err = await resolveSkillId(makeCtx() as unknown as Parameters<typeof resolveSkillId>[0], 'nope').catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
    expect((err as { message: string }).message).toContain('summarize');
  });

  it('USAGE when name is ambiguous', async () => {
    fetchStub.reply('/metadata', { data: { skills: [SKILLS[0], { ...SKILLS[1], name: 'summarize' }] } });
    const err = await resolveSkillId(makeCtx() as unknown as Parameters<typeof resolveSkillId>[0], 'summarize').catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });
});
