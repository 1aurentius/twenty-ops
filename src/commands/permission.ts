import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { ROLE_PERMISSIONS } from '../lib/gql.js';
import { resolveObjectId } from '../lib/objects.js';
import { resolveRoleId } from '../lib/roles.js';
import { emitOk, emitOne } from '../lib/output.js';

interface RoleWithPermissions {
  id: string;
  label: string;
  canUpdateAllSettings: boolean;
  canAccessAllTools: boolean;
  canReadAllObjectRecords: boolean;
  canUpdateAllObjectRecords: boolean;
  canSoftDeleteAllObjectRecords: boolean;
  canDestroyAllObjectRecords: boolean;
  permissionFlags: { id: string; flag: string }[];
  objectPermissions: {
    objectMetadataId: string;
    canReadObjectRecords: boolean | null;
    canUpdateObjectRecords: boolean | null;
    canSoftDeleteObjectRecords: boolean | null;
    canDestroyObjectRecords: boolean | null;
  }[];
  fieldPermissions: {
    id: string;
    objectMetadataId: string;
    fieldMetadataId: string;
    canReadFieldValue: boolean | null;
    canUpdateFieldValue: boolean | null;
  }[];
}

/**
 * `twenty-ops permission …` — RBAC fine-grained permissions.
 *
 * Verified shapes (live probe):
 *   upsertObjectPermissions(input: { roleId, objectPermissions: [{objectMetadataId,
 *     canReadObjectRecords?, canUpdateObjectRecords?, canSoftDeleteObjectRecords?,
 *     canDestroyObjectRecords?}] })
 *   upsertFieldPermissions(input: { roleId, fieldPermissions: [{objectMetadataId,
 *     fieldMetadataId, canReadFieldValue?, canUpdateFieldValue?}] })
 *   upsertPermissionFlags(input: { roleId, permissionFlagKeys: [PermissionFlagType] })
 *     — PermissionFlagType enum: API_KEYS_AND_WEBHOOKS, WORKSPACE, WORKSPACE_MEMBERS,
 *       ROLES, DATA_MODEL, SECURITY, WORKFLOWS, IMPERSONATE, SSO_BYPASS, APPLICATIONS,
 *       MARKETPLACE_APPS, LAYOUTS, BILLING, AI_SETTINGS, AI, VIEWS, UPLOAD_FILE,
 *       DOWNLOAD_FILE, SEND_EMAIL_TOOL, HTTP_REQUEST_TOOL, CODE_INTERPRETER_TOOL,
 *       IMPORT_CSV, EXPORT_CSV, CONNECTED_ACCOUNTS, PROFILE_INFORMATION
 *
 * ObjectPermission has NO id — composite key is (roleId, objectMetadataId).
 * FieldPermission has an id but is also uniquely keyed by
 * (roleId, objectMetadataId, fieldMetadataId).
 *
 * No `--force` gate on `set-*`: permission changes are reversible — calling
 * the upsert again with the previous value undoes the change. (Unlike
 * `role delete` or `member remove`.) Operators who lock themselves out can
 * still recover via a different actor with WORKSPACE/ROLES flags.
 */
