#!/usr/bin/env node
/**
 * Seeds the pinned local Twenty stack and writes a `twenty-ops-test` remote
 * to ~/.twenty/config.json so the integration tests can run with zero manual
 * UI steps.
 *
 * Flow (verified against twentycrm/twenty@sha256:ca7d9ce…):
 *   1. POST signUp(email, password)              → workspace-agnostic access token
 *   2. POST signUpInNewWorkspace                 → loginToken + workspaceId
 *   3. POST getAuthTokensFromLoginToken          → workspace-scoped access token
 *   4. POST activateWorkspace(displayName)       → seeds default roles
 *   5. POST getRoles                             → find Admin role
 *   6. POST createApiKey(name, expiresAt, role)  → ApiKey { id }
 *   7. POST generateApiKeyToken(id, expiresAt)   → bearer token
 *   8. Write remote to ~/.twenty/config.json
 *
 * Idempotency: if a `twenty-ops-test` remote already works (whoami succeeds),
 * exit 0 without re-seeding. To start clean, wipe the stack with
 * `docker compose -f deploy/docker-compose.yml down -v` first.
 *
 *   npm run test:up   # boots the stack + runs this seed
 */
import { URL } from 'node:url';

import { deriveEndpoints } from '../src/api/endpoints.js';
import { CliError, EXIT } from '../src/api/errors.js';
import { GraphQLClient } from '../src/api/graphql-client.js';
import { upsertRemote } from '../src/config/remote-config.js';
import { resolveRemote } from '../src/config/resolve-remote.js';

const REMOTE_NAME = 'twenty-ops-test';
const EMAIL = process.env.TWENTY_OPS_TEST_EMAIL ?? 'cli-test@twenty-ops.local';
const PASSWORD = process.env.TWENTY_OPS_TEST_PASSWORD ?? 'TestPass123!';
const WORKSPACE_NAME = 'twenty-ops-test';
const API_KEY_NAME = 'twenty-ops-test';
const TEST_PORT = process.env.TWENTY_OPS_TEST_PORT ?? '3001';
const API_URL = process.env.TWENTY_OPS_TEST_URL ?? `http://localhost:${TEST_PORT}`;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const FIFTY_YEARS_MS = 50 * 365 * 24 * 60 * 60 * 1000;

function step(msg: string): void {
  process.stdout.write(`  → ${msg}\n`);
}

async function waitForHealthy(baseUrl: string, deadlineMs = 60_000): Promise<void> {
  const url = `${baseUrl}/healthz`;
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new CliError(`stack at ${baseUrl} never became healthy (waited ${deadlineMs}ms)`, EXIT.API);
}

/** Anonymous (no-auth) GraphQL POST — used for signUp + sign-in flow before we have a token. */
async function gqlAnon<T>(endpoint: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) {
    throw new CliError(body.errors.map((e) => e.message).join('; '), EXIT.API);
  }
  if (body.data === undefined) {
    throw new CliError(`empty response from ${endpoint}`, EXIT.API);
  }
  return body.data;
}

