import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { CALENDAR_CHANNEL_SUMMARY } from '../lib/gql.js';
import { loadInputFile } from '../lib/input-file.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

/**
 * `twenty-ops calendar-channel …` — manage per-calendar inbound sync settings.
 *
 * Verified shapes (live probe, twenty-ops-test stack):
 *   createCalendarChannel(data, upsert)        → CalendarChannel
 *   updateCalendarChannel(id, data)            → CalendarChannel
 *   delete/destroy/restoreCalendarChannel(id)  → CalendarChannel
 *   calendarChannel(filter)                    → CalendarChannel
 *   calendarChannels(first, after, filter, ...) → Connection
 *
 * Required enums on create:
 *   visibility: CalendarChannelVisibilityEnum
 *   contactAutoCreationPolicy: CalendarChannelContactAutoCreationPolicyEnum
 *   syncStage: CalendarChannelSyncStageEnum
 *
 * `connectedAccountId` links the channel to its parent OAuth account.
 * Create is OAuth-coupled; update is the agent's main lever for toggling
 * `isSyncEnabled` and adjusting auto-creation policies.
 */
export function registerCalendarChannelCommands(program: Command): void {
  const cc = program.command('calendar-channel').description('manage per-calendar inbound sync channels');

  cc.command('list')
    .description('list calendar channels visible to the calling actor')
    .option('--limit <n>', 'max rows', Number, 50)
    .option('--starting-after <id>', 'opaque cursor for paging')
    .action(async (opts: { limit: number; startingAfter?: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{ calendarChannels: Connection<CalendarChannel> }>(
        `query CCs($first: Int, $after: String) {
           calendarChannels(first: $first, after: $after) {
             edges { node { ${CALENDAR_CHANNEL_SUMMARY} } }
           }
         }`,
        { first: opts.limit, after: opts.startingAfter },
      );
      emitList(
        data.calendarChannels.edges.map((e) => e.node),
        ccColumns(ctx),
        ctx.out,
      );
    });

  cc.command('get <calendarChannelId>')
    .description('show one calendar channel')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{ calendarChannel: CalendarChannel | null }>(
        `query CC($id: UUID!) {
           calendarChannel(filter: { id: { eq: $id } }) { ${CALENDAR_CHANNEL_SUMMARY} }
         }`,
        { id },
      );
      if (!data.calendarChannel) throw new CliError(`calendar channel "${id}" not found`, EXIT.NOT_FOUND);
      emitOne(data.calendarChannel as unknown as Record<string, unknown>, ccColumns(ctx), ctx.out);
    });

  cc.command('create')
    .description('create a calendar channel (requires a parent connectedAccountId)')
    .requiredOption(
      '--file <path>',
      'CalendarChannelCreateInput { connectedAccountId, visibility, handle, ... }',
    )
    .action(async (opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(data) || typeof data !== 'object' || data === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const res = await ctx.core.request<{ createCalendarChannel: CalendarChannel }>(
        `mutation Create($data: CalendarChannelCreateInput!) {
           createCalendarChannel(data: $data) { ${CALENDAR_CHANNEL_SUMMARY} }
         }`,
        { data },
      );
      emitOk(
        `created calendar channel ${res.createCalendarChannel.id}`,
        res.createCalendarChannel as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  cc.command('update <calendarChannelId>')
    .description('update a calendar channel — main lever for toggling isSyncEnabled + policies')
    .requiredOption('--file <path>', 'partial CalendarChannelUpdateInput')
    .action(async (id: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(data) || typeof data !== 'object' || data === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const res = await ctx.core.request<{ updateCalendarChannel: CalendarChannel }>(
        `mutation Update($id: UUID!, $data: CalendarChannelUpdateInput!) {
           updateCalendarChannel(id: $id, data: $data) { ${CALENDAR_CHANNEL_SUMMARY} }
         }`,
        { id, data },
      );
      emitOk(
        `updated calendar channel ${id}`,
        res.updateCalendarChannel as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  cc.command('delete <calendarChannelId>')
    .description('soft-delete a calendar channel (use `restore` to undo)')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.core.request(
        `mutation Delete($id: UUID!) { deleteCalendarChannel(id: $id) { id } }`,
        { id },
      );
      emitOk(`deleted calendar channel ${id}`, { deleted: id }, ctx.out);
    });

  cc.command('destroy <calendarChannelId>')
    .description('hard-delete a calendar channel (irrecoverable)')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.core.request(
        `mutation Destroy($id: UUID!) { destroyCalendarChannel(id: $id) { id } }`,
        { id },
      );
      emitOk(`destroyed calendar channel ${id}`, { destroyed: id }, ctx.out);
    });

  cc.command('restore <calendarChannelId>')
    .description('un-soft-delete a calendar channel from the recycle bin')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{ restoreCalendarChannel: CalendarChannel }>(
        `mutation Restore($id: UUID!) {
           restoreCalendarChannel(id: $id) { ${CALENDAR_CHANNEL_SUMMARY} }
         }`,
        { id },
      );
      emitOk(
        `restored calendar channel ${id}`,
        data.restoreCalendarChannel as unknown as Record<string, unknown>,
        ctx.out,
      );
    });
}

interface CalendarChannel {
  id: string;
  handle: string | null;
  visibility: string;
  connectedAccountId: string;
  isSyncEnabled: boolean;
  syncStatus: string | null;
  syncStage: string;
  syncedAt: string | null;
  isContactAutoCreationEnabled: boolean;
  contactAutoCreationPolicy: string;
  createdAt: string;
  updatedAt: string;
}

interface Connection<T> {
  edges: { node: T }[];
}

function ccColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'handle', 'isSyncEnabled', 'syncStatus', 'connectedAccountId'];
}
