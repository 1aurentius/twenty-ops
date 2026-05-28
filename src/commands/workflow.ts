import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx } from '../lib/context.js';
import { loadInputFile } from '../lib/input-file.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

/*
 * Workflows live on the Core GraphQL API (`/graphql`) as records:
 *   workflow  ->  versioned workflowVersion records (trigger + steps JSON)
 *             ->  workflowRun records (execution history)
 *
 * Verified API behaviour on Twenty v2.x (twentycrm/twenty:latest):
 *   - `createWorkflow` is allowed and auto-creates an empty v1 DRAFT version.
 *   - `createWorkflowVersion` is forbidden ("Method not allowed").
 *   - `updateWorkflowVersion` (DRAFT versions only) accepts `name` and
 *     `trigger`, but rejects `steps` ("use createWorkflowVersionStep…") and
 *     `status` ("Cannot update workflow version status manually").
 *   - No `createWorkflowVersionStep` / activate / run resolvers are exposed.
 *
 * So v1 covers: workflow record CRUD, draft `trigger` editing, and full
 * inspection of versions and runs. Step authoring and activation require
 * Twenty resolvers this build does not expose — a later phase, once the CLI
 * targets a Twenty version that ships them.
 */

interface Workflow {
  id: string;
  name: string | null;
  statuses: unknown;
  lastPublishedVersionId: string | null;
}
interface WorkflowVersion {
  id: string;
  name: string | null;
  status: string;
  workflowId: string;
  trigger: unknown;
  steps: unknown;
}
interface WorkflowRun {
  id: string;
  name: string | null;
  status: string;
  workflowId: string;
  workflowVersionId: string;
  startedAt: string | null;
  endedAt: string | null;
}
interface Connection<T> {
  edges: { node: T }[];
}
/** A `set-trigger` input file: either a bare trigger object, or `{name?,trigger}`. */
interface TriggerFile {
  name?: string;
  trigger?: unknown;
  [key: string]: unknown;
}

const WORKFLOW = `id name statuses lastPublishedVersionId`;
const VERSION = `id name status workflowId trigger steps`;
const RUN = `id name status workflowId workflowVersionId enqueuedAt startedAt endedAt`;
const AUTOMATED_TRIGGER = `id workflowId type settings createdAt updatedAt`;

interface WorkflowAutomatedTrigger {
  id: string;
  workflowId: string;
  type: string;
  settings: unknown;
  createdAt: string;
  updatedAt: string;
}

