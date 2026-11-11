/**
 * Step 4b: quote and place a buy for one account, then wait for the result.
 *
 *   npm run trade -- --account <accountId> --market <marketId> \
 *     --outcome <index> --amount <USDC atomic units, e.g. 1000000 for 1 USDC>
 *
 * Optional: --order-id <your own order reference> (default: a new UUID).
 * Re-running with the same --order-id returns the same trade instead of
 * placing a second one.
 */

import { randomUUID } from 'node:crypto';

import { isCompletedTrade, isFailedTrade, isRejectedTrade } from '@kashdao/sdk';
import type { KashClient, TradeResource } from '@kashdao/sdk';

import { getKashClient } from '../client.js';
import {
  StepStoppedError,
  isMain,
  parseAtomicAmount,
  parseFlags,
  parseIndex,
  requireFlag,
  runMain,
} from '../cli.js';
import { atomicToDecimal, formatUsdc } from '../format.js';

import { isTradeable } from './markets.js';

export type PlaceTradeInput = {
  readonly accountId: string;
  readonly marketId: string;
  readonly outcomeIndex: number;
  /** USDC to spend, in atomic units. */
  readonly amountAtomic: string;
  /** Your own reference for this order; it doubles as the idempotency key. */
  readonly orderId: string;
};

export async function placeTrade(kash: KashClient, input: PlaceTradeInput): Promise<TradeResource> {
  const { accountId, marketId, outcomeIndex, amountAtomic, orderId } = input;
  console.log(`Order ${orderId} (pass --order-id ${orderId} to retry this same order safely)`);

  // 1. Check the market takes trades and has this outcome.
  const market = await kash.markets.get(marketId);
  if (!isTradeable(market)) {
    throw new StepStoppedError(
      `Market ${marketId} does not take trades now (${market.notTradeableReason ?? 'not stated'}).`
    );
  }
  const outcome = market.outcomes.find((o) => o.index === outcomeIndex);
  if (outcome === undefined) {
    throw new StepStoppedError(
      `Market ${marketId} has outcomes 0 to ${market.outcomes.length - 1}; there is no ${outcomeIndex}.`
    );
  }

  // 2. Quote it, as your app would to show the user a preview. Quotes act
  //    for no account and are cached by Kash for about 10 seconds.
  const quote = await kash.quotes.buy({
    marketId,
    outcomeIndex,
    amountUsdcAtomic: BigInt(amountAtomic),
  });
  console.log(
    `Quote: ${formatUsdc(amountAtomic)} on "${outcome.label}" (${market.title ?? marketId})`
  );
  console.log(`  tokens out:          ${formatTokens(quote.tokensOut)}`);
  console.log(`  effective price:     ${quote.effectivePrice}`);
  if (quote.impliedProbability !== null) {
    console.log(`  probability after:   ${(quote.impliedProbability * 100).toFixed(1)}%`);
  }

  // 3. Make sure the account can pay. Kash checks this too; checking first
  //    gives your user a clear message instead of a failed trade.
  const balance = await kash.balance.get({ account: accountId });
  if (BigInt(balance.availableAtomic) < BigInt(amountAtomic)) {
    throw new StepStoppedError(
      `The account has ${formatUsdc(balance.availableAtomic)} available, less than ${formatUsdc(amountAtomic)}.`
    );
  }

  // 4. Place it for the account. `amount` is a USDC decimal string here, not
  //    atomic units. Metadata comes back on every trade webhook, which is how
  //    you match a trade webhook to your own order and user: trade webhooks
  //    do not carry the account id.
  const trade = await kash.trades.create(
    {
      marketId,
      outcomeIndex,
      amount: atomicToDecimal(amountAtomic),
      side: 'buy',
      metadata: { exampleWalletOrderId: orderId, kashAccountId: accountId },
    },
    { account: accountId, idempotencyKey: `trade-${orderId}` }
  );
  console.log(
    `Trade ${trade.id}: ${trade.status}${trade.idempotent ? ' (an earlier request with this order id)' : ''}`
  );

  // 5. A high-value trade waits for the user to confirm. Your app shows the
  //    user what they are about to do and calls kash.trades.confirm with the
  //    one-time token only if they agree; this sample stops instead.
  if (trade.confirmation !== undefined) {
    throw new StepStoppedError(
      `Trade ${trade.id} needs the user's confirmation before ${trade.confirmation.expiresAt}: ` +
        'call kash.trades.confirm(trade.id, { token }, { account }) once they agree.'
    );
  }

  // 6. Wait for a final status. In production the trade.completed,
  //    trade.failed or trade.rejected webhook tells you without polling.
  return kash.trades.waitForCompletion(trade.id, {
    account: accountId,
    timeoutMs: 120_000,
    onStatus: (t) => console.log(`  status: ${t.status}`),
  });
}

export function printTradeResult(trade: TradeResource): void {
  if (isCompletedTrade(trade)) {
    console.log(`Trade completed. Transaction: ${trade.txHash ?? '(not reported)'}`);
    if (trade.tokensOut !== null)
      console.log(`  tokens received: ${formatTokens(trade.tokensOut)}`);
  } else if (isFailedTrade(trade) || isRejectedTrade(trade)) {
    console.log(
      `Trade ${trade.status}: ${trade.errorCode ?? 'no code'} ${trade.errorMessage ?? ''}`
    );
  } else {
    console.log(`Trade is ${trade.status}.`);
  }
}

/** Outcome tokens are 18-decimal fixed point (WAD); shown to 4 places. */
function formatTokens(wad: string): string {
  const scaled = BigInt(wad) / 10n ** 14n; // 4 decimal places
  const whole = scaled / 10_000n;
  const fraction = (scaled % 10_000n).toString().padStart(4, '0');
  return `${whole}.${fraction}`;
}

async function main(): Promise<void> {
  const flags = parseFlags(['account', 'market', 'outcome', 'amount', 'order-id']);
  const trade = await placeTrade(getKashClient(), {
    accountId: requireFlag(flags.account, 'account'),
    marketId: requireFlag(flags.market, 'market'),
    outcomeIndex: parseIndex(flags.outcome, 'outcome'),
    amountAtomic: parseAtomicAmount(flags.amount, 'amount'),
    orderId: flags['order-id'] ?? randomUUID(),
  });
  printTradeResult(trade);
}

if (isMain(import.meta.url)) await runMain(main);
