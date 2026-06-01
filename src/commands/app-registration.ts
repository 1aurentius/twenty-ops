import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import {
  APPLICATION_REGISTRATION_SUMMARY,
  APPLICATION_REGISTRATION_VARIABLE_SUMMARY,
} from '../lib/gql.js';
import { loadInputFile } from '../lib/input-file.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

/**
 * `twenty-ops app-registration …` — manage installable application registrations.
 *
 * Verified shapes (live probe):
 *   createApplicationRegistration(input) → { applicationRegistration, clientSecret }
 *     input { name!, universalIdentifier?, oAuthRedirectUris?, oAuthScopes? }
 *   updateApplicationRegistration(input { id!, update: { name?, oAuthRedirectUris?, oAuthScopes?, isListed? } })
 *   deleteApplicationRegistration(id) → Boolean
 *   rotateApplicationRegistrationClientSecret(id) → { clientSecret }
 *   transferApplicationRegistrationOwnership(applicationRegistrationId, targetWorkspaceSubdomain)
 *
 *   Variables (per-registration config slots):
 *     createApplicationRegistrationVariable(input { applicationRegistrationId!, key!, value!, description?, isSecret? })
 *     updateApplicationRegistrationVariable(input { id!, update: { value?, resetValue?, description? } })
 *     deleteApplicationRegistrationVariable(id)
 *     findApplicationRegistrationVariables(applicationRegistrationId)
 *
 *   Discovery:
 *     findManyApplicationRegistrations
 *     findOneApplicationRegistration(id)
 *     findApplicationRegistrationByClientId(clientId)
 *     findApplicationRegistrationByUniversalIdentifier(universalIdentifier)
 *     findApplicationRegistrationStats(id) → { activeInstalls, mostInstalledVersion, versionDistribution }
 *     applicationRegistrationTarballUrl(id) → String
 */
