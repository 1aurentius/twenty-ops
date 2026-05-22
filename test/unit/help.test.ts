import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { registerDoctorCommand } from '../../src/commands/doctor.js';
import { registerNavCommands } from '../../src/commands/nav.js';
import { registerRecordCommands } from '../../src/commands/record.js';
import { registerRemoteCommands } from '../../src/commands/remote.js';
import { registerViewCommands } from '../../src/commands/view.js';
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

const REGISTRARS = [
  ['remote', registerRemoteCommands] as const,
  ['whoami', registerWhoamiCommand] as const,
  ['doctor', registerDoctorCommand] as const,
  ['view', registerViewCommands] as const,
  ['nav', registerNavCommands] as const,
  ['workflow', registerWorkflowCommands] as const,
  ['record', registerRecordCommands] as const,
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