/** `twenty-ops workflow …` — manage workflows via the Core API. */
export function registerWorkflowCommands(program: Command): void {
  const wf = program.command('workflow').description('manage workflows, versions and runs');

  wf
    .command('list')
    .description('list workflows')
    .option('--limit <n>', 'max rows', Number, 50)
    .action(async (opts: { limit: number }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{ workflows: Connection<Workflow> }>(
        `query Workflows($first: Int) { workflows(first: $first) { edges { node { ${WORKFLOW} } } } }`,
        { first: opts.limit },
      );
      emitList(
        data.workflows.edges.map((e) => e.node),
        ['id', 'name', 'statuses', 'lastPublishedVersionId'],
        ctx.out,
      );
    });

  wf
    .command('get <workflowId>')
    .description('show a workflow with its versions and recent runs')
    .action(async (workflowId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{
        workflow: (Workflow & { versions: Connection<WorkflowVersion>; runs: Connection<WorkflowRun> }) | null;
      }>(
        `query Workflow($id: UUID!) {
           workflow(filter: { id: { eq: $id } }) {
             ${WORKFLOW}
             versions { edges { node { id name status } } }
             runs(first: 10) { edges { node { id status startedAt endedAt } } }
           }
         }`,
        { id: workflowId },
      );
      if (!data.workflow) throw new CliError(`workflow "${workflowId}" not found`, EXIT.NOT_FOUND);
      const w = data.workflow;
      emitOne(
        {
          id: w.id,
          name: w.name,
          statuses: w.statuses,
          lastPublishedVersionId: w.lastPublishedVersionId,
          versions: w.versions.edges.map((e) => e.node),
          runs: w.runs.edges.map((e) => e.node),
        },
        ['id', 'name', 'statuses', 'lastPublishedVersionId', 'versions', 'runs'],
        ctx.out,
      );
    });

  wf
    .command('create')
    .description('create a workflow (Twenty auto-creates its DRAFT version)')
    .requiredOption('--name <name>', 'workflow name')
    .action(async (opts: { name: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const created = await ctx.core.request<{ createWorkflow: Workflow }>(
        `mutation Create($data: WorkflowCreateInput!) {
           createWorkflow(data: $data) { ${WORKFLOW} }
         }`,
        { data: { name: opts.name } },
      );
      const workflowId = created.createWorkflow.id;

      // Twenty creates the v1 DRAFT version itself — locate it for the caller.
      const versions = await ctx.core.request<{ workflowVersions: Connection<WorkflowVersion> }>(
        `query Draft($id: UUID!) {
           workflowVersions(filter: { workflowId: { eq: $id } }, first: 1) {
             edges { node { ${VERSION} } }
           }
         }`,
        { id: workflowId },
      );
      const draftId = versions.workflowVersions.edges[0]?.node.id ?? null;
      emitOk(
        `created workflow ${workflowId}${draftId ? ` (draft version ${draftId})` : ''}`,
        { workflowId, versionId: draftId, name: opts.name },
        ctx.out,
      );
    });

  wf
    .command('update <workflowId>')
    .description('rename a workflow')
    .requiredOption('--name <name>', 'new workflow name')
    .action(async (workflowId: string, opts: { name: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{ updateWorkflow: Workflow }>(
        `mutation Update($id: UUID!, $data: WorkflowUpdateInput!) {
           updateWorkflow(id: $id, data: $data) { ${WORKFLOW} }
         }`,
        { id: workflowId, data: { name: opts.name } },
      );
      emitOk(`updated workflow ${workflowId}`, data.updateWorkflow, ctx.out);
    });

  wf
    .command('delete <workflowId>')
    .description('delete a workflow')
    .action(async (workflowId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.core.request(
        `mutation Delete($id: UUID!) { deleteWorkflow(id: $id) { id } }`,
        { id: workflowId },
      );
      emitOk(`deleted workflow ${workflowId}`, { deleted: workflowId }, ctx.out);
    });

  wf
    .command('versions <workflowId>')
    .description('list a workflow\'s versions')
    .action(async (workflowId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{ workflowVersions: Connection<WorkflowVersion> }>(
        `query Versions($id: UUID!) {
           workflowVersions(filter: { workflowId: { eq: $id } }, first: 100) {
             edges { node { id name status workflowId } }
           }
         }`,
        { id: workflowId },
      );
      emitList(
        data.workflowVersions.edges.map((e) => e.node),
        ['id', 'name', 'status', 'workflowId'],
        ctx.out,
      );
    });

  const version = wf.command('version').description('inspect a single workflow version');
  version
    .command('get <versionId>')
    .description('show a version including its trigger and steps')
    .action(async (versionId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{ workflowVersion: WorkflowVersion | null }>(
        `query Version($id: UUID!) {
           workflowVersion(filter: { id: { eq: $id } }) { ${VERSION} }
         }`,
        { id: versionId },
      );
      if (!data.workflowVersion) {
        throw new CliError(`workflow version "${versionId}" not found`, EXIT.NOT_FOUND);
      }
      emitOne(
        data.workflowVersion,
        ['id', 'name', 'status', 'workflowId', 'trigger', 'steps'],
        ctx.out,
      );
    });

  wf
    .command('set-trigger <versionId>')
    .description('set a DRAFT version\'s trigger from a JSON/YAML file (- for stdin)')
    .requiredOption('--file <path>', 'a trigger object, or {name?,trigger}')
    .action(async (versionId: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const loaded = loadInputFile<TriggerFile>(opts.file);
      // Accept either a bare trigger object or a wrapper with name/trigger keys.
      const trigger = loaded.trigger !== undefined ? loaded.trigger : loaded;
      const data: Record<string, unknown> = { trigger };
      if (typeof loaded.name === 'string' && loaded.trigger !== undefined) {
        data.name = loaded.name;
      }

      const res = await ctx.core.request<{ updateWorkflowVersion: WorkflowVersion }>(
        `mutation SetTrigger($id: UUID!, $data: WorkflowVersionUpdateInput!) {
           updateWorkflowVersion(id: $id, data: $data) { ${VERSION} }
         }`,
        { id: versionId, data },
      );
      emitOk(`updated trigger of version ${versionId}`, res.updateWorkflowVersion, ctx.out);
    });

  wf
    .command('runs <workflowId>')
    .description('list a workflow\'s runs')
    .option('--status <status>', 'filter by run status (e.g. COMPLETED, FAILED)')
    .option('--limit <n>', 'max rows', Number, 25)
    .action(
      async (workflowId: string, opts: { status?: string; limit: number }, cmd: Command) => {
        const ctx = makeCtx(cmd);
        const filter: Record<string, unknown> = { workflowId: { eq: workflowId } };
        if (opts.status) filter.status = { eq: opts.status.toUpperCase() };
        const data = await ctx.core.request<{ workflowRuns: Connection<WorkflowRun> }>(
          `query Runs($filter: WorkflowRunFilterInput, $first: Int) {
             workflowRuns(filter: $filter, first: $first) { edges { node { ${RUN} } } }
           }`,
          { filter, first: opts.limit },
        );
        emitList(
          data.workflowRuns.edges.map((e) => e.node),
          ['id', 'status', 'workflowVersionId', 'startedAt', 'endedAt'],
          ctx.out,
        );
      },
    );

  const run = wf.command('run').description('inspect a single workflow run');
  run
    .command('get <runId>')
    .description('show a run including its per-step state')
    .action(async (runId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{
        workflowRun: (WorkflowRun & { state: unknown }) | null;
      }>(
        `query Run($id: UUID!) {
           workflowRun(filter: { id: { eq: $id } }) { ${RUN} state }
         }`,
        { id: runId },
      );
      if (!data.workflowRun) throw new CliError(`workflow run "${runId}" not found`, EXIT.NOT_FOUND);
      emitOne(
        data.workflowRun,
        ['id', 'status', 'workflowId', 'workflowVersionId', 'startedAt', 'endedAt', 'state'],
        ctx.out,
      );
    });

  /*
   * Automated triggers (DATABASE_EVENT or CRON) bind a workflow to an
   * automatic firing source. They live as records on the Core API. Authoring
   * a trigger does NOT activate the workflow — version activation
   * (`activateWorkflowVersion`) is still unexposed on the pinned Twenty image,
   * so the v0.6 surface is: inspect + create the trigger record, then
   * activate the workflow version through the Twenty UI until a later image
   * lifts the gate.
   *
   * Verified shapes (live probe):
   *   createWorkflowAutomatedTrigger(data: WorkflowAutomatedTriggerCreateInput!,
   *                                  upsert: Boolean): WorkflowAutomatedTrigger
   *   updateWorkflowAutomatedTrigger(id: UUID!, data: ...UpdateInput!): ...
   *   deleteWorkflowAutomatedTrigger(id: UUID!): ...
   *   WorkflowAutomatedTriggerTypeEnum: DATABASE_EVENT | CRON
   *   Required: settings(JSON!). Recommended: type, workflowId.
   */
  const trigger = wf
    .command('trigger')
    .description('manage workflow automated triggers (DATABASE_EVENT | CRON)');

  trigger
    .command('list <workflowId>')
    .description("list a workflow's automated triggers")
    .action(async (workflowId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{
        workflowAutomatedTriggers: Connection<WorkflowAutomatedTrigger>;
      }>(
        `query Triggers($id: UUID!) {
           workflowAutomatedTriggers(filter: { workflowId: { eq: $id } }, first: 100) {
             edges { node { ${AUTOMATED_TRIGGER} } }
           }
         }`,
        { id: workflowId },
      );
      emitList(
        data.workflowAutomatedTriggers.edges.map((e) => e.node),
        ['id', 'workflowId', 'type', 'settings'],
        ctx.out,
      );
    });

  trigger
    .command('get <triggerId>')
    .description('show one automated trigger')
    .action(async (triggerId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{ workflowAutomatedTrigger: WorkflowAutomatedTrigger | null }>(
        `query Trigger($id: UUID!) {
           workflowAutomatedTrigger(filter: { id: { eq: $id } }) { ${AUTOMATED_TRIGGER} }
         }`,
        { id: triggerId },
      );
      if (!data.workflowAutomatedTrigger) {
        throw new CliError(`workflow trigger "${triggerId}" not found`, EXIT.NOT_FOUND);
      }
      emitOne(
        data.workflowAutomatedTrigger as unknown as Record<string, unknown>,
        ['id', 'workflowId', 'type', 'settings', 'createdAt', 'updatedAt'],
        ctx.out,
      );
    });

  trigger
    .command('create')
    .description('create an automated trigger for a workflow')
    .requiredOption('--workflow <id>', 'workflow id')
    .requiredOption('--file <path>', 'WorkflowAutomatedTriggerCreateInput { type, settings, ... }')
    .action(async (opts: { workflow: string; file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const loaded = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(loaded) || typeof loaded !== 'object' || loaded === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      if (loaded.settings === undefined) {
        throw new CliError(`${opts.file} must include "settings" (JSON, per Twenty's trigger shape)`, EXIT.USAGE);
      }
      const data = { workflowId: opts.workflow, ...loaded };
      const res = await ctx.core.request<{ createWorkflowAutomatedTrigger: WorkflowAutomatedTrigger }>(
        `mutation Create($data: WorkflowAutomatedTriggerCreateInput!) {
           createWorkflowAutomatedTrigger(data: $data) { ${AUTOMATED_TRIGGER} }
         }`,
        { data },
      );
      emitOk(
        `created workflow trigger ${res.createWorkflowAutomatedTrigger.id}`,
        res.createWorkflowAutomatedTrigger as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  trigger
    .command('update <triggerId>')
    .description('update an automated trigger (e.g. change settings or type)')
    .requiredOption('--file <path>', 'partial WorkflowAutomatedTriggerUpdateInput')
    .action(async (triggerId: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const update = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(update) || typeof update !== 'object' || update === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const res = await ctx.core.request<{ updateWorkflowAutomatedTrigger: WorkflowAutomatedTrigger }>(
        `mutation Update($id: UUID!, $data: WorkflowAutomatedTriggerUpdateInput!) {
           updateWorkflowAutomatedTrigger(id: $id, data: $data) { ${AUTOMATED_TRIGGER} }
         }`,
        { id: triggerId, data: update },
      );
      emitOk(
        `updated workflow trigger ${triggerId}`,
        res.updateWorkflowAutomatedTrigger as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  trigger
    .command('delete <triggerId>')
    .description('delete an automated trigger (soft-delete; can be restored via Core API)')
    .action(async (triggerId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.core.request(
        `mutation Delete($id: UUID!) {
           deleteWorkflowAutomatedTrigger(id: $id) { id }
         }`,
        { id: triggerId },
      );
      emitOk(`deleted workflow trigger ${triggerId}`, { deleted: triggerId }, ctx.out);
    });
}
