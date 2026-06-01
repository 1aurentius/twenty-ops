import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { BLOCKLIST_SUMMARY } from '../lib/gql.js';
import { loadInputFile } from '../lib/input-file.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

/**
 * `twenty-ops blocklist …` — manage per-workspace-member address blocklists.
 *
 * Verified shapes (live probe, twenty-ops-test stack):
 *   createBlocklist(data, upsert)        → Blocklist
 *   updateBlocklist(id, data)            → Blocklist
 *   delete/destroy/restoreBlocklist(id)  → Blocklist
 *   blocklist(filter)                    → Blocklist
 *   blocklists(first, after, filter, ...) → Connection
 *
 * BlocklistCreateInput is genuinely agent-friendly — `{handle,
 * workspaceMemberId}`. No OAuth coupling; full integration lifecycle.
 */
export function registerBlocklistCommands(program: Command): void {
  const bl = program.command('blocklist').description('manage address blocklists per workspace member');

  bl.command('list')
    .description('list blocklist entries visible to the calling actor')
    .option('--limit <n>', 'max rows', Number, 50)
    .option('--starting-after <id>', 'opaque cursor for paging')
    .action(async (opts: { limit: number; startingAfter?: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{ blocklists: Connection<Blocklist> }>(
        `query BLs($first: Int, $after: String) {
           blocklists(first: $first, after: $after) {
             edges { node { ${BLOCKLIST_SUMMARY} } }
           }
         }`,
        { first: opts.limit, after: opts.startingAfter },
      );
      emitList(
        data.blocklists.edges.map((e) => e.node),
        blColumns(ctx),
        ctx.out,
      );
    });

  bl.command('get <blocklistId>')
    .description('show one blocklist entry')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{ blocklist: Blocklist | null }>(
        `query BL($id: UUID!) {
           blocklist(filter: { id: { eq: $id } }) { ${BLOCKLIST_SUMMARY} }
         }`,
        { id },
      );
      if (!data.blocklist) throw new CliError(`blocklist entry "${id}" not found`, EXIT.NOT_FOUND);
      emitOne(data.blocklist as unknown as Record<string, unknown>, blColumns(ctx), ctx.out);
    });

  bl.command('create')
    .description('add a blocklist entry — { handle, workspaceMemberId }')
    .requiredOption('--file <path>', 'BlocklistCreateInput { handle, workspaceMemberId }')
    .action(async (opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(data) || typeof data !== 'object' || data === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const res = await ctx.core.request<{ createBlocklist: Blocklist }>(
        `mutation Create($data: BlocklistCreateInput!) {
           createBlocklist(data: $data) { ${BLOCKLIST_SUMMARY} }
         }`,
        { data },
      );
      emitOk(
        `created blocklist entry ${res.createBlocklist.id}`,
        res.createBlocklist as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  bl.command('update <blocklistId>')
    .description('update a blocklist entry')
    .requiredOption('--file <path>', 'partial BlocklistUpdateInput')
    .action(async (id: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(data) || typeof data !== 'object' || data === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const res = await ctx.core.request<{ updateBlocklist: Blocklist }>(
        `mutation Update($id: UUID!, $data: BlocklistUpdateInput!) {
           updateBlocklist(id: $id, data: $data) { ${BLOCKLIST_SUMMARY} }
         }`,
        { id, data },
      );
      emitOk(
        `updated blocklist entry ${id}`,
        res.updateBlocklist as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  bl.command('delete <blocklistId>')
    .description('soft-delete a blocklist entry (use `restore` to undo)')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.core.request(
        `mutation Delete($id: UUID!) { deleteBlocklist(id: $id) { id } }`,
        { id },
      );
      emitOk(`deleted blocklist entry ${id}`, { deleted: id }, ctx.out);
    });

  bl.command('destroy <blocklistId>')
    .description('hard-delete a blocklist entry (irrecoverable)')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.core.request(
        `mutation Destroy($id: UUID!) { destroyBlocklist(id: $id) { id } }`,
        { id },
      );
      emitOk(`destroyed blocklist entry ${id}`, { destroyed: id }, ctx.out);
    });

  bl.command('restore <blocklistId>')
    .description('un-soft-delete a blocklist entry from the recycle bin')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{ restoreBlocklist: Blocklist }>(
        `mutation Restore($id: UUID!) {
           restoreBlocklist(id: $id) { ${BLOCKLIST_SUMMARY} }
         }`,
        { id },
      );
      emitOk(
        `restored blocklist entry ${id}`,
        data.restoreBlocklist as unknown as Record<string, unknown>,
        ctx.out,
      );
    });
}

interface Blocklist {
  id: string;
  handle: string | null;
  workspaceMemberId: string;
  createdAt: string;
  updatedAt: string;
}

interface Connection<T> {
  edges: { node: T }[];
}

function blColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'handle', 'workspaceMemberId'];
}
