import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { expectArray, loadInputFile } from '../lib/input-file.js';
import { resolveObjectName, type ObjectNames } from '../lib/objects.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';
import { reconcile } from '../lib/reconcile.js';

/**
 * `twenty-ops record …` — CRUD on any object (standard or custom) via Twenty's REST API.
 *
 * REST was chosen over GraphQL: a single URL shape (`/rest/{namePlural}`) works for
 * every object in any workspace without per-workspace code generation, which keeps
 * the client small and the tool truly portable across forwards-deployed installs.
 * GraphQL is used only for the one thing REST doesn't cover: `restore{Object}`,
 * which un-soft-deletes a record from the recycle bin.
 *
 * Twenty REST response shapes (verified against v2.x):
 *   GET    /rest/{plural}            → { data: { [plural]: Record[] } }
 *   GET    /rest/{plural}/{id}       → { data: { [singular]: Record } }
 *   POST   /rest/{plural}            → { data: { create<Singular>: Record } }
 *   PATCH  /rest/{plural}/{id}       → { data: { update<Singular>: Record } }
 *   DELETE /rest/{plural}/{id}       → { data: { delete<Singular>: { id } } } (soft delete)
 *
 * Filter DSL (Twenty REST): `field[op]:value`; compose with `and(f1,f2)` / `or(f1,f2)`.
 * Operators include `eq`, `is`, `gt`, `gte`, `lt`, `lte`, `like`, `in`. Passed through
 * verbatim — the user/agent owns the syntax.
 */
export function registerRecordCommands(program: Command): void {
  const record = program.command('record').description('CRUD any object via REST (workspace-agnostic)');

  registerList(record);
  registerGet(record);
  registerCreate(record);
  registerUpdate(record);
  registerDelete(record);
  registerRestore(record);
  registerBulkUpsert(record);
  registerMerge(record);
}

interface RecordRow {
  id: string;
  [key: string]: unknown;
}

function pickSingle(payload: unknown, name: string): RecordRow {
  const data = (payload as { data?: Record<string, unknown> } | undefined)?.data;
  if (!data) throw new CliError(`empty response (expected data.${name})`, EXIT.API);
  // Defensive: pick `data[name]` if present, else the first object in `data`.
  const direct = data[name];
  if (direct && typeof direct === 'object') return direct as RecordRow;
  for (const v of Object.values(data)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as RecordRow;
  }
  throw new CliError(`unexpected response shape: ${JSON.stringify(data).slice(0, 200)}`, EXIT.API);
}

function pickList(payload: unknown, namePlural: string): RecordRow[] {
  const data = (payload as { data?: Record<string, unknown> } | undefined)?.data;
  if (!data) return [];
  const direct = data[namePlural];
  if (Array.isArray(direct)) return direct as RecordRow[];
  // Twenty sometimes nests under .{namePlural}.edges[].node — handle both.
  if (direct && typeof direct === 'object') {
    const edges = (direct as { edges?: { node: RecordRow }[] }).edges;
    if (Array.isArray(edges)) return edges.map((e) => e.node);
  }
  return [];
}

/**
 * Extract the opaque cursor for the next page from a Twenty REST response.
 *
 * Twenty's REST API returns `pageInfo: { startCursor, endCursor,
 * hasNextPage, hasPreviousPage }` at the top level. The `endCursor` is a
 * base64-encoded JSON envelope (`btoa(JSON.stringify({id: "..."}))`), NOT
 * a bare UUID. Passing a bare UUID to `?starting_after=` returns
 * `400 Invalid cursor: <id>`. So callers paging through results must
 * read `pageInfo.endCursor` verbatim and pass it back as the next cursor.
 */
function pickNextCursor(payload: unknown): string | undefined {
  const pi = (payload as { pageInfo?: { endCursor?: string; hasNextPage?: boolean } } | undefined)?.pageInfo;
  if (!pi?.hasNextPage) return undefined;
  return pi.endCursor;
}

async function resolveNames(ctx: Ctx, ref: string): Promise<ObjectNames> {
  return resolveObjectName(ctx.metadata, ref);
}

function registerList(record: Command): void {
  record
    .command('list <object>')
    .description('list records (Twenty REST filter DSL: `field[op]:value`)')
    .option('--filter <expr>', 'REST filter expression, e.g. `email[eq]:"a@b.com"`')
    .option('--limit <n>', 'page size (default 60, max 60)', Number)
    .option('--starting-after <cursor>', 'opaque cursor (use `pageInfo.endCursor` from a previous --json call)')
    .option('--ending-before <cursor>', 'opaque cursor (use `pageInfo.startCursor` from a previous --json call)')
    .option('--order-by <expr>', 'e.g. `createdAt[DescNullsFirst]`')
    .action(
      async (
        ref: string,
        opts: {
          filter?: string;
          limit?: number;
          startingAfter?: string;
          endingBefore?: string;
          orderBy?: string;
        },
        cmd: Command,
      ) => {
        const ctx = makeCtx(cmd);
        const names = await resolveNames(ctx, ref);
        const payload = await ctx.rest.get<unknown>(`/${names.namePlural}`, {
          filter: opts.filter,
          limit: opts.limit,
          starting_after: opts.startingAfter,
          ending_before: opts.endingBefore,
          order_by: opts.orderBy,
        });
        const rows = pickList(payload, names.namePlural);
        emitList(rows, recordColumns(ctx, rows), ctx.out);
      },
    );
}

