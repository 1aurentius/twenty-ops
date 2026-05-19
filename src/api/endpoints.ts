/**
 * Derives Twenty's three API endpoints from a workspace base URL.
 *
 * Verified against a running Twenty stack (v2.x):
 *   - Core GraphQL (records, workflow lifecycle) -> `{base}/graphql`
 *   - Metadata GraphQL (views, fields, navigation) -> `{base}/metadata`
 *   - REST (record reads) -> `{base}/rest`
 *
 * If any of these paths move in a future Twenty release, this is the single
 * place to change.
 */
export interface Endpoints {
  base: string;
  core: string;
  metadata: string;
  rest: string;
}

export function deriveEndpoints(apiUrl: string): Endpoints {
  const base = apiUrl.replace(/\/+$/, '');
  return {
    base,
    core: `${base}/graphql`,
    metadata: `${base}/metadata`,
    rest: `${base}/rest`,
  };
}
