import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliError } from '../../src/api/errors.js';
import { expectArray, loadInputFile } from '../../src/lib/input-file.js';

const dir = mkdtempSync(join(tmpdir(), 'twenty-ops-'));

function fixture(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

describe('loadInputFile', () => {
  it('parses a JSON file', () => {
    const path = fixture('a.json', '{"trigger":{"type":"MANUAL"},"steps":[]}');
    expect(loadInputFile(path)).toEqual({ trigger: { type: 'MANUAL' }, steps: [] });
  });

  it('parses a YAML file', () => {
    const path = fixture('b.yaml', 'trigger:\n  type: MANUAL\nsteps: []\n');
    expect(loadInputFile(path)).toEqual({ trigger: { type: 'MANUAL' }, steps: [] });
  });

  it('parses JSON content even when the extension says yaml', () => {
    const path = fixture('c.yaml', '{"x":1}');
    expect(loadInputFile(path)).toEqual({ x: 1 });
  });

  it('throws a CliError for an unreadable path', () => {
    expect(() => loadInputFile(join(dir, 'missing.json'))).toThrow(CliError);
  });
});

describe('expectArray', () => {
  it('returns the array unchanged', () => {
    expect(expectArray([{ id: '1' }], 'f.json')).toEqual([{ id: '1' }]);
  });

  it('throws a CliError for a non-array document', () => {
    expect(() => expectArray({ id: '1' }, 'f.json')).toThrow(CliError);
  });
});
