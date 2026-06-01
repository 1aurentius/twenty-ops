import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import {
  APPROVED_ACCESS_DOMAIN_SUMMARY,
  EMAILING_DOMAIN_SUMMARY,
  PUBLIC_DOMAIN_SUMMARY,
} from '../lib/gql.js';
import { loadInputFile } from '../lib/input-file.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

/**
 * `twenty-ops domain …` — manage workspace domain configuration.
 *
 * Twenty exposes four distinct domain types, each with its own mutation
 * shape. Grouping them under a single top-level command keeps the surface
 * discoverable while preserving the per-type quirks:
 *
 *   domain approved <…>  — invite-allowlist (workspace can sign up @domain)
 *   domain public <…>     — workspace-facing custom domains
 *   domain emailing <…>   — outbound email senders (AWS_SES)
 *   domain custom <…>     — single utility (checkCustomDomainValidRecords)
 *
 * Verified shapes (live probe, twenty-ops-test stack):
 *   createApprovedAccessDomain(input: { domain!, email! })
 *   validateApprovedAccessDomain(input: { validationToken!, approvedAccessDomainId! })
 *   deleteApprovedAccessDomain(input: { id! })
 *   createPublicDomain(domain: String!, applicationId: String?)   — flat args!
 *   updatePublicDomain(domain: String!, applicationId: String?)   — keyed by domain
 *   deletePublicDomain(domain: String!)
 *   checkPublicDomainValidRecords(domain: String!) → DomainValidRecords
 *   createEmailingDomain(domain!, driver: EmailingDomainDriver!)
 *   verifyEmailingDomain(id: String!)
 *   deleteEmailingDomain(id: String!)
 *   checkCustomDomainValidRecords() → DomainValidRecords           — no args
 *
 * EmailingDomainDriver enum: AWS_SES (only).
 */
export function registerDomainCommands(program: Command): void {
  const dom = program.command('domain').description('manage workspace domains (SSO, public, emailing, custom)');

  registerApproved(dom);
  registerPublic(dom);
  registerEmailing(dom);
  registerCustom(dom);
}

