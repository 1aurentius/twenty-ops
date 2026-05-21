/**
 * Schema introspection helpers — shared by `scripts/snapshot-schema.ts`
 * (writes the committed snapshot) and `test/integration/schema-drift.int.test.ts`
 * (asserts live matches the snapshot).
 *
 * The snapshot deliberately captures only resolver names and their argument
 * names — *not* full GraphQL types. Full-type snapshots churn on every Twenty
 * release; field-level changes are the ones that actually break callers.
 */
import type { GraphQLClient } from '../api/graphql-client.js';

export interface EndpointSnapshot {
  /** GraphQL field name → sorted argument names. */
  queries: Record<string, string[]>;
  mutations: Record<string, string[]>;
}

export interface SchemaSnapshot {
  /** ISO-8601 instant the snapshot was generated. */
  generatedAt: string;
  endpoints: {
    core: EndpointSnapshot;
    metadata: EndpointSnapshot;
  };
}

interface IntrospectionResponse {
  __schema: {
    queryType: { fields: Array<{ name: string; args: Array<{ name: string }> }> } | null;
    mutationType: { fields: Array<{ name: string; args: Array<{ name: string }> }> } | null;
  };
}

const INTROSPECTION_QUERY = `
  query Introspect {
    __schema {
      queryType { fields { name args { name } } }
      mutationType { fields { name args { name } } }
    }
  }
`;

/** Introspects one endpoint and reduces to a sorted, comparable snapshot. */
export async function snapshotEndpoint(client: GraphQLClient): Promise<EndpointSnapshot> {
  const data = await client.request<IntrospectionResponse>(INTROSPECTION_QUERY);
  return {
    queries: reduceFields(data.__schema.queryType?.fields ?? []),
    mutations: reduceFields(data.__schema.mutationType?.fields ?? []),
  };
}

function reduceFields(fields: Array<{ name: string; args: Array<{ name: string }> }>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const field of fields) {
    out[field.name] = field.args.map((a) => a.name).sort();
  }
  return sortKeys(out);
}

function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  const sorted: Record<string, T> = {};
  for (const key of Object.keys(record).sort()) sorted[key] = record[key]!;
  return sorted;
}

export interface SnapshotDiff {
  /** Resolvers present live but missing from the snapshot (Twenty added new surface). */
  added: string[];
  /** Resolvers in the snapshot but missing live (Twenty removed surface — likely break). */
  removed: string[];
  /** Resolvers where the argument list changed. Entries describe added/removed args. */
  argChanges: Array<{ field: string; added: string[]; removed: string[] }>;
}

/** Compares two snapshots and returns a structural diff. Empty diff = no drift. */
export function diffSnapshots(committed: SchemaSnapshot, live: SchemaSnapshot): SnapshotDiff {
  const diff: SnapshotDiff = { added: [], removed: [], argChanges: [] };
  for (const endpoint of ['core', 'metadata'] as const) {
    for (const kind of ['queries', 'mutations'] as const) {
      const before = committed.endpoints[endpoint][kind];
      const after = live.endpoints[endpoint][kind];
      const beforeNames = new Set(Object.keys(before));
      const afterNames = new Set(Object.keys(after));
      for (const name of afterNames) {
        if (!beforeNames.has(name)) diff.added.push(`${endpoint}.${kind}.${name}`);
      }
      for (const name of beforeNames) {
        if (!afterNames.has(name)) diff.removed.push(`${endpoint}.${kind}.${name}`);
      }
      for (const name of beforeNames) {
        if (!afterNames.has(name)) continue;
        const beforeArgs = new Set(before[name] ?? []);
        const afterArgs = new Set(after[name] ?? []);
        const added: string[] = [];
        const removed: string[] = [];
        for (const a of afterArgs) if (!beforeArgs.has(a)) added.push(a);
        for (const a of beforeArgs) if (!afterArgs.has(a)) removed.push(a);
        if (added.length || removed.length) {
          diff.argChanges.push({ field: `${endpoint}.${kind}.${name}`, added, removed });
        }
      }
    }
  }
  diff.added.sort();
  diff.removed.sort();
  diff.argChanges.sort((a, b) => a.field.localeCompare(b.field));
  return diff;
}

export function hasDrift(diff: SnapshotDiff): boolean {
  return diff.added.length > 0 || diff.removed.length > 0 || diff.argChanges.length > 0;
}

/** Renders a diff as a multi-line message — used by both the test and the script. */
export function formatDiff(diff: SnapshotDiff): string {
  const lines: string[] = [];
  if (diff.added.length) {
    lines.push(`+ ${diff.added.length} new resolver${diff.added.length === 1 ? '' : 's'}:`);
    for (const f of diff.added) lines.push(`    + ${f}`);
  }
  if (diff.removed.length) {
    lines.push(`- ${diff.removed.length} removed resolver${diff.removed.length === 1 ? '' : 's'}:`);
    for (const f of diff.removed) lines.push(`    - ${f}`);
  }
  if (diff.argChanges.length) {
    lines.push(`~ ${diff.argChanges.length} resolver${diff.argChanges.length === 1 ? '' : 's'} with argument changes:`);
    for (const c of diff.argChanges) {
      const parts = [
        ...c.added.map((a) => `+${a}`),
        ...c.removed.map((a) => `-${a}`),
      ];
      lines.push(`    ~ ${c.field} (${parts.join(', ')})`);
    }
  }
  return lines.join('\n');
}
