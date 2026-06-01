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
import { registerPageLayoutCommands } from '../../../src/commands/page-layout.js';
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

const PL_ID = '11111111-1111-4111-8111-111111111111';
const OBJ_ID = '22222222-2222-4222-8222-222222222222';

const PL = {
  id: PL_ID, name: 'Person detail', type: 'RECORD_PAGE', objectMetadataId: OBJ_ID,
  createdAt: '2026-05-25T00:00:00Z', updatedAt: '2026-05-25T00:00:00Z',
};

interface GqlBody { query: string; variables?: Record<string, unknown> }
const body = (call: { body: unknown }): GqlBody => call.body as GqlBody;

const runPl = (...args: string[]) => runCli(registerPageLayoutCommands, ['page-layout', ...args]);

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-pl-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('page-layout list', () => {
  it('resolves --object name to an id, then calls getPageLayouts with type', async () => {
    fetchStub.reply('/metadata', {
      data: { objects: { edges: [{ node: { id: OBJ_ID, nameSingular: 'person', namePlural: 'people', labelSingular: 'Person', isActive: true } }] } },
    });
    fetchStub.reply('/metadata', { data: { getPageLayouts: [PL] } });

    await runPl('list', '--object', 'person', '--type', 'record_page', '--json');

    expect(body(fetchStub.calls[1]!).variables).toEqual({
      objectMetadataId: OBJ_ID,
      pageLayoutType: 'RECORD_PAGE',
    });
  });

  it('--type is optional', async () => {
    fetchStub.reply('/metadata', { data: { getPageLayouts: [] } });
    await runPl('list', '--object', OBJ_ID, '--json');
    expect(body(fetchStub.calls[0]!).variables).toEqual({
      objectMetadataId: OBJ_ID,
      pageLayoutType: undefined,
    });
  });
});

