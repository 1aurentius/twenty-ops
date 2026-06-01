import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { SSO_PROVIDER_SUMMARY } from '../lib/gql.js';
import { loadInputFile } from '../lib/input-file.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

/**
 * `twenty-ops sso …` — manage workspace SSO identity providers.
 *
 * Verified shapes (live probe, twenty-ops-test stack):
 *   createOIDCIdentityProvider(input: SetupOIDCSsoInput!) → SetupSso!
 *     { name!, issuer!, clientID!, clientSecret! }
 *   createSAMLIdentityProvider(input: SetupSAMLSsoInput!) → SetupSso!
 *     { name!, issuer!, id(UUID!), ssoURL!, certificate!, fingerprint? }
 *   editSSOIdentityProvider(input: EditSsoInput!) → EditSso!
 *     { id!, status: SSOIdentityProviderStatus! }
 *     (status: Active | Inactive | Error — toggling is the only edit op)
 *   deleteSSOIdentityProvider(input: DeleteSsoInput!) → DeleteSso!
 *     { identityProviderId! }    (note: distinct arg name)
 *   getSSOIdentityProviders → [SSOIdentityProvider!]
 *
 * `getSSOIdentityProviders` is server-side gated for some actor types
 * — observed exit 5 on the seeded stack with "Cannot read properties of
 * undefined (reading 'headers')". Documented as a server-side quirk;
 * the list command surfaces the gate verbatim.
 *
 * IdentityProviderType enum: OIDC | SAML.
 */
export function registerSsoCommands(program: Command): void {
  const sso = program.command('sso').description('manage SSO identity providers (OIDC + SAML)');

  sso.command('list')
    .description('list configured SSO identity providers')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ getSSOIdentityProviders: SSOProvider[] }>(
        `query { getSSOIdentityProviders { ${SSO_PROVIDER_SUMMARY} } }`,
      );
      emitList(data.getSSOIdentityProviders, ssoColumns(ctx), ctx.out);
    });

  sso.command('create-oidc')
    .description('create an OIDC identity provider')
    .requiredOption('--file <path>', 'SetupOIDCSsoInput { name, issuer, clientID, clientSecret }')
    .action(async (opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const input = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(input) || typeof input !== 'object' || input === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      for (const required of ['name', 'issuer', 'clientID', 'clientSecret']) {
        if (typeof input[required] !== 'string') {
          throw new CliError(`${opts.file} is missing required field "${required}"`, EXIT.USAGE);
        }
      }
      const data = await ctx.metadata.request<{ createOIDCIdentityProvider: SSOProvider }>(
        `mutation Create($input: SetupOIDCSsoInput!) {
           createOIDCIdentityProvider(input: $input) { ${SSO_PROVIDER_SUMMARY} }
         }`,
        { input },
      );
      emitOk(
        `created OIDC provider ${data.createOIDCIdentityProvider.id} (${data.createOIDCIdentityProvider.name})`,
        data.createOIDCIdentityProvider as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  sso.command('create-saml')
    .description('create a SAML identity provider')
    .requiredOption('--file <path>', 'SetupSAMLSsoInput { name, issuer, id, ssoURL, certificate, fingerprint? }')
    .action(async (opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const input = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(input) || typeof input !== 'object' || input === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      for (const required of ['name', 'issuer', 'id', 'ssoURL', 'certificate']) {
        if (typeof input[required] !== 'string') {
          throw new CliError(`${opts.file} is missing required field "${required}"`, EXIT.USAGE);
        }
      }
      const data = await ctx.metadata.request<{ createSAMLIdentityProvider: SSOProvider }>(
        `mutation Create($input: SetupSAMLSsoInput!) {
           createSAMLIdentityProvider(input: $input) { ${SSO_PROVIDER_SUMMARY} }
         }`,
        { input },
      );
      emitOk(
        `created SAML provider ${data.createSAMLIdentityProvider.id} (${data.createSAMLIdentityProvider.name})`,
        data.createSAMLIdentityProvider as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  sso.command('set-status <id>')
    .description("set an SSO provider's status (Active | Inactive | Error)")
    .requiredOption('--status <s>', 'Active | Inactive | Error')
    .action(async (id: string, opts: { status: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const allowed = ['Active', 'Inactive', 'Error'];
      const status = opts.status;
      if (!allowed.includes(status)) {
        throw new CliError(`--status must be one of ${allowed.join(', ')} (got "${status}")`, EXIT.USAGE);
      }
      const data = await ctx.metadata.request<{ editSSOIdentityProvider: SSOProvider }>(
        `mutation Edit($input: EditSsoInput!) {
           editSSOIdentityProvider(input: $input) { ${SSO_PROVIDER_SUMMARY} }
         }`,
        { input: { id, status } },
      );
      emitOk(
        `set SSO provider ${id} status=${status}`,
        data.editSSOIdentityProvider as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  sso.command('delete <id>')
    .description('delete an SSO identity provider')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.metadata.request(
        `mutation Delete($input: DeleteSsoInput!) {
           deleteSSOIdentityProvider(input: $input) { identityProviderId }
         }`,
        { input: { identityProviderId: id } },
      );
      emitOk(`deleted SSO provider ${id}`, { deleted: id }, ctx.out);
    });
}

interface SSOProvider {
  id: string;
  name: string;
  type: string;
  status: string;
  issuer: string;
}

function ssoColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'name', 'type', 'status', 'issuer'];
}
