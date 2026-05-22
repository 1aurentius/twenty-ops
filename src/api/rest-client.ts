import { CliError, EXIT, exitCodeForStatus } from './errors.js';

const DEBUG = process.env.TWENTY_DEBUG === '1';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * Thin wrapper over Twenty's REST API.
 *
 * Used for record CRUD — workspace-agnostic across standard and custom
 * objects because the URL only needs an `objectNamePlural` segment, no
 * per-workspace code generation. The GraphQL client remains the one place
 * we issue Twenty-specific mutations (workflow lifecycle, view widgets).
 */
export class RestClient {
  constructor(
    private readonly restBase: string,
    private readonly apiKey: string,
  ) {}

  get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    return this.request<T>('GET', path, { query });
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, { body });
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, { body });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(
    method: Method,
    path: string,
    opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(`${this.restBase}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }

    let res: Response;
    try {
      res = await fetch(url, { method, headers, body });
    } catch (err) {
      throw new CliError(`cannot reach ${url.origin}: ${(err as Error).message}`, EXIT.API);
    }

    const text = await res.text();
    if (DEBUG) {
      process.stderr.write(`[debug] ${method} ${url.pathname}${url.search} -> ${res.status}\n`);
    }

    if (!res.ok) {
      throw new CliError(
        `${res.status} ${res.statusText} from ${method} ${url.pathname}${text ? `: ${truncate(text)}` : ''}`,
        exitCodeForStatus(res.status),
      );
    }
    if (text.length === 0) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new CliError(`invalid JSON from ${method} ${url.pathname}`, EXIT.API);
    }
  }
}

function truncate(s: string, max = 300): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
