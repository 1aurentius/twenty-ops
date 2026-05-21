import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerWorkflowCommands } from '../../src/commands/workflow.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote, tag } from '../helpers/integration-setup.js';

const TAG = `wf-int-${tag()}`;
const runWf = (...args: string[]) => runCli(registerWorkflowCommands, ['--remote', REMOTE, 'workflow', ...args]);

describe.skipIf(!INTEGRATION)('workflow integration', () => {
  const cleanup: string[] = [];

  beforeAll(assertLocalRemote);
  afterAll(async () => {
    for (const id of cleanup) await runWf('delete', id).catch(() => undefined);
  });

  it('creates a workflow with an auto-generated draft version, sets a trigger, and deletes', async () => {
    const created = await runWf('create', '--name', `${TAG}-wf`, '--json');
    const { workflowId, versionId } = JSON.parse(created.stdout.trim()) as { workflowId: string; versionId: string };
    cleanup.push(workflowId);

    expect(workflowId).toMatch(/^[0-9a-f-]{36}$/);
    expect(versionId).toMatch(/^[0-9a-f-]{36}$/);

    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const file = join(mkdtempSync(join(tmpdir(), 'wf-int-')), 'trigger.json');
    writeFileSync(file, JSON.stringify({ type: 'MANUAL_TRIGGER', settings: {} }));

    await runWf('set-trigger', versionId, '--file', file);

    const got = await runWf('version', 'get', versionId, '--json');
    const ver = JSON.parse(got.stdout.trim()) as { trigger: { type: string } };
    expect(ver.trigger.type).toBe('MANUAL_TRIGGER');

    await runWf('delete', workflowId);
    cleanup.pop();
  });

  it('returns NOT_FOUND for a bogus workflow id', async () => {
    const err = await runWf('get', '00000000-0000-4000-8000-000000000000').catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });
});
