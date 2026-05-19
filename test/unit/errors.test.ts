import { describe, expect, it } from 'vitest';
import { EXIT, exitCodeForStatus } from '../../src/api/errors.js';

describe('exitCodeForStatus', () => {
  it('maps 401/403 to the auth exit code', () => {
    expect(exitCodeForStatus(401)).toBe(EXIT.AUTH);
    expect(exitCodeForStatus(403)).toBe(EXIT.AUTH);
  });

  it('maps 404 to the not-found exit code', () => {
    expect(exitCodeForStatus(404)).toBe(EXIT.NOT_FOUND);
  });

  it('maps other failures to the API exit code', () => {
    expect(exitCodeForStatus(500)).toBe(EXIT.API);
    expect(exitCodeForStatus(400)).toBe(EXIT.API);
  });
});
