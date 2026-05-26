import { Command } from 'commander';
import { vi } from 'vitest';

export interface RunResult {
  stdout: string;
  stderr: string;
}

/**
 * Runs a `registerXxxCommand` function against a fresh commander program
 * configured with the same global flags as the production CLI, then parses
 * `args` and captures stdout/stderr.
 *
 * Errors from action handlers propagate as a rejection — tests inspect
 * `error.exitCode` for the contract assertion.
 */
export async function runCli(
  register: (program: Command) => void,
  args: string[],
): Promise<RunResult> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const spyOut = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  const spyErr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  try {
    const program = new Command();
    program
      .exitOverride()
      .option('--remote <name>')
      .option('--json')
      .option('--fields <list>')
      .option('-q, --quiet');
    register(program);
    await program.parseAsync(['node', 'cli', ...args]);
  } catch (err) {
    // Attach the in-process stdout/stderr to the thrown error so tests can
    // assert against writes that happened before the action threw. Without
    // this, stderr written immediately before a CliError is lost.
    const e = err as { stdout?: string; stderr?: string };
    e.stdout = stdoutChunks.join('');
    e.stderr = stderrChunks.join('');
    throw err;
  } finally {
    spyOut.mockRestore();
    spyErr.mockRestore();
  }
  return { stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
}
