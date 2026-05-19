import { describe, expect, it } from 'vitest';
import { isUuid, uuid } from '../../src/lib/gql.js';

describe('isUuid', () => {
  it('accepts a UUID', () => {
    expect(isUuid('a5402bb3-dea7-4ade-affa-f1dc0d2ab82b')).toBe(true);
  });

  it('rejects object names and junk', () => {
    expect(isUuid('person')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});

describe('uuid', () => {
  it('produces a syntactically valid UUID', () => {
    expect(isUuid(uuid())).toBe(true);
  });
});
