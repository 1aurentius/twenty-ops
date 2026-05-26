import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { ROLE_SUMMARY } from '../lib/gql.js';
import { loadInputFile } from '../lib/input-file.js';
import { listRoles, resolveRoleId, type Role } from '../lib/roles.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

/**
 * `twenty-ops role …` — manage RBAC roles for the workspace.
 *
 * Twenty's metadata API uses non-standard arg names for these mutations
 * (not the usual `input` wrapper):
 *
 *   createOneRole(createRoleInput: CreateRoleInput!)
 *   updateOneRole(updateRoleInput: UpdateRoleInput!)
 *   deleteOneRole(roleId: UUID!)
 *
 * No `role` or `roles` query exists — `getRoles` returns the full list and we
 * filter client-side (same pattern as `api-key get`).
 *
 * `delete` is irreversible (orphans permission assignments; members on the role
 * get bumped to their workspace default). Requires `--force`.
 */
export function registerRoleCommands(program: Command): void {
  const role = program.command('role').description('manage RBAC roles');

  role
    .command('list')
    .description('list every role in the workspace')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const rows = await listRoles(ctx.metadata);
      emitList(rows, roleColumns(ctx), ctx.out);
    });

  role
    .command('get <ref>')
    .description('show one role — accepts UUID or label')
    .action(async (ref: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const id = await resolveRoleId(ctx, ref);
      const roles = await listRoles(ctx.metadata);
      const match = roles.find((r) => r.id === id);
      if (!match) throw new CliError(`role "${ref}" not found`, EXIT.NOT_FOUND);
      emitOne(match as unknown as Record<string, unknown>, roleColumns(ctx), ctx.out);
    });

  role
    .command('create')
    .description('create a custom role from a JSON/YAML file (- for stdin)')
    .requiredOption(
      '--file <path>',
      'role { label, description?, icon?, canBeAssignedToUsers?, canBeAssignedToApiKeys? }',
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
      const data = await ctx.metadata.request<{ createOneRole: Role }>(
        `mutation Create($input: CreateRoleInput!) {
           createOneRole(createRoleInput: $input) { ${ROLE_SUMMARY} }
         }`,
        { input },
      );
      emitOk(
        `created role ${data.createOneRole.id} (${data.createOneRole.label})`,
        data.createOneRole as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  role
    .command('update <ref>')
    .description('update a role from a JSON/YAML file (- for stdin)')
    .requiredOption(
      '--file <path>',
      'partial: { label?, description?, icon?, canBeAssignedToUsers?, canBeAssignedToApiKeys? }',
    )
    .action(async (ref: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const update = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(update) || typeof update !== 'object' || update === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const id = await resolveRoleId(ctx, ref);
      const data = await ctx.metadata.request<{ updateOneRole: Role }>(
        `mutation Update($input: UpdateRoleInput!) {
           updateOneRole(updateRoleInput: $input) { ${ROLE_SUMMARY} }
         }`,
        { input: { id, update } },
      );
      emitOk(
        `updated role ${id}`,
        data.updateOneRole as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  role
    .command('delete <ref>')
    .description('delete a role — irreversible; orphans permission assignments. Requires --force.')
    .option('--force', 'confirm this irreversible operation', false)
    .action(async (ref: string, opts: { force?: boolean }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      if (!opts.force) {
        process.stderr.write(
          `refusing to delete role "${ref}" without --force ` +
            `(irreversible; orphans permissions, bumps assigned members)\n`,
        );
        throw new CliError('pass --force to confirm', EXIT.USAGE);
      }
      const id = await resolveRoleId(ctx, ref);
      // deleteOneRole returns String! (the deleted role's id), so no selection set.
      await ctx.metadata.request(
        `mutation Delete($id: UUID!) { deleteOneRole(roleId: $id) }`,
        { id },
      );
      emitOk(`deleted role ${id}`, { deleted: id }, ctx.out);
    });
}

function roleColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'label', 'description', 'canBeAssignedToUsers', 'canBeAssignedToApiKeys', 'isEditable'];
}
