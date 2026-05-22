import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { HOME } = vi.hoisted(() => ({ HOME: { current: '' } }));
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => HOME.current };
});

import { EXIT } from '../../src/api/errors.js';
import { registerNavCommands } from '../../src/commands/nav.js';
import { registerRecordCommands } from '../../src/commands/record.js';
import { registerViewCommands } from '../../src/commands/view.js';
import { registerWorkflowCommands } from '../../src/commands/workflow.js';
import { runCli } from '../helpers/cli-harness.js';
import { type FetchStub, stubFetch } from '../helpers/graphql-mock.js';

/**
 * Error-message quality.
 *
 * When something goes wrong, the agent reads stderr (single line) and the
 * exit code. The message must include the resource id it tried to find —
 * otherwise the agent has to correlate against its own input, which is
 * brittle and expensive.
 *
 * Contract: every NOT_FOUND error includes the id (or other locator string)
 * the user passed in, verbatim.
 */

const NONESUCH = '00000000-0000-4000-8000-000000000000';

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

function scriptPersonObject(stub: FetchStub): void {
  stub.reply('/metadata', {
    data: {
      objects: {
        edges: [
          {
            node: {
              id: 'obj-person',
              nameSingular: 'person',
              namePlural: 'people',
              labelSingular: 'Person',
              isActive: true,
            },
          },
        ],
      },
    },
  });
}

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-errq-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

interface ThrownError {
  exitCode?: number;
  message?: string;
}

async function expectNotFoundWithId(
  promise: Promise<unknown>,
  needle: string,
): Promise<void> {
  const err = await promise.catch((e: unknown) => e) as ThrownError;
  expect(err.exitCode, `got exit ${err.exitCode}: ${err.message}`).toBe(EXIT.NOT_FOUND);
  expect(err.message ?? '').toContain(needle);
}

describe('NOT_FOUND messages include the resource id', () => {
  it('view get <id>', async () => {
    fetchStub.reply('/metadata', { data: { getView: null } });
    await expectNotFoundWithId(
      runCli(registerViewCommands, ['view', 'get', NONESUCH]),
      NONESUCH,
    );
  });

  it('view delete <id>', async () => {
    fetchStub.reply('/metadata', {
      errors: [{ message: `View ${NONESUCH} not found`, extensions: { code: 'NOT_FOUND' } }],
    });
    await expectNotFoundWithId(
      runCli(registerViewCommands, ['view', 'delete', NONESUCH]),
      NONESUCH,
    );
  });

  it('workflow get <id>', async () => {
    fetchStub.reply('/graphql', {
      errors: [{ message: `Workflow ${NONESUCH} not found`, extensions: { code: 'NOT_FOUND' } }],
    });
    await expectNotFoundWithId(
      runCli(registerWorkflowCommands, ['workflow', 'get', NONESUCH]),
      NONESUCH,
    );
  });

  it('nav remove <id>', async () => {
    fetchStub.reply('/metadata', {
      errors: [{ message: `Navigation menu item ${NONESUCH} not found`, extensions: { code: 'NOT_FOUND' } }],
    });
    await expectNotFoundWithId(
      runCli(registerNavCommands, ['nav', 'remove', NONESUCH]),
      NONESUCH,
    );
  });

  it('record get <object> <id> (REST 404)', async () => {
    scriptPersonObject(fetchStub);
    fetchStub.reply('/rest/people', { error: `record ${NONESUCH} not found` }, { status: 404, statusText: 'Not Found' });
    await expectNotFoundWithId(
      runCli(registerRecordCommands, ['record', 'get', 'person', NONESUCH]),
      NONESUCH,
    );
  });

  it('record get against an unknown object name names the offending object', async () => {
    // Empty objects list — resolveObjectName fails with the user's ref in the message.
    fetchStub.reply('/metadata', { data: { objects: { edges: [] } } });
    await expectNotFoundWithId(
      runCli(registerRecordCommands, ['record', 'get', 'nosuchobject', NONESUCH]),
      'nosuchobject',
    );
  });
});
