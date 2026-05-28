import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { LOGIC_FUNCTION_SUMMARY } from '../lib/gql.js';
import { loadInputFile } from '../lib/input-file.js';
import {
  listLogicFunctions,
  resolveLogicFunctionId,
  type LogicFunction,
} from '../lib/logic-functions.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

/**
 * `twenty-ops logic-function …` — manage server-side TypeScript handlers.
 *
 * Verified mutation shapes (live probe):
 *   createOneLogicFunction(input: CreateLogicFunctionFromSourceInput!) → LogicFunction
 *     { id?, name!, description?, timeoutSeconds?, source(JSON),
 *       cronTriggerSettings, databaseEventTriggerSettings, ... }
 *   updateOneLogicFunction(input: UpdateLogicFunctionFromSourceInput!) → Boolean
 *     wrapper { id, update: { name?, sourceHandlerCode?, handlerName?, ... } }
 *   deleteOneLogicFunction(input: LogicFunctionIdInput!)         { id }
 *   executeOneLogicFunction(input: ExecuteOneLogicFunctionInput!) { id, payload(JSON!) }
 *     → { data, logs, duration, status, error }
 *
 * The `source` JSON shape on create is undocumented — the server appears to
 * expect a base64-encoded tarball (the same format `twenty-sdk install`
 * produces). For non-trivial authoring, use `twenty add logicFunction` plus
 * `twenty install`. This command is the low-level inspect/execute/manage
 * surface: list, get, source (read), execute, delete are robust; create and
 * update accept opaque JSON pass-through for the rare cases where an agent
 * already has the right shape.
 *
 * `update` returns `Boolean!`, so we re-fetch via `findOneLogicFunction` for
 * the success payload.
 */
