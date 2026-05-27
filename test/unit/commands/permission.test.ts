import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { HOME } = vi.hoisted(() => ({ HOME: { current: '' } }));
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => HOME.current };
});

import { EXIT } from '../../../src/api/errors.js';
import { registerPermissionCommands } from '../../../src/commands/permission.js';
import { runCli } from '../../helpers/cli-harness.js';
import { type FetchStub, stubFetch } from '../../helpers/graphql-mock.js';

function writeRemote(): void {
  mkdirSync(join(HOME.current, '.twenty'), { recursive: true });
  writeFileSync(
    join(HOME.current, '.twenty', 'config.json'),
    JSON.stringify({
      remotes: { test: { apiUrl: 'http://localhost:3001', apiKey: 'test-key' } },
      defaultRemote: 'test',
    }),
  );
}

const ROLE = {
  id: 'role-member',
  label: 'Member',
  canUpdateAllSettings: false,
  canAccessAllTools: true,
  canReadAllObjectRecords: true,
  canUpdateAllObjectRecords: true,
  canSoftDeleteAllObjectRecords: true,
  canDestroyAllObjectRecords: true,
  permissionFlags: [{ id: 'pf-1', flag: 'WORKFLOWS' }],
  objectPermissions: [
    { objectMetadataId: 'obj-person', canReadObjectRecords: true, canUpdateObjectRecords: null, canSoftDeleteObjectRecords: null, canDestroyObjectRecords: null },
  ],
  fieldPermissions: [
    { id: 'fp-1', objectMetadataId: 'obj-person', fieldMetadataId: 'fld-jobTitle', canReadFieldValue: true, canUpdateFieldValue: null },
  ],
};

/** resolveRoleId queries getRoles with a leaner selection. */
const ROLE_FOR_RESOLVE = [
  { id: 'role-member', label: 'Member', description: null, icon: null, canBeAssignedToUsers: true, canBeAssignedToApiKeys: false, isEditable: true },
];

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-perm-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('permission show', () => {
  it('emits the full role with nested permissions under --json', async () => {
    // resolveRoleId
    fetchStub.reply('/metadata', { data: { getRoles: ROLE_FOR_RESOLVE } });
    // fetchRoleWithPermissions
    fetchStub.reply('/metadata', { data: { getRoles: [ROLE] } });

    const { stdout } = await runCli(registerPermissionCommands, ['permission', 'show', '--role', 'Member', '--json']);
    const got = JSON.parse(stdout.trim()) as { id: string; permissionFlags: { flag: string }[]; objectPermissions: { objectMetadataId: string }[] };
    expect(got.id).toBe('role-member');
    expect(got.permissionFlags[0]?.flag).toBe('WORKFLOWS');
    expect(got.objectPermissions[0]?.objectMetadataId).toBe('obj-person');
  });
});

describe('permission set-object', () => {
  it('USAGE when no permission flags are passed', async () => {
    const err = await runCli(registerPermissionCommands, [
      'permission', 'set-object', '--role', 'Member', '--object', 'person',
    ]).catch((e: unknown) => e) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.USAGE);
  });

  it('reads existing permissions, modifies the target row, sends full list back', async () => {
    fetchStub.reply('/metadata', { data: { getRoles: ROLE_FOR_RESOLVE } });
    fetchStub.reply('/metadata', { data: { getRoles: [ROLE] } });
    // resolveObjectId — listObjects
    fetchStub.reply('/metadata', {
      data: {
        objects: {
          edges: [{ node: { id: 'obj-person', nameSingular: 'person', namePlural: 'people', labelSingular: 'Person', labelPlural: 'People', icon: null, isCustom: false, isActive: true } }],
        },
      },
    });
    fetchStub.reply('/metadata', { data: { upsertObjectPermissions: { objectMetadataId: 'obj-person' } } });

    await runCli(registerPermissionCommands, [
      'permission', 'set-object',
      '--role', 'Member', '--object', 'person',
      '--write', 'true',
    ]);

    const upsertCall = fetchStub.calls.find((c) =>
      (c.body as { query?: string } | undefined)?.query?.includes('upsertObjectPermissions'),
    );
    const query = (upsertCall!.body as { query: string }).query;
    // arg name must match the live schema: `upsertObjectPermissionsInput:`, not `input:`
    expect(query).toContain('upsertObjectPermissions(upsertObjectPermissionsInput:');

    const v = (upsertCall!.body as { variables: { input: { roleId: string; objectPermissions: Record<string, unknown>[] } } }).variables;
    expect(v.input.roleId).toBe('role-member');
    // The existing person row should be modified (canRead carried forward, canUpdate added)
    expect(v.input.objectPermissions).toHaveLength(1);
    expect(v.input.objectPermissions[0]).toMatchObject({
      objectMetadataId: 'obj-person',
      canReadObjectRecords: true,             // carried forward
      canUpdateObjectRecords: true,           // newly set
    });
  });

  it('appends a new object row when one does not already exist', async () => {
    fetchStub.reply('/metadata', { data: { getRoles: ROLE_FOR_RESOLVE } });
    fetchStub.reply('/metadata', { data: { getRoles: [ROLE] } });
    // resolveObjectId — list with extra company object
    fetchStub.reply('/metadata', {
      data: {
        objects: {
          edges: [
            { node: { id: 'obj-person', nameSingular: 'person', namePlural: 'people', labelSingular: 'P', labelPlural: 'P', icon: null, isCustom: false, isActive: true } },
            { node: { id: 'obj-company', nameSingular: 'company', namePlural: 'companies', labelSingular: 'C', labelPlural: 'C', icon: null, isCustom: false, isActive: true } },
          ],
        },
      },
    });
    fetchStub.reply('/metadata', { data: { upsertObjectPermissions: { objectMetadataId: 'obj-company' } } });

    await runCli(registerPermissionCommands, [
      'permission', 'set-object', '--role', 'Member', '--object', 'company', '--read', 'true',
    ]);

    const upsertCall = fetchStub.calls.find((c) =>
      (c.body as { query?: string } | undefined)?.query?.includes('upsertObjectPermissions'),
    );
    const v = (upsertCall!.body as { variables: { input: { objectPermissions: { objectMetadataId: string; canReadObjectRecords?: boolean }[] } } }).variables;
    // Person row preserved + company row appended
    expect(v.input.objectPermissions).toHaveLength(2);
    const ids = v.input.objectPermissions.map((p) => p.objectMetadataId).sort();
    expect(ids).toEqual(['obj-company', 'obj-person']);
    const company = v.input.objectPermissions.find((p) => p.objectMetadataId === 'obj-company');
    expect(company?.canReadObjectRecords).toBe(true);
  });
});

