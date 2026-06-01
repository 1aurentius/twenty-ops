import type { Command } from 'commander';
import { makeCtx } from '../lib/context.js';
import { emitOk } from '../lib/output.js';

/**
 * `twenty-ops marketplace …` — install Twenty marketplace apps + refresh the catalog.
 *
 * Verified shapes (live probe):
 *   installMarketplaceApp(universalIdentifier, version?) → Boolean
 *   syncMarketplaceCatalog() → Boolean
 *
 * Single-purpose group with two operations. The catalog itself is browsable
 * through Twenty's marketplace UI; once a partner has chosen an app, the
 * CLI installs it programmatically by universalIdentifier.
 */
export function registerMarketplaceCommands(program: Command): void {
  const mp = program.command('marketplace').description('install marketplace apps + refresh the catalog');

  mp.command('install <universalIdentifier>')
    .description('install a marketplace app by universalIdentifier')
    .option('--version <v>', 'specific version (defaults to latest)')
    .action(async (universalIdentifier: string, opts: { version?: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ installMarketplaceApp: boolean }>(
        `mutation Install($universalIdentifier: String!, $version: String) {
           installMarketplaceApp(universalIdentifier: $universalIdentifier, version: $version)
         }`,
        { universalIdentifier, version: opts.version },
      );
      emitOk(
        `installed marketplace app ${universalIdentifier}${opts.version ? `@${opts.version}` : ''}`,
        { installed: universalIdentifier, version: opts.version ?? null, success: data.installMarketplaceApp },
        ctx.out,
      );
    });

  mp.command('sync-catalog')
    .description('refresh the workspace\'s view of the marketplace catalog')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ syncMarketplaceCatalog: boolean }>(
        `mutation { syncMarketplaceCatalog }`,
      );
      emitOk('synced marketplace catalog', { success: data.syncMarketplaceCatalog }, ctx.out);
    });
}
