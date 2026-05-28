import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { SKILL_SUMMARY } from '../lib/gql.js';
import { loadInputFile } from '../lib/input-file.js';
import { listSkills, resolveSkillId, type Skill } from '../lib/skills.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

/**
 * `twenty-ops skill …` — manage AI agent skills (tool-using behaviors).
 *
 * Verified mutation shapes (live probe):
 *   createSkill(input: CreateSkillInput!) → Skill!
 *     { id?, name!, label!, icon?, description?, content! }
 *   updateSkill(input: UpdateSkillInput!) → Skill!
 *     { id!, name?, label?, icon?, description?, content?, isActive? }
 *     (flat — id sits inside the input, no wrapper)
 *   deleteSkill(id: UUID!) → Skill!
 *   activateSkill(id: UUID!) / deactivateSkill(id: UUID!) → Skill!
 *
 * `skills` query returns every skill in the workspace (no paging). The
 * `content` field is the skill's prompt/system-message body — typically a
 * multi-line markdown string. We surface it in `get` but not in `list` (kept
 * compact for token efficiency).
 */
export function registerSkillCommands(program: Command): void {
  const sk = program.command('skill').description('manage AI agent skills');

  sk.command('list')
    .description('list every skill in the workspace')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const rows = await listSkills(ctx.metadata);
      // Strip `content` from the list view so wide tables stay compact;
      // `get <ref>` reveals it for inspection.
      const compact = rows.map(({ content: _content, ...rest }) => rest);
      emitList(compact, skillColumns(ctx), ctx.out);
    });

  sk.command('get <ref>')
    .description('show one skill (id or unique name)')
    .action(async (ref: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const id = await resolveSkillId(ctx, ref);
      const data = await ctx.metadata.request<{ skill: Skill | null }>(
        `query Get($id: UUID!) { skill(id: $id) { ${SKILL_SUMMARY} content } }`,
        { id },
      );
      if (!data.skill) throw new CliError(`skill "${ref}" not found`, EXIT.NOT_FOUND);
      emitOne(
        data.skill as unknown as Record<string, unknown>,
        ctx.out.json ? [] : ['id', 'name', 'label', 'isActive', 'isCustom', 'description', 'content'],
        ctx.out,
      );
    });

  sk.command('create')
    .description('create a skill from JSON/YAML (- for stdin)')
    .requiredOption('--file <path>', 'CreateSkillInput { name, label, content, icon?, description? }')
    .action(async (opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const input = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(input) || typeof input !== 'object' || input === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      for (const required of ['name', 'label', 'content']) {
        if (typeof input[required] !== 'string') {
          throw new CliError(`${opts.file} is missing required field "${required}"`, EXIT.USAGE);
        }
      }
      const data = await ctx.metadata.request<{ createSkill: Skill }>(
        `mutation Create($input: CreateSkillInput!) {
           createSkill(input: $input) { ${SKILL_SUMMARY} }
         }`,
        { input },
      );
      emitOk(
        `created skill ${data.createSkill.id} (${data.createSkill.name})`,
        data.createSkill as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  sk.command('update <ref>')
    .description('update a skill — accepts UUID or unique name')
    .requiredOption('--file <path>', 'partial UpdateSkillInput { name?, label?, icon?, description?, content?, isActive? }')
    .action(async (ref: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const update = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(update) || typeof update !== 'object' || update === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const id = await resolveSkillId(ctx, ref);
      const data = await ctx.metadata.request<{ updateSkill: Skill }>(
        `mutation Update($input: UpdateSkillInput!) {
           updateSkill(input: $input) { ${SKILL_SUMMARY} }
         }`,
        { input: { id, ...update } },
      );
      emitOk(`updated skill ${id}`, data.updateSkill as unknown as Record<string, unknown>, ctx.out);
    });

  sk.command('delete <ref>')
    .description('delete a skill — accepts UUID or unique name')
    .action(async (ref: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const id = await resolveSkillId(ctx, ref);
      await ctx.metadata.request(
        `mutation Delete($id: UUID!) { deleteSkill(id: $id) { id } }`,
        { id },
      );
      emitOk(`deleted skill ${id}`, { deleted: id }, ctx.out);
    });

  sk.command('activate <ref>')
    .description('mark a skill active so agents can use it')
    .action(async (ref: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const id = await resolveSkillId(ctx, ref);
      const data = await ctx.metadata.request<{ activateSkill: Skill }>(
        `mutation A($id: UUID!) { activateSkill(id: $id) { ${SKILL_SUMMARY} } }`,
        { id },
      );
      emitOk(`activated skill ${id}`, data.activateSkill as unknown as Record<string, unknown>, ctx.out);
    });

  sk.command('deactivate <ref>')
    .description('mark a skill inactive (agents can no longer call it)')
    .action(async (ref: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const id = await resolveSkillId(ctx, ref);
      const data = await ctx.metadata.request<{ deactivateSkill: Skill }>(
        `mutation D($id: UUID!) { deactivateSkill(id: $id) { ${SKILL_SUMMARY} } }`,
        { id },
      );
      emitOk(`deactivated skill ${id}`, data.deactivateSkill as unknown as Record<string, unknown>, ctx.out);
    });
}

function skillColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'name', 'label', 'isActive', 'isCustom', 'description'];
}
