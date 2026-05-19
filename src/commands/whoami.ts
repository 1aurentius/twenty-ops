import type { Command } from 'commander';
import { makeCtx } from '../lib/context.js';
import { emitOne } from '../lib/output.js';

interface WhoamiResult {
  currentWorkspace: { id: string; displayName: string | null; activationStatus: string | null };
}

/** `twenty-ops whoami` — verifies the resolved remote and its API key work. */
export function registerWhoamiCommand(program: Command): void {
  program
    .command('whoami')
    .description('show the connected workspace (verifies remote + API key)')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      // `currentWorkspace` is served by the metadata API.
      const data = await ctx.metadata.request<WhoamiResult>(
        `query { currentWorkspace { id displayName activationStatus } }`,
      );
      const w = data.currentWorkspace;
      emitOne(
        {
          remote: ctx.remote.name,
          apiUrl: ctx.remote.apiUrl,
          workspaceId: w.id,
          workspace: w.displayName,
          activationStatus: w.activationStatus,
        },
        ['remote', 'apiUrl', 'workspaceId', 'workspace', 'activationStatus'],
        ctx.out,
      );
    });
}
