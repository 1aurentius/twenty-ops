import { CliError, EXIT } from '../api/errors.js';
import { getDefaultRemoteName, getRemote } from './remote-config.js';

export interface ResolvedRemote {
  /** Display name — a config remote name, or "env" / "flags". */
  name: string;
  apiUrl: string;
  apiKey: string;
}

/**
 * Resolves which Twenty workspace to talk to.
 *
 * Precedence:
 *   1. TWENTY_API_URL + TWENTY_API_KEY env vars (fully bypass the config file)
 *   2. `--remote <name>` flag
 *   3. TWENTY_REMOTE env var
 *   4. the config file's `defaultRemote`
 */
export function resolveRemote(remoteFlag?: string): ResolvedRemote {
  const envUrl = process.env.TWENTY_API_URL;
  const envKey = process.env.TWENTY_API_KEY;
  if (envUrl && envKey) {
    return { name: 'env', apiUrl: envUrl, apiKey: envKey };
  }

  const name = remoteFlag ?? process.env.TWENTY_REMOTE ?? getDefaultRemoteName();
  if (!name) {
    throw new CliError(
      'no remote selected — run `twenty-ops remote add <name> --url <apiUrl> --key <apiKey>`',
      EXIT.USAGE,
    );
  }

  const remote = getRemote(name);
  const apiKey = remote.apiKey ?? remote.twentyCLIAccessToken;
  if (!apiKey) {
    throw new CliError(
      `remote "${name}" has no API key — run \`twenty-ops remote add ${name} --url ${remote.apiUrl} --key <apiKey>\``,
      EXIT.AUTH,
    );
  }
  return { name, apiUrl: remote.apiUrl, apiKey };
}