export function registerLogicFunctionCommands(program: Command): void {
  const lf = program
    .command('logic-function')
    .description('manage server-side logic functions (TypeScript handlers)');

  lf.command('list')
    .description('list every logic function in the workspace')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const rows = await listLogicFunctions(ctx.metadata);
      emitList(rows, lfColumns(ctx), ctx.out);
    });

  lf.command('get <ref>')
    .description('show one logic function — accepts UUID or unique name')
    .action(async (ref: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const id = await resolveLogicFunctionId(ctx, ref);
      const data = await ctx.metadata.request<{ findOneLogicFunction: LogicFunction | null }>(
        `query Get($input: LogicFunctionIdInput!) {
           findOneLogicFunction(input: $input) { ${LOGIC_FUNCTION_SUMMARY} }
         }`,
        { input: { id } },
      );
      if (!data.findOneLogicFunction) {
        throw new CliError(`logic function "${ref}" not found`, EXIT.NOT_FOUND);
      }
      emitOne(
        data.findOneLogicFunction as unknown as Record<string, unknown>,
        lfColumns(ctx),
        ctx.out,
      );
    });

  lf.command('source <ref>')
    .description('print the handler source code')
    .action(async (ref: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const id = await resolveLogicFunctionId(ctx, ref);
      const data = await ctx.metadata.request<{ getLogicFunctionSourceCode: string | null }>(
        `query Source($input: LogicFunctionIdInput!) {
           getLogicFunctionSourceCode(input: $input)
         }`,
        { input: { id } },
      );
      const src = data.getLogicFunctionSourceCode ?? '';
      if (ctx.out.json) {
        process.stdout.write(`${JSON.stringify({ id, source: src })}\n`);
      } else {
        process.stdout.write(src);
        if (!src.endsWith('\n')) process.stdout.write('\n');
      }
    });

  lf.command('create')
    .description('create a logic function — opaque JSON pass-through (see `twenty install` for authoring)')
    .requiredOption(
      '--file <path>',
      'CreateLogicFunctionFromSourceInput { name, description?, timeoutSeconds?, source?, *TriggerSettings? }',
    )
    .action(async (opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const input = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(input) || typeof input !== 'object' || input === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      if (typeof input.name !== 'string') {
        throw new CliError(`${opts.file} is missing required field "name"`, EXIT.USAGE);
      }
      const data = await ctx.metadata.request<{ createOneLogicFunction: LogicFunction }>(
        `mutation Create($input: CreateLogicFunctionFromSourceInput!) {
           createOneLogicFunction(input: $input) { ${LOGIC_FUNCTION_SUMMARY} }
         }`,
        { input },
      );
      emitOk(
        `created logic function ${data.createOneLogicFunction.id} (${data.createOneLogicFunction.name})`,
        data.createOneLogicFunction as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  lf.command('update <ref>')
    .description('update a logic function — accepts UUID or unique name')
    .requiredOption(
      '--file <path>',
      'partial update { name?, description?, timeoutSeconds?, handlerName?, sourceHandlerPath?, sourceHandlerCode?, *TriggerSettings? }',
    )
    .action(
      async (
        ref: string,
        opts: { file: string },
        cmd: Command,
      ) => {
        const ctx = makeCtx(cmd);
        const update = loadInputFile<Record<string, unknown>>(opts.file);
        if (Array.isArray(update) || typeof update !== 'object' || update === null) {
          throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
        }
        const id = await resolveLogicFunctionId(ctx, ref);
        // updateOneLogicFunction returns Boolean! — no selection set; refetch for output.
        await ctx.metadata.request<{ updateOneLogicFunction: boolean }>(
          `mutation Update($input: UpdateLogicFunctionFromSourceInput!) {
             updateOneLogicFunction(input: $input)
           }`,
          { input: { id, update } },
        );
        const refreshed = await ctx.metadata.request<{
          findOneLogicFunction: LogicFunction | null;
        }>(
          `query Get($input: LogicFunctionIdInput!) {
             findOneLogicFunction(input: $input) { ${LOGIC_FUNCTION_SUMMARY} }
           }`,
          { input: { id } },
        );
        const fn = refreshed.findOneLogicFunction;
        if (!fn) throw new CliError(`logic function ${id} vanished after update`, EXIT.API);
        emitOk(
          `updated logic function ${id}`,
          fn as unknown as Record<string, unknown>,
          ctx.out,
        );
      },
    );

  lf.command('delete <ref>')
    .description('delete a logic function — accepts UUID or unique name')
    .action(async (ref: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const id = await resolveLogicFunctionId(ctx, ref);
      await ctx.metadata.request<{ deleteOneLogicFunction: LogicFunction }>(
        `mutation Delete($input: LogicFunctionIdInput!) {
           deleteOneLogicFunction(input: $input) { id }
         }`,
        { input: { id } },
      );
      emitOk(`deleted logic function ${id}`, { deleted: id }, ctx.out);
    });

  lf.command('execute <ref>')
    .description('invoke a logic function — prints { data, logs, duration, status }')
    .option('--input <json>', 'inline JSON payload (mutually exclusive with --input-file)')
    .option('--input-file <path>', 'JSON/YAML payload file (mutually exclusive with --input)')
    .action(
      async (
        ref: string,
        opts: { input?: string; inputFile?: string },
        cmd: Command,
      ) => {
        const ctx = makeCtx(cmd);
        if (opts.input && opts.inputFile) {
          throw new CliError('pass either --input or --input-file, not both', EXIT.USAGE);
        }
        let payload: unknown = {};
        if (opts.inputFile) {
          payload = loadInputFile(opts.inputFile);
        } else if (opts.input) {
          try {
            payload = JSON.parse(opts.input);
          } catch (err) {
            throw new CliError(`--input is not valid JSON: ${(err as Error).message}`, EXIT.USAGE);
          }
        }
        const id = await resolveLogicFunctionId(ctx, ref);
        const data = await ctx.metadata.request<{
          executeOneLogicFunction: {
            data: unknown;
            logs: string;
            duration: number;
            status: string;
            error: unknown;
          };
        }>(
          `mutation Exec($input: ExecuteOneLogicFunctionInput!) {
             executeOneLogicFunction(input: $input) { data logs duration status error }
           }`,
          { input: { id, payload } },
        );
        const r = data.executeOneLogicFunction;
        if (r.status !== 'SUCCESS') {
          // Emit the result so logs/error reach the caller, then exit API.
          const msg =
            typeof r.error === 'string' ? r.error : JSON.stringify(r.error ?? r.status);
          if (ctx.out.json) {
            process.stdout.write(`${JSON.stringify(r)}\n`);
          } else {
            process.stderr.write(`status=${r.status}\n`);
            if (r.logs) process.stderr.write(`${r.logs}\n`);
          }
          throw new CliError(`logic function failed: ${msg}`, EXIT.API);
        }
        emitOne(r as unknown as Record<string, unknown>, executeColumns(ctx), ctx.out);
      },
    );
}

function lfColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'name', 'runtime', 'timeoutSeconds', 'handlerName', 'description'];
}

function executeColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['status', 'duration', 'data', 'logs'];
}
