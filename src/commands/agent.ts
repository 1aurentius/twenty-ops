import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { listAgents, resolveAgentId, type Agent } from '../lib/agents.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { AGENT_SUMMARY, AGENT_TURN_SUMMARY } from '../lib/gql.js';
import { loadInputFile } from '../lib/input-file.js';
import { resolveRoleId } from '../lib/roles.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

/**
 * `twenty-ops agent …` — manage AI agent records (workspace-scoped assistants).
 *
 * Verified mutation shapes (live probe):
 *   createOneAgent(input: CreateAgentInput!) → Agent!
 *     { name?, label!, icon?, description?, prompt!, modelId!, roleId?,
 *       responseFormat(JSON?), modelConfiguration(JSON?), evaluationInputs? }
 *   updateOneAgent(input: UpdateAgentInput!) → Agent!  flat {id, ...}
 *   deleteOneAgent(input: AgentIdInput!) → Agent!      {id}
 *   assignRoleToAgent(agentId: UUID!, roleId: UUID!)   → Boolean!
 *   removeRoleFromAgent(agentId: UUID!)                → Boolean!
 *   evaluateAgentTurn(turnId: UUID!)                   → AgentTurnEvaluation!
 *   stopAgentChatStream(threadId: UUID!)               → Boolean!
 *
 *   findOneAgent(input: AgentIdInput!) / findManyAgents() / agentTurns(agentId)
 */
export function registerAgentCommands(program: Command): void {
  const ag = program.command('agent').description('manage AI agents (workspace assistants)');

  ag.command('list')
    .description('list every agent in the workspace')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const rows = await listAgents(ctx.metadata);
      emitList(rows, agentColumns(ctx), ctx.out);
    });

  ag.command('get <ref>')
    .description('show one agent — accepts UUID or unique name')
    .action(async (ref: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const id = await resolveAgentId(ctx, ref);
      const data = await ctx.metadata.request<{ findOneAgent: Agent | null }>(
        `query Get($input: AgentIdInput!) {
           findOneAgent(input: $input) { ${AGENT_SUMMARY} }
         }`,
        { input: { id } },
      );
      if (!data.findOneAgent) throw new CliError(`agent "${ref}" not found`, EXIT.NOT_FOUND);
      emitOne(
        data.findOneAgent as unknown as Record<string, unknown>,
        agentColumns(ctx),
        ctx.out,
      );
    });

  ag.command('create')
    .description('create an agent from JSON/YAML (- for stdin)')
    .requiredOption(
      '--file <path>',
      'CreateAgentInput { label, prompt, modelId, name?, description?, roleId?, ... }',
    )
    .action(async (opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const input = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(input) || typeof input !== 'object' || input === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      for (const required of ['label', 'prompt', 'modelId']) {
        if (typeof input[required] !== 'string') {
          throw new CliError(`${opts.file} is missing required field "${required}"`, EXIT.USAGE);
        }
      }
      const data = await ctx.metadata.request<{ createOneAgent: Agent }>(
        `mutation Create($input: CreateAgentInput!) {
           createOneAgent(input: $input) { ${AGENT_SUMMARY} }
         }`,
        { input },
      );
      emitOk(
        `created agent ${data.createOneAgent.id} (${data.createOneAgent.label})`,
        data.createOneAgent as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  ag.command('update <ref>')
    .description('update an agent from JSON/YAML')
    .requiredOption('--file <path>', 'partial UpdateAgentInput (id merged in)')
    .action(async (ref: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const update = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(update) || typeof update !== 'object' || update === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const id = await resolveAgentId(ctx, ref);
      const data = await ctx.metadata.request<{ updateOneAgent: Agent }>(
        `mutation Update($input: UpdateAgentInput!) {
           updateOneAgent(input: $input) { ${AGENT_SUMMARY} }
         }`,
        { input: { id, ...update } },
      );
      emitOk(`updated agent ${id}`, data.updateOneAgent as unknown as Record<string, unknown>, ctx.out);
    });

  ag.command('delete <ref>')
    .description('delete an agent — accepts UUID or unique name')
    .action(async (ref: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const id = await resolveAgentId(ctx, ref);
      await ctx.metadata.request(
        `mutation Delete($input: AgentIdInput!) { deleteOneAgent(input: $input) { id } }`,
        { input: { id } },
      );
      emitOk(`deleted agent ${id}`, { deleted: id }, ctx.out);
    });

  ag.command('set-role')
    .description('bind an agent to a role (mirrors `member set-role`)')
    .requiredOption('--agent <ref>', 'agent id or unique name')
    .requiredOption('--role <ref>', 'role id or label')
    .action(async (opts: { agent: string; role: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const agentId = await resolveAgentId(ctx, opts.agent);
      const roleId = await resolveRoleId(ctx, opts.role);
      await ctx.metadata.request<{ assignRoleToAgent: boolean }>(
        `mutation Bind($agentId: UUID!, $roleId: UUID!) {
           assignRoleToAgent(agentId: $agentId, roleId: $roleId)
         }`,
        { agentId, roleId },
      );
      emitOk(`bound agent ${agentId} → role ${roleId}`, { agentId, roleId }, ctx.out);
    });

  ag.command('clear-role')
    .description('remove the role assignment from an agent')
    .requiredOption('--agent <ref>', 'agent id or unique name')
    .action(async (opts: { agent: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const agentId = await resolveAgentId(ctx, opts.agent);
      await ctx.metadata.request<{ removeRoleFromAgent: boolean }>(
        `mutation Clear($agentId: UUID!) { removeRoleFromAgent(agentId: $agentId) }`,
        { agentId },
      );
      emitOk(`cleared role for agent ${agentId}`, { agentId }, ctx.out);
    });

  ag.command('turns <agentId>')
    .description("list an agent's past reasoning turns")
    .action(async (agentId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ agentTurns: AgentTurn[] }>(
        `query Turns($agentId: UUID!) {
           agentTurns(agentId: $agentId) { ${AGENT_TURN_SUMMARY} }
         }`,
        { agentId },
      );
      emitList(data.agentTurns, ['id', 'threadId', 'agentId', 'createdAt'], ctx.out);
    });

  ag.command('evaluate <turnId>')
    .description('re-run reasoning evaluation on a stored turn (cost-bearing — calls the LLM)')
    .action(async (turnId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ evaluateAgentTurn: AgentTurnEvaluation }>(
        `mutation Eval($turnId: UUID!) {
           evaluateAgentTurn(turnId: $turnId) { id turnId score comment createdAt }
         }`,
        { turnId },
      );
      emitOne(
        data.evaluateAgentTurn as unknown as Record<string, unknown>,
        ['id', 'turnId', 'score', 'comment', 'createdAt'],
        ctx.out,
      );
    });

  ag.command('stop-stream <threadId>')
    .description('stop an in-flight agent chat stream on a thread')
    .action(async (threadId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.metadata.request<{ stopAgentChatStream: boolean }>(
        `mutation Stop($threadId: UUID!) { stopAgentChatStream(threadId: $threadId) }`,
        { threadId },
      );
      emitOk(`stopped stream on thread ${threadId}`, { threadId }, ctx.out);
    });
}

interface AgentTurn {
  id: string;
  threadId: string;
  agentId: string | null;
  createdAt: string;
}

interface AgentTurnEvaluation {
  id: string;
  turnId: string;
  score: number;
  comment: string | null;
  createdAt: string;
}

function agentColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'name', 'label', 'modelId', 'isCustom', 'roleId'];
}
