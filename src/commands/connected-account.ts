import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { CONNECTED_ACCOUNT_DTO_SUMMARY, CONNECTED_ACCOUNT_SUMMARY } from '../lib/gql.js';
import { loadInputFile } from '../lib/input-file.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

/**
 * `twenty-ops connected-account …` — manage workspace member OAuth bindings.
 *
 * Verified shapes (live probe, twenty-ops-test stack):
 *   createConnectedAccount(data, upsert) → ConnectedAccount
 *   updateConnectedAccount(id, data)     → ConnectedAccount
 *   deleteConnectedAccount(id)           → ConnectedAccount   (soft)
 *   destroyConnectedAccount(id)          → ConnectedAccount   (hard)
 *   restoreConnectedAccount(id)          → ConnectedAccount
 *   connectedAccount(filter)             → ConnectedAccount
 *   connectedAccounts(first, after, ...) → Connection
 *
 * Plus the metadata alias `myConnectedAccounts()` (user-context only —
 * verified AUTH gate; surfaced as `connected-account my` so an agent calling
 * with a user token can list its own accounts).
 *
 * Connected accounts carry `accessToken` + `refreshToken` + `scopes`. The
 * summary deliberately OMITS those secrets; pass `--fields
 * accessToken,refreshToken,scopes` to surface them when debugging.
 *
 * `create` requires a valid OAuth token (from Twenty's browser-driven OAuth
 * handshake). The wire shape is identical to other Core creates, but
 * integration testing it end-to-end isn't possible against the seeded stack
 * (no OAuth provider configured) — unit-tested only.
 */
export function registerConnectedAccountCommands(program: Command): void {
  const ca = program.command('connected-account').description('manage workspace member OAuth bindings');

  ca.command('list')
    .description('list connected accounts visible to the calling actor')
    .option('--limit <n>', 'max rows', Number, 50)
    .option('--starting-after <id>', 'opaque cursor for paging')
    .action(async (opts: { limit: number; startingAfter?: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{ connectedAccounts: Connection<ConnectedAccount> }>(
        `query CAs($first: Int, $after: String) {
           connectedAccounts(first: $first, after: $after) {
             edges { node { ${CONNECTED_ACCOUNT_SUMMARY} } }
           }
         }`,
        { first: opts.limit, after: opts.startingAfter },
      );
      emitList(
        data.connectedAccounts.edges.map((e) => e.node),
        caColumns(ctx),
        ctx.out,
      );
    });

  ca.command('my')
    .description('list the calling user\'s connected accounts (metadata — user context required)')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      // metadata's myConnectedAccounts returns ConnectedAccountDTO, which has
      // a different field set than core's ConnectedAccount — see
      // CONNECTED_ACCOUNT_DTO_SUMMARY for the DTO-specific selection.
      const data = await ctx.metadata.request<{ myConnectedAccounts: ConnectedAccountDTO[] }>(
        `query { myConnectedAccounts { ${CONNECTED_ACCOUNT_DTO_SUMMARY} } }`,
      );
      emitList(data.myConnectedAccounts, dtoColumns(ctx), ctx.out);
    });

  ca.command('get <connectedAccountId>')
    .description('show one connected account')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{ connectedAccount: ConnectedAccount | null }>(
        `query CA($id: UUID!) {
           connectedAccount(filter: { id: { eq: $id } }) { ${CONNECTED_ACCOUNT_SUMMARY} }
         }`,
        { id },
      );
      if (!data.connectedAccount) {
        throw new CliError(`connected account "${id}" not found`, EXIT.NOT_FOUND);
      }
      emitOne(
        data.connectedAccount as unknown as Record<string, unknown>,
        caColumns(ctx),
        ctx.out,
      );
    });

  ca.command('create')
    .description('create a connected account (requires a valid OAuth token in the file)')
    .requiredOption(
      '--file <path>',
      'ConnectedAccountCreateInput { provider, handle, accessToken, refreshToken, accountOwnerId, ... }',
    )
    .action(async (opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(data) || typeof data !== 'object' || data === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const res = await ctx.core.request<{ createConnectedAccount: ConnectedAccount }>(
        `mutation Create($data: ConnectedAccountCreateInput!) {
           createConnectedAccount(data: $data) { ${CONNECTED_ACCOUNT_SUMMARY} }
         }`,
        { data },
      );
      emitOk(
        `created connected account ${res.createConnectedAccount.id}`,
        res.createConnectedAccount as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  ca.command('update <connectedAccountId>')
    .description('update a connected account from a JSON/YAML file')
    .requiredOption('--file <path>', 'partial ConnectedAccountUpdateInput')
    .action(async (id: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(data) || typeof data !== 'object' || data === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const res = await ctx.core.request<{ updateConnectedAccount: ConnectedAccount }>(
        `mutation Update($id: UUID!, $data: ConnectedAccountUpdateInput!) {
           updateConnectedAccount(id: $id, data: $data) { ${CONNECTED_ACCOUNT_SUMMARY} }
         }`,
        { id, data },
      );
      emitOk(
        `updated connected account ${id}`,
        res.updateConnectedAccount as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  ca.command('delete <connectedAccountId>')
    .description('soft-delete a connected account (use `restore` to undo)')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.core.request(
        `mutation Delete($id: UUID!) { deleteConnectedAccount(id: $id) { id } }`,
        { id },
      );
      emitOk(`deleted connected account ${id}`, { deleted: id }, ctx.out);
    });

  ca.command('destroy <connectedAccountId>')
    .description('hard-delete a connected account (irrecoverable)')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.core.request(
        `mutation Destroy($id: UUID!) { destroyConnectedAccount(id: $id) { id } }`,
        { id },
      );
      emitOk(`destroyed connected account ${id}`, { destroyed: id }, ctx.out);
    });

  ca.command('restore <connectedAccountId>')
    .description('un-soft-delete a connected account from the recycle bin')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{ restoreConnectedAccount: ConnectedAccount }>(
        `mutation Restore($id: UUID!) {
           restoreConnectedAccount(id: $id) { ${CONNECTED_ACCOUNT_SUMMARY} }
         }`,
        { id },
      );
      emitOk(
        `restored connected account ${id}`,
        data.restoreConnectedAccount as unknown as Record<string, unknown>,
        ctx.out,
      );
    });
}

interface ConnectedAccount {
  id: string;
  handle: string | null;
  provider: string;
  accountOwnerId: string;
  handleAliases: string | null;
  authFailedAt: string | null;
  lastCredentialsRefreshedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ConnectedAccountDTO {
  id: string;
  handle: string | null;
  provider: string;
  name: string | null;
  visibility: string | null;
  userWorkspaceId: string | null;
  connectionProviderId: string | null;
  applicationId: string | null;
  handleAliases: string | null;
  authFailedAt: string | null;
  lastCredentialsRefreshedAt: string | null;
  lastSignedInAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Connection<T> {
  edges: { node: T }[];
}

function caColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'handle', 'provider', 'accountOwnerId', 'authFailedAt'];
}

function dtoColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'handle', 'provider', 'name', 'visibility', 'lastSignedInAt'];
}