export function registerAppRegistrationCommands(program: Command): void {
  const ar = program.command('app-registration').description('manage installable application registrations');

  ar.command('list')
    .description('list every application registration visible to the actor')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ findManyApplicationRegistrations: AppReg[] }>(
        `query { findManyApplicationRegistrations { ${APPLICATION_REGISTRATION_SUMMARY} } }`,
      );
      emitList(data.findManyApplicationRegistrations, arColumns(ctx), ctx.out);
    });

  ar.command('get <id>')
    .description('show one application registration')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ findOneApplicationRegistration: AppReg | null }>(
        `query F($id: String!) { findOneApplicationRegistration(id: $id) { ${APPLICATION_REGISTRATION_SUMMARY} } }`,
        { id },
      );
      if (!data.findOneApplicationRegistration) {
        throw new CliError(`application registration "${id}" not found`, EXIT.NOT_FOUND);
      }
      emitOne(data.findOneApplicationRegistration as unknown as Record<string, unknown>, arColumns(ctx), ctx.out);
    });

  ar.command('find-by-client-id <clientId>')
    .description('look up by OAuth clientId — returns the PublicApplicationRegistration projection')
    .action(async (clientId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      // findApplicationRegistrationByClientId returns a narrower
      // PublicApplicationRegistration type (no oAuth* internals; just the
      // public-facing { id, name, logoUrl, websiteUrl, oAuthScopes }).
      const data = await ctx.metadata.request<{ findApplicationRegistrationByClientId: PublicAppReg | null }>(
        `query F($clientId: String!) {
           findApplicationRegistrationByClientId(clientId: $clientId) {
             id name logoUrl websiteUrl oAuthScopes
           }
         }`,
        { clientId },
      );
      if (!data.findApplicationRegistrationByClientId) {
        throw new CliError(`no app-registration with clientId "${clientId}"`, EXIT.NOT_FOUND);
      }
      emitOne(
        data.findApplicationRegistrationByClientId as unknown as Record<string, unknown>,
        ctx.out.json ? [] : ['id', 'name', 'logoUrl', 'websiteUrl', 'oAuthScopes'],
        ctx.out,
      );
    });

  ar.command('find-by-identifier <universalIdentifier>')
    .description('look up by universalIdentifier')
    .action(async (universalIdentifier: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ findApplicationRegistrationByUniversalIdentifier: AppReg | null }>(
        `query F($universalIdentifier: String!) {
           findApplicationRegistrationByUniversalIdentifier(universalIdentifier: $universalIdentifier) { ${APPLICATION_REGISTRATION_SUMMARY} }
         }`,
        { universalIdentifier },
      );
      if (!data.findApplicationRegistrationByUniversalIdentifier) {
        throw new CliError(`no app-registration with identifier "${universalIdentifier}"`, EXIT.NOT_FOUND);
      }
      emitOne(data.findApplicationRegistrationByUniversalIdentifier as unknown as Record<string, unknown>, arColumns(ctx), ctx.out);
    });

  ar.command('create')
    .description('create an application registration; prints the initial clientSecret (store it now)')
    .requiredOption('--file <path>', 'CreateApplicationRegistrationInput { name, universalIdentifier?, oAuthRedirectUris?, oAuthScopes? }')
    .action(async (opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const input = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(input) || typeof input !== 'object' || input === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      if (typeof input.name !== 'string') {
        throw new CliError(`${opts.file} is missing required field "name"`, EXIT.USAGE);
      }
      const data = await ctx.metadata.request<{
        createApplicationRegistration: { applicationRegistration: AppReg; clientSecret: string };
      }>(
        `mutation Create($input: CreateApplicationRegistrationInput!) {
           createApplicationRegistration(input: $input) {
             applicationRegistration { ${APPLICATION_REGISTRATION_SUMMARY} }
             clientSecret
           }
         }`,
        { input },
      );
      const { applicationRegistration, clientSecret } = data.createApplicationRegistration;
      emitOk(
        `created app-registration ${applicationRegistration.id} — clientSecret: ${clientSecret} (store it now)`,
        { applicationRegistration, clientSecret },
        ctx.out,
      );
    });

  ar.command('update <id>')
    .description('update an application registration (name/redirects/scopes/isListed)')
    .requiredOption('--file <path>', 'partial UpdateApplicationRegistrationPayload { name?, oAuthRedirectUris?, oAuthScopes?, isListed? }')
    .action(async (id: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const update = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(update) || typeof update !== 'object' || update === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const data = await ctx.metadata.request<{ updateApplicationRegistration: AppReg }>(
        `mutation Update($input: UpdateApplicationRegistrationInput!) {
           updateApplicationRegistration(input: $input) { ${APPLICATION_REGISTRATION_SUMMARY} }
         }`,
        { input: { id, update } },
      );
      emitOk(
        `updated app-registration ${id}`,
        data.updateApplicationRegistration as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  ar.command('delete <id>')
    .description('delete an application registration')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.metadata.request(
        `mutation Delete($id: String!) { deleteApplicationRegistration(id: $id) }`,
        { id },
      );
      emitOk(`deleted app-registration ${id}`, { deleted: id }, ctx.out);
    });

  ar.command('rotate-secret <id>')
    .description('rotate the OAuth client secret; prints the new secret (store it now)')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ rotateApplicationRegistrationClientSecret: { clientSecret: string } }>(
        `mutation Rotate($id: String!) {
           rotateApplicationRegistrationClientSecret(id: $id) { clientSecret }
         }`,
        { id },
      );
      const { clientSecret } = data.rotateApplicationRegistrationClientSecret;
      emitOk(`rotated app-registration ${id} — clientSecret: ${clientSecret}`, { id, clientSecret }, ctx.out);
    });

  ar.command('transfer-ownership <id>')
    .description('transfer ownership to another workspace by subdomain')
    .requiredOption('--target-subdomain <subdomain>', 'target workspace subdomain')
    .action(async (id: string, opts: { targetSubdomain: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ transferApplicationRegistrationOwnership: AppReg }>(
        `mutation Transfer($applicationRegistrationId: String!, $targetWorkspaceSubdomain: String!) {
           transferApplicationRegistrationOwnership(
             applicationRegistrationId: $applicationRegistrationId,
             targetWorkspaceSubdomain: $targetWorkspaceSubdomain
           ) { ${APPLICATION_REGISTRATION_SUMMARY} }
         }`,
        { applicationRegistrationId: id, targetWorkspaceSubdomain: opts.targetSubdomain },
      );
      emitOk(
        `transferred app-registration ${id} → ${opts.targetSubdomain}`,
        data.transferApplicationRegistrationOwnership as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  ar.command('tarball-url <id>')
    .description('get the npm tarball URL for the registered application')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ applicationRegistrationTarballUrl: string }>(
        `query T($id: String!) { applicationRegistrationTarballUrl(id: $id) }`,
        { id },
      );
      emitOne({ id, tarballUrl: data.applicationRegistrationTarballUrl }, ['id', 'tarballUrl'], ctx.out);
    });

  ar.command('stats <id>')
    .description('install stats for an application registration')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{
        findApplicationRegistrationStats: {
          activeInstalls: number;
          mostInstalledVersion: string | null;
          versionDistribution: unknown[];
        };
      }>(
        `query S($id: String!) {
           findApplicationRegistrationStats(id: $id) {
             activeInstalls mostInstalledVersion versionDistribution
           }
         }`,
        { id },
      );
      emitOne(
        data.findApplicationRegistrationStats as unknown as Record<string, unknown>,
        ['activeInstalls', 'mostInstalledVersion', 'versionDistribution'],
        ctx.out,
      );
    });

  registerVariables(ar);
}

