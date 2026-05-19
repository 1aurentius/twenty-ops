import type { Command } from 'commander';
import {
  listRemotes,
  removeRemote,
  setDefaultRemote,
  upsertRemote,
} from '../config/remote-config.js';
import { resolveRemote } from '../config/resolve-remote.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

/** `twenty-ops remote …` — manage workspace connections in ~/.twenty/config.json. */
export function registerRemoteCommands(program: Command): void {
  const remote = program
    .command('remote')
    .description('manage Twenty workspace connections (shared with twenty-sdk)');

  remote
    .command('list')
    .description('list configured remotes')
    .action((_opts, cmd: Command) => {
      const out = globalOut(cmd);
      const rows = listRemotes().map((r) => ({
        name: r.name,
        apiUrl: r.apiUrl,
        hasKey: r.hasKey,
        default: r.isDefault,
      }));
      emitList(rows, ['name', 'apiUrl', 'hasKey', 'default'], out);
    });

  remote
    .command('current')
    .description('show the remote that would be used')
    .action((_opts, cmd: Command) => {
      const out = globalOut(cmd);
      const r = resolveRemote(cmd.optsWithGlobals().remote);
      emitOne({ name: r.name, apiUrl: r.apiUrl }, ['name', 'apiUrl'], out);
    });

  remote
    .command('add <name>')
    .description('add or replace a remote')
    .requiredOption('--url <apiUrl>', 'workspace API base URL, e.g. http://localhost:3000')
    .requiredOption('--key <apiKey>', 'API key (Settings > APIs in the Twenty UI)')
    .action((name: string, opts: { url: string; key: string }, cmd: Command) => {
      upsertRemote(name, opts.url, opts.key);
      emitOk(`remote "${name}" saved`, { name, apiUrl: opts.url }, globalOut(cmd));
    });

  remote
    .command('use <name>')
    .description('set the default remote')
    .action((name: string, _opts, cmd: Command) => {
      setDefaultRemote(name);
      emitOk(`default remote is now "${name}"`, { defaultRemote: name }, globalOut(cmd));
    });

  remote
    .command('remove <name>')
    .description('remove a remote')
    .action((name: string, _opts, cmd: Command) => {
      removeRemote(name);
      emitOk(`remote "${name}" removed`, { removed: name }, globalOut(cmd));
    });
}

function globalOut(cmd: Command) {
  const o = cmd.optsWithGlobals() as { json?: boolean; fields?: string; quiet?: boolean };
  return { json: o.json, fields: o.fields, quiet: o.quiet };
}
