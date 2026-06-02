import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import type { GraphQLClient } from '../api/graphql-client.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import {
  VIEW_DETAIL,
  VIEW_FIELD,
  VIEW_FIELD_GROUP,
  VIEW_FILTER,
  VIEW_FILTER_GROUP,
  VIEW_GROUP,
  VIEW_SORT,
  VIEW_SUMMARY,
} from '../lib/gql.js';
import { expectArray, loadInputFile } from '../lib/input-file.js';
import { resolveObjectId } from '../lib/objects.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';
import { reconcile, type ReconcileResult } from '../lib/reconcile.js';

interface View {
  id: string;
  name: string;
  objectMetadataId: string;
  type: string;
  icon: string;
  position: number;
  visibility: string;
  isCustom: boolean;
}
interface ViewField {
  id: string;
  fieldMetadataId: string;
  isVisible: boolean;
  size: number;
  position: number;
}
interface ViewFilter {
  id: string;
  fieldMetadataId: string;
  operand: string;
  value: unknown;
  subFieldName: string | null;
}
interface ViewSort {
  id: string;
  fieldMetadataId: string;
  direction: string;
}
interface ViewGroup {
  id: string;
  isVisible: boolean;
  fieldValue: string;
  position: number;
  viewId: string;
}
interface ViewFilterGroup {
  id: string;
  parentViewFilterGroupId: string | null;
  logicalOperator: string;
  positionInViewFilterGroup: number | null;
  viewId: string;
}
interface ViewFieldGroup {
  id: string;
  name: string;
  position: number;
  isVisible: boolean;
  viewId: string;
}

