import { CliError, EXIT, exitCodeForStatus } from './errors.js';

interface GraphQLError {
  message: string;
  extensions?: { code?: string; subCode?: string };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

const DEBUG = process.env.TWENTY_DEBUG === '1';

/**
 * A deliberately thin GraphQL-over-HTTP client.
 *
 * We do NOT use `twenty-client-sdk`'s `CoreApiClient` (its constructor throws
 * unless code is generated per-workspace) nor the genql metadata client (pins
 * us to a large schema snapshot). A ~50-line fetch wrapper keeps the prototype
 * portable across any Twenty workspace and trivial to review for upstreaming.
 */
export class GraphQLClient {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
  ) {}

  async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      throw new CliError(
        `cannot reach ${this.endpoint}: ${(err as Error).message}`,
        EXIT.API,
      );
    }

    const text = await res.text();
    if (DEBUG) process.stderr.write(`[debug] POST ${this.endpoint} -> ${res.status}\n`);

    if (!res.ok) {
      throw new CliError(
        `${res.status} ${res.statusText} from ${this.endpoint}${text ? `: ${truncate(text)}` : ''}`,
        exitCodeForStatus(res.status),
      );
    }

    let body: GraphQLResponse<T>;
    try {
      body = JSON.parse(text) as GraphQLResponse<T>;
    } catch {
      throw new CliError(`invalid JSON from ${this.endpoint}: ${truncate(text)}`, EXIT.API);
    }

    if (body.errors?.length) {
      const message = body.errors.map((e) => e.message).join('; ');
      throw new CliError(message, exitCodeForGraphQLError(body.errors));
    }
    if (body.data === undefined) {
      throw new CliError(`empty response from ${this.endpoint}`, EXIT.API);
    }
    return body.data;
  }
}

/** Classifies a GraphQL error — preferring Twenty's `extensions.code` over the message. */
function exitCodeForGraphQLError(errors: GraphQLError[]): typeof EXIT[keyof typeof EXIT] {
  const codes = errors.map((e) => (e.extensions?.code ?? '').toUpperCase());
  if (codes.some((c) => ['UNAUTHENTICATED', 'UNAUTHORIZED', 'FORBIDDEN'].includes(c))) {
    return EXIT.AUTH;
  }
  if (codes.includes('NOT_FOUND')) return EXIT.NOT_FOUND;

  const m = errors.map((e) => e.message).join(' ').toLowerCase();
  if (/unauthor|forbidden|no payload|jwt|expired|unauthenticated|authentication|invalid token/.test(m)) {
    return EXIT.AUTH;
  }
  if (/not found|does not exist/.test(m)) return EXIT.NOT_FOUND;
  return EXIT.API;
}

function truncate(s: string, max = 300): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
