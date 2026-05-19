import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CliError, EXIT } from '../api/errors.js';

/**
 * Reads and writes `~/.twenty/config.json` — the SAME file the official
 * `twenty-sdk` CLI uses, so authentication is shared between the two tools.
 *
 * Observed file shape (twenty-sdk v2.3):
 *   { "version": 1, "remotes": { "<name>": RemoteConfig }, "defaultRemote": "<name>" }
 *
 * Unknown top-level keys and unknown RemoteConfig keys are preserved on write
 * so we never corrupt config written by twenty-sdk.
 */
export interface RemoteConfig {
  apiUrl: string;
  apiKey?: string;
  twentyCLIAccessToken?: string;
  [key: string]: unknown;
}

interface TwentyConfig {
  version?: number;
  remotes?: Record<string, RemoteConfig>;
  defaultRemote?: string;
  [key: string]: unknown;
}

export function configPath(): string {
  return join(homedir(), '.twenty', 'config.json');
}

export function readConfig(): TwentyConfig {
  const path = configPath();
  if (!existsSync(path)) return { version: 1, remotes: {} };
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as TwentyConfig;
  } catch (err) {
    throw new CliError(`cannot parse ${path}: ${(err as Error).message}`, EXIT.GENERIC);
  }
}

function writeConfig(config: TwentyConfig): void {
  const path = configPath();
  mkdirSync(join(homedir(), '.twenty'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function listRemotes(): { name: string; apiUrl: string; hasKey: boolean; isDefault: boolean }[] {
  const config = readConfig();
  const remotes = config.remotes ?? {};
  return Object.entries(remotes).map(([name, r]) => ({
    name,
    apiUrl: r.apiUrl,
    hasKey: Boolean(r.apiKey ?? r.twentyCLIAccessToken),
    isDefault: name === config.defaultRemote,
  }));
}

export function getRemote(name: string): RemoteConfig {
  const config = readConfig();
  const remote = config.remotes?.[name];
  if (!remote) {
    const known = Object.keys(config.remotes ?? {});
    throw new CliError(
      `remote "${name}" not found${known.length ? ` (known: ${known.join(', ')})` : ''}`,
      EXIT.NOT_FOUND,
    );
  }
  return remote;
}

export function getDefaultRemoteName(): string | undefined {
  return readConfig().defaultRemote;
}

/** Adds or replaces a remote, preserving every other key in the file. */
export function upsertRemote(name: string, apiUrl: string, apiKey: string): void {
  const config = readConfig();
  config.version ??= 1;
  config.remotes ??= {};
  config.remotes[name] = { ...config.remotes[name], apiUrl, apiKey };
  config.defaultRemote ??= name;
  writeConfig(config);
}

export function removeRemote(name: string): void {
  const config = readConfig();
  if (!config.remotes?.[name]) {
    throw new CliError(`remote "${name}" not found`, EXIT.NOT_FOUND);
  }
  delete config.remotes[name];
  if (config.defaultRemote === name) {
    config.defaultRemote = Object.keys(config.remotes)[0];
  }
  writeConfig(config);
}

export function setDefaultRemote(name: string): void {
  const config = readConfig();
  if (!config.remotes?.[name]) {
    throw new CliError(`remote "${name}" not found`, EXIT.NOT_FOUND);
  }
  config.defaultRemote = name;
  writeConfig(config);
}
