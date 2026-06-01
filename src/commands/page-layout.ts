import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { PAGE_LAYOUT_SUMMARY, PAGE_LAYOUT_TAB_SUMMARY, PAGE_LAYOUT_WIDGET_SUMMARY } from '../lib/gql.js';
import { loadInputFile } from '../lib/input-file.js';
import { resolveObjectId } from '../lib/objects.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

/**
 * `twenty-ops page-layout …` — manage record-detail and dashboard page layouts.
 *
 * Verified mutation shapes (live probe):
 *   createPageLayout(input: CreatePageLayoutInput!): PageLayout!
 *     { name!, type?: PageLayoutType, objectMetadataId? }
 *   updatePageLayout(id: UUID!, input: UpdatePageLayoutInput!): PageLayout!
 *     flat input (not the {id,update} wrapper used elsewhere)
 *   destroyPageLayout(id: UUID!): Boolean!         (hard delete, no soft-delete variant)
 *   resetPageLayoutToDefault(id: UUID!): PageLayout!
 *
 *   getPageLayouts(objectMetadataId: String, pageLayoutType: PageLayoutType): [PageLayout!]!
 *   getPageLayout(id: String!): PageLayout
 *
 * PageLayoutType enum: RECORD_INDEX | RECORD_PAGE | DASHBOARD | STANDALONE_PAGE.
 *
 * `getPageLayouts` requires *both* `objectMetadataId` AND `pageLayoutType` — the
 * `--object` flag is required on `list`. (Twenty's UI also scopes layout
 * browsing to a single object at a time.)
 */