describe('permission set-field', () => {
  it('reads existing fieldPermissions, modifies the (object,field) target, sends full list back', async () => {
    fetchStub.reply('/metadata', { data: { getRoles: ROLE_FOR_RESOLVE } });
    fetchStub.reply('/metadata', { data: { getRoles: [ROLE] } });
    fetchStub.reply('/metadata', {
      data: {
        objects: {
          edges: [{ node: { id: 'obj-person', nameSingular: 'person', namePlural: 'people', labelSingular: 'P', labelPlural: 'P', icon: null, isCustom: false, isActive: true } }],
        },
      },
    });
    fetchStub.reply('/metadata', { data: { upsertFieldPermissions: [{ id: 'fp-1' }] } });

    await runCli(registerPermissionCommands, [
      'permission', 'set-field',
      '--role', 'Member', '--object', 'person', '--field', 'fld-jobTitle',
      '--write', 'true',
    ]);

    const upsertCall = fetchStub.calls.find((c) =>
      (c.body as { query?: string } | undefined)?.query?.includes('upsertFieldPermissions'),
    );
    const query = (upsertCall!.body as { query: string }).query;
    expect(query).toContain('upsertFieldPermissions(upsertFieldPermissionsInput:');

    const v = (upsertCall!.body as { variables: { input: { fieldPermissions: Record<string, unknown>[] } } }).variables;
    expect(v.input.fieldPermissions).toHaveLength(1);
    expect(v.input.fieldPermissions[0]).toMatchObject({
      objectMetadataId: 'obj-person',
      fieldMetadataId: 'fld-jobTitle',
      canReadFieldValue: true,         // carried forward
      canUpdateFieldValue: true,       // newly set
    });
  });
});

describe('permission set-flag', () => {
  it('USAGE without --enable or --disable', async () => {
    const err = await runCli(registerPermissionCommands, [
      'permission', 'set-flag', '--role', 'Member', '--flag', 'WORKFLOWS',
    ]).catch((e: unknown) => e) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.USAGE);
  });

  it('USAGE when both --enable and --disable are passed', async () => {
    const err = await runCli(registerPermissionCommands, [
      'permission', 'set-flag', '--role', 'Member', '--flag', 'WORKFLOWS',
      '--enable', '--disable',
    ]).catch((e: unknown) => e) as { exitCode?: number };
    expect(err.exitCode).toBe(EXIT.USAGE);
  });

  it('--enable adds the flag and sends the full updated list', async () => {
    fetchStub.reply('/metadata', { data: { getRoles: ROLE_FOR_RESOLVE } });
    fetchStub.reply('/metadata', { data: { getRoles: [ROLE] } });
    fetchStub.reply('/metadata', { data: { upsertPermissionFlags: [{ id: 'pf-2', flag: 'DATA_MODEL' }] } });

    await runCli(registerPermissionCommands, [
      'permission', 'set-flag', '--role', 'Member', '--flag', 'DATA_MODEL', '--enable',
    ]);

    const upsertCall = fetchStub.calls.find((c) =>
      (c.body as { query?: string } | undefined)?.query?.includes('upsertPermissionFlags'),
    );
    const query = (upsertCall!.body as { query: string }).query;
    expect(query).toContain('upsertPermissionFlags(upsertPermissionFlagsInput:');

    const v = (upsertCall!.body as { variables: { input: { permissionFlagKeys: string[] } } }).variables;
    expect(v.input.permissionFlagKeys.sort()).toEqual(['DATA_MODEL', 'WORKFLOWS']);
  });

  it('--disable removes the flag from the role', async () => {
    fetchStub.reply('/metadata', { data: { getRoles: ROLE_FOR_RESOLVE } });
    fetchStub.reply('/metadata', { data: { getRoles: [ROLE] } });
    fetchStub.reply('/metadata', { data: { upsertPermissionFlags: [] } });

    await runCli(registerPermissionCommands, [
      'permission', 'set-flag', '--role', 'Member', '--flag', 'WORKFLOWS', '--disable',
    ]);

    const upsertCall = fetchStub.calls.find((c) =>
      (c.body as { query?: string } | undefined)?.query?.includes('upsertPermissionFlags'),
    );
    const v = (upsertCall!.body as { variables: { input: { permissionFlagKeys: string[] } } }).variables;
    expect(v.input.permissionFlagKeys).toEqual([]);
  });
});
