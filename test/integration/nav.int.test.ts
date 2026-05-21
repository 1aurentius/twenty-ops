import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerNavCommands } from '../../src/commands/nav.js';
import { registerViewCommands } from '../../src/commands/view.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote, tag } from '../helpers/integration-setup.js';

const TAG = `nav-int-${tag()}`;
const runNav = (...args: string[]) => runCli(registerNavCommands, ['--remote', REMOTE, 'nav', ...args]);
const runView = (...args: string[]) => runCli(registerViewCommands, ['--remote', REMOTE, 'view', ...args]);

describe.skipIf(!INTEGRATION)('nav integration', () => {
  const cleanupNav: string[] = [];
  const cleanupViews: string[] = [];

  beforeAll(assertLocalRemote);
  afterAll(async () => {
    for (const id of cleanupNav) await runNav('remove', id).catch(() => undefined);
    for (const id of cleanupViews) await runView('delete', id).catch(() => undefined);
  });

  it('adds + removes a --view item bound to a real view', async () => {
    const v = await runView('create', '--object', 'person', '--name', `${TAG}-view`, '--json');
    const viewId = (JSON.parse(v.stdout.trim()) as { id: string }).id;
    cleanupViews.push(viewId);

    const added = await runNav('add', '--view', viewId, '--name', `${TAG}-vnav`, '--icon', 'IconFlame', '--json');
    const navItem = JSON.parse(added.stdout.trim()) as { id: string; type: string; viewId: string };
    cleanupNav.push(navItem.id);
    expect(navItem.type).toBe('VIEW');
    expect(navItem.viewId).toBe(viewId);

    await runNav('remove', navItem.id);
    cleanupNav.pop();
  });

  it('adds + removes a --folder item', async () => {
    const added = await runNav('add', '--folder', '--name', `${TAG}-folder`, '--json');
    const item = JSON.parse(added.stdout.trim()) as { id: string; type: string };
    cleanupNav.push(item.id);
    expect(item.type).toBe('FOLDER');

    await runNav('remove', item.id);
    cleanupNav.pop();
  });

  it('adds + removes a --link item', async () => {
    const added = await runNav('add', '--link', 'https://example.com', '--name', `${TAG}-link`, '--json');
    const item = JSON.parse(added.stdout.trim()) as { id: string; type: string; link: string };
    cleanupNav.push(item.id);
    expect(item.type).toBe('LINK');
    expect(item.link).toBe('https://example.com');

    await runNav('remove', item.id);
    cleanupNav.pop();
  });
});