export function registerPageLayoutCommands(program: Command): void {
  const pl = program.command('page-layout').description('manage page layouts (record-detail + dashboard pages)');

  pl.command('list')
    .description('list page layouts for an object (required)')
    .requiredOption('--object <ref>', 'object id or name (nameSingular/namePlural)')
    .option('--type <T>', 'RECORD_INDEX | RECORD_PAGE | DASHBOARD | STANDALONE_PAGE')
    .action(async (opts: { object: string; type?: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const objectMetadataId = await resolveObjectId(ctx.metadata, opts.object);
      const data = await ctx.metadata.request<{ getPageLayouts: PageLayoutNode[] }>(
        `query Layouts($objectMetadataId: String, $pageLayoutType: PageLayoutType) {
           getPageLayouts(objectMetadataId: $objectMetadataId, pageLayoutType: $pageLayoutType) {
             ${PAGE_LAYOUT_SUMMARY}
           }
         }`,
        {
          objectMetadataId,
          pageLayoutType: opts.type ? opts.type.toUpperCase() : undefined,
        },
      );
      emitList(data.getPageLayouts, plColumns(ctx), ctx.out);
    });

  pl.command('get <pageLayoutId>')
    .description('show one page layout')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ getPageLayout: PageLayoutNode | null }>(
        `query L($id: String!) { getPageLayout(id: $id) { ${PAGE_LAYOUT_SUMMARY} } }`,
        { id },
      );
      if (!data.getPageLayout) throw new CliError(`page layout "${id}" not found`, EXIT.NOT_FOUND);
      emitOne(
        data.getPageLayout as unknown as Record<string, unknown>,
        plColumns(ctx),
        ctx.out,
      );
    });

  pl.command('create')
    .description('create a page layout from a JSON/YAML file (- for stdin)')
    .requiredOption('--file <path>', 'CreatePageLayoutInput { name, type?, objectMetadataId? }')
    .action(async (opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const input = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(input) || typeof input !== 'object' || input === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      if (typeof input.name !== 'string') {
        throw new CliError(`${opts.file} is missing required field "name"`, EXIT.USAGE);
      }
      const data = await ctx.metadata.request<{ createPageLayout: PageLayoutNode }>(
        `mutation Create($input: CreatePageLayoutInput!) {
           createPageLayout(input: $input) { ${PAGE_LAYOUT_SUMMARY} }
         }`,
        { input },
      );
      emitOk(
        `created page layout ${data.createPageLayout.id} (${data.createPageLayout.name})`,
        data.createPageLayout as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  pl.command('update <pageLayoutId>')
    .description('update a page layout from a JSON/YAML file')
    .requiredOption('--file <path>', 'partial { name?, type?, objectMetadataId? }')
    .action(async (id: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const input = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(input) || typeof input !== 'object' || input === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const data = await ctx.metadata.request<{ updatePageLayout: PageLayoutNode }>(
        `mutation Update($id: String!, $input: UpdatePageLayoutInput!) {
           updatePageLayout(id: $id, input: $input) { ${PAGE_LAYOUT_SUMMARY} }
         }`,
        { id, input },
      );
      emitOk(`updated page layout ${id}`, data.updatePageLayout as unknown as Record<string, unknown>, ctx.out);
    });

  pl.command('delete <pageLayoutId>')
    .description('hard-delete a page layout (no soft-delete; cascades to tabs + widgets)')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.metadata.request(
        `mutation Destroy($id: String!) { destroyPageLayout(id: $id) }`,
        { id },
      );
      emitOk(`deleted page layout ${id}`, { deleted: id }, ctx.out);
    });

  pl.command('reset <pageLayoutId>')
    .description('revert a page layout to its default (stock Twenty layout)')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ resetPageLayoutToDefault: PageLayoutNode }>(
        `mutation Reset($id: String!) {
           resetPageLayoutToDefault(id: $id) { ${PAGE_LAYOUT_SUMMARY} }
         }`,
        { id },
      );
      emitOk(`reset page layout ${id}`, data.resetPageLayoutToDefault as unknown as Record<string, unknown>, ctx.out);
    });

  pl.command('sync <pageLayoutId>')
    .description('declaratively replace a page layout + its tabs + widgets in one call')
    .requiredOption('--file <path>', 'UpdatePageLayoutWithTabsInput { name, type, objectMetadataId?, tabs[] }')
    .action(async (id: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const input = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(input) || typeof input !== 'object' || input === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      for (const required of ['name', 'type', 'tabs']) {
        if (input[required] === undefined) {
          throw new CliError(`${opts.file} is missing required field "${required}"`, EXIT.USAGE);
        }
      }
      const data = await ctx.metadata.request<{ updatePageLayoutWithTabsAndWidgets: PageLayoutNode }>(
        `mutation Sync($id: String!, $input: UpdatePageLayoutWithTabsInput!) {
           updatePageLayoutWithTabsAndWidgets(id: $id, input: $input) { ${PAGE_LAYOUT_SUMMARY} }
         }`,
        { id, input },
      );
      emitOk(
        `synced page layout ${id} (whole tree)`,
        data.updatePageLayoutWithTabsAndWidgets as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  registerTabSubcommands(pl);
  registerWidgetSubcommands(pl);
}

interface PageLayoutTabNode {
  id: string;
  title: string;
  position: number;
  pageLayoutId: string;
  icon: string | null;
  layoutMode: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function registerTabSubcommands(pl: Command): void {
  const tab = pl.command('tab').description('manage tabs inside a page layout');

  tab.command('list <pageLayoutId>')
    .description("list a page layout's tabs")
    .action(async (pageLayoutId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ getPageLayoutTabs: PageLayoutTabNode[] }>(
        `query Tabs($id: String!) { getPageLayoutTabs(pageLayoutId: $id) { ${PAGE_LAYOUT_TAB_SUMMARY} } }`,
        { id: pageLayoutId },
      );
      emitList(data.getPageLayoutTabs, tabColumns(ctx), ctx.out);
    });

  tab.command('get <tabId>')
    .description('show one tab')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ getPageLayoutTab: PageLayoutTabNode | null }>(
        `query Tab($id: String!) { getPageLayoutTab(id: $id) { ${PAGE_LAYOUT_TAB_SUMMARY} } }`,
        { id },
      );
      if (!data.getPageLayoutTab) throw new CliError(`page layout tab "${id}" not found`, EXIT.NOT_FOUND);
      emitOne(
        data.getPageLayoutTab as unknown as Record<string, unknown>,
        tabColumns(ctx),
        ctx.out,
      );
    });

  tab.command('create')
    .description('create a tab inside a page layout')
    .requiredOption('--page-layout <id>', 'parent page layout id')
    .requiredOption('--file <path>', 'CreatePageLayoutTabInput { title, position?, layoutMode? }')
    .action(async (opts: { pageLayout: string; file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const loaded = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(loaded) || typeof loaded !== 'object' || loaded === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      if (typeof loaded.title !== 'string') {
        throw new CliError(`${opts.file} is missing required field "title"`, EXIT.USAGE);
      }
      const input = { pageLayoutId: opts.pageLayout, ...loaded };
      const data = await ctx.metadata.request<{ createPageLayoutTab: PageLayoutTabNode }>(
        `mutation Create($input: CreatePageLayoutTabInput!) {
           createPageLayoutTab(input: $input) { ${PAGE_LAYOUT_TAB_SUMMARY} }
         }`,
        { input },
      );
      emitOk(
        `created tab ${data.createPageLayoutTab.id} (${data.createPageLayoutTab.title})`,
        data.createPageLayoutTab as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  tab.command('update <tabId>')
    .description('update a tab from a JSON/YAML file')
    .requiredOption('--file <path>', 'partial UpdatePageLayoutTabInput { title?, position?, icon?, layoutMode? }')
    .action(async (id: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const input = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(input) || typeof input !== 'object' || input === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const data = await ctx.metadata.request<{ updatePageLayoutTab: PageLayoutTabNode }>(
        `mutation Update($id: String!, $input: UpdatePageLayoutTabInput!) {
           updatePageLayoutTab(id: $id, input: $input) { ${PAGE_LAYOUT_TAB_SUMMARY} }
         }`,
        { id, input },
      );
      emitOk(`updated tab ${id}`, data.updatePageLayoutTab as unknown as Record<string, unknown>, ctx.out);
    });

  tab.command('delete <tabId>')
    .description('hard-delete a tab (no soft-delete; cascades to widgets)')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.metadata.request(
        `mutation Destroy($id: String!) { destroyPageLayoutTab(id: $id) }`,
        { id },
      );
      emitOk(`deleted tab ${id}`, { deleted: id }, ctx.out);
    });

  tab.command('reset <tabId>')
    .description('revert a tab to its default (stock layouts only)')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ resetPageLayoutTabToDefault: PageLayoutTabNode }>(
        `mutation Reset($id: String!) {
           resetPageLayoutTabToDefault(id: $id) { ${PAGE_LAYOUT_TAB_SUMMARY} }
         }`,
        { id },
      );
      emitOk(`reset tab ${id}`, data.resetPageLayoutTabToDefault as unknown as Record<string, unknown>, ctx.out);
    });
}

function tabColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'title', 'position', 'pageLayoutId', 'layoutMode'];
}

interface PageLayoutWidgetNode {
  id: string;
  title: string;
  type: string;
  pageLayoutTabId: string;
  objectMetadataId: string | null;
  conditionalDisplay: unknown;
  conditionalAvailabilityExpression: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function registerWidgetSubcommands(pl: Command): void {
  const widget = pl.command('widget').description('manage widgets inside a tab');

  widget.command('list <pageLayoutTabId>')
    .description("list widgets on a tab")
    .action(async (pageLayoutTabId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ getPageLayoutWidgets: PageLayoutWidgetNode[] }>(
        `query Widgets($id: String!) {
           getPageLayoutWidgets(pageLayoutTabId: $id) { ${PAGE_LAYOUT_WIDGET_SUMMARY} }
         }`,
        { id: pageLayoutTabId },
      );
      emitList(data.getPageLayoutWidgets, widgetColumns(ctx), ctx.out);
    });

  widget.command('get <widgetId>')
    .description('show one widget')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ getPageLayoutWidget: PageLayoutWidgetNode | null }>(
        `query Widget($id: String!) {
           getPageLayoutWidget(id: $id) { ${PAGE_LAYOUT_WIDGET_SUMMARY} }
         }`,
        { id },
      );
      if (!data.getPageLayoutWidget) {
        throw new CliError(`page layout widget "${id}" not found`, EXIT.NOT_FOUND);
      }
      emitOne(
        data.getPageLayoutWidget as unknown as Record<string, unknown>,
        widgetColumns(ctx),
        ctx.out,
      );
    });

  widget.command('create')
    .description('create a widget inside a tab')
    .requiredOption('--tab <id>', 'parent page-layout tab id')
    .requiredOption(
      '--file <path>',
      'CreatePageLayoutWidgetInput { title, type(WidgetType!), gridPosition!, configuration!(JSON), objectMetadataId?, position? }',
    )
    .action(async (opts: { tab: string; file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const loaded = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(loaded) || typeof loaded !== 'object' || loaded === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      if (typeof loaded.title !== 'string') {
        throw new CliError(`${opts.file} is missing required field "title"`, EXIT.USAGE);
      }
      if (typeof loaded.type !== 'string') {
        throw new CliError(`${opts.file} is missing required field "type" (WidgetType enum)`, EXIT.USAGE);
      }
      if (typeof loaded.gridPosition !== 'object' || loaded.gridPosition === null) {
        throw new CliError(
          `${opts.file} is missing required field "gridPosition" {row,column,rowSpan,columnSpan}`,
          EXIT.USAGE,
        );
      }
      if (loaded.configuration === undefined) {
        throw new CliError(
          `${opts.file} is missing required field "configuration" (JSON; per-widget-type shape)`,
          EXIT.USAGE,
        );
      }
      const input = { pageLayoutTabId: opts.tab, ...loaded };
      const data = await ctx.metadata.request<{ createPageLayoutWidget: PageLayoutWidgetNode }>(
        `mutation Create($input: CreatePageLayoutWidgetInput!) {
           createPageLayoutWidget(input: $input) { ${PAGE_LAYOUT_WIDGET_SUMMARY} }
         }`,
        { input },
      );
      emitOk(
        `created widget ${data.createPageLayoutWidget.id} (${data.createPageLayoutWidget.title})`,
        data.createPageLayoutWidget as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  widget.command('update <widgetId>')
    .description('update a widget from a JSON/YAML file')
    .requiredOption('--file <path>', 'partial UpdatePageLayoutWidgetInput')
    .action(async (id: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const input = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(input) || typeof input !== 'object' || input === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const data = await ctx.metadata.request<{ updatePageLayoutWidget: PageLayoutWidgetNode }>(
        `mutation Update($id: String!, $input: UpdatePageLayoutWidgetInput!) {
           updatePageLayoutWidget(id: $id, input: $input) { ${PAGE_LAYOUT_WIDGET_SUMMARY} }
         }`,
        { id, input },
      );
      emitOk(`updated widget ${id}`, data.updatePageLayoutWidget as unknown as Record<string, unknown>, ctx.out);
    });

  widget.command('delete <widgetId>')
    .description('hard-delete a widget (no soft-delete)')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.metadata.request(
        `mutation Destroy($id: String!) { destroyPageLayoutWidget(id: $id) }`,
        { id },
      );
      emitOk(`deleted widget ${id}`, { deleted: id }, ctx.out);
    });

  widget.command('reset <widgetId>')
    .description('revert a widget to its default (stock layouts only)')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ resetPageLayoutWidgetToDefault: PageLayoutWidgetNode }>(
        `mutation Reset($id: String!) {
           resetPageLayoutWidgetToDefault(id: $id) { ${PAGE_LAYOUT_WIDGET_SUMMARY} }
         }`,
        { id },
      );
      emitOk(`reset widget ${id}`, data.resetPageLayoutWidgetToDefault as unknown as Record<string, unknown>, ctx.out);
    });

  /*
   * `configure-view` and `configure-fields` ship the upsertViewWidget /
   * upsertFieldsWidget mutations that were deferred from v0.6 (Step 4).
   * Both whole-list-replace the widget's content keyed by widgetId — same
   * semantics as the v0.5 permission setters. Pass-through JSON; the
   * caller's file supplies the arrays verbatim.
   *
   *   upsertViewWidget(input: { widgetId, viewFields[], viewFilters[],
   *                              viewFilterGroups[], viewSorts[] }): View!
   *   upsertFieldsWidget(input: { widgetId, groups[], fields[] }): View!
   */
  widget.command('configure-view <widgetId>')
    .description('configure a VIEW widget\'s viewFields/viewFilters/viewSorts/viewFilterGroups')
    .requiredOption(
      '--file <path>',
      'UpsertViewWidgetInput body (without widgetId — supplied by the arg)',
    )
    .action(async (widgetId: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const loaded = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(loaded) || typeof loaded !== 'object' || loaded === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const input = { widgetId, ...loaded };
      // upsertViewWidget returns View! — select just the id so we don't
      // re-encode the widget union types.
      await ctx.metadata.request<{ upsertViewWidget: { id: string } }>(
        `mutation Configure($input: UpsertViewWidgetInput!) {
           upsertViewWidget(input: $input) { id }
         }`,
        { input },
      );
      emitOk(`configured view widget ${widgetId}`, { widgetId, configured: 'view' }, ctx.out);
    });

  widget.command('configure-fields <widgetId>')
    .description('configure a FIELDS widget\'s groups + fields')
    .requiredOption(
      '--file <path>',
      'UpsertFieldsWidgetInput body (without widgetId — supplied by the arg)',
    )
    .action(async (widgetId: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const loaded = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(loaded) || typeof loaded !== 'object' || loaded === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const input = { widgetId, ...loaded };
      await ctx.metadata.request<{ upsertFieldsWidget: { id: string } }>(
        `mutation Configure($input: UpsertFieldsWidgetInput!) {
           upsertFieldsWidget(input: $input) { id }
         }`,
        { input },
      );
      emitOk(`configured fields widget ${widgetId}`, { widgetId, configured: 'fields' }, ctx.out);
    });
}

function widgetColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'title', 'type', 'pageLayoutTabId', 'objectMetadataId'];
}

interface PageLayoutNode {
  id: string;
  name: string;
  type: string;
  objectMetadataId: string | null;
  createdAt: string;
  updatedAt: string;
}

function plColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'name', 'type', 'objectMetadataId'];
}
