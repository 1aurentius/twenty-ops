import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { APPLICATION_SUMMARY } from '../lib/gql.js';
import { loadInputFile } from '../lib/input-file.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

/**
 * `twenty-ops application …` — manage installed applications.
 *
 * Verified shapes (live probe):
 *   findManyApplications → [Application!]!
 *   findOneApplication(id?, universalIdentifier?) → Application
 *   createDevelopmentApplication(universalIdentifier, name) → DevelopmentApplication
 *   installApplication(appRegistrationId, version?) → Boolean
 *   uninstallApplication(universalIdentifier) → Boolean
 *   upgradeApplication(appRegistrationId, targetVersion) → Boolean
 *   syncApplication(manifest: JSON!) → WorkspaceMigration { applicationUniversalIdentifier, actions(JSON) }
 *   generateApplicationToken(applicationId: UUID!) → ApplicationTokenPair
 *   renewApplicationToken(applicationRefreshToken) → ApplicationTokenPair
 *   updateOneApplicationVariable(key, value, applicationId) → Boolean
 *   applicationConnectionProviders(applicationId) → ... (provider list)
 *
 * `Application` exposes nested `agents`, `frontComponents`, `commandMenuItems`,
 * `logicFunctions`, `objects`, `applicationVariables`, `applicationRegistration`.
 * The default selection in APPLICATION_SUMMARY surfaces only the scalar/identity
 * fields; pass `--fields` to drill deeper.
 */