/** `twenty-ops view …` — manage table/board/calendar views via the Metadata API. */
export function registerViewCommands(program: Command): void {
  const view = program.command('view').description('manage views (table/board/calendar)');

  view
    .command('list')
    .description('list views, optionally filtered by object')
    .option('--object <ref>', 'object id or name (nameSingular/namePlural)')
    .option('--type <type>', 'TABLE | KANBAN | CALENDAR')
    .action(async (opts: { object?: string; type?: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const objectMetadataId = opts.object
        ? await resolveObjectId(ctx.metadata, opts.object)
        : undefined;
      const data = await ctx.metadata.request<{ getViews: View[] }>(
        `query Views($objectMetadataId: String, $viewTypes: [ViewType!]) {
           getViews(objectMetadataId: $objectMetadataId, viewTypes: $viewTypes) { ${VIEW_SUMMARY} }
         }`,
        {
          objectMetadataId,
          viewTypes: opts.type ? [opts.type.toUpperCase()] : undefined,
        },
      );
      emitList(
        data.getViews,
        ['id', 'name', 'type', 'objectMetadataId', 'icon', 'visibility'],
        ctx.out,
      );
    });

  view
    .command('get <viewId>')
    .description("show one view with its fields, filters, sorts, groups, field-groups, filter-groups, and grouping state")
    .action(async (viewId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ getView: View | null }>(
        `query View($id: String!) { getView(id: $id) { ${VIEW_DETAIL} } }`,
        { id: viewId },
      );
      if (!data.getView) throw new CliError(`view "${viewId}" not found`, EXIT.NOT_FOUND);
      emitOne(
        data.getView as unknown as Record<string, unknown>,
        [
          'id', 'name', 'objectMetadataId', 'type', 'icon', 'position', 'visibility',
          'mainGroupByFieldMetadataId', 'shouldHideEmptyGroups',
          'kanbanAggregateOperation', 'kanbanAggregateOperationFieldMetadataId',
          'calendarFieldMetadataId',
          'viewFields', 'viewFilters', 'viewFilterGroups', 'viewSorts',
          'viewGroups', 'viewFieldGroups',
        ],
        ctx.out,
      );
    });

  view
    .command('create')
    .description('create a view on an object')
    .requiredOption('--object <ref>', 'object id or name')
    .requiredOption('--name <name>', 'view name')
    .option('--icon <icon>', 'Tabler icon name', 'IconLayoutList')
    .option('--type <type>', 'TABLE | KANBAN | CALENDAR', 'TABLE')
    .option('--visibility <v>', 'WORKSPACE | UNLISTED', 'WORKSPACE')
    .action(
      async (
        opts: { object: string; name: string; icon: string; type: string; visibility: string },
        cmd: Command,
      ) => {
        const ctx = makeCtx(cmd);
        const objectMetadataId = await resolveObjectId(ctx.metadata, opts.object);
        const data = await ctx.metadata.request<{ createView: View }>(
          `mutation Create($input: CreateViewInput!) {
             createView(input: $input) { ${VIEW_SUMMARY} }
           }`,
          {
            input: {
              name: opts.name,
              objectMetadataId,
              icon: opts.icon,
              type: opts.type.toUpperCase(),
              visibility: opts.visibility.toUpperCase(),
            },
          },
        );
        emitOk(
          `created view ${data.createView.id}`,
          data.createView as unknown as Record<string, unknown>,
          ctx.out,
        );
      },
    );

  view
    .command('update <viewId>')
    .description('update a view (visibility, grouping config, calendar/kanban aggregation, layout)')
    .option('--name <name>', 'view name')
    .option('--icon <icon>', 'Tabler icon name')
    .option('--type <type>', 'TABLE | KANBAN | CALENDAR')
    .option('--visibility <v>', 'WORKSPACE | UNLISTED')
    .option('--position <n>', 'sidebar position', Number)
    .option('--is-compact <bool>', 'true|false — compact row rendering')
    .option('--open-record-in <v>', 'SIDE_PANEL | RECORD_PAGE')
    .option('--any-field-filter-value <text>', 'free-text "search across fields" filter')
    .option('--main-group-by <fieldMetadataId>', 'group the view by this fieldMetadataId (kanban or table grouping)')
    .option('--no-main-group-by', 'clear the grouping (sets mainGroupByFieldMetadataId to null)')
    .option('--hide-empty-groups <bool>', 'true|false — hide groups with no rows')
    .option('--kanban-aggregate-op <op>', 'AggregateOperations enum (e.g. COUNT, SUM, AVG)')
    .option('--kanban-aggregate-field <fieldMetadataId>', 'fieldMetadataId aggregated for the kanban subtitle')
    .option('--calendar-field <fieldMetadataId>', 'DATE/DATE_TIME fieldMetadataId for CALENDAR-type views')
    .option('--calendar-layout <v>', 'MONTH | WEEK | DAY (CALENDAR-type views)')
    .option('--file <path>', 'apply the JSON file as the UpdateViewInput body (other flags merge over it)')
    .action(
      async (
        viewId: string,
        opts: {
          name?: string; icon?: string; type?: string; visibility?: string; position?: number;
          isCompact?: string; openRecordIn?: string; anyFieldFilterValue?: string;
          mainGroupBy?: string | false; hideEmptyGroups?: string;
          kanbanAggregateOp?: string; kanbanAggregateField?: string;
          calendarField?: string; calendarLayout?: string;
          file?: string;
        },
        cmd: Command,
      ) => {
        const ctx = makeCtx(cmd);
        const input: Record<string, unknown> = {};
        if (opts.file) {
          const loaded = loadInputFile<Record<string, unknown>>(opts.file);
          if (Array.isArray(loaded) || typeof loaded !== 'object' || loaded === null) {
            throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
          }
          Object.assign(input, loaded);
        }
        if (opts.name !== undefined) input.name = opts.name;
        if (opts.icon !== undefined) input.icon = opts.icon;
        if (opts.type !== undefined) input.type = opts.type.toUpperCase();
        if (opts.visibility !== undefined) input.visibility = opts.visibility.toUpperCase();
        if (opts.position !== undefined) input.position = opts.position;
        if (opts.isCompact !== undefined) input.isCompact = parseBool(opts.isCompact, '--is-compact');
        if (opts.openRecordIn !== undefined) input.openRecordIn = opts.openRecordIn.toUpperCase();
        if (opts.anyFieldFilterValue !== undefined) input.anyFieldFilterValue = opts.anyFieldFilterValue;
        // commander encodes --no-X as opts.X === false; --main-group-by <id> sets a string.
        if (opts.mainGroupBy === false) input.mainGroupByFieldMetadataId = null;
        else if (typeof opts.mainGroupBy === 'string') input.mainGroupByFieldMetadataId = opts.mainGroupBy;
        if (opts.hideEmptyGroups !== undefined) input.shouldHideEmptyGroups = parseBool(opts.hideEmptyGroups, '--hide-empty-groups');
        if (opts.kanbanAggregateOp !== undefined) input.kanbanAggregateOperation = opts.kanbanAggregateOp.toUpperCase();
        if (opts.kanbanAggregateField !== undefined) input.kanbanAggregateOperationFieldMetadataId = opts.kanbanAggregateField;
        if (opts.calendarField !== undefined) input.calendarFieldMetadataId = opts.calendarField;
        if (opts.calendarLayout !== undefined) input.calendarLayout = opts.calendarLayout.toUpperCase();
        if (Object.keys(input).length === 0) {
          throw new CliError('nothing to update — pass at least one field flag or --file', EXIT.USAGE);
        }
        const data = await ctx.metadata.request<{ updateView: View }>(
          `mutation Update($id: String!, $input: UpdateViewInput!) {
             updateView(id: $id, input: $input) { ${VIEW_SUMMARY} }
           }`,
          { id: viewId, input },
        );
        emitOk(
          `updated view ${viewId}`,
          data.updateView as unknown as Record<string, unknown>,
          ctx.out,
        );
      },
    );

  view
    .command('delete <viewId>')
    .description('delete a view')
    .action(async (viewId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.metadata.request(`mutation Delete($id: String!) { deleteView(id: $id) }`, {
        id: viewId,
      });
      emitOk(`deleted view ${viewId}`, { deleted: viewId }, ctx.out);
    });

  registerSetFields(view);
  registerSetFilters(view);
  registerSetSorts(view);
  registerSetGroups(view);
  registerSetFilterGroups(view);
  registerSetFieldGroups(view);
}

