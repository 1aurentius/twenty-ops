import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitList, emitOne } from '../../src/lib/output.js';

/** Captures everything written to stdout while `fn` runs. */
function capture(fn: () => void): string {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return chunks.join('');
}

afterEach(() => vi.restoreAllMocks());

const rows = [
  { id: '1', name: 'Alpha', type: 'TABLE' },
  { id: '2', name: 'Beta', type: 'KANBAN' },
];

describe('emitList', () => {
  it('renders an aligned text table by default', () => {
    const out = capture(() => emitList(rows, ['id', 'name'], {}));
    const lines = out.trimEnd().split('\n');
    // Columns are aligned; trailing whitespace is trimmed from every line.
    expect(lines[0]).toBe('id  name');
    expect(lines[1]).toBe('1   Alpha');
    expect(lines[2]).toBe('2   Beta');
  });

  it('emits JSON Lines under --json', () => {
    const out = capture(() => emitList(rows, ['id', 'name'], { json: true }));
    expect(out.trimEnd().split('\n')).toEqual([
      '{"id":"1","name":"Alpha"}',
      '{"id":"2","name":"Beta"}',
    ]);
  });

  it('projects to exactly the requested --fields', () => {
    const out = capture(() => emitList(rows, ['id', 'name'], { json: true, fields: 'type' }));
    expect(out.trimEnd().split('\n')).toEqual(['{"type":"TABLE"}', '{"type":"KANBAN"}']);
  });
});

describe('emitOne', () => {
  it('renders key=value lines by default', () => {
    const out = capture(() => emitOne(rows[0]!, ['id', 'name'], {}));
    expect(out).toBe('id=1\nname=Alpha\n');
  });

  it('emits a single JSON object under --json', () => {
    const out = capture(() => emitOne(rows[0]!, ['id', 'name'], { json: true }));
    expect(JSON.parse(out)).toEqual({ id: '1', name: 'Alpha' });
  });

  it('renders empty arrays and nulls as empty values in text mode', () => {
    const record = { id: '1', viewFields: [] as unknown[], steps: null };
    const out = capture(() => emitOne(record, ['id', 'viewFields', 'steps'], {}));
    expect(out).toBe('id=1\nviewFields=\nsteps=\n');
  });

  it('comma-joins arrays of primitives, and shows a count for arrays of objects', () => {
    const record = {
      id: '1',
      statuses: ['ACTIVE', 'DEACTIVATED'],
      fields: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    };
    const out = capture(() => emitOne(record, ['statuses', 'fields'], {}));
    expect(out).toBe('statuses=ACTIVE,DEACTIVATED\nfields=[3 items]\n');
  });

  it('preserves array fidelity under --json', () => {
    const record = { statuses: ['ACTIVE'], fields: [{ id: 'a' }] };
    const out = capture(() => emitOne(record, ['statuses', 'fields'], { json: true }));
    expect(JSON.parse(out)).toEqual({ statuses: ['ACTIVE'], fields: [{ id: 'a' }] });
  });
});

describe('cell rendering inside tables', () => {
  it('comma-joins primitive arrays in table cells', () => {
    const wfRows = [
      { id: '1', name: 'WF-A', statuses: ['ACTIVE'] },
      { id: '2', name: 'WF-B', statuses: ['ACTIVE', 'DEACTIVATED'] },
    ];
    const out = capture(() => emitList(wfRows, ['id', 'name', 'statuses'], {}));
    const lines = out.trimEnd().split('\n');
    expect(lines[0]).toBe('id  name  statuses');
    expect(lines[1]).toBe('1   WF-A  ACTIVE');
    expect(lines[2]).toBe('2   WF-B  ACTIVE,DEACTIVATED');
  });
});