export function registerApplicationCommands(program: Command): void {
  const app = program.command('application').description('manage installed applications');

  app.command('list')
    .description('list every application installed in the workspace')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ findManyApplications: Application[] }>(
        `query { findManyApplications { ${APPLICATION_SUMMARY} } }`,
      );
      emitList(data.findManyApplications, appColumns(ctx), ctx.out);
    });

  app.command('get')
    .description('show one application — pass --id OR --identifier')
    .option('--id <id>', 'application UUID')
    .option('--identifier <universalIdentifier>', 'universalIdentifier')
    .action(async (opts: { id?: string; identifier?: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      if (!opts.id && !opts.identifier) {
        throw new CliError('pass --id or --identifier', EXIT.USAGE);
      }
      // The resolver declares both args as UUID even though
      // universalIdentifier is conventionally a string slug like "my-app";
      // Twenty's schema is permissive here so passing a slug as UUID works.
      const data = await ctx.metadata.request<{ findOneApplication: Application | null }>(
        `query F($id: UUID, $universalIdentifier: UUID) {
           findOneApplication(id: $id, universalIdentifier: $universalIdentifier) { ${APPLICATION_SUMMARY} }
         }`,
        { id: opts.id, universalIdentifier: opts.identifier },
      );
      if (!data.findOneApplication) {
        throw new CliError(`application not found`, EXIT.NOT_FOUND);
      }
      emitOne(data.findOneApplication as unknown as Record<string, unknown>, appColumns(ctx), ctx.out);
    });

  app.command('create-dev')
    .description('create a development application (local source)')
    .requiredOption('--identifier <universalIdentifier>', 'unique universalIdentifier')
    .requiredOption('--name <name>', 'application name')
    .action(async (opts: { identifier: string; name: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ createDevelopmentApplication: { id: string; universalIdentifier: string } }>(
        `mutation Create($universalIdentifier: String!, $name: String!) {
           createDevelopmentApplication(universalIdentifier: $universalIdentifier, name: $name) {
             id universalIdentifier
           }
         }`,
        { universalIdentifier: opts.identifier, name: opts.name },
      );
      emitOk(
        `created dev application ${data.createDevelopmentApplication.id} (${opts.identifier})`,
        data.createDevelopmentApplication as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  app.command('install')
    .description('install an application from its registration')
    .requiredOption('--app-registration <id>', 'appRegistrationId to install')
    .option('--version <v>', 'specific version (defaults to latest)')
    .action(async (opts: { appRegistration: string; version?: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ installApplication: boolean }>(
        `mutation Install($appRegistrationId: String!, $version: String) {
           installApplication(appRegistrationId: $appRegistrationId, version: $version)
         }`,
        { appRegistrationId: opts.appRegistration, version: opts.version },
      );
      emitOk(
        `installed application from registration ${opts.appRegistration}${opts.version ? `@${opts.version}` : ''}`,
        { installed: opts.appRegistration, version: opts.version ?? null, success: data.installApplication },
        ctx.out,
      );
    });

  app.command('uninstall <universalIdentifier>')
    .description('uninstall an application by universalIdentifier')
    .action(async (universalIdentifier: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ uninstallApplication: boolean }>(
        `mutation Uninstall($universalIdentifier: String!) {
           uninstallApplication(universalIdentifier: $universalIdentifier)
         }`,
        { universalIdentifier },
      );
      emitOk(
        `uninstalled application ${universalIdentifier}`,
        { uninstalled: universalIdentifier, success: data.uninstallApplication },
        ctx.out,
      );
    });

  app.command('upgrade')
    .description('upgrade an installed application to a target version')
    .requiredOption('--app-registration <id>', 'appRegistrationId to upgrade')
    .requiredOption('--target-version <v>', 'target version (e.g. 1.3.0)')
    .action(async (opts: { appRegistration: string; targetVersion: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ upgradeApplication: boolean }>(
        `mutation Upgrade($appRegistrationId: String!, $targetVersion: String!) {
           upgradeApplication(appRegistrationId: $appRegistrationId, targetVersion: $targetVersion)
         }`,
        { appRegistrationId: opts.appRegistration, targetVersion: opts.targetVersion },
      );
      emitOk(
        `upgraded application ${opts.appRegistration} → ${opts.targetVersion}`,
        { upgraded: opts.appRegistration, targetVersion: opts.targetVersion, success: data.upgradeApplication },
        ctx.out,
      );
    });

  app.command('sync')
    .description('sync an application from its manifest (returns the workspace migration)')
    .requiredOption('--file <path>', 'manifest JSON to sync')
    .action(async (opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const manifest = loadInputFile<unknown>(opts.file);
      const data = await ctx.metadata.request<{
        syncApplication: { applicationUniversalIdentifier: string; actions: unknown };
      }>(
        `mutation Sync($manifest: JSON!) {
           syncApplication(manifest: $manifest) {
             applicationUniversalIdentifier actions
           }
         }`,
        { manifest },
      );
      emitOne(
        data.syncApplication as unknown as Record<string, unknown>,
        ['applicationUniversalIdentifier', 'actions'],
        ctx.out,
      );
    });

  app.command('generate-token <applicationId>')
    .description('generate an application token pair (access + refresh)')
    .action(async (applicationId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ generateApplicationToken: TokenPair }>(
        `mutation Gen($applicationId: UUID!) {
           generateApplicationToken(applicationId: $applicationId) {
             applicationAccessToken { token expiresAt }
             applicationRefreshToken { token expiresAt }
           }
         }`,
        { applicationId },
      );
      emitOne(
        data.generateApplicationToken as unknown as Record<string, unknown>,
        ['applicationAccessToken', 'applicationRefreshToken'],
        ctx.out,
      );
    });

  app.command('renew-token')
    .description('renew an application token pair from a refresh token')
    .requiredOption('--refresh-token <token>', 'application refresh token')
    .action(async (opts: { refreshToken: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ renewApplicationToken: TokenPair }>(
        `mutation Renew($applicationRefreshToken: String!) {
           renewApplicationToken(applicationRefreshToken: $applicationRefreshToken) {
             applicationAccessToken { token expiresAt }
             applicationRefreshToken { token expiresAt }
           }
         }`,
        { applicationRefreshToken: opts.refreshToken },
      );
      emitOne(
        data.renewApplicationToken as unknown as Record<string, unknown>,
        ['applicationAccessToken', 'applicationRefreshToken'],
        ctx.out,
      );
    });

  app.command('set-variable')
    .description('set an application variable (key/value)')
    .requiredOption('--application <id>', 'applicationId')
    .requiredOption('--key <key>', 'variable key')
    .requiredOption('--value <value>', 'variable value')
    .action(async (opts: { application: string; key: string; value: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.metadata.request<{ updateOneApplicationVariable: boolean }>(
        `mutation V($applicationId: UUID!, $key: String!, $value: String!) {
           updateOneApplicationVariable(applicationId: $applicationId, key: $key, value: $value)
         }`,
        { applicationId: opts.application, key: opts.key, value: opts.value },
      );
      emitOk(
        `set application ${opts.application} variable ${opts.key}`,
        { applicationId: opts.application, key: opts.key },
        ctx.out,
      );
    });

  app.command('connection-providers <applicationId>')
    .description('list connection providers available to an application')
    .action(async (applicationId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      // Return shape is undocumented; emit as opaque rows. Agents that need
      // specific fields can override via --fields once they probe the shape.
      const data = await ctx.metadata.request<{ applicationConnectionProviders: Record<string, unknown>[] }>(
        `query C($applicationId: String!) {
           applicationConnectionProviders(applicationId: $applicationId) { id name }
         }`,
        { applicationId },
      );
      emitList(data.applicationConnectionProviders ?? [], ['id', 'name'], ctx.out);
    });
}

interface Application {
  id: string;
  name: string;
  description: string | null;
  version: string | null;
  universalIdentifier: string;
  packageJsonChecksum: string | null;
  yarnLockChecksum: string | null;
  applicationRegistrationId: string | null;
  canBeUninstalled: boolean;
  defaultRoleId: string | null;
  settingsCustomTabFrontComponentId: string | null;
  logo: string | null;
}

interface TokenPair {
  applicationAccessToken: { token: string; expiresAt: string };
  applicationRefreshToken: { token: string; expiresAt: string };
}

function appColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'name', 'version', 'universalIdentifier', 'canBeUninstalled'];
}