/* --------------------------------------------------------------------------
 * Declarative `set-*` subcommands: reconcile the workspace to a desired file.
 * The reconcile() helper itself lives in lib/reconcile.ts — shared with
 * `record bulk-upsert`.
 * ------------------------------------------------------------------------ */

async function getViewFields(metadata: GraphQLClient, viewId: string): Promise<ViewField[]> {
  const data = await metadata.request<{ getViewFields: ViewField[] }>(
    `query Fields($viewId: String!) { getViewFields(viewId: $viewId) { ${VIEW_FIELD} } }`,
    { viewId },
  );
  return data.getViewFields;
}

function registerSetFields(view: Command): void {
  view
    .command('set-fields <viewId>')
    .description('reconcile a view\'s fields to a JSON/YAML file (- for stdin)')
    .requiredOption('--file <path>', 'array of {fieldMetadataId,isVisible?,size?,position?}')
    .action(async (viewId: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const desired = expectArray(loadInputFile(opts.file), opts.file);
      const current = await getViewFields(ctx.metadata, viewId);

      const result = await reconcile<ViewField>({
        desired,
        current,
        keyOfDesired: (d) => requireString(d, 'fieldMetadataId', opts.file),
        keyOfCurrent: (c) => c.fieldMetadataId,
        changed: (c, d) =>
          (d.isVisible !== undefined && d.isVisible !== c.isVisible) ||
          (d.size !== undefined && d.size !== c.size) ||
          (d.position !== undefined && d.position !== c.position),
        create: (d) =>
          ctx.metadata.request(
            `mutation($input: CreateViewFieldInput!) { createViewField(input: $input) { id } }`,
            {
              input: {
                viewId,
                fieldMetadataId: d.fieldMetadataId,
                isVisible: d.isVisible ?? true,
                size: d.size,
                position: d.position,
              },
            },
          ),
        update: (c, d) =>
          ctx.metadata.request(
            `mutation($input: UpdateViewFieldInput!) { updateViewField(input: $input) { id } }`,
            {
              input: {
                id: c.id,
                update: pruneUndefined({
                  isVisible: d.isVisible,
                  size: d.size,
                  position: d.position,
                }),
              },
            },
          ),
        remove: (c) =>
          ctx.metadata.request(
            `mutation($input: DeleteViewFieldInput!) { deleteViewField(input: $input) { id } }`,
            { input: { id: c.id } },
          ),
      });
      emitReconcile('fields', viewId, result, ctx);
    });
}

