import { Command, CommanderError } from 'commander';
import { describe, expect, it } from 'vitest';

import { registerViewCommands } from '../../src/commands/view.js';

/**
 * Regression test for a real bug found in QA: `program.exitOverride()` only
 * configures the root command. When a deep subcommand
 * (e.g. `view create --object …`) is missing a `requiredOption`, commander's
 * internal `_exit()` runs on the SUBCOMMAND — which without its own override
 * calls `process.exit(1)` instead of throwing. That made the CLI exit with
 * rc=1 (GENERIC) for missing-flag errors that should be rc=2 (USAGE).
 *
 * Fix: cli.ts walks the command tree and applies `exitOverride()` to every
 * command. This test pins the invariant: parseAsync must THROW a
 * CommanderError on a missing requiredOption nested two levels deep, never
 * call process.exit.
 */
function buildTreeWithExitOverride(): Command {
  const program = new Command();
  program
    .name('twenty-ops')
    .option('--remote <name>')
    .option('--json');
  registerViewCommands(program);

  // Same recursive override the production cli.ts applies.
  function applyExitOverride(cmd: Command): void {
    cmd.exitOverride();
    for (const child of cmd.commands) applyExitOverride(child);
  }
  applyExitOverride(program);
  return program;
}

describe('exit override propagates to subcommands', () => {
  it('missing requiredOption on a subcommand THROWS CommanderError (never process.exit)', async () => {
    const program = buildTreeWithExitOverride();
    // `view create` requires --object and --name; pass neither.
    const err = await program
      .parseAsync(['node', 'cli', 'view', 'create'])
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CommanderError);
    const ce = err as CommanderError;
    expect(ce.code).toBe('commander.missingMandatoryOptionValue');
    // The CommanderError carries exitCode=1 (commander's default), but the
    // cli.ts catch block remaps that to EXIT.USAGE (=2) — what matters here
    // is that the error reached our catch block, not silently exited.
    expect(ce.exitCode).toBe(1);
  });

  it('unknown subcommand THROWS CommanderError (caught by cli.ts handler)', async () => {
    const program = buildTreeWithExitOverride();
    const err = await program
      .parseAsync(['node', 'cli', 'view', 'no-such-subcommand'])
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CommanderError);
    expect((err as CommanderError).code).toBe('commander.unknownCommand');
  });
});
