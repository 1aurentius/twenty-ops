import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { loadInputFile } from '../lib/input-file.js';
import { emitOk, emitOne } from '../lib/output.js';

interface CurrentWorkspace {
  id: string;
  displayName: string | null;
  activationStatus: string;
  subdomain: string;
  customDomain: string | null;
  workspaceMembersCount: number | null;
  metadataVersion: number;
  trashRetentionDays: number;
  eventLogRetentionDays: number;
  allowImpersonation: boolean;
  isPublicInviteLinkEnabled: boolean;
  isGoogleAuthEnabled: boolean;
  isPasswordAuthEnabled: boolean;
  isTwoFactorAuthenticationEnforced: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Conservative selection set — every field above is either part of every
 * Twenty fork or has been stable across the v2.x line. The giant `views` /
 * `viewFields` / etc. nested lists are deliberately excluded; they belong
 * under `view list`, not here.
 */
const CURRENT_WORKSPACE_FIELDS = `
  id displayName activationStatus subdomain customDomain workspaceMembersCount
  metadataVersion trashRetentionDays eventLogRetentionDays
  allowImpersonation isPublicInviteLinkEnabled
  isGoogleAuthEnabled isPasswordAuthEnabled isTwoFactorAuthenticationEnforced
  createdAt updatedAt
`;

/**
 * `twenty-ops settings get` — dump the current workspace's settings.
 *
 * v0.4 is read-only. `updateWorkspace` exists in the metadata schema; expose
 * it in v0.5 alongside members/roles work where workspace-wide toggles
 * (allowImpersonation, isPublicInviteLinkEnabled, etc.) actually become
 * useful.
 */
export function registerSettingsCommands(program: Command): void {
  const settings = program.command('settings').description('inspect workspace settings');

  settings
    .command('get')
    .description('dump current workspace configuration')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ currentWorkspace: CurrentWorkspace }>(
        `query { currentWorkspace { ${CURRENT_WORKSPACE_FIELDS} } }`,
      );
      emitOne(
        data.currentWorkspace as unknown as Record<string, unknown>,
        settingsColumns(ctx),
        ctx.out,
      );
    });

  settings
    .command('update')
    .description('update workspace settings (use --file for bulk, or named flags for one-off toggles)')
    .option('--file <path>', 'JSON/YAML object matching UpdateWorkspaceInput; merged with named flags')
    .option('--display-name <text>')
    .option('--subdomain <text>')
    .option('--allow-impersonation <bool>', 'true|false', parseBool)
    .option('--is-public-invite-link-enabled <bool>', 'true|false', parseBool)
    .option('--is-google-auth-enabled <bool>', 'true|false', parseBool)
    .option('--is-microsoft-auth-enabled <bool>', 'true|false', parseBool)
    .option('--is-password-auth-enabled <bool>', 'true|false', parseBool)
    .option('--is-two-factor-authentication-enforced <bool>', 'true|false', parseBool)
    .option('--trash-retention-days <n>', 'days to retain soft-deleted records', (v) => Number(v))
    .option('--event-log-retention-days <n>', 'days to retain event log entries', (v) => Number(v))
    .action(async (opts: Record<string, unknown>, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data: Record<string, unknown> = {};
      // File contents come first; named flags override.
      if (typeof opts.file === 'string') {
        const fromFile = loadInputFile<Record<string, unknown>>(opts.file);
        if (Array.isArray(fromFile) || typeof fromFile !== 'object' || fromFile === null) {
          throw new CliError(`${opts.file} must be a JSON/YAML object`, EXIT.USAGE);
        }
        Object.assign(data, fromFile);
      }
      const flagMap: Record<string, string> = {
        displayName: 'displayName',
        subdomain: 'subdomain',
        allowImpersonation: 'allowImpersonation',
        isPublicInviteLinkEnabled: 'isPublicInviteLinkEnabled',
        isGoogleAuthEnabled: 'isGoogleAuthEnabled',
        isMicrosoftAuthEnabled: 'isMicrosoftAuthEnabled',
        isPasswordAuthEnabled: 'isPasswordAuthEnabled',
        isTwoFactorAuthenticationEnforced: 'isTwoFactorAuthenticationEnforced',
        trashRetentionDays: 'trashRetentionDays',
        eventLogRetentionDays: 'eventLogRetentionDays',
      };
      for (const [optKey, fieldName] of Object.entries(flagMap)) {
        if (opts[optKey] !== undefined) data[fieldName] = opts[optKey];
      }
      if (Object.keys(data).length === 0) {
        throw new CliError(
          'nothing to update — pass --file or at least one named flag',
          EXIT.USAGE,
        );
      }
      const updated = await ctx.metadata.request<{ updateWorkspace: CurrentWorkspace }>(
        `mutation($data: UpdateWorkspaceInput!) {
           updateWorkspace(data: $data) { ${CURRENT_WORKSPACE_FIELDS} }
         }`,
        { data },
      );
      emitOk(
        `updated workspace ${updated.updateWorkspace.id}`,
        updated.updateWorkspace as unknown as Record<string, unknown>,
        ctx.out,
      );
    });
}

function parseBool(v: string): boolean {
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new CliError(`expected true|false, got "${v}"`, EXIT.USAGE);
}

function settingsColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return [
    'id', 'displayName', 'activationStatus', 'subdomain', 'workspaceMembersCount',
    'metadataVersion', 'trashRetentionDays', 'eventLogRetentionDays',
    'allowImpersonation', 'isPublicInviteLinkEnabled',
    'isGoogleAuthEnabled', 'isPasswordAuthEnabled', 'isTwoFactorAuthenticationEnforced',
  ];
}
