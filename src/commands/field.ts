import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { FIELD_SUMMARY } from '../lib/gql.js';
import { loadInputFile } from '../lib/input-file.js';
import { resolveObjectId } from '../lib/objects.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

interface FieldNode {
  id: string;
  name: string;
  label: string;
  type: string;
  isCustom: boolean;
  isActive: boolean;
  isNullable: boolean;
  objectMetadataId: string;
  description: string | null;
  icon: string | null;
  options?: unknown;
}

/**
 * `twenty-ops field …` — manage field metadata (schema-as-code, part 2).
 *
 * Mirrors `object` with its own nested-input quirk:
 *   createOneField(input: CreateOneFieldMetadataInput { field: CreateFieldInput })
 *   updateOneField(input: { id, update: UpdateFieldInput })
 *   deleteOneField(input: { id })
 *
 * CreateFieldInput requires {type (FieldMetadataType enum), name, label, objectMetadataId}.
 * The user's --file JSON passes through verbatim — type-specific shapes
 * (defaultValue / options / settings / relationCreationPayload) are
 * Twenty-version-dependent, so the burden of correctness lives with the
 * input. Probe confirmed TEXT and SELECT (options: [{value,label,color,position}]).
 */
export function registerFieldCommands(program: Command): void {
  const field = program.command('field').description('manage field metadata (schema-as-code)');

  field
    .command('list')
    .description('list fields on an object — accepts UUID or nameSingular/namePlural')
    .requiredOption('--object <ref>', 'object id or nameSingular/namePlural')
    .option('--include-inactive', 'include inactive fields', false)
    .action(async (opts: { object: string; includeInactive?: boolean }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const objectMetadataId = await resolveObjectId(ctx.metadata, opts.object);
      const data = await ctx.metadata.request<{
        fields: { edges: { node: FieldNode }[] };
      }>(
        `query Fields($id: UUID!) {
           fields(filter: { objectMetadataId: { eq: $id } }, paging: { first: 200 }) {
             edges { node { ${FIELD_SUMMARY} } }
           }
         }`,
        { id: objectMetadataId },
      );
      const rows = data.fields.edges
        .map((e) => e.node)
        .filter((n) => opts.includeInactive || n.isActive);
      emitList(rows, fieldColumns(ctx), ctx.out);
    });

  field
    .command('get <id>')
    .description('show one field by id')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ field: FieldNode | null }>(
        `query Field($id: UUID!) { field(id: $id) { ${FIELD_SUMMARY} options } }`,
        { id },
      );
      if (!data.field) throw new CliError(`field "${id}" not found`, EXIT.NOT_FOUND);
      emitOne(data.field, fieldColumns(ctx), ctx.out);
    });

  field
    .command('create')
    .description('create a field on an object from a JSON/YAML file (- for stdin)')
    .requiredOption('--object <ref>', 'object id or nameSingular/namePlural')
    .requiredOption(
      '--file <path>',
      'field {name, label, type, description?, icon?, defaultValue?, options?, ...}',
    )
    .action(async (opts: { object: string; file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const input = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(input) || typeof input !== 'object' || input === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      for (const required of ['name', 'label', 'type']) {
        if (typeof input[required] !== 'string') {
          throw new CliError(`${opts.file} is missing required field "${required}"`, EXIT.USAGE);
        }
      }
      const objectMetadataId = await resolveObjectId(ctx.metadata, opts.object);
      const data = await ctx.metadata.request<{ createOneField: FieldNode }>(
        `mutation Create($input: CreateOneFieldMetadataInput!) {
           createOneField(input: $input) { ${FIELD_SUMMARY} }
         }`,
        { input: { field: { ...input, objectMetadataId } } },
      );
      emitOk(
        `created field ${data.createOneField.id} (${data.createOneField.name})`,
        data.createOneField as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  field
    .command('update <id>')
    .description('update a field from a JSON/YAML file (- for stdin)')
    .requiredOption(
      '--file <path>',
      'partial: {label?, name?, description?, icon?, isActive?, defaultValue?, options?, ...}',
    )
    .action(async (id: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const update = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(update) || typeof update !== 'object' || update === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const data = await ctx.metadata.request<{ updateOneField: FieldNode }>(
        `mutation Update($input: UpdateOneFieldMetadataInput!) {
           updateOneField(input: $input) { ${FIELD_SUMMARY} }
         }`,
        { input: { id, update } },
      );
      emitOk(
        `updated field ${id}`,
        data.updateOneField as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  field
    .command('delete <id>')
    .description('delete a field')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.metadata.request(
        `mutation Delete($input: DeleteOneFieldInput!) { deleteOneField(input: $input) { id } }`,
        { input: { id } },
      );
      emitOk(`deleted field ${id}`, { deleted: id }, ctx.out);
    });
}

function fieldColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return []; // emit every FIELD_SUMMARY key under --json
  return ['id', 'name', 'label', 'type', 'isCustom', 'isActive'];
}
