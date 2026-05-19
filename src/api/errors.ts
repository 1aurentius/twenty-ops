/** Deterministic exit codes — let an agent branch on outcome without parsing prose. */
export const EXIT = {
  OK: 0,
  GENERIC: 1,
  USAGE: 2,
  AUTH: 3,
  NOT_FOUND: 4,
  API: 5,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** A user-facing error. The message is printed as a single line; no stack trace. */
export class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode: ExitCode = EXIT.GENERIC,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

/** Maps an HTTP status to the right exit code. */
export function exitCodeForStatus(status: number): ExitCode {
  if (status === 401 || status === 403) return EXIT.AUTH;
  if (status === 404) return EXIT.NOT_FOUND;
  return EXIT.API;
}
