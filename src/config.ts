/**
 * Reads the sample's settings from the environment.
 *
 * `npm run <step>` loads `.env` when it exists (Node's `--env-file-if-exists`),
 * and anything already set in the shell wins over the file, so you can also
 * pass the values inline or from a secrets manager.
 */

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** The variable's value, or a `ConfigError` that says how to set it. */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ConfigError(
      `${name} is not set. Copy .env.example to .env and fill it in, or set it in your shell.`
    );
  }
  return value;
}

/** The variable's value, or `undefined` when it is unset or empty. */
export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** True when the key is a test key, which only works against Kash staging. */
export function isTestKey(apiKey: string): boolean {
  return apiKey.startsWith('kash_test_');
}
