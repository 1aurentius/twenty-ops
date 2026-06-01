import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { COMMAND_MENU_ITEM_SUMMARY } from '../lib/gql.js';
import { loadInputFile } from '../lib/input-file.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

/**
 * `twenty-ops command-menu-item …` — manage Cmd-K palette entries.
 *
 * Verified shapes (live probe):
 *   createCommandMenuItem(input { label!, engineComponentKey!, frontComponentId?,
 *     workflowVersionId?, icon?, shortLabel?, position?, isPinned?, availabilityType?,
 *     hotKeys?, conditionalAvailabilityExpression?, availabilityObjectMetadataId?,
 *     payload(JSON?), pageLayoutId? })
 *   updateCommandMenuItem(input { id!, label?, icon?, shortLabel?, position?,
 *     isPinned?, availabilityType?, availabilityObjectMetadataId?,
 *     engineComponentKey?, hotKeys?, pageLayoutId? })   — flat, no wrapper
 *   deleteCommandMenuItem(id: UUID!) → CommandMenuItem
 *   commandMenuItem(id) / commandMenuItems()
 *
 * `engineComponentKey` is an `EngineComponentKey` enum identifying which
 * built-in or partner-provided component renders the item's action.
 */
export function registerCommandMenuItemCommands(program: Command): void {
  const cmi = program.command('command-menu-item').description('manage workspace Cmd-K palette entries');

  cmi.command('list')
    .description('list every command menu item in the workspace')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ commandMenuItems: CommandMenuItem[] }>(
        `query { commandMenuItems { ${COMMAND_MENU_ITEM_SUMMARY} } }`,
      );
      emitList(data.commandMenuItems, cmiColumns(ctx), ctx.out);
    });

  cmi.command('get <id>')
    .description('show one command menu item')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ commandMenuItem: CommandMenuItem | null }>(
        `query CMI($id: UUID!) { commandMenuItem(id: $id) { ${COMMAND_MENU_ITEM_SUMMARY} } }`,
        { id },
      );
      if (!data.commandMenuItem) throw new CliError(`command menu item "${id}" not found`, EXIT.NOT_FOUND);
      emitOne(data.commandMenuItem as unknown as Record<string, unknown>, cmiColumns(ctx), ctx.out);
    });

  cmi.command('create')
    .description('add a command menu item to the workspace palette')
    .requiredOption(
      '--file <path>',
      'CreateCommandMenuItemInput { label, engineComponentKey, ... }',
    )
    .action(async (opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const input = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(input) || typeof input !== 'object' || input === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      if (typeof input.label !== 'string') {
        throw new CliError(`${opts.file} is missing required field "label"`, EXIT.USAGE);
      }
      if (typeof input.engineComponentKey !== 'string') {
        throw new CliError(`${opts.file} is missing required field "engineComponentKey"`, EXIT.USAGE);
      }
      const data = await ctx.metadata.request<{ createCommandMenuItem: CommandMenuItem }>(
        `mutation Create($input: CreateCommandMenuItemInput!) {
           createCommandMenuItem(input: $input) { ${COMMAND_MENU_ITEM_SUMMARY} }
         }`,
        { input },
      );
      emitOk(
        `created command menu item ${data.createCommandMenuItem.id} (${data.createCommandMenuItem.label})`,
        data.createCommandMenuItem as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  cmi.command('update <id>')
    .description('update a command menu item (flat input — no wrapper)')
    .requiredOption('--file <path>', 'partial UpdateCommandMenuItemInput')
    .action(async (id: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const update = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(update) || typeof update !== 'object' || update === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const data = await ctx.metadata.request<{ updateCommandMenuItem: CommandMenuItem }>(
        `mutation Update($input: UpdateCommandMenuItemInput!) {
           updateCommandMenuItem(input: $input) { ${COMMAND_MENU_ITEM_SUMMARY} }
         }`,
        { input: { id, ...update } },
      );
      emitOk(`updated command menu item ${id}`, data.updateCommandMenuItem as unknown as Record<string, unknown>, ctx.out);
    });

  cmi.command('delete <id>')
    .description('delete a command menu item')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.metadata.request(
        `mutation Delete($id: UUID!) { deleteCommandMenuItem(id: $id) { id } }`,
        { id },
      );
      emitOk(`deleted command menu item ${id}`, { deleted: id }, ctx.out);
    });
}

interface CommandMenuItem {
  id: string;
  label: string;
  icon: string | null;
  shortLabel: string | null;
  position: number;
  isPinned: boolean;
  engineComponentKey: string;
  availabilityType: string;
  availabilityObjectMetadataId: string | null;
  hotKeys: string[] | null;
  conditionalAvailabilityExpression: string | null;
  workflowVersionId: string | null;
  frontComponentId: string | null;
  pageLayoutId: string | null;
  applicationId: string | null;
  universalIdentifier: string | null;
  createdAt: string;
  updatedAt: string;
}

function cmiColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'label', 'engineComponentKey', 'isPinned', 'availabilityType', 'position'];
}