function registerGet(record: Command): void {
  record
    .command('get <object> <id>')
    .description('fetch one record')
    .action(async (ref: string, id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const names = await resolveNames(ctx, ref);
      const payload = await ctx.rest.get<unknown>(`/${names.namePlural}/${id}`);
      const row = pickSingle(payload, names.nameSingular);
      emitOne(row, recordColumns(ctx, [row]), ctx.out);
    });
}

function registerCreate(record: Command): void {
  record
    .command('create <object>')
    .description('create one record from a JSON/YAML file (- for stdin)')
    .requiredOption('--file <path>', 'JSON/YAML object describing the record')
    .action(async (ref: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const names = await resolveNames(ctx, ref);
      const input = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(input) || typeof input !== 'object' || input === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const payload = await ctx.rest.post<unknown>(`/${names.namePlural}`, input);
      const row = pickSingle(payload, names.nameSingular);
      emitOk(`created ${names.nameSingular} ${row.id}`, row, ctx.out);
    });
}

function registerUpdate(record: Command): void {
  record
    .command('update <object> <id>')
    .description('partial update from a JSON/YAML file (- for stdin)')
    .requiredOption('--file <path>', 'JSON/YAML object of fields to patch')
    .action(async (ref: string, id: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const names = await resolveNames(ctx, ref);
      const input = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(input) || typeof input !== 'object' || input === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const payload = await ctx.rest.patch<unknown>(`/${names.namePlural}/${id}`, input);
      const row = pickSingle(payload, names.nameSingular);
      emitOk(`updated ${names.nameSingular} ${id}`, row, ctx.out);
    });
}

function registerDelete(record: Command): void {
  record
    .command('delete <object> <id>')
    .description('soft-delete a record (recycle bin; restore with `record restore`)')
    .action(async (ref: string, id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const names = await resolveNames(ctx, ref);
      await ctx.rest.delete<unknown>(`/${names.namePlural}/${id}`);
      emitOk(`deleted ${names.nameSingular} ${id}`, { deleted: id }, ctx.out);
    });
}

function registerRestore(record: Command): void {
  record
    .command('restore <object> <id>')
    .description('restore a soft-deleted record from the recycle bin')
    .action(async (ref: string, id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const names = await resolveNames(ctx, ref);
      // restore<Object> is the one operation REST does not expose — fall back to
      // the per-object GraphQL mutation.
      const mutationName = `restore${capitalize(names.nameSingular)}`;
      const data = await ctx.core.request<Record<string, { id: string }>>(
        `mutation($id: UUID!) { ${mutationName}(id: $id) { id } }`,
        { id },
      );
      const row = data[mutationName];
      if (!row) throw new CliError(`restore returned no record (mutation ${mutationName})`, EXIT.API);
      emitOk(`restored ${names.nameSingular} ${row.id}`, row, ctx.out);
    });
}

function registerBulkUpsert(record: Command): void {
  record
    .command('bulk-upsert <object>')
    .description('reconcile a list of records against the workspace, matching by --key')
    .requiredOption('--file <path>', 'JSON/YAML array of record objects')
    .requiredOption('--key <field>', 'field name to match desired ↔ current records by')
    .option('--page-size <n>', 'records to fetch per page when listing current state', (v) => Number(v), 60)
    .action(
      async (
        ref: string,
        opts: { file: string; key: string; pageSize: number },
        cmd: Command,
      ) => {
        const ctx = makeCtx(cmd);
        const names = await resolveNames(ctx, ref);
        const desired = expectArray(loadInputFile(opts.file), opts.file);
        for (const d of desired) {
          if (d[opts.key] === undefined) {
            throw new CliError(
              `${opts.file}: every record must include the match key "${opts.key}"`,
              EXIT.USAGE,
            );
          }
        }

        // Page through current state and index by the match key. We don't filter
        // server-side — the user's --key may be any field, and `bulk-upsert` is
        // expected to handle full sync semantics (including detecting deletes).
        //
        // Paging uses Twenty's `pageInfo.endCursor` (a base64-encoded JSON
        // envelope, not a bare UUID). Constructing a cursor from the last
        // row's id returns 400 "Invalid cursor: <uuid>" — verified live.
        const current: RecordRow[] = [];
        let cursor: string | undefined;
        const limit = Math.max(1, Math.min(60, opts.pageSize));
        let safety = 1000;
        while (safety-- > 0) {
          const payload = await ctx.rest.get<unknown>(`/${names.namePlural}`, {
            limit,
            starting_after: cursor,
          });
          const rows = pickList(payload, names.namePlural);
          current.push(...rows);
          cursor = pickNextCursor(payload);
          if (!cursor) break;
        }

        const result = await reconcile<RecordRow>({
          desired,
          current,
          keyOfDesired: (d) => String(d[opts.key]),
          keyOfCurrent: (c) => String((c as RecordRow)[opts.key]),
          changed: (cur, des) => Object.entries(des).some(([k, v]) => {
            if (k === 'id') return false;
            return JSON.stringify(cur[k]) !== JSON.stringify(v);
          }),
          create: async (d) => {
            await ctx.rest.post<unknown>(`/${names.namePlural}`, d);
          },
          update: async (cur, d) => {
            // Drop the match key from the patch — Twenty rejects updates that
            // rewrite an identity field, and it's already correct by definition.
            const { [opts.key]: _, ...patch } = d;
            void _;
            await ctx.rest.patch<unknown>(`/${names.namePlural}/${cur.id}`, patch);
          },
          remove: async (cur) => {
            await ctx.rest.delete<unknown>(`/${names.namePlural}/${cur.id}`);
          },
        });
        emitOk(
          `${names.namePlural} upsert: +${result.created} ~${result.updated} -${result.deleted} =${result.unchanged}`,
          { what: names.namePlural, ...result },
          ctx.out,
        );
      },
    );
}