export function registerPermissionCommands(program: Command): void {
  const permission = program.command('permission').description('manage RBAC permissions');

  permission
    .command('show')
    .description('show all permissions for a role (flags + per-object + per-field)')
    .requiredOption('--role <ref>', 'role id or label')
    .action(async (opts: { role: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const role = await fetchRoleWithPermissions(ctx, opts.role);
      emitOne(role as unknown as Record<string, unknown>, [], ctx.out);
    });

  permission
    .command('set-object')
    .description('grant/revoke per-object permissions for a role')
    .requiredOption('--role <ref>', 'role id or label')
    .requiredOption('--object <ref>', 'object id or nameSingular/namePlural')
    .option('--read <bool>', 'canReadObjectRecords (true/false)', parseBool)
    .option('--write <bool>', 'canUpdateObjectRecords (true/false)', parseBool)
    .option('--soft-delete <bool>', 'canSoftDeleteObjectRecords (true/false)', parseBool)
    .option('--destroy <bool>', 'canDestroyObjectRecords (true/false)', parseBool)
    .action(
      async (
        opts: { role: string; object: string; read?: boolean; write?: boolean; softDelete?: boolean; destroy?: boolean },
        cmd: Command,
      ) => {
        const ctx = makeCtx(cmd);
        const flags = { read: opts.read, write: opts.write, softDelete: opts.softDelete, destroy: opts.destroy };
        if (Object.values(flags).every((v) => v === undefined)) {
          throw new CliError(
            'pass at least one of --read/--write/--soft-delete/--destroy',
            EXIT.USAGE,
          );
        }
        const role = await fetchRoleWithPermissions(ctx, opts.role);
        const objectMetadataId = await resolveObjectId(ctx.metadata, opts.object);

        // upsertObjectPermissions REPLACES the role's full objectPermissions list
        // (verified live, not per-row upsert as the name suggests). Read-modify-write:
        // preserve every other row, modify-or-append the target row.
        const next = role.objectPermissions.map((p) => ({ ...p })) as Record<string, unknown>[];
        const idx = next.findIndex((p) => p.objectMetadataId === objectMetadataId);
        const targetRow: Record<string, unknown> =
          idx >= 0 ? next[idx]! : { objectMetadataId };
        if (opts.read !== undefined) targetRow.canReadObjectRecords = opts.read;
        if (opts.write !== undefined) targetRow.canUpdateObjectRecords = opts.write;
        if (opts.softDelete !== undefined) targetRow.canSoftDeleteObjectRecords = opts.softDelete;
        if (opts.destroy !== undefined) targetRow.canDestroyObjectRecords = opts.destroy;
        if (idx < 0) next.push(targetRow);

        await ctx.metadata.request(
          `mutation($input: UpsertObjectPermissionsInput!) {
             upsertObjectPermissions(upsertObjectPermissionsInput: $input) { objectMetadataId }
           }`,
          { input: { roleId: role.id, objectPermissions: next } },
        );
        emitOk(
          `set object permission for role ${role.id} on object ${objectMetadataId}`,
          { roleId: role.id, objectMetadataId, ...targetRow },
          ctx.out,
        );
      },
    );

  permission
    .command('set-field')
    .description('grant/revoke per-field permissions for a role')
    .requiredOption('--role <ref>', 'role id or label')
    .requiredOption('--object <ref>', 'object id or nameSingular/namePlural')
    .requiredOption('--field <id>', 'fieldMetadataId — use `field list --object X` to look up')
    .option('--read <bool>', 'canReadFieldValue (true/false)', parseBool)
    .option('--write <bool>', 'canUpdateFieldValue (true/false)', parseBool)
    .action(
      async (
        opts: { role: string; object: string; field: string; read?: boolean; write?: boolean },
        cmd: Command,
      ) => {
        const ctx = makeCtx(cmd);
        if (opts.read === undefined && opts.write === undefined) {
          throw new CliError('pass at least one of --read/--write', EXIT.USAGE);
        }
        const role = await fetchRoleWithPermissions(ctx, opts.role);
        const objectMetadataId = await resolveObjectId(ctx.metadata, opts.object);

        // Same replace-whole-list semantics as set-object (confirmed live). Carry
        // every other row forward, then modify-or-append the (objectMetadataId,
        // fieldMetadataId) target.
        const next = role.fieldPermissions.map((p) => ({
          objectMetadataId: p.objectMetadataId,
          fieldMetadataId: p.fieldMetadataId,
          canReadFieldValue: p.canReadFieldValue,
          canUpdateFieldValue: p.canUpdateFieldValue,
        })) as Record<string, unknown>[];
        const idx = next.findIndex(
          (p) => p.fieldMetadataId === opts.field && p.objectMetadataId === objectMetadataId,
        );
        const targetRow: Record<string, unknown> =
          idx >= 0 ? next[idx]! : { objectMetadataId, fieldMetadataId: opts.field };
        if (opts.read !== undefined) targetRow.canReadFieldValue = opts.read;
        if (opts.write !== undefined) targetRow.canUpdateFieldValue = opts.write;
        if (idx < 0) next.push(targetRow);

        await ctx.metadata.request(
          `mutation($input: UpsertFieldPermissionsInput!) {
             upsertFieldPermissions(upsertFieldPermissionsInput: $input) { id }
           }`,
          { input: { roleId: role.id, fieldPermissions: next } },
        );
        emitOk(
          `set field permission for role ${role.id} on field ${opts.field}`,
          { roleId: role.id, ...targetRow },
          ctx.out,
        );
      },
    );

  permission
    .command('set-flag')
    .description('enable or disable a permission flag on a role (e.g. WORKFLOWS, DATA_MODEL)')
    .requiredOption('--role <ref>', 'role id or label')
    .requiredOption('--flag <NAME>', 'PermissionFlagType enum value (e.g. WORKFLOWS)')
    .option('--enable', 'add the flag to the role', false)
    .option('--disable', 'remove the flag from the role', false)
    .action(
      async (opts: { role: string; flag: string; enable?: boolean; disable?: boolean }, cmd: Command) => {
        const ctx = makeCtx(cmd);
        if (!opts.enable && !opts.disable) {
          throw new CliError('pass either --enable or --disable', EXIT.USAGE);
        }
        if (opts.enable && opts.disable) {
          throw new CliError('--enable and --disable are mutually exclusive', EXIT.USAGE);
        }
        const role = await fetchRoleWithPermissions(ctx, opts.role);
        const current = new Set(role.permissionFlags.map((f) => f.flag));
        if (opts.enable) current.add(opts.flag);
        else current.delete(opts.flag);
        const next = [...current];

        await ctx.metadata.request(
          `mutation($input: UpsertPermissionFlagsInput!) {
             upsertPermissionFlags(upsertPermissionFlagsInput: $input) { id flag }
           }`,
          { input: { roleId: role.id, permissionFlagKeys: next } },
        );
        emitOk(
          `${opts.enable ? 'enabled' : 'disabled'} ${opts.flag} for role ${role.id}`,
          { roleId: role.id, flag: opts.flag, enabled: !!opts.enable, allFlags: next },
          ctx.out,
        );
      },
    );
}

async function fetchRoleWithPermissions(ctx: Ctx, ref: string): Promise<RoleWithPermissions> {
  const roleId = await resolveRoleId(ctx, ref);
  const data = await ctx.metadata.request<{ getRoles: RoleWithPermissions[] }>(
    `query { getRoles { ${ROLE_PERMISSIONS} } }`,
  );
  const match = data.getRoles.find((r) => r.id === roleId);
  if (!match) throw new CliError(`role "${ref}" not found`, EXIT.NOT_FOUND);
  return match;
}

function parseBool(v: string): boolean {
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new CliError(`expected true|false, got "${v}"`, EXIT.USAGE);
}