function registerSetFilters(view: Command): void {
  view
    .command('set-filters <viewId>')
    .description('reconcile a view\'s filters to a JSON/YAML file (- for stdin)')
    .requiredOption('--file <path>', 'array of {fieldMetadataId,operand,value,subFieldName?}')
    .action(async (viewId: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const desired = expectArray(loadInputFile(opts.file), opts.file);
      const data = await ctx.metadata.request<{ getViewFilters: ViewFilter[] }>(
        `query Filters($viewId: String) { getViewFilters(viewId: $viewId) { ${VIEW_FILTER} } }`,
        { viewId },
      );

      const key = (fieldMetadataId: unknown, subFieldName: unknown) =>
        `${String(fieldMetadataId)}::${subFieldName ?? ''}`;
      const result = await reconcile<ViewFilter>({
        desired,
        current: data.getViewFilters,
        keyOfDesired: (d) => key(requireString(d, 'fieldMetadataId', opts.file), d.subFieldName),
        keyOfCurrent: (c) => key(c.fieldMetadataId, c.subFieldName),
        changed: (c, d) =>
          (d.operand !== undefined && d.operand !== c.operand) ||
          JSON.stringify(d.value) !== JSON.stringify(c.value),
        create: (d) =>
          ctx.metadata.request(
            `mutation($input: CreateViewFilterInput!) { createViewFilter(input: $input) { id } }`,
            {
              input: {
                viewId,
                fieldMetadataId: d.fieldMetadataId,
                operand: d.operand ?? 'IS',
                value: d.value ?? null,
                subFieldName: d.subFieldName,
              },
            },
          ),
        update: (c, d) =>
          ctx.metadata.request(
            `mutation($input: UpdateViewFilterInput!) { updateViewFilter(input: $input) { id } }`,
            {
              input: {
                id: c.id,
                update: pruneUndefined({ operand: d.operand, value: d.value }),
              },
            },
          ),
        remove: (c) =>
          ctx.metadata.request(
            `mutation($input: DeleteViewFilterInput!) { deleteViewFilter(input: $input) { id } }`,
            { input: { id: c.id } },
          ),
      });
      emitReconcile('filters', viewId, result, ctx);
    });
}

function registerSetSorts(view: Command): void {
  view
    .command('set-sorts <viewId>')
    .description('reconcile a view\'s sorts to a JSON/YAML file (- for stdin)')
    .requiredOption('--file <path>', 'array of {fieldMetadataId,direction}')
    .action(async (viewId: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const desired = expectArray(loadInputFile(opts.file), opts.file);
      const data = await ctx.metadata.request<{ getViewSorts: ViewSort[] }>(
        `query Sorts($viewId: String) { getViewSorts(viewId: $viewId) { ${VIEW_SORT} } }`,
        { viewId },
      );

      const result = await reconcile<ViewSort>({
        desired,
        current: data.getViewSorts,
        keyOfDesired: (d) => requireString(d, 'fieldMetadataId', opts.file),
        keyOfCurrent: (c) => c.fieldMetadataId,
        changed: (c, d) => d.direction !== undefined && d.direction !== c.direction,
        create: (d) =>
          ctx.metadata.request(
            `mutation($input: CreateViewSortInput!) { createViewSort(input: $input) { id } }`,
            {
              input: {
                viewId,
                fieldMetadataId: d.fieldMetadataId,
                direction: (d.direction as string | undefined)?.toUpperCase() ?? 'ASC',
              },
            },
          ),
        update: (c, d) =>
          ctx.metadata.request(
            `mutation($input: UpdateViewSortInput!) { updateViewSort(input: $input) { id } }`,
            {
              input: {
                id: c.id,
                update: { direction: (d.direction as string).toUpperCase() },
              },
            },
          ),
        remove: (c) =>
          ctx.metadata.request(
            `mutation($input: DeleteViewSortInput!) { deleteViewSort(input: $input) }`,
            { input: { id: c.id } },
          ),
      });
      emitReconcile('sorts', viewId, result, ctx);
    });
}

