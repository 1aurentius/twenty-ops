import type { Command } from 'commander';
import { deriveEndpoints } from '../api/endpoints.js';
import { GraphQLClient } from '../api/graphql-client.js';
import { RestClient } from '../api/rest-client.js';
import { resolveRemote, type ResolvedRemote } from '../config/resolve-remote.js';
import type { OutputOpts } from './output.js';

/** Everything a command needs: resolved output options and ready API clients. */
export interface Ctx {
  out: OutputOpts;
  remote: ResolvedRemote;
  /** Core GraphQL API (`/graphql`) — records and workflow lifecycle. */
  core: GraphQLClient;
  /** Metadata GraphQL API (`/metadata`) — views, view widgets, navigation. */
  metadata: GraphQLClient;
  /** REST API (`/rest`) — stable record list/filter reads. */
  rest: RestClient;
}

interface GlobalOpts {
  remote?: string;
  json?: boolean;
  fields?: string;
  quiet?: boolean;
}

/** Builds a command context from the global flags (which may sit on any ancestor). */
export function makeCtx(cmd: Command): Ctx {
  const opts = cmd.optsWithGlobals() as GlobalOpts;
  const remote = resolveRemote(opts.remote);
  const ep = deriveEndpoints(remote.apiUrl);
  return {
    out: { json: opts.json, fields: opts.fields, quiet: opts.quiet },
    remote,
    core: new GraphQLClient(ep.core, remote.apiKey),
    metadata: new GraphQLClient(ep.metadata, remote.apiKey),
    rest: new RestClient(ep.rest, remote.apiKey),
  };
}
