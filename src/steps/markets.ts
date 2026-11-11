/**
 * Step 4a: list open markets to show in your app.
 *
 *   npm run markets
 *   npm run markets -- --limit 20 --category crypto
 *
 * Markets and quotes act for no account, so these calls take no `account`.
 */

import type { KashClient, MarketResource } from '@kashdao/sdk';

import { getKashClient } from '../client.js';
import { UsageError, isMain, parseFlags, runMain } from '../cli.js';

export async function listOpenMarkets(
  kash: KashClient,
  options: { readonly limit: number; readonly category?: string }
): Promise<readonly MarketResource[]> {
  const page = await kash.markets.list({
    status: 'ACTIVE',
    chain: 'solana',
    limit: options.limit,
    ...(options.category === undefined ? {} : { category: options.category }),
  });
  return page.data;
}

/**
 * Whether Kash will accept a trade on the market right now. Read `tradeable`
 * rather than `status`: a cancelled or frozen market can still say `ACTIVE`.
 * A missing `tradeable` means "not stated", so do not treat it as yes.
 */
export function isTradeable(market: MarketResource): boolean {
  return market.tradeable === true;
}

export function printMarket(market: MarketResource): void {
  const tradeable = isTradeable(market)
    ? 'tradeable'
    : `not tradeable (${market.notTradeableReason ?? 'not stated'})`;
  console.log(`\n${market.title ?? '(untitled market)'}`);
  console.log(`  id: ${market.id}  ${tradeable}`);
  if (market.expiresAt !== null) console.log(`  expires: ${market.expiresAt}`);
  for (const outcome of market.outcomes) {
    const percent = (outcome.probability * 100).toFixed(1);
    console.log(`  [${outcome.index}] ${outcome.label}: ${percent}%`);
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(['limit', 'category']);
  const limit = flags.limit === undefined ? 10 : Number(flags.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new UsageError('--limit must be a whole number from 1 to 100.');
  }
  const markets = await listOpenMarkets(getKashClient(), {
    limit,
    ...(flags.category === undefined ? {} : { category: flags.category }),
  });
  if (markets.length === 0) {
    console.log('No open markets right now.');
    return;
  }
  console.log(`${markets.length} open market(s):`);
  markets.forEach(printMarket);
}

if (isMain(import.meta.url)) await runMain(main);
