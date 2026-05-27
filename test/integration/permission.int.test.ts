import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerObjectCommands } from '../../src/commands/object.js';
import { registerPermissionCommands } from '../../src/commands/permission.js';
import { registerRoleCommands } from '../../src/commands/role.js';
import { runCli } from '../helpers/cli-harness.js';
import { INTEGRATION, REMOTE, assertLocalRemote, tag } from '../helpers/integration-setup.js';

const TAG = `permint${tag()}`;
const runPerm = (...args: string[]) => runCli(registerPermissionCommands, ['--remote', REMOTE, 'permission', ...args]);
const runRole = (...args: string[]) => runCli(registerRoleCommands, ['--remote', REMOTE, 'role', ...args]);
const runObj = (...args: string[]) => runCli(registerObjectCommands, ['--remote', REMOTE, 'object', ...args]);

/**
 * Run against a throwaway role so we don't disturb the seeded Admin/Member roles
 * (Admin is irreplaceable; Member's defaults matter for any other test). The
 * role + a throwaway object both live just for this test's lifetime.
 */
describe.skipIf(!INTEGRATION)('permission integration', () => {
  let roleId = '';
  let objectId = '';
  let objectSingular = '';

  beforeAll(async () => {
    assertLocalRemote();
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'perm-int-'));

    // throwaway role
    const roleFile = join(dir, 'role.json');
    writeFileSync(roleFile, JSON.stringify({ label: `${TAG}-role`, description: 'permission integration test', canBeAssignedToUsers: true }));
    const r = await runRole('create', '--file', roleFile, '--json');
    roleId = (JSON.parse(r.stdout.trim()) as { id: string }).id;

    // throwaway object
    objectSingular = `${TAG}Obj`;
    const objFile = join(dir, 'obj.json');
    writeFileSync(objFile, JSON.stringify({
      nameSingular: objectSingular,
      namePlural: `${TAG}Objs`,
      labelSingular: 'PermObj', labelPlural: 'PermObjs',
    }));
    const o = await runObj('create', '--file', objFile, '--json');
    objectId = (JSON.parse(o.stdout.trim()) as { id: string }).id;
  });

  afterAll(async () => {
    if (objectId) await runObj('delete', objectId).catch(() => undefined);
    if (roleId) await runRole('delete', roleId, '--force').catch(() => undefined);
  });

  it('show + set-object: adding two objects preserves the first row', async () => {
    // First object: read=true
    await runPerm('set-object', '--role', roleId, '--object', objectSingular, '--read', 'true');
    const s1 = await runPerm('show', '--role', roleId, '--json');
    const r1 = JSON.parse(s1.stdout.trim()) as { objectPermissions: { objectMetadataId: string; canReadObjectRecords: boolean | null }[] };
    expect(r1.objectPermissions).toHaveLength(1);
    expect(r1.objectPermissions[0]?.canReadObjectRecords).toBe(true);

    // Set a second permission on `person` (always exists). Must preserve our throwaway row.
    await runPerm('set-object', '--role', roleId, '--object', 'person', '--read', 'true');
    const s2 = await runPerm('show', '--role', roleId, '--json');
    const r2 = JSON.parse(s2.stdout.trim()) as { objectPermissions: { objectMetadataId: string }[] };
    const ids = r2.objectPermissions.map((p) => p.objectMetadataId).sort();
    expect(ids).toContain(objectId);
    expect(ids.length).toBeGreaterThanOrEqual(2);
  });

  it('set-flag --enable then --disable round-trips', async () => {
    await runPerm('set-flag', '--role', roleId, '--flag', 'WORKFLOWS', '--enable');
    let show = await runPerm('show', '--role', roleId, '--json');
    let row = JSON.parse(show.stdout.trim()) as { permissionFlags: { flag: string }[] };
    expect(row.permissionFlags.map((f) => f.flag)).toContain('WORKFLOWS');

    await runPerm('set-flag', '--role', roleId, '--flag', 'WORKFLOWS', '--disable');
    show = await runPerm('show', '--role', roleId, '--json');
    row = JSON.parse(show.stdout.trim()) as { permissionFlags: { flag: string }[] };
    expect(row.permissionFlags.map((f) => f.flag)).not.toContain('WORKFLOWS');
  });

  it('apply: idempotent — re-running the same file shows all unchanged', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'perm-int-apply-'));
    const file = join(dir, 'spec.json');
    writeFileSync(file, JSON.stringify({
      objects: [{ object: objectSingular, read: true }],
      flags: ['VIEWS'],
    }));

    // First apply — at least the flag creates (current may carry over from prior tests)
    const r1 = await runPerm('apply', '--role', roleId, '--file', file, '--json');
    const s1 = JSON.parse(r1.stdout.trim()) as { flags: { created: number; unchanged: number } };
    expect(s1.flags.created + s1.flags.unchanged).toBeGreaterThanOrEqual(1);

    // Second apply — everything must be unchanged
    const r2 = await runPerm('apply', '--role', roleId, '--file', file, '--json');
    const s2 = JSON.parse(r2.stdout.trim()) as {
      objects: { created: number; updated: number; deleted: number; unchanged: number };
      flags: { created: number; updated: number; deleted: number; unchanged: number };
    };
    expect(s2.objects).toMatchObject({ created: 0, updated: 0, deleted: 0 });
    expect(s2.flags).toMatchObject({ created: 0, updated: 0, deleted: 0 });
  });
});
