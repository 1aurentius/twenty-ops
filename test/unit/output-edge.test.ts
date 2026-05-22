import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitList, emitOne } from '../../src/lib/output.js';

/**
 * Edge cases for the output renderer.
 *
 * The renderer is the single place that determines what an agent
 * actually reads, so anything that could mis-align columns, swallow
 * a value silently, or corrupt JSON output is a real risk.
 */

function capture(fn: () => void): { stdout: string; stderr: string } {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const spyOut = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  const spyErr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  });
  try { fn(); } finally {
    spyOut.mockRestore();
    spyErr.mockRestore();
  }
  return { stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
}

afterEach(() => vi.restoreAllMocks());

describe('output edges', () => {
  it('aligns columns when one row has a much wider value than the rest', () => {
    const rows = [
      { id: 'short', name: 'A' },
      { id: 'a-very-long-id-that-makes-the-column-wide', name: 'B' },
    ];
    const { stdout } = capture(() => emitList(rows, ['id', 'name'], {}));
    const lines = stdout.trimEnd().split('\n');
    // Column header padding matches the widest cell.
    const idColWidth = 'a-very-long-id-that-makes-the-column-wide'.length;
    expect(lines[0]!.indexOf('name')).toBe(idColWidth + 2); // two-space separator
    expect(lines[1]!.indexOf('A')).toBe(idColWidth + 2);
  });

  it('renders unicode characters with their visual codepoints (no escaping)', () => {
    const rows = [{ id: '1', label: 'café — naïve résumé 🚀' }];
    const { stdout } = capture(() => emitList(rows, ['id', 'label'], {}));
    expect(stdout).toContain('café — naïve résumé 🚀');
  });

  it('does not corrupt JSON output for very long values', () => {
    const big = 'x'.repeat(5000);
    const { stdout } = capture(() =>
      emitList([{ id: '1', blob: big }], ['id', 'blob'], { json: true }),
    );
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.blob.length).toBe(5000);
  });

  it('preserves embedded newlines in JSON output (escaped) and shows the raw value in text mode', () => {
    const rows = [{ id: '1', note: 'line1\nline2' }];
    const jsonOut = capture(() => emitList(rows, ['id', 'note'], { json: true }));
    expect(JSON.parse(jsonOut.stdout.trim())).toEqual({ id: '1', note: 'line1\nline2' });

    // In text mode the raw newline will appear in the output — that breaks
    // alignment, but it's still a faithful render. This documents the trade-off.
    const textOut = capture(() => emitList(rows, ['id', 'note'], {}));
    expect(textOut.stdout).toContain('line1');
    expect(textOut.stdout).toContain('line2');
  });

  it('distinguishes null from empty array from empty string in text mode (all blank)', () => {
    // Documented behaviour: nullish + empty array all render as ''. This is
    // deliberate (one column, one blank cell) but agents should reach for
    // --json when nullness needs to be distinguished from emptiness.
    const out = capture(() =>
      emitOne(
        { a: null, b: undefined, c: [], d: '' },
        ['a', 'b', 'c', 'd'],
        {},
      ),
    );
    expect(out.stdout).toBe('a=\nb=\nc=\nd=\n');
  });

  it('distinguishes null / [] / "" cleanly under --json', () => {
    const out = capture(() =>
      emitOne(
        { a: null, b: undefined, c: [], d: '' },
        ['a', 'b', 'c', 'd'],
        { json: true },
      ),
    );
    const parsed = JSON.parse(out.stdout);
    expect(parsed.a).toBeNull();
    expect(parsed.b).toBeUndefined(); // JSON.stringify drops undefined fields entirely
    expect(parsed.c).toEqual([]);
    expect(parsed.d).toBe('');
  });

  it('emits "(no results)" on stderr — not stdout — for empty lists in text mode', () => {
    const { stdout, stderr } = capture(() => emitList([], ['id'], {}));
    expect(stdout).toBe('');
    expect(stderr).toContain('(no results)');
  });

  it('emits nothing at all for empty lists under --quiet', () => {
    const { stdout, stderr } = capture(() => emitList([], ['id'], { quiet: true }));
    expect(stdout).toBe('');
    expect(stderr).toBe('');
  });

  it('renders nested objects in tables as compact JSON, not [object Object]', () => {
    const rows = [{ id: '1', meta: { kind: 'a', count: 3 } }];
    const { stdout } = capture(() => emitList(rows, ['id', 'meta'], {}));
    // Cell stringifier JSON.stringifies objects so the column is still readable.
    expect(stdout).toContain('{"kind":"a","count":3}');
    expect(stdout).not.toContain('[object Object]');
  });
});
