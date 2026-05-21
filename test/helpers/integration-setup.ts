import { URL } from 'node:url';

import { deriveEndpoints } from '../../src/api/endpoints.js';
import { GraphQLClient } from '../../src/api/graphql-client.js';
import { resolveRemote } from '../../src/config/resolve-remote.js';
import { listObjects, resolveObjectId } from '../../src/lib/objects.js';

/**
 * Common preamble for integration tests. Default remote is `twenty-ops-test`
 * — the workspace seeded by `npm run test:up`. Override with
 * `TWENTY_OPS_TEST_REMOTE` if you need to point at a different local stack.
 *
 * All integration test files import this and call `assertLocalRemote()` once
 * in beforeAll() so a misconfigured remote can never accidentally hit Cloud.
 */
export const INTEGRATION = process.env.TWENTY_INTEGRATION === '1';
export const REMOTE = process.env.TWENTY_OPS_TEST_REMOTE ?? 'twenty-ops-test';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function assertLocalRemote(): void {
  const r = resolveRemote(REMOTE);
  const host = new URL(r.apiUrl).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `refusing to run integration tests against non-local host "${host}" (remote=${r.name})`,
    );
  }
}

/** A short, unique tag for fixture names. */
export const tag = (): string => `t${Date.now()}${Math.floor(Math.random() * 1000)}`;

/** A metadata GraphQL client bound to the resolved remote, for fixture setup. */
export function metadataClient(): GraphQLClient {
  const r = resolveRemote(REMOTE);
  return new GraphQLClient(deriveEndpoints(r.apiUrl).metadata, r.apiKey);
}

/** Resolve an object's metadata id by `nameSingular`/`namePlural`. */
export async function objectId(name: string): Promise<string> {
  return resolveObjectId(metadataClient(), name);
}

/** Pick a stable field id on an object (used to construct view set-fields fixtures). */
export async function firstFieldId(objectName: string, preferred: string): Promise<string> {
  const client = metadataClient();
  const objectMetadataId = await resolveObjectId(client, objectName);
  const data = await client.request<{
    fields: { edges: { node: { id: string; name: string } }[] };
  }>(
    `query($id:UUID!){
       fields(filter:{objectMetadataId:{eq:$id}}, paging:{first:100}) {
         edges { node { id name } }
       }
     }`,
    { id: objectMetadataId },
  );
  const fields = data.fields.edges.map((e) => e.node);
  const match = fields.find((f) => f.name === preferred) ?? fields[0];
  if (!match) throw new Error(`no fields found on object "${objectName}"`);
  return match.id;
}

export { listObjects };
