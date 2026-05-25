import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { OBJECT_SUMMARY } from '../lib/gql.js';
import { loadInputFile } from '../lib/input-file.js';
import { listObjects, resolveObjectName, type ObjectNode } from '../lib/objects.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

/**
 * `twenty-ops object …` — manage object metadata (the schema-as-code surface).
 *
 * Twenty's metadata API splits "an object" into nested input wrappers:
 *
 *   mutation createOneObject(input: { object: CreateObjectInput })
 *   mutation updateOneObject(input: { id: UUID, update: UpdateObjectPayload })
 *   mutation deleteOneObject(input: { id: UUID })
 *
 * Verified empirically (probe `dataSourceId` is NOT required, contrary to some
 * Twenty versions). `<ref>` accepts UUID or nameSingular/namePlural via
 * `resolveObjectName` so callers don't have to look up ids first.
 */
export function registerObjectCommands(program: Command): void {
  const object = program.command('object').description('manage object metadata (schema-as-code)');

  object
    .command('list')
    .description('list objects (custom + standard)')
    .option('--include-inactive', 'include inactive objects', false)
    .action(async (opts: { includeInactive?: boolean }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const objects = await listObjects(ctx.metadata);
      const rows = opts.includeInactive ? objects : objects.filter((o) => o.isActive);
      emitList(
        rows,
        ['id', 'nameSingular', 'namePlural', 'labelSingular', 'isCustom', 'isActive'],
        ctx.out,
      );
    });

  object
    .command('get <ref>')
    .description('show one object — accepts UUID or nameSingular/namePlural')
    .action(async (ref: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const names = await resolveObjectName(ctx.metadata, ref);
      const data = await ctx.metadata.request<{ object: ObjectNode | null }>(
        `query Object($id: UUID!) { object(id: $id) { ${OBJECT_SUMMARY} } }`,
        { id: names.id },
      );
      if (!data.object) throw new CliError(`object "${ref}" not found`, EXIT.NOT_FOUND);
      emitOne(
        data.object,
        objectColumns(ctx),
        ctx.out,
      );
    });

  object
    .command('create')
    .description('create a custom object from a JSON/YAML file (- for stdin)')
    .requiredOption(
      '--file <path>',
      'object {nameSingular, namePlural, labelSingular, labelPlural, icon?, description?, color?, ...}',
    )
    .action(async (opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const input = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(input) || typeof input !== 'object' || input === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      for (const required of ['nameSingular', 'namePlural', 'labelSingular', 'labelPlural']) {
        if (typeof input[required] !== 'string') {
          throw new CliError(`${opts.file} is missing required field "${required}"`, EXIT.USAGE);
        }
      }
      const data = await ctx.metadata.request<{ createOneObject: ObjectNode }>(
        `mutation Create($input: CreateOneObjectInput!) {
           createOneObject(input: $input) { ${OBJECT_SUMMARY} }
         }`,
        { input: { object: input } },
      );
      emitOk(
        `created object ${data.createOneObject.id} (${data.createOneObject.nameSingular})`,
        data.createOneObject as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  object
    .command('update <ref>')
    .description('update an object\'s metadata from a JSON/YAML file (- for stdin)')
    .requiredOption(
      '--file <path>',
      'partial: {labelSingular?, labelPlural?, nameSingular?, namePlural?, description?, icon?, isActive?, ...}',
    )
    .action(async (ref: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const update = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(update) || typeof update !== 'object' || update === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const names = await resolveObjectName(ctx.metadata, ref);
      const data = await ctx.metadata.request<{ updateOneObject: ObjectNode }>(
        `mutation Update($input: UpdateOneObjectInput!) {
           updateOneObject(input: $input) { ${OBJECT_SUMMARY} }
         }`,
        { input: { id: names.id, update } },
      );
      emitOk(
        `updated object ${names.id}`,
        data.updateOneObject as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  object
    .command('delete <ref>')
    .description('delete an object — must be empty of records')
    .action(async (ref: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const names = await resolveObjectName(ctx.metadata, ref);
      await ctx.metadata.request(
        `mutation Delete($input: DeleteOneObjectInput!) { deleteOneObject(input: $input) { id } }`,
        { input: { id: names.id } },
      );
      emitOk(`deleted object ${names.id} (${names.nameSingular})`, { deleted: names.id }, ctx.out);
    });
}

/** Default text-mode column projection; --json emits all OBJECT_SUMMARY fields. */
function objectColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return []; // emit all OBJECT_SUMMARY fields
  return ['id', 'nameSingular', 'namePlural', 'labelSingular', 'labelPlural', 'icon', 'isCustom', 'isActive'];
}
