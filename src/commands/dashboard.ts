import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { DASHBOARD_SUMMARY } from '../lib/gql.js';
import { loadInputFile } from '../lib/input-file.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

/**
 * `twenty-ops dashboard …` — manage workspace dashboards (Core API records).
 *
 * Verified shapes (live probe, twenty-ops-test stack):
 *   createDashboard(data: DashboardCreateInput!, upsert: Boolean) → Dashboard
 *   updateDashboard(id: UUID!, data: DashboardUpdateInput!) → Dashboard
 *   deleteDashboard(id: UUID!) → Dashboard            (soft-delete)
 *   restoreDashboard(id: UUID!) → Dashboard
 *   dashboard(filter: DashboardFilterInput) → Dashboard
 *   dashboards(first, after, filter, ...) → DashboardConnection
 *
 * Dashboard { id, title?, position!, pageLayoutId?, createdBy/updatedBy, … }
 *
 * A dashboard *links* to a PageLayout of type DASHBOARD via `pageLayoutId`;
 * v0.7 keeps the two records independent (creating a dashboard does not
 * auto-create the page layout) — see README for the recommended wiring.
 */
export function registerDashboardCommands(program: Command): void {
  const dash = program.command('dashboard').description('manage workspace dashboards');

  dash.command('list')
    .description('list dashboards')
    .option('--limit <n>', 'max rows', Number, 50)
    .option('--starting-after <id>', 'opaque cursor for paging')
    .action(async (opts: { limit: number; startingAfter?: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{ dashboards: Connection<Dashboard> }>(
        `query Dashboards($first: Int, $after: String) {
           dashboards(first: $first, after: $after) {
             edges { node { ${DASHBOARD_SUMMARY} } }
           }
         }`,
        { first: opts.limit, after: opts.startingAfter },
      );
      emitList(
        data.dashboards.edges.map((e) => e.node),
        dashColumns(ctx),
        ctx.out,
      );
    });

  dash.command('get <dashboardId>')
    .description('show one dashboard')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{ dashboard: Dashboard | null }>(
        `query D($id: UUID!) {
           dashboard(filter: { id: { eq: $id } }) { ${DASHBOARD_SUMMARY} }
         }`,
        { id },
      );
      if (!data.dashboard) throw new CliError(`dashboard "${id}" not found`, EXIT.NOT_FOUND);
      emitOne(data.dashboard as unknown as Record<string, unknown>, dashColumns(ctx), ctx.out);
    });

  dash.command('create')
    .description('create a dashboard from a JSON/YAML file (- for stdin)')
    .requiredOption('--file <path>', 'DashboardCreateInput { title?, pageLayoutId?, position? }')
    .action(async (opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(data) || typeof data !== 'object' || data === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const res = await ctx.core.request<{ createDashboard: Dashboard }>(
        `mutation Create($data: DashboardCreateInput!) {
           createDashboard(data: $data) { ${DASHBOARD_SUMMARY} }
         }`,
        { data },
      );
      emitOk(
        `created dashboard ${res.createDashboard.id}`,
        res.createDashboard as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  dash.command('update <dashboardId>')
    .description('update a dashboard from a JSON/YAML file')
    .requiredOption('--file <path>', 'partial DashboardUpdateInput')
    .action(async (id: string, opts: { file: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = loadInputFile<Record<string, unknown>>(opts.file);
      if (Array.isArray(data) || typeof data !== 'object' || data === null) {
        throw new CliError(`${opts.file} must contain a single JSON/YAML object`, EXIT.USAGE);
      }
      const res = await ctx.core.request<{ updateDashboard: Dashboard }>(
        `mutation Update($id: UUID!, $data: DashboardUpdateInput!) {
           updateDashboard(id: $id, data: $data) { ${DASHBOARD_SUMMARY} }
         }`,
        { id, data },
      );
      emitOk(`updated dashboard ${id}`, res.updateDashboard as unknown as Record<string, unknown>, ctx.out);
    });

  dash.command('delete <dashboardId>')
    .description('soft-delete a dashboard (use `restore` to undo)')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.core.request(
        `mutation Delete($id: UUID!) { deleteDashboard(id: $id) { id } }`,
        { id },
      );
      emitOk(`deleted dashboard ${id}`, { deleted: id }, ctx.out);
    });

  dash.command('restore <dashboardId>')
    .description('un-soft-delete a dashboard from the recycle bin')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.core.request<{ restoreDashboard: Dashboard }>(
        `mutation Restore($id: UUID!) {
           restoreDashboard(id: $id) { ${DASHBOARD_SUMMARY} }
         }`,
        { id },
      );
      emitOk(`restored dashboard ${id}`, data.restoreDashboard as unknown as Record<string, unknown>, ctx.out);
    });
}

interface Dashboard {
  id: string;
  title: string | null;
  position: number;
  pageLayoutId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Connection<T> {
  edges: { node: T }[];
}

function dashColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'title', 'position', 'pageLayoutId'];
}
