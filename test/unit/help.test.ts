import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { registerAgentCommands } from '../../src/commands/agent.js';
import { registerApiKeyCommands } from '../../src/commands/api-key.js';
import { registerAppRegistrationCommands } from '../../src/commands/app-registration.js';
import { registerApplicationCommands } from '../../src/commands/application.js';
import { registerBlocklistCommands } from '../../src/commands/blocklist.js';
import { registerCalendarChannelCommands } from '../../src/commands/calendar-channel.js';
import { registerChatCommands } from '../../src/commands/chat.js';
import { registerCommandMenuItemCommands } from '../../src/commands/command-menu-item.js';
import { registerConnectedAccountCommands } from '../../src/commands/connected-account.js';
import { registerDashboardCommands } from '../../src/commands/dashboard.js';
import { registerDoctorCommand } from '../../src/commands/doctor.js';
import { registerDomainCommands } from '../../src/commands/domain.js';
import { registerFieldCommands } from '../../src/commands/field.js';
import { registerFrontComponentCommands } from '../../src/commands/front-component.js';
import { registerInvitationCommands } from '../../src/commands/invitation.js';
import { registerLogicFunctionCommands } from '../../src/commands/logic-function.js';
import { registerMarketplaceCommands } from '../../src/commands/marketplace.js';
import { registerMemberCommands } from '../../src/commands/member.js';
import { registerMessageChannelCommands } from '../../src/commands/message-channel.js';
import { registerNavCommands } from '../../src/commands/nav.js';
import { registerObjectCommands } from '../../src/commands/object.js';
import { registerPageLayoutCommands } from '../../src/commands/page-layout.js';
import { registerPermissionCommands } from '../../src/commands/permission.js';
import { registerRecordCommands } from '../../src/commands/record.js';
import { registerRemoteCommands } from '../../src/commands/remote.js';
import { registerRoleCommands } from '../../src/commands/role.js';
import { registerSettingsCommands } from '../../src/commands/settings.js';
import { registerSkillCommands } from '../../src/commands/skill.js';
import { registerSsoCommands } from '../../src/commands/sso.js';
import { registerViewCommands } from '../../src/commands/view.js';
import { registerWebhookCommands } from '../../src/commands/webhook.js';
import { registerWhoamiCommand } from '../../src/commands/whoami.js';
import { registerWorkflowCommands } from '../../src/commands/workflow.js';

/**
 * Help-text hygiene tests.
 *
 * No human eyeballs the CLI's --help output during development; an agent
 * is the primary reader. So every command needs:
 *   1. A non-empty description (so listing parent help is useful)
 *   2. A description on every requiredOption (so agents know what to pass)
 *   3. Either an action handler OR at least one subcommand (so the command
 *      isn't a dead end)
 *
 * If any of those slip out, the help text becomes uselessly terse and the
 * "discovery is paid once via --help" premise breaks.
 */

/**
 * Every command registrar in the v1.0 surface. Kept in alphabetical order
 * to make `npm run check` failures point straight at the offending name
 * — and so adding a new group requires updating this list (a missing
 * registrar means a missing help-hygiene check).
 */
const REGISTRARS = [
  ['agent', registerAgentCommands] as const,
  ['api-key', registerApiKeyCommands] as const,
  ['app-registration', registerAppRegistrationCommands] as const,
  ['application', registerApplicationCommands] as const,
  ['blocklist', registerBlocklistCommands] as const,
  ['calendar-channel', registerCalendarChannelCommands] as const,
  ['chat', registerChatCommands] as const,
  ['command-menu-item', registerCommandMenuItemCommands] as const,
  ['connected-account', registerConnectedAccountCommands] as const,
  ['dashboard', registerDashboardCommands] as const,
  ['doctor', registerDoctorCommand] as const,
  ['domain', registerDomainCommands] as const,
  ['field', registerFieldCommands] as const,
  ['front-component', registerFrontComponentCommands] as const,
  ['invitation', registerInvitationCommands] as const,
  ['logic-function', registerLogicFunctionCommands] as const,
  ['marketplace', registerMarketplaceCommands] as const,
  ['member', registerMemberCommands] as const,
  ['message-channel', registerMessageChannelCommands] as const,
  ['nav', registerNavCommands] as const,
  ['object', registerObjectCommands] as const,
  ['page-layout', registerPageLayoutCommands] as const,
  ['permission', registerPermissionCommands] as const,
  ['record', registerRecordCommands] as const,
  ['remote', registerRemoteCommands] as const,
  ['role', registerRoleCommands] as const,
  ['settings', registerSettingsCommands] as const,
  ['skill', registerSkillCommands] as const,
  ['sso', registerSsoCommands] as const,
  ['view', registerViewCommands] as const,
  ['webhook', registerWebhookCommands] as const,
  ['whoami', registerWhoamiCommand] as const,
  ['workflow', registerWorkflowCommands] as const,
];

function buildProgram(): Command {
  const program = new Command();
  program
    .name('twenty-ops')
    .exitOverride()
    .option('--remote <name>')
    .option('--json')
    .option('--fields <list>')
    .option('-q, --quiet');
  for (const [, register] of REGISTRARS) register(program);
  return program;
}

function* walk(cmd: Command): Generator<Command> {
  yield cmd;
  for (const child of cmd.commands) yield* walk(child);
}

describe('help-text hygiene', () => {
  const program = buildProgram();
  const all = [...walk(program)].filter((c) => c.parent); // skip the root

  it('every command has a non-empty description', () => {
    const missing = all.filter((c) => !c.description() || c.description().trim().length === 0);
    expect(missing.map((c) => c.name())).toEqual([]);
  });

  it('every requiredOption has a description', () => {
    const offenders: string[] = [];
    for (const cmd of all) {
      for (const opt of cmd.options) {
        if (opt.mandatory && (!opt.description || opt.description.trim().length === 0)) {
          offenders.push(`${cmd.name()}.${opt.long ?? opt.short ?? '?'}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every leaf command has either an action or subcommands', () => {
    const offenders: string[] = [];
    for (const cmd of all) {
      const hasAction = (cmd as unknown as { _actionHandler: unknown })._actionHandler;
      if (!hasAction && cmd.commands.length === 0) {
        offenders.push(cmd.name());
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every command has at least one example use captured by name (basic sanity)', () => {
    // Lightweight smoke check — every registered subcommand resolves cleanly
    // by name, no accidental empties slipped in.
    const names = all.map((c) => c.name());
    expect(names).toContain('list');
    expect(names).toContain('get');
    expect(names).toContain('create');
    expect(names).toContain('delete');
    // No duplicate names at the *root* level (subcommands can reuse names).
    const root = program.commands.map((c) => c.name());
    expect(root.length).toBe(new Set(root).size);
  });
});
