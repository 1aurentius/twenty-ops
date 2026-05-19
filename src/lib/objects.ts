import { CliError, EXIT } from '../api/errors.js';
import type { GraphQLClient } from '../api/graphql-client.js';
import { isUuid } from './gql.js';

interface ObjectNode {
  id: string;
  nameSingular: string;
  namePlural: string;
  labelSingular: string;
  isActive: boolean;
}

interface ObjectsResult {
  objects: { edges: { node: ObjectNode }[] };
}

const OBJECTS_QUERY = `
  query Objects($paging: CursorPaging!, $filter: ObjectFilter!) {
    objects(paging: $paging, filter: $filter) {
      edges { node { id nameSingular namePlural labelSingular isActive } }
    }
  }
`;

/** Lists every object in the workspace (used by `view list` discovery). */
export async function listObjects(metadata: GraphQLClient): Promise<ObjectNode[]> {
  const data = await metadata.request<ObjectsResult>(OBJECTS_QUERY, {
    paging: { first: 1000 },
    filter: {},
  });
  return data.objects.edges.map((e) => e.node);
}

/**
 * Resolves `--object` (which accepts either an objectMetadataId or an object's
 * `nameSingular`/`namePlural`) to an objectMetadataId.
 */
export async function resolveObjectId(metadata: GraphQLClient, ref: string): Promise<string> {
  if (isUuid(ref)) return ref;
  const objects = await listObjects(metadata);
  const match = objects.find((o) => o.nameSingular === ref || o.namePlural === ref);
  if (!match) {
    throw new CliError(
      `object "${ref}" not found — pass an objectMetadataId or a valid object name`,
      EXIT.NOT_FOUND,
    );
  }
  return match.id;
}