function registerVariables(ar: Command): void {
  const v = ar.command('variable').description('manage application registration variables (config slots)');

  v.command('list <applicationRegistrationId>')
    .description('list variables for an application registration')
    .action(async (applicationRegistrationId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ findApplicationRegistrationVariables: AppRegVariable[] }>(
        `query V($applicationRegistrationId: String!) {
           findApplicationRegistrationVariables(applicationRegistrationId: $applicationRegistrationId) {
             ${APPLICATION_REGISTRATION_VARIABLE_SUMMARY}
           }
         }`,
        { applicationRegistrationId },
      );
      emitList(data.findApplicationRegistrationVariables, varColumns(ctx), ctx.out);
    });

  v.command('create')
    .description('create a variable on an application registration')
    .requiredOption('--app-registration <id>', 'parent applicationRegistrationId')
    .requiredOption('--key <key>', 'variable key')
    .requiredOption('--value <value>', 'variable value (secret if --secret)')
    .option('--description <text>', 'variable description')
    .option('--secret', 'mark the variable as secret', false)
    .action(async (
      opts: { appRegistration: string; key: string; value: string; description?: string; secret?: boolean },
      cmd: Command,
    ) => {
      const ctx = makeCtx(cmd);
      const input = {
        applicationRegistrationId: opts.appRegistration,
        key: opts.key,
        value: opts.value,
        description: opts.description,
        isSecret: opts.secret ?? false,
      };
      const data = await ctx.metadata.request<{ createApplicationRegistrationVariable: AppRegVariable }>(
        `mutation Create($input: CreateApplicationRegistrationVariableInput!) {
           createApplicationRegistrationVariable(input: $input) { ${APPLICATION_REGISTRATION_VARIABLE_SUMMARY} }
         }`,
        { input },
      );
      emitOk(
        `created variable ${data.createApplicationRegistrationVariable.id} (${opts.key})`,
        data.createApplicationRegistrationVariable as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  v.command('update <id>')
    .description('update a variable value, description, or clear the stored value')
    .option('--value <value>', 'new value')
    .option('--description <text>', 'new description')
    .option('--reset', 'clear the stored value (mark as unfilled)', false)
    .action(async (
      id: string,
      opts: { value?: string; description?: string; reset?: boolean },
      cmd: Command,
    ) => {
      const ctx = makeCtx(cmd);
      const update: Record<string, unknown> = {};
      if (opts.value !== undefined) update.value = opts.value;
      if (opts.description !== undefined) update.description = opts.description;
      if (opts.reset) update.resetValue = true;
      if (Object.keys(update).length === 0) {
        throw new CliError('nothing to update — pass --value, --description, or --reset', EXIT.USAGE);
      }
      const data = await ctx.metadata.request<{ updateApplicationRegistrationVariable: AppRegVariable }>(
        `mutation Update($input: UpdateApplicationRegistrationVariableInput!) {
           updateApplicationRegistrationVariable(input: $input) { ${APPLICATION_REGISTRATION_VARIABLE_SUMMARY} }
         }`,
        { input: { id, update } },
      );
      emitOk(
        `updated variable ${id}`,
        data.updateApplicationRegistrationVariable as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  v.command('delete <id>')
    .description('delete a variable')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.metadata.request(
        `mutation Delete($id: String!) { deleteApplicationRegistrationVariable(id: $id) }`,
        { id },
      );
      emitOk(`deleted variable ${id}`, { deleted: id }, ctx.out);
    });
}

interface PublicAppReg {
  id: string;
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  oAuthScopes: string[];
}

interface AppReg {
  id: string;
  name: string;
  universalIdentifier: string;
  oAuthClientId: string;
  oAuthRedirectUris: string[];
  oAuthScopes: string[];
  ownerWorkspaceId: string | null;
  sourceType: string;
  sourcePackage: string | null;
  latestAvailableVersion: string | null;
  isListed: boolean;
  isFeatured: boolean;
  isPreInstalled: boolean;
  isConfigured: boolean;
  logoUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AppRegVariable {
  id: string;
  key: string;
  description: string;
  isSecret: boolean;
  isRequired: boolean;
  isFilled: boolean;
  createdAt: string;
  updatedAt: string;
}

function arColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'name', 'universalIdentifier', 'sourceType', 'isListed', 'isConfigured'];
}

function varColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'key', 'isSecret', 'isRequired', 'isFilled', 'description'];
}
