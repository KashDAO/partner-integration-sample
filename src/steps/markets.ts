/**
 * Step 4a: list open markets to show in your app.
 *
 *   npm run markets
 *   npm run markets -- --limit 20 --category crypto
 *
 * Shows only markets worth offering a user: tradeable now, not closing
 * within the hour, and not one of staging's automated test fixtures.
 * Markets and quotes act for no account, so these calls take no `account`.
 */

import type { KashClient, MarketResource } from '@kashdao/sdk';

import { getKashClient } from '../client.js';
import { UsageError, isMain, parseFlags, runMain } from '../cli.js';

/** A market closing sooner than this is not offered: a new position would barely run. */
const MIN_TIME_LEFT_MS = 60 * 60 * 1000;

/** Staging runs automated end-to-end markets whose titles start with this. */
const STAGING_FIXTURE_PREFIX = 'zz-fixture';

/** Up to `limit` markets worth offering, walking pages as filtering needs. */
export async function listOpenMarkets(
  kash: KashClient,
  options: { readonly limit: number; readonly category?: string }
): Promise<readonly MarketResource[]> {
  const page = await kash.markets.list({
    status: 'ACTIVE',
    chain: 'solana',
    limit: 100,
    ...(options.category === undefined ? {} : { category: options.category }),
  });
  const now = Date.now();
  const offerable: MarketResource[] = [];
  for await (const market of page) {
    if (isOfferable(market, now)) offerable.push(market);
    if (offerable.length >= options.limit) break;
  }
  return offerable;
}

/** Tradeable now, not a staging fixture, and not closing within the hour. */
export function isOfferable(market: MarketResource, now: number): boolean {
  if (!isTradeable(market)) return false;
  if (market.title?.startsWith(STAGING_FIXTURE_PREFIX) === true) return false;
  const closesAt = market.freezeAt ?? market.expiresAt;
  return (
    closesAt === null || closesAt === undefined || Date.parse(closesAt) - now > MIN_TIME_LEFT_MS
  );
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