function registerApproved(dom: Command): void {
  const approved = dom.command('approved').description('approved-access domain allowlist (auto-join @domain.com)');

  approved.command('list')
    .description('list approved-access domains')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ getApprovedAccessDomains: ApprovedAccessDomain[] }>(
        `query { getApprovedAccessDomains { ${APPROVED_ACCESS_DOMAIN_SUMMARY} } }`,
      );
      emitList(data.getApprovedAccessDomains, approvedColumns(ctx), ctx.out);
    });

  approved.command('create')
    .description('register a new approved-access domain (server emits a validation token to the email)')
    .requiredOption('--domain <domain>', 'domain to approve (e.g. acme.com)')
    .requiredOption('--email <email>', 'email at the domain for ownership verification')
    .action(async (opts: { domain: string; email: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ createApprovedAccessDomain: ApprovedAccessDomain }>(
        `mutation Create($input: CreateApprovedAccessDomainInput!) {
           createApprovedAccessDomain(input: $input) { ${APPROVED_ACCESS_DOMAIN_SUMMARY} }
         }`,
        { input: { domain: opts.domain, email: opts.email } },
      );
      emitOk(
        `created approved-access domain ${data.createApprovedAccessDomain.id} (${opts.domain})`,
        data.createApprovedAccessDomain as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  approved.command('validate <id>')
    .description('validate domain ownership using the token emailed by `create`')
    .requiredOption('--token <token>', 'validation token from the verification email')
    .action(async (id: string, opts: { token: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ validateApprovedAccessDomain: ApprovedAccessDomain }>(
        `mutation Validate($input: ValidateApprovedAccessDomainInput!) {
           validateApprovedAccessDomain(input: $input) { ${APPROVED_ACCESS_DOMAIN_SUMMARY} }
         }`,
        { input: { approvedAccessDomainId: id, validationToken: opts.token } },
      );
      emitOk(
        `validated approved-access domain ${id}`,
        data.validateApprovedAccessDomain as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  approved.command('delete <id>')
    .description('remove an approved-access domain')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.metadata.request(
        `mutation Delete($input: DeleteApprovedAccessDomainInput!) {
           deleteApprovedAccessDomain(input: $input)
         }`,
        { input: { id } },
      );
      emitOk(`deleted approved-access domain ${id}`, { deleted: id }, ctx.out);
    });
}

function registerPublic(dom: Command): void {
  const pub = dom.command('public').description('public workspace-facing domains');

  pub.command('list')
    .description('list public domains')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ findManyPublicDomains: PublicDomain[] }>(
        `query { findManyPublicDomains { ${PUBLIC_DOMAIN_SUMMARY} } }`,
      );
      emitList(data.findManyPublicDomains, publicColumns(ctx), ctx.out);
    });

  pub.command('create')
    .description('register a public domain, optionally bound to an application')
    .requiredOption('--domain <domain>', 'domain to register')
    .option('--application <applicationId>', 'optional applicationId to bind')
    .action(async (opts: { domain: string; application?: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ createPublicDomain: PublicDomain }>(
        `mutation Create($domain: String!, $applicationId: String) {
           createPublicDomain(domain: $domain, applicationId: $applicationId) { ${PUBLIC_DOMAIN_SUMMARY} }
         }`,
        { domain: opts.domain, applicationId: opts.application },
      );
      emitOk(
        `created public domain ${data.createPublicDomain.id} (${opts.domain})`,
        data.createPublicDomain as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  pub.command('update')
    .description("update a public domain's application binding (keyed by domain string)")
    .requiredOption('--domain <domain>', 'domain to update')
    .option('--application <applicationId>', 'applicationId to bind (omit to unbind)')
    .action(async (opts: { domain: string; application?: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ updatePublicDomain: PublicDomain }>(
        `mutation Update($domain: String!, $applicationId: String) {
           updatePublicDomain(domain: $domain, applicationId: $applicationId) { ${PUBLIC_DOMAIN_SUMMARY} }
         }`,
        { domain: opts.domain, applicationId: opts.application },
      );
      emitOk(
        `updated public domain ${opts.domain}`,
        data.updatePublicDomain as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  pub.command('delete')
    .description('delete a public domain (keyed by domain string)')
    .requiredOption('--domain <domain>', 'domain to delete')
    .action(async (opts: { domain: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.metadata.request(
        `mutation Delete($domain: String!) { deletePublicDomain(domain: $domain) }`,
        { domain: opts.domain },
      );
      emitOk(`deleted public domain ${opts.domain}`, { deleted: opts.domain }, ctx.out);
    });

  pub.command('check')
    .description('check DNS records for a public domain')
    .requiredOption('--domain <domain>', 'domain to check')
    .action(async (opts: { domain: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ checkPublicDomainValidRecords: DomainValidRecords | null }>(
        `mutation Check($domain: String!) {
           checkPublicDomainValidRecords(domain: $domain) {
             id domain records { validationType type status key value }
           }
         }`,
        { domain: opts.domain },
      );
      if (!data.checkPublicDomainValidRecords) {
        throw new CliError(`no DNS records returned for "${opts.domain}"`, EXIT.NOT_FOUND);
      }
      emitOne(
        data.checkPublicDomainValidRecords as unknown as Record<string, unknown>,
        ['id', 'domain', 'records'],
        ctx.out,
      );
    });
}

function registerEmailing(dom: Command): void {
  const em = dom.command('emailing').description('outbound emailing domains (AWS_SES)');

  em.command('list')
    .description('list emailing domains')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ getEmailingDomains: EmailingDomain[] }>(
        `query { getEmailingDomains { ${EMAILING_DOMAIN_SUMMARY} } }`,
      );
      emitList(data.getEmailingDomains, emailingColumns(ctx), ctx.out);
    });

  em.command('create')
    .description('register an emailing domain (driver: AWS_SES)')
    .requiredOption('--domain <domain>', 'domain to register')
    .option('--driver <driver>', 'emailing driver', 'AWS_SES')
    .action(async (opts: { domain: string; driver: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ createEmailingDomain: EmailingDomain }>(
        `mutation Create($domain: String!, $driver: EmailingDomainDriver!) {
           createEmailingDomain(domain: $domain, driver: $driver) { ${EMAILING_DOMAIN_SUMMARY} }
         }`,
        { domain: opts.domain, driver: opts.driver.toUpperCase() },
      );
      emitOk(
        `created emailing domain ${data.createEmailingDomain.id} (${opts.domain})`,
        data.createEmailingDomain as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  em.command('verify <id>')
    .description('trigger DNS verification on an emailing domain')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ verifyEmailingDomain: EmailingDomain }>(
        `mutation Verify($id: String!) {
           verifyEmailingDomain(id: $id) { ${EMAILING_DOMAIN_SUMMARY} }
         }`,
        { id },
      );
      emitOk(
        `verified emailing domain ${id} → status=${data.verifyEmailingDomain.status}`,
        data.verifyEmailingDomain as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  em.command('delete <id>')
    .description('delete an emailing domain')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.metadata.request(
        `mutation Delete($id: String!) { deleteEmailingDomain(id: $id) }`,
        { id },
      );
      emitOk(`deleted emailing domain ${id}`, { deleted: id }, ctx.out);
    });
}

function registerCustom(dom: Command): void {
  const custom = dom.command('custom').description('custom-domain DNS validity check (single-tenant)');

  custom.command('check')
    .description('check DNS records for the workspace custom domain')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ checkCustomDomainValidRecords: DomainValidRecords | null }>(
        `mutation { checkCustomDomainValidRecords {
           id domain records { validationType type status key value }
         } }`,
      );
      if (!data.checkCustomDomainValidRecords) {
        throw new CliError('no custom domain configured for this workspace', EXIT.NOT_FOUND);
      }
      emitOne(
        data.checkCustomDomainValidRecords as unknown as Record<string, unknown>,
        ['id', 'domain', 'records'],
        ctx.out,
      );
    });
}

interface ApprovedAccessDomain {
  id: string;
  domain: string;
  isValidated: boolean;
  createdAt: string;
}

interface PublicDomain {
  id: string;
  domain: string;
  isValidated: boolean;
  applicationId: string | null;
  createdAt: string;
}

interface EmailingDomain {
  id: string;
  domain: string;
  driver: string;
  status: string;
  verifiedAt: string | null;
  verificationRecords: { type: string; key: string; value: string; priority: number | null }[];
  createdAt: string;
  updatedAt: string;
}

interface DomainValidRecords {
  id: string;
  domain: string;
  records: { validationType: string; type: string; status: string; key: string; value: string }[];
}

function approvedColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'domain', 'isValidated'];
}

function publicColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'domain', 'isValidated', 'applicationId'];
}

function emailingColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'domain', 'driver', 'status', 'verifiedAt'];
}
