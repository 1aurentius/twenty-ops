import { CliError, EXIT } from '../api/errors.js';
import type { GraphQLClient } from '../api/graphql-client.js';
import type { Ctx } from './context.js';
import { AGENT_SUMMARY, isUuid } from './gql.js';

export interface Agent {
  id: string;
  name: string;
  label: string;
  icon: string | null;
  description: string | null;
  prompt: string;
  modelId: string;
  roleId: string | null;
  isCustom: boolean;
  applicationId: string | null;
  evaluationInputs: string[];
  createdAt: string;
  updatedAt: string;
}

export async function listAgents(metadata: GraphQLClient): Promise<Agent[]> {
  const data = await metadata.request<{ findManyAgents: Agent[] }>(
    `query { findManyAgents { ${AGENT_SUMMARY} } }`,
  );
  return data.findManyAgents;
}

/** Resolve a `<ref>` (UUID or unique agent name) to an agent id. */
export async function resolveAgentId(ctx: Ctx, ref: string): Promise<string> {
  if (isUuid(ref)) {
    const data = await ctx.metadata.request<{ findOneAgent: Agent | null }>(
      `query Get($input: AgentIdInput!) { findOneAgent(input: $input) { id } }`,
      { input: { id: ref } },
    );
    if (data.findOneAgent) return data.findOneAgent.id;
    throw new CliError(`agent "${ref}" not found`, EXIT.NOT_FOUND);
  }
  const all = await listAgents(ctx.metadata);
  const matches = all.filter((a) => a.name === ref);
  if (matches.length === 0) {
    const names = all.map((a) => a.name).join(', ') || '(none)';
    throw new CliError(`agent "${ref}" not found — available: ${names}`, EXIT.NOT_FOUND);
  }
  if (matches.length > 1) {
    throw new CliError(`agent name "${ref}" is ambiguous — pass the id`, EXIT.USAGE);
  }
  return matches[0]!.id;
}