async function isAlreadySeeded(): Promise<boolean> {
  try {
    const remote = resolveRemote(REMOTE_NAME);
    const ep = deriveEndpoints(remote.apiUrl);
    const client = new GraphQLClient(ep.metadata, remote.apiKey);
    await client.request<{ currentWorkspace: { id: string } }>(
      `query { currentWorkspace { id } }`,
    );
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const host = new URL(API_URL).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new CliError(`refusing to seed against non-local host "${host}"`, EXIT.USAGE);
  }

  process.stdout.write(`seed: target=${API_URL} email=${EMAIL}\n`);

  step(`waiting for ${API_URL}/healthz`);
  await waitForHealthy(API_URL);

  if (await isAlreadySeeded()) {
    process.stdout.write(`remote=${REMOTE_NAME} already configured and reachable — nothing to do\n`);
    return;
  }

  const ep = deriveEndpoints(API_URL);
  const metadataUrl = ep.metadata;
  const expiresAt = new Date(Date.now() + FIFTY_YEARS_MS).toISOString();

  step('signUp');
  const signUp = await gqlAnon<{
    signUp: { tokens: { accessOrWorkspaceAgnosticToken: { token: string } } };
  }>(
    metadataUrl,
    `mutation($e:String!,$p:String!){
       signUp(email:$e, password:$p, captchaToken:"", locale:"en", verifyEmailRedirectPath:"/") {
         tokens { accessOrWorkspaceAgnosticToken { token } }
       }
     }`,
    { e: EMAIL, p: PASSWORD },
  ).catch((err: unknown) => {
    const msg = (err as Error).message ?? String(err);
    throw new CliError(
      `signUp failed: ${msg}\n  (if the user already exists from a prior run, wipe the stack first:\n   docker compose -f deploy/docker-compose.yml down -v)`,
      EXIT.API,
    );
  });
  const agnosticToken = signUp.signUp.tokens.accessOrWorkspaceAgnosticToken.token;

  step('signUpInNewWorkspace');
  const auth = new GraphQLClient(metadataUrl, agnosticToken);
  const nw = await auth.request<{
    signUpInNewWorkspace: { loginToken: { token: string }; workspace: { id: string } };
  }>(`mutation { signUpInNewWorkspace { loginToken { token } workspace { id } } }`);
  const loginToken = nw.signUpInNewWorkspace.loginToken.token;
  const workspaceId = nw.signUpInNewWorkspace.workspace.id;

  step('getAuthTokensFromLoginToken');
  const tk = await gqlAnon<{
    getAuthTokensFromLoginToken: { tokens: { accessOrWorkspaceAgnosticToken: { token: string } } };
  }>(
    metadataUrl,
    `mutation($lt:String!,$o:String!){
       getAuthTokensFromLoginToken(loginToken:$lt, origin:$o) {
         tokens { accessOrWorkspaceAgnosticToken { token } }
       }
     }`,
    { lt: loginToken, o: API_URL },
  );
  const wsToken = tk.getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken.token;

  step(`activateWorkspace (workspaceId=${workspaceId})`);
  const wsClient = new GraphQLClient(metadataUrl, wsToken);
  await wsClient.request(
    `mutation($n:String!){ activateWorkspace(data:{displayName:$n}) { id activationStatus } }`,
    { n: WORKSPACE_NAME },
  );

  step('getRoles → find Admin');
  const roles = await wsClient.request<{
    getRoles: Array<{ id: string; label: string; canUpdateAllSettings: boolean; canBeAssignedToApiKeys: boolean }>;
  }>(`query { getRoles { id label canUpdateAllSettings canBeAssignedToApiKeys } }`);
  const adminRole = roles.getRoles.find(
    (r) => r.canUpdateAllSettings && r.canBeAssignedToApiKeys,
  );
  if (!adminRole) {
    throw new CliError(
      `no admin role found after activation — workspace bootstrap may be broken\n  available roles: ${roles.getRoles.map((r) => r.label).join(', ')}`,
      EXIT.API,
    );
  }

  step(`createApiKey "${API_KEY_NAME}"`);
  const ak = await wsClient.request<{ createApiKey: { id: string } }>(
    `mutation($i:CreateApiKeyInput!){ createApiKey(input:$i) { id } }`,
    { i: { name: API_KEY_NAME, expiresAt, roleId: adminRole.id } },
  );

  step('generateApiKeyToken');
  // expiresAt is declared String! in the schema's resolver despite DateTime in the type;
  // see the spike notes in the v0.3 plan.
  const tok = await wsClient.request<{ generateApiKeyToken: { token: string } }>(
    `mutation($id:UUID!,$e:String!){ generateApiKeyToken(apiKeyId:$id, expiresAt:$e) { token } }`,
    { id: ak.createApiKey.id, e: expiresAt },
  );

  step(`upsertRemote "${REMOTE_NAME}"`);
  upsertRemote(REMOTE_NAME, API_URL, tok.generateApiKeyToken.token);

  process.stdout.write(
    `done: remote=${REMOTE_NAME} workspaceId=${workspaceId} apiUrl=${API_URL}\n` +
      `verify with:  twenty-ops --remote ${REMOTE_NAME} whoami\n`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`error: ${message}\n`);
  process.exit(err instanceof CliError ? err.exitCode : 1);
});
