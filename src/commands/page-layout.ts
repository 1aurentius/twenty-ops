import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { PAGE_LAYOUT_SUMMARY } from '../lib/gql.js';
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
