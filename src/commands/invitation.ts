import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { INVITATION_SUMMARY } from '../lib/gql.js';
import { resolveRoleId } from '../lib/roles.js';
import { emitList, emitOk } from '../lib/output.js';

interface InvitationNode {
  id: string;
  email: string;
  roleId: string | null;
  expiresAt: string;
}

/**
 * `twenty-ops invitation …` — manage pending workspace invitations.
 *
 * Verified shapes (live probe):
 *   findWorkspaceInvitations → [WorkspaceInvitation!]! (no args)
 *   sendInvitations(emails: [String!]!, roleId: UUID): SendInvitations
 *     { success, errors, result: [WorkspaceInvitation!]! }
 *   resendWorkspaceInvitation(appTokenId: String!)
 *   deleteWorkspaceInvitation(appTokenId: String!)
 *
 * The `id` field of a WorkspaceInvitation doubles as the `appTokenId` arg for
 * resend/revoke (invitations are App Tokens internally). All on metadata.
 */
export function registerInvitationCommands(program: Command): void {
  const invitation = program.command('invitation').description('manage pending workspace invitations');

  invitation
    .command('list')
    .description('list pending invitations')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ findWorkspaceInvitations: InvitationNode[] }>(
        `query { findWorkspaceInvitations { ${INVITATION_SUMMARY} } }`,
      );
      emitList(data.findWorkspaceInvitations, invitationColumns(ctx), ctx.out);
    });

  invitation
    .command('send')
    .description('send invitation emails (one per address)')
    .requiredOption('--emails <list>', 'comma-separated email addresses')
    .option('--role <ref>', 'role id or label assigned to the new members (default: server default)')
    .action(async (opts: { emails: string; role?: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const emails = parseList(opts.emails);
      if (emails.length === 0) {
        throw new CliError('--emails must contain at least one address', EXIT.USAGE);
      }
      const roleId = opts.role ? await resolveRoleId(ctx, opts.role) : undefined;
      const data = await ctx.metadata.request<{
        sendInvitations: {
          success: boolean;
          errors: string[];
          result: InvitationNode[];
        };
      }>(
        `mutation($emails: [String!]!, $roleId: UUID) {
           sendInvitations(emails: $emails, roleId: $roleId) {
             success errors result { ${INVITATION_SUMMARY} }
           }
         }`,
        { emails, roleId },
      );
      if (!data.sendInvitations.success) {
        throw new CliError(
          `sendInvitations failed: ${data.sendInvitations.errors.join('; ')}`,
          EXIT.API,
        );
      }
      const result = data.sendInvitations.result;
      emitOk(
        `sent ${result.length} invitation${result.length === 1 ? '' : 's'}`,
        { result, errors: data.sendInvitations.errors },
        ctx.out,
      );
    });

  invitation
    .command('resend <id>')
    .description('resend an existing invitation (id = WorkspaceInvitation.id, aka appTokenId)')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.metadata.request(
        `mutation($id: String!) { resendWorkspaceInvitation(appTokenId: $id) }`,
        { id },
      );
      emitOk(`resent invitation ${id}`, { resent: id }, ctx.out);
    });

  invitation
    .command('revoke <id>')
    .description('revoke a pending invitation (id = WorkspaceInvitation.id)')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.metadata.request(
        `mutation($id: String!) { deleteWorkspaceInvitation(appTokenId: $id) }`,
        { id },
      );
      emitOk(`revoked invitation ${id}`, { revoked: id }, ctx.out);
    });
}

function invitationColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'email', 'roleId', 'expiresAt'];
}

function parseList(s: string): string[] {
  return s.split(',').map((v) => v.trim()).filter(Boolean);
}
