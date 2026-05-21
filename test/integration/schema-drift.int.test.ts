import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { deriveEndpoints } from '../../src/api/endpoints.js';
import { GraphQLClient } from '../../src/api/graphql-client.js';
import { resolveRemote } from '../../src/config/resolve-remote.js';
import {
  diffSnapshots,
  formatDiff,
  hasDrift,
  type SchemaSnapshot,
  snapshotEndpoint,
} from '../../src/lib/introspection.js';
import { INTEGRATION, REMOTE, assertLocalRemote } from '../helpers/integration-setup.js';

/*
 * Schema-drift integration test.
 *
 * Compares the committed test/fixtures/schema.snapshot.json (pinned Twenty
 * surface) against a live introspection of a running local stack. Drift = any
 * resolver added, removed, or with argument changes — that means either:
 *
 *   - Twenty was upgraded and we should investigate before merging, OR
 *   - someone forgot to regenerate the snapshot after a deliberate bump.
 *
 * Either way the next step is `npm run snapshot:schema` followed by deliberate
 * review of the diff. Hard-fails to force that conversation.
 *
 *   TWENTY_INTEGRATION=1 npm run test:integration
 */
const here = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(here, '..', 'fixtures', 'schema.snapshot.json');

describe.skipIf(!INTEGRATION)('schema drift', () => {
  let committed: SchemaSnapshot;
  let core: GraphQLClient;
  let metadata: GraphQLClient;

  beforeAll(() => {
    assertLocalRemote();
    const remote = resolveRemote(REMOTE);
    committed = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as SchemaSnapshot;
    const endpoints = deriveEndpoints(remote.apiUrl);
    core = new GraphQLClient(endpoints.core, remote.apiKey);
    metadata = new GraphQLClient(endpoints.metadata, remote.apiKey);
  });

  it('matches the live Twenty stack', async () => {
    const [coreLive, metadataLive] = await Promise.all([
      snapshotEndpoint(core),
      snapshotEndpoint(metadata),
    ]);
    const live: SchemaSnapshot = {
      generatedAt: new Date().toISOString(),
      endpoints: { core: coreLive, metadata: metadataLive },
    };

    const diff = diffSnapshots(committed, live);
    if (hasDrift(diff)) {
      const message = [
        'Twenty schema drifted from the committed snapshot.',
        'Investigate the change, then if it is intentional regenerate the snapshot:',
        '  npm run snapshot:schema',
        '',
        formatDiff(diff),
      ].join('\n');
      throw new Error(message);
    }
    expect(hasDrift(diff)).toBe(false);
  });
});
