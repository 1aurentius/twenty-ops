import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { MESSAGE_CHANNEL_SUMMARY } from '../lib/gql.js';
import { loadInputFile } from '../lib/input-file.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

/**
 * `twenty-ops message-channel …` — manage per-mailbox inbound sync settings.
 *
 * Verified shapes (live probe, twenty-ops-test stack):
 *   createMessageChannel(data, upsert)        → MessageChannel
 *   updateMessageChannel(id, data)            → MessageChannel
 *   delete/destroy/restoreMessageChannel(id)  → MessageChannel
 *   messageChannel(filter)                    → MessageChannel
 *   messageChannels(first, after, filter, ...) → Connection
 *
 * Required enums on create:
 *   visibility: MessageChannelVisibilityEnum
 *   type: MessageChannelTypeEnum
 *   contactAutoCreationPolicy: MessageChannelContactAutoCreationPolicyEnum
 *   messageFolderImportPolicy: MessageChannelMessageFolderImportPolicyEnum
 *   pendingGroupEmailsAction: MessageChannelPendingGroupEmailsActionEnum
 *   syncStage: MessageChannelSyncStageEnum
 *
 * `connectedAccountId` links the channel to its parent OAuth account.
 * Create is OAuth-coupled (relies on a valid connected account); update is
 * the agent's main lever for toggling `isSyncEnabled` and adjusting
 * filtering policies.
 */
export function registerMessageChannelCommands(program: Command): void {
  const mc = program.command('message-channel').description('manage per-mailbox inbound sync channels');

  mc.command('list')
    .description('list message channels visible to the calling actor')
    .option('--limit <n>', 'max rows', Number, 50)
    .option('--starting-after <id>', 'opaque cursor for paging')
    .action(async (opts: { limit: number; startingAfter?: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{ messageChannels: Connection<MessageChannel> }>(
        `query MCs($first: Int, $after: String) {
           messageChannels(first: $first, after: $after) {
             edges { node { ${MESSAGE_CHANNEL_SUMMARY} } }
           }
         }`,
        { first: opts.limit, after: opts.startingAfter },
      );
      emitList(
        data.messageChannels.edges.map((e) => e.node),
        mcColumns(ctx),
        ctx.out,
      );
    });

  mc.command('get <messageChannelId>')
    .description('show one message channel')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{ messageChannel: MessageChannel | null }>(
        `query MC($id: UUID!) {
           messageChannel(filter: { id: { eq: $id } }) { ${MESSAGE_CHANNEL_SUMMARY} }
         }`,
        { id },
      );
      if (!data.messageChannel) throw new CliError(`message channel "${id}" not found`, EXIT.NOT_FOUND);
      emitOne(data.messageChannel as unknown as Record<string, unknown>, mcColumns(ctx), ctx.out);
    });

  mc.command('create')
    .description('create a message channel (requires a parent connectedAccountId)')
    .requiredOption(
      '--file <path>',
      'MessageChannelCreateInput { connectedAccountId, type, visibility, handle, ... }',
    )
    .action(async (opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(data) || typeof data !== 'object' || data === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const res = await ctx.core.request<{ createMessageChannel: MessageChannel }>(
        `mutation Create($data: MessageChannelCreateInput!) {
           createMessageChannel(data: $data) { ${MESSAGE_CHANNEL_SUMMARY} }
         }`,
        { data },
      );
      emitOk(
        `created message channel ${res.createMessageChannel.id}`,
        res.createMessageChannel as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  mc.command('update <messageChannelId>')
    .description('update a message channel — main lever for toggling isSyncEnabled + policies')
    .requiredOption('--file <path>', 'partial MessageChannelUpdateInput')
    .action(async (id: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(data) || typeof data !== 'object' || data === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const res = await ctx.core.request<{ updateMessageChannel: MessageChannel }>(
        `mutation Update($id: UUID!, $data: MessageChannelUpdateInput!) {
           updateMessageChannel(id: $id, data: $data) { ${MESSAGE_CHANNEL_SUMMARY} }
         }`,
        { id, data },
      );
      emitOk(
        `updated message channel ${id}`,
        res.updateMessageChannel as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  mc.command('delete <messageChannelId>')
    .description('soft-delete a message channel (use `restore` to undo)')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.core.request(
        `mutation Delete($id: UUID!) { deleteMessageChannel(id: $id) { id } }`,
        { id },
      );
      emitOk(`deleted message channel ${id}`, { deleted: id }, ctx.out);
    });

  mc.command('destroy <messageChannelId>')
    .description('hard-delete a message channel (irrecoverable)')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.core.request(
        `mutation Destroy($id: UUID!) { destroyMessageChannel(id: $id) { id } }`,
        { id },
      );
      emitOk(`destroyed message channel ${id}`, { destroyed: id }, ctx.out);
    });

  mc.command('restore <messageChannelId>')
    .description('un-soft-delete a message channel from the recycle bin')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{ restoreMessageChannel: MessageChannel }>(
        `mutation Restore($id: UUID!) {
           restoreMessageChannel(id: $id) { ${MESSAGE_CHANNEL_SUMMARY} }
         }`,
        { id },
      );
      emitOk(
        `restored message channel ${id}`,
        data.restoreMessageChannel as unknown as Record<string, unknown>,
        ctx.out,
      );
    });
}

interface MessageChannel {
  id: string;
  handle: string | null;
  type: string;
  visibility: string;
  connectedAccountId: string;
  isSyncEnabled: boolean;
  syncStatus: string | null;
  syncStage: string;
  syncedAt: string | null;
  isContactAutoCreationEnabled: boolean;
  contactAutoCreationPolicy: string;
  excludeNonProfessionalEmails: boolean;
  excludeGroupEmails: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Connection<T> {
  edges: { node: T }[];
}

function mcColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'handle', 'type', 'isSyncEnabled', 'syncStatus', 'connectedAccountId'];
}
