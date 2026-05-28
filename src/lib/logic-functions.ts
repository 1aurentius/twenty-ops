import { CliError, EXIT } from '../api/errors.js';
import type { GraphQLClient } from '../api/graphql-client.js';
import type { Ctx } from './context.js';
import { LOGIC_FUNCTION_SUMMARY, isUuid } from './gql.js';

export interface LogicFunction {
  id: string;
  name: string;
  description: string | null;
  runtime: string;
  timeoutSeconds: number;
  sourceHandlerPath: string;
  handlerName: string;
  applicationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listLogicFunctions(metadata: GraphQLClient): Promise<LogicFunction[]> {
  const data = await metadata.request<{ findManyLogicFunctions: LogicFunction[] }>(
    `query { findManyLogicFunctions { ${LOGIC_FUNCTION_SUMMARY} } }`,
  );
  return data.findManyLogicFunctions;
}

/** Resolve a `--ref` arg (UUID or unique name) to a logic function id. */
export async function resolveLogicFunctionId(ctx: Ctx, ref: string): Promise<string> {
  if (isUuid(ref)) {
    // Probe by id to confirm — `findOneLogicFunction` returns null for unknown ids.
    const data = await ctx.metadata.request<{ findOneLogicFunction: LogicFunction | null }>(
      `query Get($input: LogicFunctionIdInput!) {
         findOneLogicFunction(input: $input) { ${LOGIC_FUNCTION_SUMMARY} }
       }`,
      { input: { id: ref } },
    );
    if (data.findOneLogicFunction) return data.findOneLogicFunction.id;
    throw new CliError(`logic function "${ref}" not found`, EXIT.NOT_FOUND);
  }
  const all = await listLogicFunctions(ctx.metadata);
  const matches = all.filter((f) => f.name === ref);
  if (matches.length === 0) {
    const names = all.map((f) => f.name).join(', ') || '(none)';
    throw new CliError(
      `logic function "${ref}" not found — available: ${names}`,
      EXIT.NOT_FOUND,
    );
  }
  if (matches.length > 1) {
    throw new CliError(
      `logic function name "${ref}" is ambiguous — pass the id`,
      EXIT.USAGE,
    );
  }
  return matches[0]!.id;
}
