import { Command, CommanderError } from 'commander';
import { CliError, EXIT } from './api/errors.js';
import { registerApiKeyCommands } from './commands/api-key.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerFieldCommands } from './commands/field.js';
import { registerMemberCommands } from './commands/member.js';
import { registerNavCommands } from './commands/nav.js';
import { registerObjectCommands } from './commands/object.js';
import { registerRecordCommands } from './commands/record.js';
import { registerRemoteCommands } from './commands/remote.js';
import { registerRoleCommands } from './commands/role.js';
import { registerSettingsCommands } from './commands/settings.js';
import { registerViewCommands } from './commands/view.js';
import { registerWebhookCommands } from './commands/webhook.js';
import { registerWhoamiCommand } from './commands/whoami.js';
import { registerWorkflowCommands } from './commands/workflow.js';

const program = new Command();

program
  .name('twenty-ops')
  .description('Token-efficient CLI for managing a live Twenty CRM workspace.')
  .version('0.4.0')
  .showHelpAfterError('(run with --help for usage)')
  // Global flags — available on every subcommand via optsWithGlobals().
  .option('--remote <name>', 'workspace remote to use (default: config defaultRemote)')
  .option('--json', 'machine output: JSON object, or JSON Lines for lists')
  .option('--fields <list>', 'comma-separated fields to project (e.g. id,name)')
  .option('-q, --quiet', 'suppress success/info lines on stderr');

registerRemoteCommands(program);
registerWhoamiCommand(program);
registerDoctorCommand(program);
registerViewCommands(program);
registerNavCommands(program);
registerWorkflowCommands(program);
registerRecordCommands(program);
registerObjectCommands(program);
registerFieldCommands(program);
registerApiKeyCommands(program);
registerWebhookCommands(program);
registerSettingsCommands(program);
registerRoleCommands(program);
registerMemberCommands(program);

// Throw CommanderError instead of calling process.exit, so we control exit codes.
program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (err) {
  if (err instanceof CommanderError) {
    // Help / version output is a normal, successful exit.
    const ok = err.exitCode === 0 || err.code.startsWith('commander.help');
    process.exitCode = ok ? EXIT.OK : EXIT.USAGE;
  } else if (err instanceof CliError) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exitCode = err.exitCode;
  } else {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    if (process.env.TWENTY_DEBUG === '1') console.error(err);
    process.exitCode = EXIT.GENERIC;
  }
}
