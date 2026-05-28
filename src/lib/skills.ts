import { CliError, EXIT } from '../api/errors.js';
import type { GraphQLClient } from '../api/graphql-client.js';
import type { Ctx } from './context.js';
import { SKILL_SUMMARY, isUuid } from './gql.js';

export interface Skill {
  id: string;
  name: string;
  label: string;
  icon: string | null;
  description: string | null;
  content: string;
  isCustom: boolean;
  isActive: boolean;
  applicationId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** List every skill in the workspace (queries `skills` — no args, full set). */
export async function listSkills(metadata: GraphQLClient): Promise<Skill[]> {
  const data = await metadata.request<{ skills: Skill[] }>(
    `query { skills { ${SKILL_SUMMARY} content } }`,
  );
  return data.skills;
}

/** Resolve a `<ref>` (UUID or unique name) to a skill id. */
export async function resolveSkillId(ctx: Ctx, ref: string): Promise<string> {
  if (isUuid(ref)) {
    const data = await ctx.metadata.request<{ skill: Skill | null }>(
      `query Get($id: UUID!) { skill(id: $id) { id } }`,
      { id: ref },
    );
    if (data.skill) return data.skill.id;
    throw new CliError(`skill "${ref}" not found`, EXIT.NOT_FOUND);
  }
  const all = await listSkills(ctx.metadata);
  const matches = all.filter((s) => s.name === ref);
  if (matches.length === 0) {
    const names = all.map((s) => s.name).join(', ') || '(none)';
    throw new CliError(`skill "${ref}" not found — available: ${names}`, EXIT.NOT_FOUND);
  }
  if (matches.length > 1) {
    throw new CliError(`skill name "${ref}" is ambiguous — pass the id`, EXIT.USAGE);
  }
  return matches[0]!.id;
}
