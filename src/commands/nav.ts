import type { Command } from 'commander';
import { CliError, EXIT } from '../api/errors.js';
import { makeCtx } from '../lib/context.js';
import { NAV_ITEM } from '../lib/gql.js';
import { emitList, emitOk } from '../lib/output.js';

interface NavItem {
  id: string;
  type: string;
  name: string | null;
  icon: string | null;
  viewId: string | null;
  folderId: string | null;
  link: string | null;
  position: number;
}

/** `twenty-ops nav …` — manage sidebar navigation menu items via the Metadata API. */
export function registerNavCommands(program: Command): void {
  const nav = program.command('nav').description('manage sidebar navigation menu items');

  nav
    .command('list')
    .description('list navigation menu items')
    .action(async (_opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      const data = await ctx.metadata.request<{ navigationMenuItems: NavItem[] }>(
        `query { navigationMenuItems { ${NAV_ITEM} } }`,
      );
      emitList(
        data.navigationMenuItems,
        ['id', 'type', 'name', 'icon', 'viewId', 'position'],
        ctx.out,
      );
    });

  nav
    .command('add')
    .description('add a navigation item (one of --view / --folder / --link)')
    .requiredOption('--name <name>', 'menu item label')
    .option('--view <viewId>', 'view item: link to this view')
    .option('--folder', 'folder item')
    .option('--link <url>', 'link item: external URL')
    .option('--icon <icon>', 'Tabler icon name')
    .option('--position <n>', 'sidebar position', Number)
    .action(
      async (
        opts: {
          name: string;
          view?: string;
          folder?: boolean;
          link?: string;
          icon?: string;
          position?: number;
        },
        cmd: Command,
      ) => {
        const ctx = makeCtx(cmd);
        const modes = [opts.view && 'view', opts.folder && 'folder', opts.link && 'link'].filter(
          Boolean,
        );
        if (modes.length !== 1) {
          throw new CliError(
            'pass exactly one of --view <id>, --folder, or --link <url>',
            EXIT.USAGE,
          );
        }

        const input: Record<string, unknown> = {
          name: opts.name,
          icon: opts.icon,
          position: opts.position,
        };
        if (opts.view) {
          input.type = 'VIEW';
          input.viewId = opts.view;
        } else if (opts.folder) {
          input.type = 'FOLDER';
        } else {
          input.type = 'LINK';
          input.link = opts.link;
        }

        const data = await ctx.metadata.request<{ createNavigationMenuItem: NavItem }>(
          `mutation Add($input: CreateNavigationMenuItemInput!) {
             createNavigationMenuItem(input: $input) { ${NAV_ITEM} }
           }`,
          { input: pruneUndefined(input) },
        );
        emitOk(
          `added nav item ${data.createNavigationMenuItem.id}`,
          data.createNavigationMenuItem as unknown as Record<string, unknown>,
          ctx.out,
        );
      },
    );

  nav
    .command('update <navItemId>')
    .description('update a navigation item')
    .option('--name <name>')
    .option('--icon <icon>')
    .option('--position <n>', 'sidebar position', Number)
    .action(
      async (
        navItemId: string,
        opts: { name?: string; icon?: string; position?: number },
        cmd: Command,
      ) => {
        const ctx = makeCtx(cmd);
        const update = pruneUndefined({
          name: opts.name,
          icon: opts.icon,
          position: opts.position,
        });
        if (Object.keys(update).length === 0) {
          throw new CliError('nothing to update — pass at least one field flag', EXIT.USAGE);
        }
        const data = await ctx.metadata.request<{ updateNavigationMenuItem: NavItem }>(
          `mutation Update($input: UpdateOneNavigationMenuItemInput!) {
             updateNavigationMenuItem(input: $input) { ${NAV_ITEM} }
           }`,
          { input: { id: navItemId, update } },
        );
        emitOk(
          `updated nav item ${navItemId}`,
          data.updateNavigationMenuItem as unknown as Record<string, unknown>,
          ctx.out,
        );
      },
    );

  nav
    .command('remove <navItemId>')
    .description('remove a navigation item')
    .action(async (navItemId: string, _opts, cmd: Command) => {
      const ctx = makeCtx(cmd);
      await ctx.metadata.request(
        `mutation Remove($id: UUID!) { deleteNavigationMenuItem(id: $id) { id } }`,
        { id: navItemId },
      );
      emitOk(`removed nav item ${navItemId}`, { removed: navItemId }, ctx.out);
    });
}

function pruneUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
