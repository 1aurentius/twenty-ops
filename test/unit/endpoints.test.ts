import { describe, expect, it } from 'vitest';
import { deriveEndpoints } from '../../src/api/endpoints.js';

describe('deriveEndpoints', () => {
  it('derives the three Twenty API endpoints from a base URL', () => {
    expect(deriveEndpoints('http://localhost:3000')).toEqual({
      base: 'http://localhost:3000',
      core: 'http://localhost:3000/graphql',
      metadata: 'http://localhost:3000/metadata',
      rest: 'http://localhost:3000/rest',
    });
  });

  it('strips trailing slashes from the base URL', () => {
    expect(deriveEndpoints('https://acme.twenty.com//').core).toBe(
      'https://acme.twenty.com/graphql',
    );
  });
});
