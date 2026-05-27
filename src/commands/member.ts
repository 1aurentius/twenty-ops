import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { MEMBER_SUMMARY, isUuid } from '../lib/gql.js';
import { loadInputFile } from '../lib/input-file.js';
import { resolveRoleId } from '../lib/roles.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

interface MemberNode {
  id: string;
  userEmail: string;
  name: { firstName: string; lastName: string };
  locale: string | null;
  colorScheme: string;
  timeZone: string | null;
  dateFormat: string | null;
  timeFormat: string | null;
  calendarStartDay: number | null;
  numberFormat: string | null;
  roles: { id: string; label: string }[];
}

/**
 * `twenty-ops member …` — manage workspace members.
 *
 * Endpoint split worth knowing about: reads (`workspaceMembers`, `workspaceMember`)
 * live on the **Core** GraphQL endpoint (`/graphql`); writes
 * (`updateWorkspaceMemberRole`, `updateWorkspaceMemberSettings`,
 * `deleteUserFromWorkspace`) live on **Metadata** (`/metadata`). Both contexts
 * are wired in `makeCtx`.
 *
 * `name` is a nested `FullName { firstName, lastName }` object — keep the GraphQL
 * selection set explicit so the response shape is stable.
 *
 * `member remove` is irreversible; requires `--force`.
 */
export function registerMemberCommands(program: Command): void {
  const member = program.command('member').description('manage workspace members');

  member
    .command('list')
    .description('list workspace members')
    .option('--limit <n>', 'max rows to fetch (default 100)', (v) => Number(v), 100)
    .action(async (opts: { limit: number }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{
        workspaceMembers: { edges: { node: MemberNode }[] };
      }>(
        `query Members($first: Int!) {
           workspaceMembers(first: $first) { edges { node { ${MEMBER_SUMMARY} } } }
         }`,
        { first: opts.limit },
      );
      const rows = data.workspaceMembers.edges.map((e) => e.node);
      emitList(rows, memberColumns(ctx), ctx.out);
    });

  member
    .command('get <ref>')
    .description('show one member — accepts UUID or email')
    .action(async (ref: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const row = await fetchMember(ctx, ref);
      emitOne(row as unknown as Record<string, unknown>, memberColumns(ctx), ctx.out);
    });

  member
    .command('set-role')
    .description('assign a role to a workspace member')
    .requiredOption('--member <ref>', 'member id or email')
    .requiredOption('--role <ref>', 'role id or label')
    .action(async (opts: { member: string; role: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const [memberId, roleId] = await Promise.all([
        resolveMemberId(ctx, opts.member),
        resolveRoleId(ctx, opts.role),
      ]);
      await ctx.metadata.request(
        `mutation($workspaceMemberId: UUID!, $roleId: UUID!) {
           updateWorkspaceMemberRole(workspaceMemberId: $workspaceMemberId, roleId: $roleId) { id }
         }`,
        { workspaceMemberId: memberId, roleId },
      );
      emitOk(
        `assigned role ${roleId} to member ${memberId}`,
        { memberId, roleId },
        ctx.out,
      );
    });

  member
    .command('set-settings <ref>')
    .description('update a member\'s preferences (locale, colorScheme, timeZone, dateFormat, …) via JSON/YAML file')
    .requiredOption('--file <path>', 'JSON/YAML object of fields to patch (opaque JSON, passed through)')
    .action(async (ref: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const update = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(update) || typeof update !== 'object' || update === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const memberId = await resolveMemberId(ctx, ref);
      await ctx.metadata.request(
        `mutation($input: UpdateWorkspaceMemberSettingsInput!) {
           updateWorkspaceMemberSettings(input: $input)
         }`,
        { input: { workspaceMemberId: memberId, update } },
      );
      emitOk(`updated settings for member ${memberId}`, { memberId, update }, ctx.out);
    });

  member
    .command('remove <ref>')
    .description('remove a user from the workspace — irreversible. Requires --force.')
    .option('--force', 'confirm this irreversible operation', false)
    .action(async (ref: string, opts: { force?: boolean }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      if (!opts.force) {
        process.stderr.write(
          `refusing to remove member "${ref}" without --force ` +
            `(irreversible; the user loses workspace access)\n`,
        );
        throw new CliError('pass --force to confirm', EXIT.USAGE);
      }
      const memberId = await resolveMemberId(ctx, ref);
      await ctx.metadata.request(
        `mutation($id: String!) { deleteUserFromWorkspace(workspaceMemberIdToDelete: $id) { id } }`,
        { id: memberId },
      );
      emitOk(`removed member ${memberId}`, { removed: memberId }, ctx.out);
    });
}

/** Resolves `--member` (UUID or email) to a workspace member id. */
async function resolveMemberId(ctx: Ctx, ref: string): Promise<string> {
  if (isUuid(ref)) return ref;
  const member = await fetchMemberByEmail(ctx, ref);
  return member.id;
}

async function fetchMember(ctx: Ctx, ref: string): Promise<MemberNode> {
  if (isUuid(ref)) {
    const data = await ctx.core.request<{ workspaceMember: MemberNode | null }>(
      `query($filter: WorkspaceMemberFilterInput!) {
         workspaceMember(filter: $filter) { ${MEMBER_SUMMARY} }
       }`,
      { filter: { id: { eq: ref } } },
    );
    if (!data.workspaceMember) throw new CliError(`member "${ref}" not found`, EXIT.NOT_FOUND);
    return data.workspaceMember;
  }
  return fetchMemberByEmail(ctx, ref);
}

async function fetchMemberByEmail(ctx: Ctx, email: string): Promise<MemberNode> {
  const data = await ctx.core.request<{ workspaceMember: MemberNode | null }>(
    `query($filter: WorkspaceMemberFilterInput!) {
       workspaceMember(filter: $filter) { ${MEMBER_SUMMARY} }
     }`,
    { filter: { userEmail: { eq: email } } },
  );
  if (!data.workspaceMember) {
    throw new CliError(`member "${email}" not found`, EXIT.NOT_FOUND);
  }
  return data.workspaceMember;
}

function memberColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'userEmail', 'name', 'locale', 'colorScheme', 'roles'];
}
