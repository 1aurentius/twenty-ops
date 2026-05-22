import type { Command } from 'commander';
import { CliError, EXIT, type ExitCode } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { diffSnapshots, formatDiff, hasDrift, snapshotEndpoint, type SchemaSnapshot } from '../lib/introspection.js';
import { resolveObjectId } from '../lib/objects.js';
import { emitOk } from '../lib/output.js';

/**
 * `twenty-ops doctor` — self-check that exercises the configured remote end-to-end.
 *
 * Each step is a small, side-effect-light probe. The first failing step short-circuits
 * the run; later steps are reported as SKIP. With `--json`, a final object summarises
 * each step plus the overall verdict so an agent can branch without parsing prose.
 *
 * The records step is conditional on `--objects-list`: until Step 5 ships a `record`
 * command surface, doctor uses `--objects-list` as a near-equivalent probe (it lists
 * standard + custom objects via the metadata API, proving the workspace is reachable
 * and the API key has read scope).
 */
export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('run a self-check against the configured remote (remote + auth + schema + view round-trip)')
    .option('--objects-list', 'also probe object metadata listing (proxy for the records check)', false)
    .action(async (opts: { objectsList?: boolean }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const runner = new StepRunner(ctx);

      await runner.run('remote', 'remote resolves', async () =>
        `using "${ctx.remote.name}" → ${ctx.remote.apiUrl}`,
      );

      await runner.run('whoami', 'whoami returns a workspace', async () => {
        const data = await ctx.metadata.request<{
          currentWorkspace: { id: string; displayName: string | null; activationStatus: string | null };
        }>(`query { currentWorkspace { id displayName activationStatus } }`);
        const w = data.currentWorkspace;
        return `workspace ${w.id} "${w.displayName ?? ''}" (${w.activationStatus ?? 'unknown'})`;
      });

      await runner.run('schema-drift', 'live schema matches the committed snapshot', async () => {
        const committed = await loadSnapshot();
        const live: SchemaSnapshot = {
          generatedAt: new Date().toISOString(),
          endpoints: {
            core: await snapshotEndpoint(ctx.core),
            metadata: await snapshotEndpoint(ctx.metadata),
          },
        };
        const diff = diffSnapshots(committed, live);
        if (hasDrift(diff)) {
          throw new CliError(
            `schema has drifted from the committed snapshot:\n${indent(formatDiff(diff))}`,
            EXIT.API,
          );
        }
        return 'no drift';
      });

      await runner.run('view-round-trip', 'create-read-delete a throwaway view on `person`', async () => {
        const personId = await resolveObjectId(ctx.metadata, 'person');
        const name = `twenty-ops-doctor-${Date.now()}`;
        // visibility=WORKSPACE — an API key isn't tied to a user, so it can't own
        // UNLISTED (personal) views. Twenty rejects that combination with
        // "You do not have permission to create workspace-level views"
        // (the message is misleading; it actually refers to UNLISTED).
        const created = await ctx.metadata.request<{ createView: { id: string } }>(
          `mutation($input: CreateViewInput!) { createView(input: $input) { id } }`,
          {
            input: { name, objectMetadataId: personId, icon: 'IconLayoutList', type: 'TABLE', visibility: 'WORKSPACE' },
          },
        );
        const viewId = created.createView.id;
        try {
          const got = await ctx.metadata.request<{ getView: { id: string } | null }>(
            `query($id: String!) { getView(id: $id) { id } }`,
            { id: viewId },
          );
          if (got.getView?.id !== viewId) {
            throw new CliError(`view round-trip mismatch (got ${JSON.stringify(got.getView)})`, EXIT.API);
          }
          return `view ${viewId} round-tripped`;
        } finally {
          await ctx.metadata
            .request(`mutation($id: String!) { deleteView(id: $id) }`, { id: viewId })
            .catch(() => { /* best-effort cleanup; the create succeeded so the test passed */ });
        }
      });

      if (opts.objectsList) {
        await runner.run('objects-list', 'list objects via metadata API', async () => {
          const data = await ctx.metadata.request<{ objects: { edges: { node: { id: string } }[] } }>(
            `query { objects(paging:{first:1}, filter:{}) { edges { node { id } } } }`,
          );
          const n = data.objects.edges.length;
          return `${n} object${n === 1 ? '' : 's'} reachable`;
        });
      }

      runner.finish();
    });
}

interface StepResult {
  key: string;
  description: string;
  status: 'ok' | 'fail' | 'skip';
  detail?: string;
}

/**
 * Runs each probe in order. The first failure flips the runner into "skip remaining"
 * mode so we still emit a complete report instead of crashing mid-list.
 */
class StepRunner {
  private readonly results: StepResult[] = [];
  private firstFail: { exitCode: ExitCode; description: string; detail: string } | undefined;

  constructor(private readonly ctx: Ctx) {}

  async run(key: string, description: string, probe: () => Promise<string>): Promise<void> {
    if (this.firstFail) {
      const result: StepResult = { key, description, status: 'skip' };
      this.results.push(result);
      this.write(result);
      return;
    }
    try {
      const detail = await probe();
      const result: StepResult = { key, description, status: 'ok', detail };
      this.results.push(result);
      this.write(result);
    } catch (err) {
      const exitCode = err instanceof CliError ? err.exitCode : EXIT.GENERIC;
      const detail = (err as Error).message;
      const result: StepResult = { key, description, status: 'fail', detail };
      this.results.push(result);
      this.write(result);
      this.firstFail = { exitCode, description, detail };
    }
  }

  finish(): void {
    if (this.ctx.out.json) {
      const summary = {
        ok: !this.firstFail,
        remote: this.ctx.remote.name,
        apiUrl: this.ctx.remote.apiUrl,
        steps: this.results,
      };
      process.stdout.write(`${JSON.stringify(summary)}\n`);
    } else {
      const verdict = this.firstFail ? 'doctor: FAILED' : 'doctor: OK';
      emitOk(verdict, { ok: !this.firstFail }, this.ctx.out);
    }
    if (this.firstFail) {
      throw new CliError(`doctor: ${this.firstFail.description} failed`, this.firstFail.exitCode);
    }
  }

  private write(result: StepResult): void {
    if (this.ctx.out.json) return; // JSON output is emitted once in finish()
    if (this.ctx.out.quiet && result.status === 'ok') return;
    const marker = result.status === 'ok' ? 'OK  ' : result.status === 'fail' ? 'FAIL' : 'SKIP';
    const suffix = result.detail ? ` — ${result.detail.split('\n')[0]}` : '';
    process.stdout.write(`[${marker}] ${result.description}${suffix}\n`);
    if (result.status === 'fail' && result.detail?.includes('\n')) {
      const rest = result.detail.split('\n').slice(1).join('\n');
      if (rest) process.stdout.write(`${rest}\n`);
    }
  }
}

async function loadSnapshot(): Promise<SchemaSnapshot> {
  // Resolve the committed snapshot relative to this file so the path survives
  // whether we're running from src/ (tsx/vitest) or dist/ (built bundle).
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../test/fixtures/schema.snapshot.json'),
    resolve(here, '../test/fixtures/schema.snapshot.json'),
  ];
  for (const candidate of candidates) {
    try {
      const text = await readFile(candidate, 'utf8');
      return JSON.parse(text) as SchemaSnapshot;
    } catch {
      /* try next candidate */
    }
  }
  throw new CliError(
    `cannot locate schema.snapshot.json (looked in ${candidates.join(', ')})`,
    EXIT.GENERIC,
  );
}

function indent(s: string, by = '    '): string {
  return s.split('\n').map((line) => `${by}${line}`).join('\n');
}
