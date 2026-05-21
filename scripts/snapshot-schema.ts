#!/usr/bin/env node
/**
 * Generates `test/fixtures/schema.snapshot.json` against a live Twenty stack.
 *
 * Run when intentionally bumping Twenty (changed the pinned digest in
 * deploy/docker-compose.yml). The committed snapshot is the source of truth
 * for `npm run test:drift` — any drift between this file and what's running
 * means Twenty's surface changed and the integration tests will fail until
 * the snapshot is regenerated and re-reviewed.
 *
 *   TWENTY_OPS_TEST_REMOTE=twenty-ops-test npm run snapshot:schema
 *
 * Refuses to run against non-local hosts.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveEndpoints } from '../src/api/endpoints.js';
import { CliError, EXIT } from '../src/api/errors.js';
import { GraphQLClient } from '../src/api/graphql-client.js';
import { resolveRemote } from '../src/config/resolve-remote.js';
import { type SchemaSnapshot, snapshotEndpoint } from '../src/lib/introspection.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

async function main(): Promise<void> {
  const remoteName = process.env.TWENTY_OPS_TEST_REMOTE ?? process.env.TWENTY_REMOTE;
  const remote = resolveRemote(remoteName);
  const host = new URL(remote.apiUrl).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new CliError(
      `refusing to snapshot against non-local host "${host}" (remote=${remote.name})`,
      EXIT.USAGE,
    );
  }

  const endpoints = deriveEndpoints(remote.apiUrl);
  const core = new GraphQLClient(endpoints.core, remote.apiKey);
  const metadata = new GraphQLClient(endpoints.metadata, remote.apiKey);

  const [coreSnap, metadataSnap] = await Promise.all([
    snapshotEndpoint(core),
    snapshotEndpoint(metadata),
  ]);

  const snapshot: SchemaSnapshot = {
    generatedAt: new Date().toISOString(),
    endpoints: { core: coreSnap, metadata: metadataSnap },
  };

  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(here, '..', 'test', 'fixtures', 'schema.snapshot.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);

  const totals = (s: typeof coreSnap): number => Object.keys(s.queries).length + Object.keys(s.mutations).length;
  process.stdout.write(
    `snapshot=${out}\nremote=${remote.name}\ncore=${totals(coreSnap)} resolvers\nmetadata=${totals(metadataSnap)} resolvers\n`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`error: ${message}\n`);
  process.exit(err instanceof CliError ? err.exitCode : 1);
});