/**
 * `record merge` — Twenty exposes `mergePeople` / `mergeCompanies` on the CORE
 * GraphQL endpoint (not REST). They take a list of ids, a 0-based priority
 * index (which record wins on field conflict), and an optional dryRun flag.
 *
 * Verified shapes (live probe):
 *   core.mergePeople(ids: [String!]!, conflictPriorityIndex: Int!, dryRun: Boolean): Person
 *   core.mergeCompanies(ids: [String!]!, conflictPriorityIndex: Int!, dryRun: Boolean): Company
 *
 * No other objects are merge-able — Twenty hard-codes the dedup logic per
 * type. Other objects return USAGE with an explicit message.
 */
function registerMerge(record: Command): void {
  record
    .command('merge <object> <ids...>')
    .description('merge 2+ records of the same object — supported only for person/company')
    .option('--priority <n>', '0-based index: which input wins on field conflict (default 0)', (v) => Number(v), 0)
    .option('--dry-run', 'preview the merged record without committing', false)
    .action(async (ref: string, ids: string[], opts: { priority: number; dryRun?: boolean }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      if (ids.length < 2) {
        throw new CliError(`record merge needs at least 2 ids, got ${ids.length}`, EXIT.USAGE);
      }
      const mutation = pickMergeMutation(ref);
      if (!mutation) {
        throw new CliError(
          `record merge is supported only for person/people or company/companies, got "${ref}"`,
          EXIT.USAGE,
        );
      }
      const { name, selection } = mutation;
      const data = await ctx.core.request<Record<string, RecordRow>>(
        `mutation($ids: [String!]!, $idx: Int!, $dry: Boolean) {
           ${name}(ids: $ids, conflictPriorityIndex: $idx, dryRun: $dry) { ${selection} }
         }`,
        { ids, idx: opts.priority, dry: !!opts.dryRun },
      );
      const merged = data[name];
      if (!merged) {
        throw new CliError(`unexpected response from ${name}: ${JSON.stringify(data)}`, EXIT.API);
      }
      emitOk(
        opts.dryRun
          ? `dry-run: would merge ${ids.length} ${ref} into ${merged.id}`
          : `merged ${ids.length} ${ref} → ${merged.id}`,
        merged,
        ctx.out,
      );
    });
}

function pickMergeMutation(ref: string): { name: string; selection: string } | undefined {
  if (ref === 'person' || ref === 'people') {
    return { name: 'mergePeople', selection: 'id name { firstName lastName } jobTitle' };
  }
  if (ref === 'company' || ref === 'companies') {
    return { name: 'mergeCompanies', selection: 'id name domainName { primaryLinkUrl }' };
  }
  return undefined;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/**
 * Pick the columns to emit for records.
 *
 * Records can have 20-30 fields; the trade-off:
 *   - Text mode: project to id + name-ish + timestamps for a readable table.
 *     The user/agent adds `--fields` to expand.
 *   - JSON mode: emit every field. JSON is machine-read, so width doesn't
 *     hurt and "everything the API returned" is the useful contract.
 *
 * Explicit `--fields` always wins (selectedFields handles that in output.ts).
 */
function recordColumns(ctx: Ctx, rows: RecordRow[]): string[] {
  if (ctx.out.json) return []; // emit every field under --json
  const sample = rows[0];
  if (!sample) return ['id'];
  const wanted = ['id', 'name', 'displayName', 'title', 'email', 'createdAt', 'updatedAt'];
  const present = wanted.filter((k) => k in sample);
  if (present.length >= 2) return present;
  const keys = Object.keys(sample);
  const ordered = keys.includes('id') ? ['id', ...keys.filter((k) => k !== 'id')] : keys;
  return ordered.slice(0, 6);
}
