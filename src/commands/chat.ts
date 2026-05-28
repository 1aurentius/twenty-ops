import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx, type Ctx } from '../lib/context.js';
import { CHAT_THREAD_SUMMARY } from '../lib/gql.js';
import { emitList, emitOk, emitOne } from '../lib/output.js';

/**
 * `twenty-ops chat …` — manage AI chat threads (read + thread lifecycle).
 *
 * The result type is `AgentChatThread`, NOT `ChatThread`. Selection set is
 * CHAT_THREAD_SUMMARY from `src/lib/gql.ts`.
 *
 * Verified shapes (live probe):
 *   chatThreads()                       → [AgentChatThread!]!
 *   chatThread(id: UUID!)               → AgentChatThread
 *   chatMessages(threadId: UUID!)       → ...                (message types)
 *   createChatThread()                  → AgentChatThread!   (NO args)
 *   renameChatThread(id: UUID!, title: String!)  → AgentChatThread!
 *   archiveChatThread(id: UUID!)        → AgentChatThread!
 *   unarchiveChatThread(id: UUID!)      → AgentChatThread!
 *   deleteChatThread(id: UUID!)         → Boolean!
 *
 * AUTH gate (live verified): every write mutation (create / rename /
 * archive / unarchive / delete) returns `EXIT.AUTH` "This endpoint
 * requires a user context. API keys are not supported." — same pattern
 * as v0.5 invitations + settings update. Integration tests pin the
 * gate rather than working around it.
 *
 * `chat send` (sendChatMessage) + `uploadAiChatFile` are deferred to v0.9
 * — streaming responses + multipart upload need their own design.
 */
export function registerChatCommands(program: Command): void {
  const ch = program.command('chat').description('manage AI chat threads');

  ch.command('list')
    .description('list every chat thread visible to the calling actor')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ chatThreads: ChatThreadNode[] }>(
        `query { chatThreads { ${CHAT_THREAD_SUMMARY} } }`,
      );
      emitList(data.chatThreads, threadColumns(ctx), ctx.out);
    });

  ch.command('get <threadId>')
    .description('show one chat thread')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ chatThread: ChatThreadNode | null }>(
        `query T($id: UUID!) { chatThread(id: $id) { ${CHAT_THREAD_SUMMARY} } }`,
        { id },
      );
      if (!data.chatThread) throw new CliError(`chat thread "${id}" not found`, EXIT.NOT_FOUND);
      emitOne(data.chatThread as unknown as Record<string, unknown>, threadColumns(ctx), ctx.out);
    });

  ch.command('create')
    .description('create a new chat thread for the calling user (user context required)')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ createChatThread: ChatThreadNode }>(
        `mutation { createChatThread { ${CHAT_THREAD_SUMMARY} } }`,
      );
      emitOk(
        `created chat thread ${data.createChatThread.id}`,
        data.createChatThread as unknown as Record<string, unknown>,
        ctx.out,
      );
    });

  ch.command('rename <threadId>')
    .description("rename a chat thread")
    .requiredOption('--title <text>', 'new title')
    .action(async (id: string, opts: { title: string }, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ renameChatThread: ChatThreadNode }>(
        `mutation R($id: UUID!, $title: String!) {
           renameChatThread(id: $id, title: $title) { ${CHAT_THREAD_SUMMARY} }
         }`,
        { id, title: opts.title },
      );
      emitOk(`renamed chat thread ${id}`, data.renameChatThread as unknown as Record<string, unknown>, ctx.out);
    });

  ch.command('archive <threadId>')
    .description('archive a chat thread')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ archiveChatThread: ChatThreadNode }>(
        `mutation A($id: UUID!) { archiveChatThread(id: $id) { ${CHAT_THREAD_SUMMARY} } }`,
        { id },
      );
      emitOk(`archived chat thread ${id}`, data.archiveChatThread as unknown as Record<string, unknown>, ctx.out);
    });

  ch.command('unarchive <threadId>')
    .description('unarchive a previously archived chat thread')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ unarchiveChatThread: ChatThreadNode }>(
        `mutation U($id: UUID!) { unarchiveChatThread(id: $id) { ${CHAT_THREAD_SUMMARY} } }`,
        { id },
      );
      emitOk(`unarchived chat thread ${id}`, data.unarchiveChatThread as unknown as Record<string, unknown>, ctx.out);
    });

  ch.command('delete <threadId>')
    .description('delete a chat thread (hard delete on this resolver)')
    .action(async (id: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.metadata.request(
        `mutation D($id: UUID!) { deleteChatThread(id: $id) }`,
        { id },
      );
      emitOk(`deleted chat thread ${id}`, { deleted: id }, ctx.out);
    });

  ch.command('messages <threadId>')
    .description("list a chat thread's messages (id + role + summary)")
    .action(async (threadId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      // chatMessages returns a polymorphic LIST; introspection identifies it
      // as Union/Interface — we request __typename + an `id` we know exists
      // on every variant. Richer per-type selection is left for a typed
      // follow-up (see v0.9 deferred list).
      const data = await ctx.metadata.request<{ chatMessages: { __typename: string; id: string }[] }>(
        `query M($threadId: UUID!) { chatMessages(threadId: $threadId) { __typename id } }`,
        { threadId },
      );
      emitList(data.chatMessages, ['__typename', 'id'], ctx.out);
    });
}

interface ChatThreadNode {
  id: string;
  title: string | null;
  conversationSize: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  contextWindowTokens: number | null;
  totalInputCredits: number;
  totalOutputCredits: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function threadColumns(ctx: Ctx): string[] {
  if (ctx.out.json) return [];
  return ['id', 'title', 'conversationSize', 'lastMessageAt'];
}
