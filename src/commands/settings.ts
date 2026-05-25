import type { Command } from 'commander';
import { makeCtx, type Ctx } from '../lib/context.js';
import { emitOne } from '../lib/output.js';

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
