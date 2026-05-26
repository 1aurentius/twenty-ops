import { CliError, EXIT } from '../api/errors.js';
import type { GraphQLClient } from '../api/graphql-client.js';
import type { Ctx } from './context.js';
import { ROLE_SUMMARY, isUuid } from './gql.js';

export interface Role {
  id: string;
  label: string;
  description: string | null;
  icon: string | null;
  canBeAssignedToUsers: boolean;
  canBeAssignedToApiKeys: boolean;
  isEditable: boolean;
}

/** Lists every role in the workspace (uses `getRoles` — no args, returns the full set). */
export async function listRoles(metadata: GraphQLClient): Promise<Role[]> {
  const data = await metadata.request<{ getRoles: Role[] }>(
    `query { getRoles { ${ROLE_SUMMARY} } }`,
  );
  return data.getRoles;
}

/**
 * Resolves a `--role` flag (id or label) to a role id.
 *
 * Without a ref, picks the first role that `canBeAssignedToApiKeys` — matches
 * the seed-script's admin pick. Callers that need a different fallback (e.g.
 * `canBeAssignedToUsers` for invitations) should resolve explicitly via
 * `listRoles` and pick themselves rather than pass `undefined`.
 */
export async function resolveRoleId(ctx: Ctx, ref: string | undefined): Promise<string> {
  const roles = await listRoles(ctx.metadata);
  if (!ref) {
    const assignable = roles.find((r) => r.canBeAssignedToApiKeys);
    if (!assignable) {
      throw new CliError(
        `no role available for API keys — set --role explicitly`,
        EXIT.API,
      );
    }
    return assignable.id;
  }
  if (isUuid(ref)) {
    const byId = roles.find((r) => r.id === ref);
    if (byId) return byId.id;
  }
  const match = roles.find((r) => r.id === ref || r.label === ref);
  if (!match) {
    throw new CliError(
      `role "${ref}" not found — available: ${roles.map((r) => r.label).join(', ')}`,
      EXIT.NOT_FOUND,
    );
  }
  return match.id;
}
