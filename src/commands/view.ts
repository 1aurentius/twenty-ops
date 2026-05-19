import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import type { GraphQLClient } from '../api/graphql-client.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { VIEW_DETAIL, VIEW_FIELD, VIEW_FILTER, VIEW_SORT, VIEW_SUMMARY } from '../lib/gql.js';
import { expectArray, loadInputFile } from '../lib/input-file.js';
import { resolveObjectId } from '../lib/objects.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

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
    .description('show one view with its fields, filters and sorts')
    .action(async (viewId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ getView: View | null }>(
        `query View($id: String!) { getView(id: $id) { ${VIEW_DETAIL} } }`,
        { id: viewId },
      );
      if (!data.getView) throw new CliError(`view "${viewId}" not found`, EXIT.NOT_FOUND);
      emitOne(
        data.getView as unknown as Record<string, unknown>,
        ['id', 'name', 'objectMetadataId', 'type', 'icon', 'position', 'visibility', 'viewFields', 'viewFilters', 'viewSorts'],
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
    .description('update a view')
    .option('--name <name>')
    .option('--icon <icon>')
    .option('--type <type>', 'TABLE | KANBAN | CALENDAR')
    .option('--visibility <v>', 'WORKSPACE | UNLISTED')
    .option('--position <n>', 'sidebar position', Number)
    .action(
      async (
        viewId: string,
        opts: { name?: string; icon?: string; type?: string; visibility?: string; position?: number },
        cmd: Command,
      ) => {
        const ctx = makeCtx(cmd);
        const input: Record<string, unknown> = {};
        if (opts.name !== undefined) input.name = opts.name;
        if (opts.icon !== undefined) input.icon = opts.icon;
        if (opts.type !== undefined) input.type = opts.type.toUpperCase();
        if (opts.visibility !== undefined) input.visibility = opts.visibility.toUpperCase();
        if (opts.position !== undefined) input.position = opts.position;
        if (Object.keys(input).length === 0) {
          throw new CliError('nothing to update — pass at least one field flag', EXIT.USAGE);
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
}

/* --------------------------------------------------------------------------
 * Declarative `set-*` subcommands: reconcile the workspace to a desired file.
 * ------------------------------------------------------------------------ */

interface ReconcileResult {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
}

/** Generic create/update/delete reconciliation, matching records by a key. */
async function reconcile<C extends { id: string }>(args: {
  desired: Record<string, unknown>[];
  current: C[];
  keyOfDesired: (d: Record<string, unknown>) => string;
  keyOfCurrent: (c: C) => string;
  changed: (cur: C, des: Record<string, unknown>) => boolean;
  create: (des: Record<string, unknown>) => Promise<void>;
  update: (cur: C, des: Record<string, unknown>) => Promise<void>;
  remove: (cur: C) => Promise<void>;
}): Promise<ReconcileResult> {
  const result: ReconcileResult = { created: 0, updated: 0, deleted: 0, unchanged: 0 };
  const currentByKey = new Map(args.current.map((c) => [args.keyOfCurrent(c), c]));
  const desiredKeys = new Set<string>();

  for (const des of args.desired) {
    const key = args.keyOfDesired(des);
    desiredKeys.add(key);
    const cur = currentByKey.get(key);
    if (!cur) {
      await args.create(des);
      result.created++;
    } else if (args.changed(cur, des)) {
      await args.update(cur, des);
      result.updated++;
    } else {
      result.unchanged++;
    }
  }
  for (const cur of args.current) {
    if (!desiredKeys.has(args.keyOfCurrent(cur))) {
      await args.remove(cur);
      result.deleted++;
    }
  }
  return result;
}

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
