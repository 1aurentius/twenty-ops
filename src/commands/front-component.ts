import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { FRONT_COMPONENT_SUMMARY } from '../lib/gql.js';
import { loadInputFile } from '../lib/input-file.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

/**
 * `twenty-ops front-component …` — manage partner-authored React components
 * embedded in the Twenty UI.
 *
 * Verified shapes (live probe):
 *   createFrontComponent(input { name!, description?, sourceComponentPath!,
 *                                 builtComponentPath!, componentName!,
 *                                 builtComponentChecksum! }) → FrontComponent
 *   updateFrontComponent(input { id!, update: { name?, description?, ... } })
 *   deleteFrontComponent(id: UUID!) → FrontComponent
 *   frontComponent(id) / frontComponents()
 *
 * The build artifacts (`sourceComponentPath` / `builtComponentPath` /
 * `builtComponentChecksum`) are normally produced by `twenty-sdk install`
 * — this CLI is a pass-through for already-built components.
 */
export function registerFrontComponentCommands(program: Command): void {
  const fc = program.command('front-component').description('manage embedded UI components');

  fc.command('list')
    .description('list every front component installed in the workspace')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ frontComponents: FrontComponent[] }>(
        `query { frontComponents { ${FRONT_COMPONENT_SUMMARY} } }`,
      );
      emitList(data.frontComponents, fcColumns(ctx), ctx.out);
    });

  fc.command('get <id>')
    .description('show one front component')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ frontComponent: FrontComponent | null }>(
        `query F($id: UUID!) { frontComponent(id: $id) { ${FRONT_COMPONENT_SUMMARY} } }`,
        { id },
      );
      if (!data.frontComponent) throw new CliError(`front component "${id}" not found`, EXIT.NOT_FOUND);
      emitOne(data.frontComponent as unknown as Record<string, unknown>, fcColumns(ctx), ctx.out);
    });

  fc.command('create')
    .description('register a front component (pass-through — build artifacts come from twenty-sdk install)')
    .requiredOption(
      '--file <path>',
      'CreateFrontComponentInput { name, description?, sourceComponentPath, builtComponentPath, componentName, builtComponentChecksum }',
    )
    .action(async (opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const input = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(input) || typeof input !== 'object' || input === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      for (const required of ['name', 'sourceComponentPath', 'builtComponentPath', 'componentName', 'builtComponentChecksum']) {
        if (typeof input[required] !== 'string') {
          throw new CliError(`${opts.file} is missing required field "${required}"`, EXIT.USAGE);
        }
      }
      const data = await ctx.metadata.request<{ createFrontComponent: FrontComponent }>(
        `mutation Create($input: CreateFrontComponentInput!) {
           createFrontComponent(input: $input) { ${FRONT_COMPONENT_SUMMARY} }
         }`,
        { input },
      );
      emitOk(
        `created front component ${data.createFrontComponent.id} (${data.createFrontComponent.name})`,
        data.createFrontComponent as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  fc.command('update <id>')
    .description('update a front component (wrapper {id, update})')
    .requiredOption('--file <path>', 'partial UpdateFrontComponentInputUpdates')
    .action(async (id: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const update = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(update) || typeof update !== 'object' || update === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const data = await ctx.metadata.request<{ updateFrontComponent: FrontComponent }>(
        `mutation Update($input: UpdateFrontComponentInput!) {
           updateFrontComponent(input: $input) { ${FRONT_COMPONENT_SUMMARY} }
         }`,
        { input: { id, update } },
      );
      emitOk(`updated front component ${id}`, data.updateFrontComponent as unknown as Record<string, unknown>, ctx.out);
    });

  fc.command('delete <id>')
    .description('delete a front component')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.metadata.request(
        `mutation Delete($id: UUID!) { deleteFrontComponent(id: $id) { id } }`,
        { id },
      );
      emitOk(`deleted front component ${id}`, { deleted: id }, ctx.out);
    });
}

interface FrontComponent {
  id: string;
  name: string;
  description: string | null;
  componentName: string;
  sourceComponentPath: string;
  builtComponentPath: string;
  builtComponentChecksum: string;
  applicationId: string;
  universalIdentifier: string | null;
  isHeadless: boolean;
  usesSdkClient: boolean;
  createdAt: string;
  updatedAt: string;
}

function fcColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'name', 'componentName', 'isHeadless', 'usesSdkClient', 'applicationId'];
}
