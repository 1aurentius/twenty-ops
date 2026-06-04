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
      const exitCode = exitCodeForGraphQLError(body.errors);
      let message = body.errors.map((e) => e.message).join('; ');
      // Twenty's NOT_FOUND errors carry the bare message "Record not found"
      // — which doesn't tell an agent WHICH record. When the query has a
      // simple `$id` variable (the common get-by-id pattern) or an
      // `{input:{id}}` wrapper (the metadata API pattern), append the id
      // so the agent sees which record blew up.
      if (exitCode === EXIT.NOT_FOUND && variables && /record not found|does not exist/i.test(message)) {
        let candidate: string | undefined;
        if (typeof variables.id === 'string') {
          candidate = variables.id;
        } else if (
          variables.input &&
          typeof (variables.input as { id?: unknown }).id === 'string'
        ) {
          candidate = (variables.input as { id: string }).id;
        }
        if (candidate !== undefined) {
          message = `${message} (id: ${candidate})`;
        }
      }
      throw new CliError(message, exitCode);
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
  if (/unauthor|forbidden|no payload|jwt|expired|unauthenticated|authentication|invalid token|user context/.test(m)) {
    return EXIT.AUTH;
  }
  if (/not found|does not exist/.test(m)) return EXIT.NOT_FOUND;
  return EXIT.API;
}

function truncate(s: string, max = 300): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
