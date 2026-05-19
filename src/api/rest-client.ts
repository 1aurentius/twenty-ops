import { CliError, EXIT, exitCodeForStatus } from './errors.js';

const DEBUG = process.env.TWENTY_DEBUG === '1';

/** Thin wrapper over Twenty's REST API — used for stable record list/filter reads. */
export class RestClient {
  constructor(
    private readonly restBase: string,
    private readonly apiKey: string,
  ) {}

  async get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.restBase}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { authorization: `Bearer ${this.apiKey}` },
      });
    } catch (err) {
      throw new CliError(`cannot reach ${url.origin}: ${(err as Error).message}`, EXIT.API);
    }

    const text = await res.text();
    if (DEBUG) process.stderr.write(`[debug] GET ${url.pathname}${url.search} -> ${res.status}\n`);

    if (!res.ok) {
      throw new CliError(
        `${res.status} ${res.statusText} from ${url.pathname}${text ? `: ${truncate(text)}` : ''}`,
        exitCodeForStatus(res.status),
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new CliError(`invalid JSON from ${url.pathname}`, EXIT.API);
    }
  }
}

function truncate(s: string, max = 300): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
