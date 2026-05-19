import { execFileSync, spawnSync } from 'node:child_process';
import { URL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { resolveRemote } from '../../src/config/resolve-remote.js';

/*
 * End-to-end tests — exercise the built CLI against a REAL Twenty workspace.
 *
 * Gated behind TWENTY_E2E=1 so plain `npm test` (unit) stays hermetic.
 * A hard guard refuses to run against anything but a local stack — these
 * tests create and delete records, and Twenty's golden rule is "never test
 * against Cloud".
 *
 *   TWENTY_E2E=1 npm run test:e2e
 */
const E2E = process.env.TWENTY_E2E === '1';
const REMOTE = process.env.TWENTY_E2E_REMOTE ?? 'localhost';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const tag = `twenty-ops-e2e-${Date.now()}`;

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(...args: string[]): RunResult {
  const res = spawnSync('node', ['dist/cli.js', '--remote', REMOTE, ...args], {
    encoding: 'utf8',
  });
  return { status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/** Runs a command, asserts exit 0, and parses its single-line JSON output. */
function runJson(...args: string[]): Record<string, unknown> {
  const res = run(...args, '--json');
  expect(res.status, res.stderr).toBe(0);
  return JSON.parse(res.stdout.trim().split('\n')[0]!) as Record<string, unknown>;
}

describe.skipIf(!E2E)('e2e: view + nav + workflow lifecycle', () => {
  beforeAll(() => {
    // Refuse to touch anything that is not a local stack.
    const host = new URL(resolveRemote(REMOTE).apiUrl).hostname;
    if (!LOCAL_HOSTS.has(host)) {
      throw new Error(`refusing to run e2e against non-local host "${host}"`);
    }
    execFileSync('npm', ['run', 'build'], { stdio: 'ignore' });
  });

  it('creates, configures and deletes a view with a nav item', () => {
    const created = runJson('view', 'create', '--object', 'person', '--name', `${tag}-view`);
    const viewId = String(created.id);
    expect(viewId).toMatch(/^[0-9a-f-]{36}$/);

    let navId: string | undefined;
    try {
      const got = runJson('view', 'get', viewId);
      expect(got.name).toBe(`${tag}-view`);

      const nav = runJson('nav', 'add', '--view', viewId, '--name', `${tag}-nav`);
      navId = String(nav.id);
      expect(navId).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      if (navId) expect(run('nav', 'remove', navId).status).toBe(0);
      expect(run('view', 'delete', viewId).status).toBe(0);
    }
  });

  it('creates, edits and deletes a workflow', () => {
    const created = runJson('workflow', 'create', '--name', `${tag}-wf`);
    const workflowId = String(created.workflowId);
    const versionId = String(created.versionId);
    expect(workflowId).toMatch(/^[0-9a-f-]{36}$/);

    try {
      const trigger = JSON.stringify({ trigger: { type: 'MANUAL_TRIGGER', settings: {} } });
      const setRes = spawnSync(
        'node',
        ['dist/cli.js', '--remote', REMOTE, 'workflow', 'set-trigger', versionId, '--file', '-', '--json'],
        { encoding: 'utf8', input: trigger },
      );
      expect(setRes.status, setRes.stderr).toBe(0);

      const version = runJson('workflow', 'version', 'get', versionId);
      expect(version.trigger).toMatchObject({ type: 'MANUAL_TRIGGER' });
    } finally {
      expect(run('workflow', 'delete', workflowId).status).toBe(0);
    }
  });
});
