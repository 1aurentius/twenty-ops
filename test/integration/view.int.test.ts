import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerViewCommands } from '../../src/commands/view.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote, firstFieldId, tag } from '../helpers/integration-setup.js';

const TAG = `view-int-${tag()}`;
const runView = (...args: string[]) => runCli(registerViewCommands, ['--remote', REMOTE, 'view', ...args]);

describe.skipIf(!INTEGRATION)('view integration', () => {
  /** Track every view created so afterAll can clean up even on test failure. */
  const cleanup: string[] = [];

  beforeAll(assertLocalRemote);
  afterAll(async () => {
    for (const id of cleanup) {
      await runView('delete', id).catch(() => { /* best-effort */ });
    }
  });

  it('CRUD: create, get, update, delete', async () => {
    const created = await runView(
      'create', '--object', 'person', '--name', `${TAG}-crud`, '--icon', 'IconLayoutList', '--json',
    );
    const view = JSON.parse(created.stdout.trim()) as { id: string; name: string };
    cleanup.push(view.id);
    expect(view.name).toBe(`${TAG}-crud`);

    const got = await runView('get', view.id, '--json');
    expect(JSON.parse(got.stdout.trim())).toMatchObject({ id: view.id, name: `${TAG}-crud` });

    await runView('update', view.id, '--name', `${TAG}-renamed`);
    const reread = await runView('get', view.id, '--json');
    expect((JSON.parse(reread.stdout.trim()) as { name: string }).name).toBe(`${TAG}-renamed`);

    await runView('delete', view.id);
    cleanup.pop();

    const err = await runView('get', view.id).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('set-fields reconciles a view to the desired field set', async () => {
    const created = await runView('create', '--object', 'person', '--name', `${TAG}-fields`, '--json');
    const viewId = (JSON.parse(created.stdout.trim()) as { id: string }).id;
    cleanup.push(viewId);

    const fieldId = await firstFieldId('person', 'name');
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const file = join(mkdtempSync(join(tmpdir(), 'view-int-')), 'fields.json');
    writeFileSync(file, JSON.stringify([
      { fieldMetadataId: fieldId, isVisible: true, size: 200, position: 0 },
    ]));

    // First reconcile: 1 create
    const r1 = await runView('set-fields', viewId, '--file', file, '--json');
    expect(JSON.parse(r1.stdout.trim())).toMatchObject({ what: 'fields', created: 1, updated: 0, deleted: 0 });

    // Second reconcile, same file: no-op
    const r2 = await runView('set-fields', viewId, '--file', file, '--json');
    expect(JSON.parse(r2.stdout.trim())).toMatchObject({ created: 0, updated: 0, deleted: 0, unchanged: 1 });
  });

  it('returns NOT_FOUND for a bogus view id', async () => {
    const err = await runView('get', '00000000-0000-4000-8000-000000000000').catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });
});
