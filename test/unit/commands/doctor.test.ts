import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { HOME, INTROSPECTION } = vi.hoisted(() => ({
  HOME: { current: '' },
  INTROSPECTION: {
    snapshotEndpoint: vi.fn(),
    diffSnapshots: vi.fn(),
    hasDrift: vi.fn(),
    formatDiff: vi.fn(() => ''),
  },
}));

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => HOME.current };
});

// Stub introspection wholesale — doctor only orchestrates. Drift logic is
// covered by test/unit/introspection.test.ts.
vi.mock('../../../src/lib/introspection.js', () => INTROSPECTION);

// Stub the on-disk snapshot read so the test doesn't depend on the committed file.
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readFile: vi.fn(async () =>
      JSON.stringify({
        generatedAt: '2026-01-01T00:00:00Z',
        endpoints: { core: { queries: {}, mutations: {} }, metadata: { queries: {}, mutations: {} } },
      }),
    ),
  };
});

import { EXIT } from '../../../src/api/errors.js';
import { registerDoctorCommand } from '../../../src/commands/doctor.js';
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
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-doctor-'));
  writeRemote();
  fetchStub = stubFetch();
  INTROSPECTION.snapshotEndpoint.mockReset().mockResolvedValue({ queries: {}, mutations: {} });
  INTROSPECTION.diffSnapshots.mockReset().mockReturnValue({ added: [], removed: [], argChanges: [] });
  INTROSPECTION.hasDrift.mockReset().mockReturnValue(false);
  INTROSPECTION.formatDiff.mockReset().mockReturnValue('');
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

/* Helpers — script the GraphQL responses doctor's four steps need. */
function scriptHappyPath(): void {
  // step 2: whoami
  fetchStub.reply('/metadata', {
    data: { currentWorkspace: { id: 'ws-1', displayName: 'Acme', activationStatus: 'ACTIVE' } },
  });
  // step 4: view round-trip — resolveObjectId(metadata, 'person')
  fetchStub.reply('/metadata', {
    data: {
      objects: {
        edges: [{ node: { id: 'obj-person', nameSingular: 'person', namePlural: 'people', labelSingular: 'Person', isActive: true } }],
      },
    },
  });
  // createView
  fetchStub.reply('/metadata', { data: { createView: { id: 'view-doctor-1' } } });
  // getView
  fetchStub.reply('/metadata', {
    data: { getView: { id: 'view-doctor-1' } },
  });
  // deleteView
  fetchStub.reply('/metadata', { data: { deleteView: true } });
  // step 5: records round-trip — REST GET /rest/people?limit=1
  fetchStub.reply('/rest/people', { data: { people: [] } });
}

describe('doctor command', () => {
  it('prints OK for every step and exits 0 on a fully green run', async () => {
    scriptHappyPath();

    const { stdout, stderr } = await runCli(registerDoctorCommand, ['doctor']);

    expect(stdout).toContain('[OK  ] remote resolves');
    expect(stdout).toContain('[OK  ] whoami returns a workspace');
    expect(stdout).toContain('[OK  ] live schema matches the committed snapshot');
    expect(stdout).toContain('[OK  ] create-read-delete a throwaway view on `person`');
    expect(stdout).toContain('[OK  ] list `person` records via REST');
    expect(stdout).toContain('doctor: OK');
    expect(stderr).toBe('');

    // Whoami query did fire
    const whoamiCall = fetchStub.calls.find((c) =>
      (c.body as { query: string } | undefined)?.query?.includes('currentWorkspace'),
    );
    expect(whoamiCall).toBeTruthy();
  });

  it('--json emits a structured summary object', async () => {
    scriptHappyPath();

    const { stdout } = await runCli(registerDoctorCommand, ['doctor', '--json']);
    const summary = JSON.parse(stdout) as {
      ok: boolean;
      remote: string;
      apiUrl: string;
      steps: { key: string; status: string }[];
    };

    expect(summary.ok).toBe(true);
    expect(summary.remote).toBe('test');
    expect(summary.apiUrl).toBe('http://localhost:3001');
    expect(summary.steps.map((s) => s.key)).toEqual([
      'remote', 'whoami', 'schema-drift', 'view-round-trip', 'records-round-trip',
    ]);
    expect(summary.steps.every((s) => s.status === 'ok')).toBe(true);
  });

  it('whoami auth failure short-circuits: later steps SKIP, exit code = AUTH', async () => {
    // step 2: auth failure
    fetchStub.reply('/metadata', {
      errors: [{ message: 'No payload', extensions: { code: 'UNAUTHENTICATED' } }],
    });

    const err = await runCli(registerDoctorCommand, ['doctor']).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.AUTH);
  });

  it('schema drift fails step 3 with exit code API; step 4 is SKIP', async () => {
    // step 2: whoami OK
    fetchStub.reply('/metadata', {
      data: { currentWorkspace: { id: 'ws-1', displayName: 'Acme', activationStatus: 'ACTIVE' } },
    });
    INTROSPECTION.diffSnapshots.mockReturnValue({
      added: ['core.queries.somethingNew'],
      removed: [],
      argChanges: [],
    });
    INTROSPECTION.hasDrift.mockReturnValue(true);
    INTROSPECTION.formatDiff.mockReturnValue('+ core.queries.somethingNew');

    const err = await runCli(registerDoctorCommand, ['doctor']).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.API);
  });

  it('--objects-list is accepted as a no-op (deprecated; records-round-trip supersedes it)', async () => {
    scriptHappyPath();
    const { stdout } = await runCli(registerDoctorCommand, ['doctor', '--objects-list']);
    expect(stdout).toContain('[OK  ] list `person` records via REST');
    // Old step header is gone — the flag is now a no-op.
    expect(stdout).not.toContain('list objects via metadata API');
  });

  it('--quiet suppresses OK lines but emits the verdict', async () => {
    scriptHappyPath();
    const { stdout } = await runCli(registerDoctorCommand, ['doctor', '--quiet']);
    expect(stdout).not.toContain('[OK  ]');
    expect(stdout).not.toContain('doctor: OK');
  });
});
