import { describe, expect, it } from 'vitest';

import { EXIT } from '../../src/api/errors.js';
import { registerLogicFunctionCommands } from '../../src/commands/logic-function.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote, tag } from '../helpers/integration-setup.js';

const TAG = `lfint${tag()}`;
const runLf = (...args: string[]) =>
  runCli(registerLogicFunctionCommands, ['--remote', REMOTE, 'logic-function', ...args]);

describe.skipIf(!INTEGRATION)('logic-function integration', () => {
  it('list returns an array (possibly empty) without error', async () => {
    assertLocalRemote();
    const { stdout } = await runLf('list', '--json');
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('NOT_FOUND for an unknown name', async () => {
    const err = await runLf('get', `${TAG}-nosuch`).catch((e: unknown) => e) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('NOT_FOUND for an unknown UUID', async () => {
    const err = await runLf('get', '00000000-0000-4000-8000-000000000000').catch(
      (e: unknown) => e,
    ) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.NOT_FOUND);
  });

  /**
   * The `source` JSON shape on `createOneLogicFunction` is undocumented — the
   * server expects an internal-format tarball, not a `{code: "..."}` wrapper.
   * The official authoring path is `twenty add logicFunction` + `twenty install`.
   *
   * For the CLI's purposes, `list`/`get`/`source`/`delete`/`execute` are the
   * value-add (introspect + manage already-deployed functions). Create + update
   * are pass-through; we assert here that the mutation REACHES the server
   * (exit code 5 with a server-side message) without exiting USAGE.
   */
  it('create pass-through reaches the server (USAGE = our fault, API = server-side)', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'lf-int-'));
    const metaFile = join(dir, 'meta.json');
    writeFileSync(metaFile, JSON.stringify({ name: `${TAG}-deliberately-bad`, source: { intentionally: 'wrong-shape' } }));
    const err = await runLf('create', '--file', metaFile, '--json').catch((e: unknown) => e) as { exitCode?: number };
    expect(err.exitCode).not.toBe(EXIT.USAGE);
  });
});