function registerSetGroups(view: Command): void {
  view
    .command('set-groups <viewId>')
    .description("reconcile a view's groups (kanban-style fieldValue buckets)")
    .requiredOption('--file <path>', 'array of {fieldValue,isVisible?,position?}')
    .action(async (viewId: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const desired = expectArray(loadInputFile(opts.file), opts.file);
      const data = await ctx.metadata.request<{ getViewGroups: ViewGroup[] }>(
        `query Groups($viewId: String!) { getViewGroups(viewId: $viewId) { ${VIEW_GROUP} } }`,
        { viewId },
      );

      // Fast-path: when the view has no existing groups, batch all creates
      // into a single createManyViewGroups call. For an agent populating a
      // kanban field with 8 phases × 3 views, this turns 24 roundtrips into
      // 3 — the exact bulk-setup flow our partners hit when porting from
      // Asana/Trello.
      if (data.getViewGroups.length === 0 && desired.length > 0) {
        const inputs = desired.map((d, i) => ({
          viewId,
          fieldValue: requireString(d, 'fieldValue', opts.file),
          isVisible: d.isVisible ?? true,
          position: d.position ?? i,
        }));
        const bulk = await ctx.metadata.request<{ createManyViewGroups: { id: string }[] }>(
          `mutation($inputs: [CreateViewGroupInput!]!) {
             createManyViewGroups(inputs: $inputs) { id }
           }`,
          { inputs },
        );
        emitReconcile('groups', viewId, {
          created: bulk.createManyViewGroups.length,
          updated: 0,
          deleted: 0,
          unchanged: 0,
        }, ctx);
        return;
      }

      const result = await reconcile<ViewGroup>({
        desired,
        current: data.getViewGroups,
        keyOfDesired: (d) => requireString(d, 'fieldValue', opts.file),
        keyOfCurrent: (c) => c.fieldValue,
        changed: (c, d) =>
          (d.isVisible !== undefined && d.isVisible !== c.isVisible) ||
          (d.position !== undefined && d.position !== c.position),
        create: (d) =>
          ctx.metadata.request(
            `mutation($input: CreateViewGroupInput!) { createViewGroup(input: $input) { id } }`,
            {
              input: {
                viewId,
                fieldValue: d.fieldValue,
                isVisible: d.isVisible ?? true,
                position: d.position,
              },
            },
          ),
        update: (c, d) =>
          ctx.metadata.request(
            `mutation($input: UpdateViewGroupInput!) { updateViewGroup(input: $input) { id } }`,
            {
              input: {
                id: c.id,
                update: pruneUndefined({
                  isVisible: d.isVisible,
                  position: d.position,
                  fieldValue: d.fieldValue,
                }),
              },
            },
          ),
        remove: (c) =>
          ctx.metadata.request(
            `mutation($input: DeleteViewGroupInput!) { deleteViewGroup(input: $input) { id } }`,
            { input: { id: c.id } },
          ),
      });
      emitReconcile('groups', viewId, result, ctx);
    });
}

