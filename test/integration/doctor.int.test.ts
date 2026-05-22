import { beforeAll, describe, expect, it } from 'vitest';

import { registerDoctorCommand } from '../../src/commands/doctor.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote } from '../helpers/integration-setup.js';

const runDoctor = (...args: string[]) =>
  runCli(registerDoctorCommand, ['--remote', REMOTE, 'doctor', ...args]);

describe.skipIf(!INTEGRATION)('doctor integration', () => {
  beforeAll(assertLocalRemote);

  it('exits 0 with all green against the seeded stack', async () => {
    const { stdout } = await runDoctor();
    expect(stdout).toContain('[OK  ] remote resolves');
    expect(stdout).toContain('[OK  ] whoami returns a workspace');
    expect(stdout).toContain('[OK  ] live schema matches the committed snapshot');
    expect(stdout).toContain('[OK  ] create-read-delete a throwaway view on `person`');
    expect(stdout).toContain('doctor: OK');
  });

  it('--json emits a complete summary with ok=true', async () => {
    const { stdout } = await runDoctor('--json');
    const summary = JSON.parse(stdout.trim()) as {
      ok: boolean;
      remote: string;
      steps: { key: string; status: string }[];
    };
    expect(summary.ok).toBe(true);
    expect(summary.remote).toBe(REMOTE);
    expect(summary.steps.map((s) => `${s.key}:${s.status}`)).toEqual([
      'remote:ok',
      'whoami:ok',
      'schema-drift:ok',
      'view-round-trip:ok',
    ]);
  });
});
