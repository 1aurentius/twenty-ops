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
import { registerViewCommands } from '../../../src/commands/view.js';
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

function writeFile(filename: string, content: string): string {
  const path = join(HOME.current, filename);
  writeFileSync(path, content);
  return path;
}

const VIEW_ID = '11111111-1111-4111-8111-111111111111';
const OBJECT_ID = '22222222-2222-4222-8222-222222222222';
const FIELD_ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FIELD_ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const runView = (...args: string[]) => runCli(registerViewCommands, ['view', ...args]);

interface GqlBody {
  query: string;
  variables?: Record<string, unknown>;
}

function body(call: { body: unknown }): GqlBody {
  return call.body as GqlBody;
}

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-view-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('view list', () => {
  it('queries getViews with no filter when no flags are given', async () => {
    fetchStub.reply('/metadata', { data: { getViews: [] } });
    await runView('list');

    expect(fetchStub.calls).toHaveLength(1);
    const call = fetchStub.calls[0]!;
    expect(call.url).toBe('http://localhost:3001/metadata');
    expect(body(call).query).toContain('getViews');
    expect(body(call).variables).toEqual({ objectMetadataId: undefined, viewTypes: undefined });
  });

  it('forwards a UUID --object without hitting the objects discovery query', async () => {
    fetchStub.reply('/metadata', { data: { getViews: [] } });
    await runView('list', '--object', OBJECT_ID);

    expect(fetchStub.calls).toHaveLength(1);
    expect(body(fetchStub.calls[0]!).variables?.objectMetadataId).toBe(OBJECT_ID);
  });

  it('resolves a --object name via the objects query, then queries getViews', async () => {
    fetchStub.reply('/metadata', {
      data: {
        objects: { edges: [{ node: { id: OBJECT_ID, nameSingular: 'person', namePlural: 'people', labelSingular: 'Person', isActive: true } }] },
      },
    });
    fetchStub.reply('/metadata', { data: { getViews: [] } });

    await runView('list', '--object', 'person');

    expect(fetchStub.calls).toHaveLength(2);
    expect(body(fetchStub.calls[0]!).query).toContain('objects(paging:');
    expect(body(fetchStub.calls[1]!).variables?.objectMetadataId).toBe(OBJECT_ID);
  });

  it('uppercases --type and passes it as viewTypes', async () => {
    fetchStub.reply('/metadata', { data: { getViews: [] } });
    await runView('list', '--type', 'kanban');
    expect(body(fetchStub.calls[0]!).variables?.viewTypes).toEqual(['KANBAN']);
  });

  it('renders rows as JSON Lines under --json', async () => {
    fetchStub.reply('/metadata', {
      data: {
        getViews: [
          { id: VIEW_ID, name: 'X', type: 'TABLE', objectMetadataId: OBJECT_ID, icon: 'IconA', visibility: 'WORKSPACE' },
        ],
      },
    });
    const { stdout } = await runView('list', '--json');
    expect(JSON.parse(stdout.trim())).toMatchObject({ id: VIEW_ID, name: 'X', type: 'TABLE' });
  });
});

