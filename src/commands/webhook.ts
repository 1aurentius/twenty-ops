import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { WEBHOOK_SUMMARY } from '../lib/gql.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

interface WebhookNode {
  id: string;
  targetUrl: string;
  operations: string[];
  description: string | null;
  secret: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * `twenty-ops webhook …` — manage event subscriptions for the workspace.
 *
 * Verified shapes (live probe):
 *   createWebhook(input: CreateWebhookInput { targetUrl, operations, description?, secret? })
 *     — server generates `id` and `secret` when omitted
 *   updateWebhook(input: { id, update: UpdateWebhookInputUpdates })
 *   deleteWebhook(id: UUID!)  — unwrapped, unlike most metadata mutations
 *   webhook(id: UUID!)
 *   webhooks → flat list
 *
 * `operations` are passed verbatim as strings (e.g. `*.created`, `person.updated`).
 * No client-side enum validation — Twenty's accepted patterns vary across builds.
 */
export function registerWebhookCommands(program: Command): void {
  const webhook = program.command('webhook').description('manage event-subscription webhooks');

  webhook
    .command('list')
    .description('list webhooks (active subscriptions)')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ webhooks: WebhookNode[] }>(
        `query { webhooks { ${WEBHOOK_SUMMARY} } }`,
      );
      emitList(data.webhooks, webhookColumns(ctx), ctx.out);
    });

  webhook
    .command('get <id>')
    .description('show one webhook by id')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ webhook: WebhookNode | null }>(
        `query Get($id: UUID!) { webhook(id: $id) { ${WEBHOOK_SUMMARY} } }`,
        { id },
      );
      if (!data.webhook) throw new CliError(`webhook "${id}" not found`, EXIT.NOT_FOUND);
      emitOne(data.webhook as unknown as Record<string, unknown>, webhookColumns(ctx), ctx.out);
    });

  webhook
    .command('create')
    .description('create a webhook subscription')
    .requiredOption('--target-url <url>', 'target HTTPS URL Twenty will POST events to')
    .requiredOption(
      '--operations <list>',
      'comma-separated event patterns (e.g. `*.created`, `person.updated`)',
    )
    .option('--description <text>', 'human-readable description')
    .option('--secret <secret>', 'shared secret (server generates one if omitted)')
    .action(
      async (
        opts: { targetUrl: string; operations: string; description?: string; secret?: string },
        cmd: Command,
      ) => {
        const ctx = makeCtx(cmd);
        const operations = parseList(opts.operations);
        if (operations.length === 0) {
          throw new CliError('--operations must contain at least one event pattern', EXIT.USAGE);
        }
        const input: Record<string, unknown> = {
          targetUrl: opts.targetUrl,
          operations,
        };
        if (opts.description !== undefined) input.description = opts.description;
        if (opts.secret !== undefined) input.secret = opts.secret;

        const data = await ctx.metadata.request<{ createWebhook: WebhookNode }>(
          `mutation Create($input: CreateWebhookInput!) {
             createWebhook(input: $input) { ${WEBHOOK_SUMMARY} }
           }`,
          { input },
        );
        emitOk(
          `created webhook ${data.createWebhook.id}`,
          data.createWebhook as unknown as Record<string, unknown>,
          ctx.out,
        );
      },
    );

  webhook
    .command('update <id>')
    .description('update a webhook')
    .option('--target-url <url>')
    .option('--operations <list>', 'comma-separated event patterns')
    .option('--description <text>')
    .option('--secret <secret>')
    .action(
      async (
        id: string,
        opts: { targetUrl?: string; operations?: string; description?: string; secret?: string },
        cmd: Command,
      ) => {
        const ctx = makeCtx(cmd);
        const update: Record<string, unknown> = {};
        if (opts.targetUrl !== undefined) update.targetUrl = opts.targetUrl;
        if (opts.operations !== undefined) update.operations = parseList(opts.operations);
        if (opts.description !== undefined) update.description = opts.description;
        if (opts.secret !== undefined) update.secret = opts.secret;
        if (Object.keys(update).length === 0) {
          throw new CliError('nothing to update — pass at least one field flag', EXIT.USAGE);
        }
        const data = await ctx.metadata.request<{ updateWebhook: WebhookNode }>(
          `mutation Update($input: UpdateWebhookInput!) {
             updateWebhook(input: $input) { ${WEBHOOK_SUMMARY} }
           }`,
          { input: { id, update } },
        );
        emitOk(
          `updated webhook ${id}`,
          data.updateWebhook as unknown as Record<string, unknown>,
          ctx.out,
        );
      },
    );

  webhook
    .command('delete <id>')
    .description('delete a webhook')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.metadata.request(
        `mutation Delete($id: UUID!) { deleteWebhook(id: $id) { id } }`,
        { id },
      );
      emitOk(`deleted webhook ${id}`, { deleted: id }, ctx.out);
    });
}

function webhookColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'targetUrl', 'operations', 'description', 'createdAt'];
}

function parseList(s: string): string[] {
  return s.split(',').map((v) => v.trim()).filter(Boolean);
}