describe('page-layout get', () => {
  it('NOT_FOUND when getPageLayout returns null', async () => {
    fetchStub.reply('/metadata', { data: { getPageLayout: null } });
    const err = await runPl('get', PL_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('emits the layout as JSON', async () => {
    fetchStub.reply('/metadata', { data: { getPageLayout: PL } });
    const { stdout } = await runPl('get', PL_ID, '--json');
    expect(JSON.parse(stdout.trim())).toMatchObject({ id: PL_ID, name: 'Person detail' });
  });
});

describe('page-layout create', () => {
  it('USAGE when --file is missing required name', async () => {
    const f = writeFile('pl.json', { type: 'RECORD_PAGE' });
    const err = await runPl('create', '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('sends CreatePageLayoutInput verbatim', async () => {
    const f = writeFile('pl.json', { name: 'Dashboard', type: 'DASHBOARD' });
    fetchStub.reply('/metadata', { data: { createPageLayout: PL } });
    await runPl('create', '--file', f, '--json');
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('createPageLayout(input: $input)');
    expect(body(call).variables?.input).toMatchObject({ name: 'Dashboard', type: 'DASHBOARD' });
  });
});

describe('page-layout update', () => {
  it('uses (id, input) shape (NOT the {id,update} wrapper)', async () => {
    const f = writeFile('patch.json', { name: 'Renamed' });
    fetchStub.reply('/metadata', { data: { updatePageLayout: PL } });
    await runPl('update', PL_ID, '--file', f);
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('updatePageLayout(id: $id, input: $input)');
    expect(body(call).variables).toEqual({ id: PL_ID, input: { name: 'Renamed' } });
  });
});

describe('page-layout delete', () => {
  it('calls destroyPageLayout (hard delete) with just the id', async () => {
    fetchStub.reply('/metadata', { data: { destroyPageLayout: true } });
    await runPl('delete', PL_ID);
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('destroyPageLayout(id: $id)');
    expect(body(call).variables).toEqual({ id: PL_ID });
  });
});

describe('page-layout reset', () => {
  it('calls resetPageLayoutToDefault with the id', async () => {
    fetchStub.reply('/metadata', { data: { resetPageLayoutToDefault: PL } });
    await runPl('reset', PL_ID);
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('resetPageLayoutToDefault(id: $id)');
    expect(body(call).variables).toEqual({ id: PL_ID });
  });
});

describe('page-layout sync', () => {
  it('USAGE when required field is missing', async () => {
    const f = writeFile('s.json', { name: 'X', type: 'RECORD_PAGE' }); // missing tabs
    const err = await runPl('sync', PL_ID, '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('calls updatePageLayoutWithTabsAndWidgets with (id, input)', async () => {
    fetchStub.reply('/metadata', { data: { updatePageLayoutWithTabsAndWidgets: PL } });
    const f = writeFile('s.json', { name: 'X', type: 'RECORD_PAGE', tabs: [{ title: 'Main', widgets: [] }] });
    await runPl('sync', PL_ID, '--file', f);
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('updatePageLayoutWithTabsAndWidgets(id: $id, input: $input)');
    expect(body(call).variables?.input).toMatchObject({ name: 'X', type: 'RECORD_PAGE' });
    expect((body(call).variables?.input as { tabs: unknown[] }).tabs).toHaveLength(1);
  });
});

const TAB_ID = '33333333-3333-4333-8333-333333333333';
const TAB = {
  id: TAB_ID, title: 'Overview', position: 0, pageLayoutId: PL_ID,
  icon: null, layoutMode: 'GRID', isActive: true,
  createdAt: '2026-05-25T00:00:00Z', updatedAt: '2026-05-25T00:00:00Z',
};

describe('page-layout tab list/get', () => {
  it('list calls getPageLayoutTabs with the page layout id', async () => {
    fetchStub.reply('/metadata', { data: { getPageLayoutTabs: [TAB] } });
    const { stdout } = await runPl('tab', 'list', PL_ID, '--json');
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { id: string });
    expect(rows[0]?.id).toBe(TAB_ID);
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: PL_ID });
  });

  it('get NOT_FOUND when getPageLayoutTab returns null', async () => {
    fetchStub.reply('/metadata', { data: { getPageLayoutTab: null } });
    const err = await runPl('tab', 'get', TAB_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });
});

describe('page-layout tab create', () => {
  it('USAGE when --file lacks title', async () => {
    const f = writeFile('tab.json', { position: 0 });
    const err = await runPl('tab', 'create', '--page-layout', PL_ID, '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('merges --page-layout into the input as pageLayoutId', async () => {
    const f = writeFile('tab.json', { title: 'Overview', position: 0, layoutMode: 'GRID' });
    fetchStub.reply('/metadata', { data: { createPageLayoutTab: TAB } });
    await runPl('tab', 'create', '--page-layout', PL_ID, '--file', f, '--json');
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('createPageLayoutTab(input: $input)');
    expect(body(call).variables?.input).toMatchObject({
      pageLayoutId: PL_ID,
      title: 'Overview',
      position: 0,
      layoutMode: 'GRID',
    });
  });
});

describe('page-layout tab update/delete/reset', () => {
  it('update uses (id, input) shape', async () => {
    const f = writeFile('patch.json', { title: 'Renamed', icon: 'IconLayoutBoard' });
    fetchStub.reply('/metadata', { data: { updatePageLayoutTab: TAB } });
    await runPl('tab', 'update', TAB_ID, '--file', f);
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('updatePageLayoutTab(id: $id, input: $input)');
    expect(body(call).variables).toEqual({ id: TAB_ID, input: { title: 'Renamed', icon: 'IconLayoutBoard' } });
  });

  it('delete calls destroyPageLayoutTab', async () => {
    fetchStub.reply('/metadata', { data: { destroyPageLayoutTab: true } });
    await runPl('tab', 'delete', TAB_ID);
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('destroyPageLayoutTab(id: $id)');
    expect(body(call).variables).toEqual({ id: TAB_ID });
  });

  it('reset calls resetPageLayoutTabToDefault', async () => {
    fetchStub.reply('/metadata', { data: { resetPageLayoutTabToDefault: TAB } });
    await runPl('tab', 'reset', TAB_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('resetPageLayoutTabToDefault(id: $id)');
  });
});

const WID_ID = '44444444-4444-4444-8444-444444444444';
const WID = {
  id: WID_ID, title: 'Recent activity', type: 'VIEW', pageLayoutTabId: TAB_ID,
  objectMetadataId: OBJ_ID,
  conditionalDisplay: null, conditionalAvailabilityExpression: null,
  isActive: true, createdAt: '2026-05-25T00:00:00Z', updatedAt: '2026-05-25T00:00:00Z',
};

describe('page-layout widget list/get', () => {
  it('list calls getPageLayoutWidgets with the tab id', async () => {
    fetchStub.reply('/metadata', { data: { getPageLayoutWidgets: [WID] } });
    const { stdout } = await runPl('widget', 'list', TAB_ID, '--json');
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { id: string });
    expect(rows[0]?.id).toBe(WID_ID);
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: TAB_ID });
  });

  it('get NOT_FOUND when getPageLayoutWidget returns null', async () => {
    fetchStub.reply('/metadata', { data: { getPageLayoutWidget: null } });
    const err = await runPl('widget', 'get', WID_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });
});

describe('page-layout widget create', () => {
  const GP = { row: 0, column: 0, rowSpan: 4, columnSpan: 6 };

  it('USAGE when title is missing', async () => {
    const f = writeFile('w.json', { type: 'VIEW', gridPosition: GP, configuration: {} });
    const err = await runPl('widget', 'create', '--tab', TAB_ID, '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('USAGE when type is missing', async () => {
    const f = writeFile('w.json', { title: 'Hi', gridPosition: GP, configuration: {} });
    const err = await runPl('widget', 'create', '--tab', TAB_ID, '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('USAGE when gridPosition is missing', async () => {
    const f = writeFile('w.json', { title: 'Hi', type: 'VIEW', configuration: {} });
    const err = await runPl('widget', 'create', '--tab', TAB_ID, '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('USAGE when configuration is missing', async () => {
    const f = writeFile('w.json', { title: 'Hi', type: 'VIEW', gridPosition: GP });
    const err = await runPl('widget', 'create', '--tab', TAB_ID, '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('merges --tab into the input as pageLayoutTabId', async () => {
    const f = writeFile('w.json', {
      title: 'Recent activity', type: 'VIEW',
      gridPosition: GP, configuration: { viewId: 'abc' },
    });
    fetchStub.reply('/metadata', { data: { createPageLayoutWidget: WID } });
    await runPl('widget', 'create', '--tab', TAB_ID, '--file', f, '--json');
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('createPageLayoutWidget(input: $input)');
    expect(body(call).variables?.input).toMatchObject({
      pageLayoutTabId: TAB_ID,
      title: 'Recent activity',
      type: 'VIEW',
      gridPosition: GP,
      configuration: { viewId: 'abc' },
    });
  });
});

describe('page-layout widget update/delete/reset', () => {
  it('update uses (id, input) shape', async () => {
    const f = writeFile('patch.json', { title: 'Renamed' });
    fetchStub.reply('/metadata', { data: { updatePageLayoutWidget: WID } });
    await runPl('widget', 'update', WID_ID, '--file', f);
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('updatePageLayoutWidget(id: $id, input: $input)');
    expect(body(call).variables).toEqual({ id: WID_ID, input: { title: 'Renamed' } });
  });

  it('delete calls destroyPageLayoutWidget', async () => {
    fetchStub.reply('/metadata', { data: { destroyPageLayoutWidget: true } });
    await runPl('widget', 'delete', WID_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('destroyPageLayoutWidget(id: $id)');
  });

  it('reset calls resetPageLayoutWidgetToDefault', async () => {
    fetchStub.reply('/metadata', { data: { resetPageLayoutWidgetToDefault: WID } });
    await runPl('widget', 'reset', WID_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('resetPageLayoutWidgetToDefault(id: $id)');
  });
});

describe('page-layout widget configure-view + configure-fields', () => {
  it('configure-view merges widgetId into the input and calls upsertViewWidget', async () => {
    const f = writeFile('cfg.json', {
      viewFields: [{ fieldMetadataId: 'fmd1', isVisible: true, position: 0 }],
      viewFilters: [],
      viewFilterGroups: [],
      viewSorts: [],
    });
    fetchStub.reply('/metadata', { data: { upsertViewWidget: { id: 'view-id' } } });
    const { stdout } = await runPl('widget', 'configure-view', WID_ID, '--file', f, '--json');
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('upsertViewWidget(input: $input)');
    expect(body(call).variables?.input).toMatchObject({
      widgetId: WID_ID,
      viewFields: [{ fieldMetadataId: 'fmd1', isVisible: true, position: 0 }],
    });
    expect(JSON.parse(stdout.trim())).toMatchObject({ widgetId: WID_ID, configured: 'view' });
  });

  it('configure-fields calls upsertFieldsWidget with widgetId merged', async () => {
    const f = writeFile('cfg.json', {
      groups: [{ id: 'g1', name: 'Contact', position: 0, isVisible: true, fields: [] }],
      fields: [],
    });
    fetchStub.reply('/metadata', { data: { upsertFieldsWidget: { id: 'view-id' } } });
    await runPl('widget', 'configure-fields', WID_ID, '--file', f);
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('upsertFieldsWidget(input: $input)');
    expect(body(call).variables?.input).toMatchObject({
      widgetId: WID_ID,
      groups: [{ id: 'g1', name: 'Contact' }],
    });
  });

  it('configure-view USAGE when file is not an object', async () => {
    const f = writeFile('cfg.json', JSON.stringify(['array']));
    const err = await runPl('widget', 'configure-view', WID_ID, '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });
});
