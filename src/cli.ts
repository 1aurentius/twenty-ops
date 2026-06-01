import { Command, CommanderError } from 'commander';
import { CliError, EXIT } from './api/errors.js';
import { registerAgentCommands } from './commands/agent.js';
import { registerApiKeyCommands } from './commands/api-key.js';
import { registerAppRegistrationCommands } from './commands/app-registration.js';
import { registerApplicationCommands } from './commands/application.js';
import { registerBlocklistCommands } from './commands/blocklist.js';
import { registerCalendarChannelCommands } from './commands/calendar-channel.js';
import { registerChatCommands } from './commands/chat.js';
import { registerConnectedAccountCommands } from './commands/connected-account.js';
import { registerMessageChannelCommands } from './commands/message-channel.js';
import { registerDashboardCommands } from './commands/dashboard.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerDomainCommands } from './commands/domain.js';
import { registerFieldCommands } from './commands/field.js';
import { registerInvitationCommands } from './commands/invitation.js';
import { registerLogicFunctionCommands } from './commands/logic-function.js';
import { registerMarketplaceCommands } from './commands/marketplace.js';
import { registerMemberCommands } from './commands/member.js';
import { registerNavCommands } from './commands/nav.js';
import { registerObjectCommands } from './commands/object.js';
import { registerPageLayoutCommands } from './commands/page-layout.js';
import { registerPermissionCommands } from './commands/permission.js';
import { registerRecordCommands } from './commands/record.js';
import { registerRemoteCommands } from './commands/remote.js';
import { registerRoleCommands } from './commands/role.js';
import { registerSettingsCommands } from './commands/settings.js';
import { registerSkillCommands } from './commands/skill.js';
import { registerSsoCommands } from './commands/sso.js';
import { registerViewCommands } from './commands/view.js';
import { registerWebhookCommands } from './commands/webhook.js';
import { registerWhoamiCommand } from './commands/whoami.js';
import { registerWorkflowCommands } from './commands/workflow.js';

const program = new Command();

program
  .name('twenty-ops')
  .description('Token-efficient CLI for managing a live Twenty CRM workspace.')
  .version('0.9.0')
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
registerInvitationCommands(program);
registerPermissionCommands(program);
registerLogicFunctionCommands(program);
registerPageLayoutCommands(program);
registerDashboardCommands(program);
registerSkillCommands(program);
registerAgentCommands(program);
registerChatCommands(program);
registerConnectedAccountCommands(program);
registerMessageChannelCommands(program);
registerCalendarChannelCommands(program);
registerBlocklistCommands(program);
registerSsoCommands(program);
registerDomainCommands(program);
registerAppRegistrationCommands(program);
registerApplicationCommands(program);
registerMarketplaceCommands(program);

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