describe('view get', () => {
  it('emits the detail projection in key=value form', async () => {
    fetchStub.reply('/metadata', {
      data: {
        getView: {
          id: VIEW_ID,
          name: 'V',
          objectMetadataId: OBJECT_ID,
          type: 'TABLE',
          icon: 'IconA',
          position: 0,
          visibility: 'WORKSPACE',
          viewFields: [],
          viewFilters: [],
          viewSorts: [],
        },
      },
    });
    const { stdout } = await runView('get', VIEW_ID);
    expect(stdout).toContain(`id=${VIEW_ID}`);
    expect(stdout).toContain('name=V');
    expect(stdout).toContain('viewFields=');
  });

  it('maps a null getView response to exit code 4 (NOT_FOUND)', async () => {
    fetchStub.reply('/metadata', { data: { getView: null } });
    const err = await runView('get', VIEW_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('surfaces grouping state + every child collection in the detail projection', async () => {
    // The selection set must include mainGroupByFieldMetadataId,
    // shouldHideEmptyGroups, kanbanAggregateOperation, the calendar
    // grouping fields, plus viewGroups, viewFieldGroups, viewFilterGroups
    // — otherwise an agent inspecting a kanban-grouped view sees an empty
    // record and can't diagnose grouping issues. This regression test pins
    // the contract so future SUMMARY tweaks don't quietly drop fields.
    fetchStub.reply('/metadata', {
      data: {
        getView: {
          id: VIEW_ID, name: 'V', objectMetadataId: OBJECT_ID,
          type: 'TABLE', icon: 'IconA', position: 0, visibility: 'WORKSPACE',
          mainGroupByFieldMetadataId: 'fmd-phase',
          shouldHideEmptyGroups: true,
          kanbanAggregateOperation: null,
          kanbanAggregateOperationFieldMetadataId: null,
          calendarFieldMetadataId: null,
          viewFields: [], viewFilters: [], viewFilterGroups: [], viewSorts: [],
          viewGroups: [{ id: 'g1', fieldValue: 'A', position: 0, isVisible: true, viewId: VIEW_ID }],
          viewFieldGroups: [],
        },
      },
    });
    const { stdout } = await runView('get', VIEW_ID, '--json');
    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(out.mainGroupByFieldMetadataId).toBe('fmd-phase');
    expect(out.shouldHideEmptyGroups).toBe(true);
    expect(Array.isArray(out.viewGroups)).toBe(true);
    expect((out.viewGroups as unknown[]).length).toBe(1);
    expect(Array.isArray(out.viewFieldGroups)).toBe(true);
    expect(Array.isArray(out.viewFilterGroups)).toBe(true);
  });

  it('emits VIEW_DETAIL query with all expected child selections', async () => {
    fetchStub.reply('/metadata', {
      data: {
        getView: {
          id: VIEW_ID, name: 'V', objectMetadataId: OBJECT_ID,
          type: 'TABLE', icon: 'IconA', position: 0, visibility: 'WORKSPACE',
          mainGroupByFieldMetadataId: null, shouldHideEmptyGroups: false,
          kanbanAggregateOperation: null, kanbanAggregateOperationFieldMetadataId: null,
          calendarFieldMetadataId: null,
          viewFields: [], viewFilters: [], viewFilterGroups: [], viewSorts: [],
          viewGroups: [], viewFieldGroups: [],
        },
      },
    });
    await runView('get', VIEW_ID);
    const query = body(fetchStub.calls[0]!).query;
    expect(query).toContain('mainGroupByFieldMetadataId');
    expect(query).toContain('shouldHideEmptyGroups');
    expect(query).toContain('viewGroups');
    expect(query).toContain('viewFieldGroups');
    expect(query).toContain('viewFilterGroups');
  });
});

describe('view create', () => {
  it('forwards uppercased type/visibility plus name + objectMetadataId in the mutation input', async () => {
    fetchStub.reply('/metadata', {
      data: {
        createView: { id: VIEW_ID, name: 'New', type: 'TABLE', objectMetadataId: OBJECT_ID, icon: 'IconLayoutList', visibility: 'WORKSPACE' },
      },
    });
    await runView('create', '--object', OBJECT_ID, '--name', 'New', '--type', 'kanban', '--visibility', 'unlisted');

    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('createView');
    expect(body(call).variables).toEqual({
      input: {
        name: 'New',
        objectMetadataId: OBJECT_ID,
        icon: 'IconLayoutList',
        type: 'KANBAN',
        visibility: 'UNLISTED',
      },
    });
  });
});

describe('view update', () => {
  it('rejects an empty update with USAGE exit code', async () => {
    const err = await runView('update', VIEW_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
    // No GraphQL traffic should be issued for a rejected update.
    expect(fetchStub.calls).toHaveLength(0);
  });

  it('only sends fields that were passed (no undefined keys)', async () => {
    fetchStub.reply('/metadata', {
      data: { updateView: { id: VIEW_ID, name: 'Renamed', type: 'TABLE', objectMetadataId: OBJECT_ID, icon: 'IconA', visibility: 'WORKSPACE' } },
    });
    await runView('update', VIEW_ID, '--name', 'Renamed');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: VIEW_ID, input: { name: 'Renamed' } });
  });

  it('--main-group-by sets mainGroupByFieldMetadataId', async () => {
    fetchStub.reply('/metadata', { data: { updateView: { id: VIEW_ID, name: 'V', type: 'TABLE', objectMetadataId: OBJECT_ID, icon: 'IconA', visibility: 'WORKSPACE' } } });
    await runView('update', VIEW_ID, '--main-group-by', FIELD_ID_A);
    expect(body(fetchStub.calls[0]!).variables).toEqual({
      id: VIEW_ID,
      input: { mainGroupByFieldMetadataId: FIELD_ID_A },
    });
  });

  it('--no-main-group-by clears mainGroupByFieldMetadataId to null', async () => {
    fetchStub.reply('/metadata', { data: { updateView: { id: VIEW_ID, name: 'V', type: 'TABLE', objectMetadataId: OBJECT_ID, icon: 'IconA', visibility: 'WORKSPACE' } } });
    await runView('update', VIEW_ID, '--no-main-group-by');
    expect(body(fetchStub.calls[0]!).variables).toEqual({
      id: VIEW_ID,
      input: { mainGroupByFieldMetadataId: null },
    });
  });

  it('--hide-empty-groups parses true/false', async () => {
    fetchStub.reply('/metadata', { data: { updateView: { id: VIEW_ID, name: 'V', type: 'TABLE', objectMetadataId: OBJECT_ID, icon: 'IconA', visibility: 'WORKSPACE' } } });
    await runView('update', VIEW_ID, '--hide-empty-groups', 'true');
    expect(body(fetchStub.calls[0]!).variables).toEqual({
      id: VIEW_ID,
      input: { shouldHideEmptyGroups: true },
    });
  });

  it('--hide-empty-groups USAGE on garbage value', async () => {
    const err = await runView('update', VIEW_ID, '--hide-empty-groups', 'maybe').catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('--calendar-field + --calendar-layout drives the calendar config', async () => {
    fetchStub.reply('/metadata', { data: { updateView: { id: VIEW_ID, name: 'V', type: 'CALENDAR', objectMetadataId: OBJECT_ID, icon: 'IconA', visibility: 'WORKSPACE' } } });
    await runView('update', VIEW_ID,
      '--calendar-field', FIELD_ID_A,
      '--calendar-layout', 'month',
    );
    expect(body(fetchStub.calls[0]!).variables?.input).toMatchObject({
      calendarFieldMetadataId: FIELD_ID_A,
      calendarLayout: 'MONTH',
    });
  });

  it('--kanban-aggregate-op + --kanban-aggregate-field drives kanban aggregation', async () => {
    fetchStub.reply('/metadata', { data: { updateView: { id: VIEW_ID, name: 'V', type: 'KANBAN', objectMetadataId: OBJECT_ID, icon: 'IconA', visibility: 'WORKSPACE' } } });
    await runView('update', VIEW_ID,
      '--kanban-aggregate-op', 'sum',
      '--kanban-aggregate-field', FIELD_ID_A,
    );
    expect(body(fetchStub.calls[0]!).variables?.input).toMatchObject({
      kanbanAggregateOperation: 'SUM',
      kanbanAggregateOperationFieldMetadataId: FIELD_ID_A,
    });
  });

  it('--file applies a JSON body; per-flag overrides win over the file', async () => {
    const file = writeFile('upd.json', JSON.stringify({ name: 'From File', shouldHideEmptyGroups: false }));
    fetchStub.reply('/metadata', { data: { updateView: { id: VIEW_ID, name: 'X', type: 'TABLE', objectMetadataId: OBJECT_ID, icon: 'IconA', visibility: 'WORKSPACE' } } });
    await runView('update', VIEW_ID, '--file', file, '--name', 'Wins');
    expect(body(fetchStub.calls[0]!).variables?.input).toEqual({
      name: 'Wins',
      shouldHideEmptyGroups: false,
    });
  });
});

describe('view delete', () => {
  it('sends a deleteView mutation with the view id', async () => {
    fetchStub.reply('/metadata', { data: { deleteView: true } });
    const { stdout } = await runView('delete', VIEW_ID);
    expect(stdout).toContain(`deleted view ${VIEW_ID}`);
    expect(body(fetchStub.calls[0]!).query).toContain('deleteView');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: VIEW_ID });
  });
});

describe('view set-fields (reconciliation)', () => {
  it('creates every entry when current state is empty', async () => {
    const file = writeFile('fields.json', JSON.stringify([
      { fieldMetadataId: FIELD_ID_A, isVisible: true, size: 120, position: 0 },
      { fieldMetadataId: FIELD_ID_B, isVisible: false, size: 80, position: 1 },
    ]));
    fetchStub.reply('/metadata', { data: { getViewFields: [] } });
    fetchStub.reply('/metadata', { data: { createViewField: { id: 'new-a' } } });
    fetchStub.reply('/metadata', { data: { createViewField: { id: 'new-b' } } });

    const { stdout } = await runView('set-fields', VIEW_ID, '--file', file);

    expect(stdout).toContain('+2 ~0 -0 =0');
    // 1 query + 2 create mutations
    expect(fetchStub.calls).toHaveLength(3);
    expect(body(fetchStub.calls[1]!).query).toContain('createViewField');
  });

  it('updates changed entries, removes missing ones, leaves matches alone', async () => {
    const file = writeFile('fields.json', JSON.stringify([
      // matches existing exactly → unchanged
      { fieldMetadataId: FIELD_ID_A, isVisible: true, size: 120, position: 0 },
      // size differs → update
      { fieldMetadataId: FIELD_ID_B, isVisible: false, size: 200, position: 1 },
    ]));
    fetchStub.reply('/metadata', {
      data: {
        getViewFields: [
          { id: 'cur-a', fieldMetadataId: FIELD_ID_A, isVisible: true, size: 120, position: 0 },
          { id: 'cur-b', fieldMetadataId: FIELD_ID_B, isVisible: false, size: 80, position: 1 },
          // not in desired → delete
          { id: 'cur-c', fieldMetadataId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', isVisible: true, size: 100, position: 2 },
        ],
      },
    });
    fetchStub.reply('/metadata', { data: { updateViewField: { id: 'cur-b' } } });
    fetchStub.reply('/metadata', { data: { deleteViewField: { id: 'cur-c' } } });

    const { stdout } = await runView('set-fields', VIEW_ID, '--file', file);

    expect(stdout).toContain('+0 ~1 -1 =1');
    expect(body(fetchStub.calls[1]!).query).toContain('updateViewField');
    expect(body(fetchStub.calls[2]!).query).toContain('deleteViewField');
  });

  it('is a no-op when the file matches current state exactly', async () => {
    const file = writeFile('fields.json', JSON.stringify([
      { fieldMetadataId: FIELD_ID_A, isVisible: true, size: 120, position: 0 },
    ]));
    fetchStub.reply('/metadata', {
      data: {
        getViewFields: [{ id: 'cur-a', fieldMetadataId: FIELD_ID_A, isVisible: true, size: 120, position: 0 }],
      },
    });

    const { stdout } = await runView('set-fields', VIEW_ID, '--file', file);
    expect(stdout).toContain('+0 ~0 -0 =1');
    expect(fetchStub.calls).toHaveLength(1);
  });

  it('rejects entries missing fieldMetadataId with USAGE', async () => {
    const file = writeFile('fields.json', JSON.stringify([{ isVisible: true }]));
    fetchStub.reply('/metadata', { data: { getViewFields: [] } });
    const err = await runView('set-fields', VIEW_ID, '--file', file).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });
});

describe('view set-filters (composite-key reconciliation)', () => {
  it('treats (fieldMetadataId, subFieldName) as the identity key', async () => {
    const file = writeFile('filters.json', JSON.stringify([
      { fieldMetadataId: FIELD_ID_A, operand: 'IS', value: 'x', subFieldName: 'street' },
      { fieldMetadataId: FIELD_ID_A, operand: 'IS', value: 'y', subFieldName: 'city' },
    ]));
    fetchStub.reply('/metadata', {
      data: {
        getViewFilters: [
          // Same fieldMetadataId but different subFieldName — should be matched separately.
          { id: 'cur-street', fieldMetadataId: FIELD_ID_A, operand: 'IS', value: 'x', subFieldName: 'street' },
        ],
      },
    });
    fetchStub.reply('/metadata', { data: { createViewFilter: { id: 'new-city' } } });

    const { stdout } = await runView('set-filters', VIEW_ID, '--file', file);
    expect(stdout).toContain('+1 ~0 -0 =1');
  });
});

describe('view set-sorts', () => {
  it('uppercases direction on create', async () => {
    const file = writeFile('sorts.json', JSON.stringify([
      { fieldMetadataId: FIELD_ID_A, direction: 'desc' },
    ]));
    fetchStub.reply('/metadata', { data: { getViewSorts: [] } });
    fetchStub.reply('/metadata', { data: { createViewSort: { id: 'new' } } });

    await runView('set-sorts', VIEW_ID, '--file', file);
    expect(body(fetchStub.calls[1]!).variables).toMatchObject({
      input: { viewId: VIEW_ID, fieldMetadataId: FIELD_ID_A, direction: 'DESC' },
    });
  });
});

describe('view set-groups', () => {
  it('fast-path: empty current → single createManyViewGroups call (not per-row)', async () => {
    const file = writeFile('groups.json', JSON.stringify([
      { fieldValue: 'ACTIVE', isVisible: true, position: 0 },
      { fieldValue: 'DONE', isVisible: true, position: 1 },
    ]));
    fetchStub.reply('/metadata', { data: { getViewGroups: [] } });
    fetchStub.reply('/metadata', { data: { createManyViewGroups: [{ id: 'g1' }, { id: 'g2' }] } });

    const { stdout } = await runView('set-groups', VIEW_ID, '--file', file);
    expect(stdout).toContain('+2 ~0 -0 =0');
    // Exactly 2 calls: getViewGroups + createManyViewGroups (no per-row createViewGroup)
    expect(fetchStub.calls).toHaveLength(2);
    expect(body(fetchStub.calls[1]!).query).toContain('createManyViewGroups');
    expect(body(fetchStub.calls[1]!).query).not.toContain('createViewGroup(');
    // Each input row has viewId, fieldValue, position (defaulted from index when omitted)
    const inputs = body(fetchStub.calls[1]!).variables?.inputs as { viewId: string; fieldValue: string; position: number }[];
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({ viewId: VIEW_ID, fieldValue: 'ACTIVE', position: 0 });
    expect(inputs[1]).toMatchObject({ viewId: VIEW_ID, fieldValue: 'DONE', position: 1 });
  });

  it('fast-path defaults missing position to the array index', async () => {
    const file = writeFile('groups.json', JSON.stringify([
      { fieldValue: 'A' },
      { fieldValue: 'B' },
      { fieldValue: 'C' },
    ]));
    fetchStub.reply('/metadata', { data: { getViewGroups: [] } });
    fetchStub.reply('/metadata', { data: { createManyViewGroups: [{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }] } });
    await runView('set-groups', VIEW_ID, '--file', file);
    const inputs = body(fetchStub.calls[1]!).variables?.inputs as { position: number }[];
    expect(inputs.map((i) => i.position)).toEqual([0, 1, 2]);
  });

  it('updates when position differs, deletes orphans, leaves matches unchanged', async () => {
    const file = writeFile('groups.json', JSON.stringify([
      { fieldValue: 'ACTIVE', position: 0, isVisible: true },
      { fieldValue: 'DONE', position: 5, isVisible: true }, // position changed
    ]));
    fetchStub.reply('/metadata', {
      data: {
        getViewGroups: [
          { id: 'g1', fieldValue: 'ACTIVE', isVisible: true, position: 0, viewId: VIEW_ID },
          { id: 'g2', fieldValue: 'DONE', isVisible: true, position: 1, viewId: VIEW_ID },
          { id: 'g3', fieldValue: 'ARCHIVED', isVisible: true, position: 2, viewId: VIEW_ID },
        ],
      },
    });
    fetchStub.reply('/metadata', { data: { updateViewGroup: { id: 'g2' } } });
    fetchStub.reply('/metadata', { data: { deleteViewGroup: { id: 'g3' } } });

    const { stdout } = await runView('set-groups', VIEW_ID, '--file', file);
    expect(stdout).toContain('+0 ~1 -1 =1');
  });

  it('rejects entries missing fieldValue with USAGE', async () => {
    const file = writeFile('bad.json', JSON.stringify([{ isVisible: true }]));
    fetchStub.reply('/metadata', { data: { getViewGroups: [] } });
    const err = await runView('set-groups', VIEW_ID, '--file', file).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });
});

describe('view set-field-groups', () => {
  it('keys by name; creates new + updates position changes + removes missing', async () => {
    const file = writeFile('fg.json', JSON.stringify([
      { name: 'Contact', position: 0 },         // matches existing exactly
      { name: 'Employer', position: 5 },        // position changed
      { name: 'NewSection', position: 2 },      // new
    ]));
    fetchStub.reply('/metadata', {
      data: {
        getViewFieldGroups: [
          { id: 'fg1', name: 'Contact', position: 0, isVisible: true, viewId: VIEW_ID },
          { id: 'fg2', name: 'Employer', position: 1, isVisible: true, viewId: VIEW_ID },
          { id: 'fg3', name: 'Stale', position: 2, isVisible: true, viewId: VIEW_ID },
        ],
      },
    });
    fetchStub.reply('/metadata', { data: { updateViewFieldGroup: { id: 'fg2' } } });
    fetchStub.reply('/metadata', { data: { createViewFieldGroup: { id: 'fg4' } } });
    fetchStub.reply('/metadata', { data: { deleteViewFieldGroup: { id: 'fg3' } } });

    const { stdout } = await runView('set-field-groups', VIEW_ID, '--file', file);
    expect(stdout).toContain('+1 ~1 -1 =1');
  });
});

describe('view set-filter-groups', () => {
  it('keys by (parent, position); creates new and updates logicalOperator changes', async () => {
    const file = writeFile('flt.json', JSON.stringify([
      { parentViewFilterGroupId: null, positionInViewFilterGroup: 0, logicalOperator: 'AND' },
      // child group under a root id we don't know yet → expect a create
      { parentViewFilterGroupId: 'fg-parent', positionInViewFilterGroup: 0, logicalOperator: 'OR' },
    ]));
    fetchStub.reply('/metadata', {
      data: {
        getViewFilterGroups: [
          {
            id: 'fg-root',
            parentViewFilterGroupId: null,
            logicalOperator: 'OR', // differs → update
            positionInViewFilterGroup: 0,
            viewId: VIEW_ID,
          },
        ],
      },
    });
    fetchStub.reply('/metadata', { data: { updateViewFilterGroup: { id: 'fg-root' } } });
    fetchStub.reply('/metadata', { data: { createViewFilterGroup: { id: 'fg-child' } } });

    const { stdout } = await runView('set-filter-groups', VIEW_ID, '--file', file);
    expect(stdout).toContain('+1 ~1 -0 =0');

    // Update mutation uses `(id, input)` shape rather than `{id, update}` wrapper.
    const updCall = fetchStub.calls[1]!;
    expect(body(updCall).query).toContain('updateViewFilterGroup(id: $id');
    expect(body(updCall).variables?.id).toBe('fg-root');
  });
});
