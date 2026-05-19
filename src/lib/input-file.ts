import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { CliError, EXIT } from '../api/errors.js';

/**
 * Loads a structured input document from a file path or stdin.
 *
 * `-` reads stdin. Otherwise the extension picks the parser: `.yaml`/`.yml`
 * use YAML, anything else uses JSON. (YAML is a JSON superset, so `.json`
 * files also parse fine under YAML — we still default to JSON for clarity.)
 */
export function loadInputFile<T = unknown>(path: string): T {
  let raw: string;
  if (path === '-') {
    raw = readFileSync(0, 'utf8');
  } else {
    try {
      raw = readFileSync(path, 'utf8');
    } catch (err) {
      throw new CliError(`cannot read ${path}: ${(err as Error).message}`, EXIT.USAGE);
    }
  }

  const useYaml = /\.ya?ml$/i.test(path);
  try {
    return (useYaml ? parseYaml(raw) : JSON.parse(raw)) as T;
  } catch (err) {
    // Fall back to the other parser before giving up — agents mislabel files.
    try {
      return (useYaml ? JSON.parse(raw) : parseYaml(raw)) as T;
    } catch {
      throw new CliError(`cannot parse ${path}: ${(err as Error).message}`, EXIT.USAGE);
    }
  }
}

/** Asserts a loaded document is an array (used by the declarative `set-*` commands). */
export function expectArray(value: unknown, path: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new CliError(`${path} must contain a JSON/YAML array`, EXIT.USAGE);
  }
  return value as Record<string, unknown>[];
}
