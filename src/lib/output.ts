/**
 * Output rendering — the core of the CLI's token efficiency.
 *
 * Defaults are compact human/agent-readable text. `--json` switches to machine
 * output: a single object prints as one JSON object; a list prints as JSON
 * Lines (one object per line — streamable and greppable, no wrapping array).
 * `--fields a,b,c` projects to exactly the requested keys in any mode.
 */
export interface OutputOpts {
  json?: boolean;
  fields?: string;
  quiet?: boolean;
}

type Row = Record<string, unknown>;

function selectedFields(opts: OutputOpts, fallback: string[]): string[] {
  if (opts.fields) return opts.fields.split(',').map((f) => f.trim()).filter(Boolean);
  return fallback;
}

function project(row: Row, fields: string[]): Row {
  const out: Row = {};
  for (const f of fields) out[f] = row[f];
  return out;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Print a list of records. `columns` is the default projection when --fields is absent. */
export function emitList<T extends object>(
  records: readonly T[],
  columns: string[],
  opts: OutputOpts,
): void {
  const rows = records as readonly Row[];
  const fields = selectedFields(opts, columns);

  if (opts.json) {
    for (const row of rows) process.stdout.write(`${JSON.stringify(project(row, fields))}\n`);
    return;
  }
  if (rows.length === 0) {
    if (!opts.quiet) process.stderr.write('(no results)\n');
    return;
  }

  const widths = fields.map((f) =>
    Math.max(f.length, ...rows.map((r) => cell(r[f]).length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ').trimEnd();

  process.stdout.write(`${line(fields)}\n`);
  for (const row of rows) process.stdout.write(`${line(fields.map((f) => cell(row[f])))}\n`);
}

/** Print a single record. Default text mode is one `key=value` line per field. */
export function emitOne<T extends object>(record: T, columns: string[], opts: OutputOpts): void {
  const row = record as Row;
  const fields = selectedFields(opts, columns.length ? columns : Object.keys(row));
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(project(row, fields))}\n`);
    return;
  }
  for (const f of fields) process.stdout.write(`${f}=${cell(row[f])}\n`);
}

/** Print a terse success line (suppressed by --quiet, replaced by JSON under --json). */
export function emitOk<T extends object>(message: string, data: T, opts: OutputOpts): void {
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(data)}\n`);
    return;
  }
  if (!opts.quiet) process.stdout.write(`${message}\n`);
}
