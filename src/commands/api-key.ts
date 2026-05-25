import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { API_KEY_SUMMARY } from '../lib/gql.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

interface ApiKeyNode {
  id: string;
  name: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
  role: { id: string; label: string } | null;
}

interface Role {
  id: string;
  label: string;
  canBeAssignedToApiKeys: boolean;
}

/**
 * `twenty-ops api-key …` — manage long-lived API keys for the workspace.
 *
 * Verified mutation shapes (live probe):
 *   createApiKey(input: { name, expiresAt: String!, roleId: UUID! })
 *   updateApiKey(input: { id, name?, expiresAt?, revokedAt? })
 *   revokeApiKey(input: { id })
 *   generateApiKeyToken(apiKeyId: UUID!, expiresAt: String!) → { token }
 *   assignRoleToApiKey(apiKeyId, roleId)
 *
 * Note: `expiresAt` is typed String! at the resolver despite DateTime in the
 * API type — the seed script discovered this. We accept ISO-8601 strings.
 *
 * Note: `apiKeys` returns all keys (including revoked) without paging. The
 * surface is small enough that we list client-side and pick by id.
 */
export function registerApiKeyCommands(program: Command): void {
  const apiKey = program.command('api-key').description('manage workspace API keys');

  apiKey
    .command('list')
    .description('list API keys (active + revoked)')
    .option('--include-revoked', 'include revoked keys (default: only active)', false)
    .action(async (opts: { includeRevoked?: boolean }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ apiKeys: ApiKeyNode[] }>(
        `query { apiKeys { ${API_KEY_SUMMARY} } }`,
      );
      const rows = opts.includeRevoked ? data.apiKeys : data.apiKeys.filter((k) => !k.revokedAt);
      emitList(rows, apiKeyColumns(ctx), ctx.out);
    });

  apiKey
    .command('get <id>')
    .description('show one API key')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ apiKey: ApiKeyNode | null }>(
        `query Get($input: GetApiKeyInput!) { apiKey(input: $input) { ${API_KEY_SUMMARY} } }`,
        { input: { id } },
      );
      if (!data.apiKey) throw new CliError(`api key "${id}" not found`, EXIT.NOT_FOUND);
      emitOne(data.apiKey as unknown as Record<string, unknown>, apiKeyColumns(ctx), ctx.out);
    });

  apiKey
    .command('create')
    .description('create an API key (also prints the bearer token — store it now, it cannot be re-fetched)')
    .requiredOption('--name <name>', 'human-readable label')
    .option('--expires-at <iso>', 'ISO-8601 expiry timestamp (default: 50 years from now)')
    .option('--role <ref>', 'role id or label (default: an admin role assignable to API keys)')
    .action(
      async (opts: { name: string; expiresAt?: string; role?: string }, cmd: Command) => {
        const ctx = makeCtx(cmd);
        const expiresAt = opts.expiresAt ?? defaultExpiresAt();
        const roleId = await resolveRoleId(ctx, opts.role);
        const ak = await ctx.metadata.request<{ createApiKey: ApiKeyNode }>(
          `mutation Create($input: CreateApiKeyInput!) {
             createApiKey(input: $input) { ${API_KEY_SUMMARY} }
           }`,
          { input: { name: opts.name, expiresAt, roleId } },
        );
        const tok = await ctx.metadata.request<{ generateApiKeyToken: { token: string } }>(
          `mutation Token($id: UUID!, $e: String!) {
             generateApiKeyToken(apiKeyId: $id, expiresAt: $e) { token }
           }`,
          { id: ak.createApiKey.id, e: expiresAt },
        );
        // Bundle the token + the key metadata. Token is unrecoverable — surface
        // it immediately under both text and --json modes.
        const payload = { token: tok.generateApiKeyToken.token, apiKey: ak.createApiKey };
        if (ctx.out.json) {
          process.stdout.write(`${JSON.stringify(payload)}\n`);
        } else {
          process.stdout.write(`token=${payload.token}\n`);
          process.stdout.write(`id=${ak.createApiKey.id}\n`);
          process.stdout.write(`name=${ak.createApiKey.name}\n`);
          process.stdout.write(`expiresAt=${ak.createApiKey.expiresAt}\n`);
        }
      },
    );

  apiKey
    .command('revoke <id>')
    .description('revoke an API key — the bearer token immediately stops working')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.metadata.request(
        `mutation Revoke($input: RevokeApiKeyInput!) { revokeApiKey(input: $input) { id } }`,
        { input: { id } },
      );
      emitOk(`revoked api-key ${id}`, { revoked: id }, ctx.out);
    });

  apiKey
    .command('rotate <id>')
    .description('generate a fresh bearer token for an existing key (existing token continues to work until expiry)')
    .option('--expires-at <iso>', 'expiry for the new token (default: existing key expiresAt)')
    .action(async (id: string, opts: { expiresAt?: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      // Fetch the existing key for its expiresAt (and to fail early on NOT_FOUND).
      const data = await ctx.metadata.request<{ apiKey: ApiKeyNode | null }>(
        `query Get($input: GetApiKeyInput!) { apiKey(input: $input) { ${API_KEY_SUMMARY} } }`,
        { input: { id } },
      );
      if (!data.apiKey) throw new CliError(`api key "${id}" not found`, EXIT.NOT_FOUND);
      const expiresAt = opts.expiresAt ?? data.apiKey.expiresAt;
      const tok = await ctx.metadata.request<{ generateApiKeyToken: { token: string } }>(
        `mutation Token($id: UUID!, $e: String!) {
           generateApiKeyToken(apiKeyId: $id, expiresAt: $e) { token }
         }`,
        { id, e: expiresAt },
      );
      const payload = { token: tok.generateApiKeyToken.token, apiKey: data.apiKey };
      if (ctx.out.json) {
        process.stdout.write(`${JSON.stringify(payload)}\n`);
      } else {
        process.stdout.write(`token=${payload.token}\n`);
        process.stdout.write(`id=${id}\n`);
      }
    });
}

function apiKeyColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'name', 'expiresAt', 'revokedAt', 'createdAt'];
}

/** ISO-8601 timestamp 50 years from now, matching the seed-script default. */
function defaultExpiresAt(): string {
  const FIFTY_YEARS_MS = 50 * 365 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + FIFTY_YEARS_MS).toISOString();
}

/**
 * Resolves `--role` (label or id) to a role id. With no flag, picks any role
 * that can be assigned to API keys (matches the seed script's admin pick).
 */
async function resolveRoleId(ctx: Ctx, ref: string | undefined): Promise<string> {
  const data = await ctx.metadata.request<{ getRoles: Role[] }>(
    `query { getRoles { id label canBeAssignedToApiKeys } }`,
  );
  if (!ref) {
    const assignable = data.getRoles.find((r) => r.canBeAssignedToApiKeys);
    if (!assignable) {
      throw new CliError(
        `no role available for API keys — set --role explicitly`,
        EXIT.API,
      );
    }
    return assignable.id;
  }
  const match = data.getRoles.find((r) => r.id === ref || r.label === ref);
  if (!match) {
    throw new CliError(
      `role "${ref}" not found — available: ${data.getRoles.map((r) => r.label).join(', ')}`,
      EXIT.NOT_FOUND,
    );
  }
  return match.id;
}
