import { describe, expect, it } from 'vitest';

import {
  diffSnapshots,
  formatDiff,
  hasDrift,
  type SchemaSnapshot,
} from '../../src/lib/introspection.js';

function snap(overrides: Partial<SchemaSnapshot['endpoints']['core']> = {}): SchemaSnapshot {
  const base: SchemaSnapshot['endpoints']['core'] = { queries: {}, mutations: {} };
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    endpoints: { core: { ...base, ...overrides }, metadata: base },
  };
}

describe('diffSnapshots', () => {
  it('returns an empty diff when snapshots are identical', () => {
    const a = snap({ queries: { foo: ['x'] }, mutations: { bar: [] } });
    const diff = diffSnapshots(a, a);
    expect(diff).toEqual({ added: [], removed: [], argChanges: [] });
    expect(hasDrift(diff)).toBe(false);
  });

  it('detects added and removed resolvers', () => {
    const before = snap({ queries: { kept: [], gone: [] }, mutations: {} });
    const after = snap({ queries: { kept: [], appeared: [] }, mutations: {} });
    const diff = diffSnapshots(before, after);
    expect(diff.added).toEqual(['core.queries.appeared']);
    expect(diff.removed).toEqual(['core.queries.gone']);
    expect(diff.argChanges).toEqual([]);
    expect(hasDrift(diff)).toBe(true);
  });

  it('detects argument additions and removals on existing resolvers', () => {
    const before = snap({ mutations: { update: ['id', 'name'] } });
    const after = snap({ mutations: { update: ['id', 'description'] } });
    const diff = diffSnapshots(before, after);
    expect(diff.argChanges).toEqual([
      { field: 'core.mutations.update', added: ['description'], removed: ['name'] },
    ]);
    expect(hasDrift(diff)).toBe(true);
  });

  it('considers each endpoint independently', () => {
    const before: SchemaSnapshot = {
      generatedAt: '',
      endpoints: {
        core: { queries: { a: [] }, mutations: {} },
        metadata: { queries: { a: [] }, mutations: {} },
      },
    };
    const after: SchemaSnapshot = {
      generatedAt: '',
      endpoints: {
        core: { queries: { a: [] }, mutations: {} },
        metadata: { queries: {}, mutations: {} },
      },
    };
    const diff = diffSnapshots(before, after);
    expect(diff.removed).toEqual(['metadata.queries.a']);
    expect(diff.added).toEqual([]);
  });
});

describe('formatDiff', () => {
  it('produces a human-readable summary with prefixed lines', () => {
    const before = snap({ queries: { kept: ['id'], gone: [] }, mutations: { up: ['id'] } });
    const after = snap({ queries: { kept: ['id'], appeared: [] }, mutations: { up: ['id', 'name'] } });
    const diff = diffSnapshots(before, after);
    const text = formatDiff(diff);
    expect(text).toContain('+ 1 new resolver');
    expect(text).toContain('+ core.queries.appeared');
    expect(text).toContain('- 1 removed resolver');
    expect(text).toContain('- core.queries.gone');
    expect(text).toContain('~ core.mutations.up (+name)');
  });
});