function registerSetFilterGroups(view: Command): void {
  view
    .command('set-filter-groups <viewId>')
    .description("reconcile a view's filter groups (AND/OR hierarchy)")
    .requiredOption(
      '--file <path>',
      'array of {parentViewFilterGroupId?,logicalOperator,positionInViewFilterGroup?}',
    )
    .action(async (viewId: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const desired = expectArray(loadInputFile(opts.file), opts.file);
      const data = await ctx.metadata.request<{ getViewFilterGroups: ViewFilterGroup[] }>(
        `query Q($viewId: String!) {
           getViewFilterGroups(viewId: $viewId) { ${VIEW_FILTER_GROUP} }
         }`,
        { viewId },
      );

      // Tree-shaped reconcile: key by (parent, position). The same key function
      // applies to both sides so a current group with id "fg-root" matches a
      // desired entry that omits id but pins the same (parent, position).
      const filterGroupKey = (parent: unknown, pos: unknown): string =>
        `${parent ?? 'root'}@${pos ?? 0}`;

      const result = await reconcile<ViewFilterGroup>({
        desired,
        current: data.getViewFilterGroups,
        keyOfDesired: (d) =>
          filterGroupKey(d.parentViewFilterGroupId, d.positionInViewFilterGroup),
        keyOfCurrent: (c) =>
          filterGroupKey(c.parentViewFilterGroupId, c.positionInViewFilterGroup),
        changed: (c, d) =>
          (d.logicalOperator !== undefined && d.logicalOperator !== c.logicalOperator) ||
          (d.positionInViewFilterGroup !== undefined &&
            d.positionInViewFilterGroup !== c.positionInViewFilterGroup) ||
          (d.parentViewFilterGroupId !== undefined &&
            d.parentViewFilterGroupId !== c.parentViewFilterGroupId),
        create: (d) =>
          ctx.metadata.request(
            `mutation($input: CreateViewFilterGroupInput!) {
               createViewFilterGroup(input: $input) { id }
             }`,
            {
              input: pruneUndefined({
                viewId,
                parentViewFilterGroupId: d.parentViewFilterGroupId,
                logicalOperator: d.logicalOperator ?? 'AND',
                positionInViewFilterGroup: d.positionInViewFilterGroup,
              }),
            },
          ),
        update: (c, d) =>
          ctx.metadata.request(
            `mutation($id: String!, $input: UpdateViewFilterGroupInput!) {
               updateViewFilterGroup(id: $id, input: $input) { id }
             }`,
            {
              id: c.id,
              input: pruneUndefined({
                parentViewFilterGroupId: d.parentViewFilterGroupId,
                logicalOperator: d.logicalOperator,
                positionInViewFilterGroup: d.positionInViewFilterGroup,
              }),
            },
          ),
        remove: (c) =>
          ctx.metadata.request(
            `mutation($id: String!) { deleteViewFilterGroup(id: $id) }`,
            { id: c.id },
          ),
      });
      emitReconcile('filter-groups', viewId, result, ctx);
    });
}

function registerSetFieldGroups(view: Command): void {
  view
    .command('set-field-groups <viewId>')
    .description("reconcile a view's field groups (collapsible section labels)")
    .requiredOption('--file <path>', 'array of {name,position?,isVisible?}')
    .action(async (viewId: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const desired = expectArray(loadInputFile(opts.file), opts.file);
      const data = await ctx.metadata.request<{ getViewFieldGroups: ViewFieldGroup[] }>(
        `query Q($viewId: String!) {
           getViewFieldGroups(viewId: $viewId) { ${VIEW_FIELD_GROUP} }
         }`,
        { viewId },
      );

      const result = await reconcile<ViewFieldGroup>({
        desired,
        current: data.getViewFieldGroups,
        keyOfDesired: (d) => requireString(d, 'name', opts.file),
        keyOfCurrent: (c) => c.name,
        changed: (c, d) =>
          (d.position !== undefined && d.position !== c.position) ||
          (d.isVisible !== undefined && d.isVisible !== c.isVisible),
        create: (d) =>
          ctx.metadata.request(
            `mutation($input: CreateViewFieldGroupInput!) {
               createViewFieldGroup(input: $input) { id }
             }`,
            {
              input: pruneUndefined({
                viewId,
                name: d.name,
                position: d.position,
                isVisible: d.isVisible,
              }),
            },
          ),
        update: (c, d) =>
          ctx.metadata.request(
            `mutation($input: UpdateViewFieldGroupInput!) {
               updateViewFieldGroup(input: $input) { id }
             }`,
            {
              input: {
                id: c.id,
                update: pruneUndefined({
                  name: d.name,
                  position: d.position,
                  isVisible: d.isVisible,
                }),
              },
            },
          ),
        remove: (c) =>
          ctx.metadata.request(
            `mutation($input: DeleteViewFieldGroupInput!) {
               deleteViewFieldGroup(input: $input) { id }
             }`,
            { input: { id: c.id } },
          ),
      });
      emitReconcile('field-groups', viewId, result, ctx);
    });
}

function emitReconcile(what: string, viewId: string, r: ReconcileResult, ctx: Ctx): void {
  emitOk(
    `view ${viewId} ${what}: +${r.created} ~${r.updated} -${r.deleted} =${r.unchanged}`,
    { viewId, what, ...r },
    ctx.out,
  );
}

function requireString(obj: Record<string, unknown>, key: string, file: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new CliError(`${file}: every entry needs a "${key}" string`, EXIT.USAGE);
  }
  return v;
}

function pruneUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function parseBool(raw: string, flag: string): boolean {
  const v = raw.toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  throw new CliError(`${flag} must be true|false (got "${raw}")`, EXIT.USAGE);
}
