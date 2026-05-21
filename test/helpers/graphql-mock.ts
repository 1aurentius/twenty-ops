import { vi } from 'vitest';

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Parsed JSON body, or the raw string when JSON parse fails. */
  body: unknown;
}

export interface FetchStub {
  /**
   * Queue a JSON response for the next request whose URL *includes* `urlSubstring`.
   * Responses are consumed in FIFO order — script as many as the test makes calls.
   * Use `body = { data: ... }` for success, `body = { errors: [...] }` for errors.
   */
  reply(urlSubstring: string, body: unknown, init?: { status?: number; statusText?: string }): void;
  /** Captured calls in arrival order. */
  calls: FetchCall[];
  /** Reset to the original fetch (call in afterEach). */
  restore(): void;
}

interface ScriptedResponse {
  body: unknown;
  status: number;
  statusText: string;
}

/**
 * Replaces `globalThis.fetch` with a controllable stub. Provides:
 *   - `reply(urlSubstring, body)` — script per-URL responses
 *   - `calls` — captured calls for assertion (url, method, headers, parsed body)
 *
 * Unscripted URLs return HTTP 500 with a descriptive error so tests fail loudly
 * instead of silently going through to the real network.
 */
export function stubFetch(): FetchStub {
  const queues = new Map<string, ScriptedResponse[]>();
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;

  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();

    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k.toLowerCase()] = String(v);
      }
    }

    let body: unknown;
    if (init?.body !== undefined && init?.body !== null) {
      const raw = init.body as string;
      try { body = JSON.parse(raw); } catch { body = raw; }
    }
    calls.push({ url, method, headers, body });

    for (const [pattern, queue] of queues.entries()) {
      if (url.includes(pattern) && queue.length > 0) {
        const reply = queue.shift()!;
        return new Response(JSON.stringify(reply.body), {
          status: reply.status,
          statusText: reply.statusText,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    const error = `stubFetch: no scripted response for ${method} ${url}`;
    return new Response(JSON.stringify({ errors: [{ message: error }] }), {
      status: 500,
      statusText: 'no scripted response',
      headers: { 'content-type': 'application/json' },
    });
  });

  globalThis.fetch = impl as unknown as typeof fetch;

  return {
    reply(urlSubstring, body, init) {
      const queue = queues.get(urlSubstring) ?? [];
      queue.push({
        body,
        status: init?.status ?? 200,
        statusText: init?.statusText ?? 'OK',
      });
      queues.set(urlSubstring, queue);
    },
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}
