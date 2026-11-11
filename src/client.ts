/**
 * The one Kash client the whole sample shares.
 *
 * Create a single `KashClient` per process and reuse it: it holds the
 * connection settings, retries, and a small cache for conditional GETs.
 */

import { KashClient } from '@kashdao/sdk';

import { optionalEnv, requireEnv } from './config.js';

let client: KashClient | undefined;

export function getKashClient(): KashClient {
  client ??= new KashClient({
    // A partner key: kash_test_... on staging, kash_live_... in production.
    apiKey: requireEnv('KASH_API_KEY'),
    // Optional. Without it the SDK picks the URL from the key's prefix.
    ...withBaseUrl(optionalEnv('KASH_BASE_URL')),
    // Names your integration in Kash's request logs, which helps support.
    userAgentSuffix: 'example-wallet/0.1.0',
  });
  return client;
}

function withBaseUrl(baseUrl: string | undefined): { baseUrl?: string } {
  return baseUrl === undefined ? {} : { baseUrl };
}
