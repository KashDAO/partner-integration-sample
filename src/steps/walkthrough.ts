/**
 * Step 7: the whole journey for one user, on staging.
 *
 *   npm run walkthrough -- --external-id <your user id> \
 *     --destination <the user's Solana address> --country <ISO country>
 *
 * Optional: --market <marketId> --outcome <index> to choose what the small
 * test trade buys (default: the first tradeable market, outcome 0).
 *
 * It creates the account, waits for it to become active and reads its
 * balance. With no USDC yet it prints how to fund the account and stops.
 * Once the account holds USDC, run it again: it places a 1 USDC trade and
 * withdraws 1 USDC back to the user's Solana destination.
 *
 * It refuses a live key: it moves funds, so it is for staging only.
 */

import { randomUUID } from 'node:crypto';

import type { KashClient } from '@kashdao/sdk';

import { getKashClient } from '../client.js';
import { StepStoppedError, isMain, parseFlags, parseIndex, requireFlag, runMain } from '../cli.js';
import { isTestKey, requireEnv } from '../config.js';
import { ONE_USDC_ATOMIC, formatUsdc } from '../format.js';

import { waitForActive } from './account.js';
import { getBalance, printBalance } from './balance.js';
import { DEFAULT_TERMS_VERSION, createAccount, printCreateResult } from './create-account.js';
import { isTradeable, listOpenMarkets } from './markets.js';
import { placeTrade, printTradeResult } from './trade.js';
import { printWithdrawalResult, withdraw } from './withdraw.js';

const SMALL_AMOUNT_ATOMIC = ONE_USDC_ATOMIC.toString();

async function main(): Promise<void> {
  if (!isTestKey(requireEnv('KASH_API_KEY'))) {
    throw new StepStoppedError(
      'The walkthrough moves funds, so it runs only with a kash_test_ key.'
    );
  }
  const flags = parseFlags(['external-id', 'destination', 'country', 'market', 'outcome']);
  const destination = requireFlag(flags.destination, 'destination');
  const kash = getKashClient();

  console.log('1. Create the account');
  const created = await createAccount(kash, {
    externalId: requireFlag(flags['external-id'], 'external-id'),
    destination: { network: 'solana', address: destination },
    country: requireFlag(flags.country, 'country').toUpperCase(),
    // Your app records when the user agreed; this demo uses the current time.
    acceptedAt: new Date().toISOString(),
    termsVersion: DEFAULT_TERMS_VERSION,
  });
  printCreateResult(created);

  console.log('\n2. Wait for it to become active');
  const account = await waitForActive(kash, created.accountId);
  if (account.status !== 'active' || account.depositAddress === null) {
    throw new StepStoppedError(`The account ended in ${account.status}, not active.`);
  }

  console.log('\n3. Read its balance');
  const balance = await getBalance(kash, account.accountId);
  printBalance(balance);

  if (BigInt(balance.availableAtomic) < ONE_USDC_ATOMIC) {
    console.log('\n4. Fund the account');
    console.log(
      `  Send USDC on Solana to the account's deposit address:\n    ${account.depositAddress}`
    );
    console.log('  Send only USDC, and only on Solana.');
    console.log(
      '  On staging, ask Kash for test USDC and give them this deposit address. ' +
        'Then run the walkthrough again with the same --external-id.'
    );
    return;
  }

  console.log(`\n4. Buy ${formatUsdc(SMALL_AMOUNT_ATOMIC)} of an outcome`);
  const marketId = flags.market ?? (await firstTradeableMarket(kash));
  const trade = await placeTrade(kash, {
    accountId: account.accountId,
    marketId,
    outcomeIndex: flags.outcome === undefined ? 0 : parseIndex(flags.outcome, 'outcome'),
    amountAtomic: SMALL_AMOUNT_ATOMIC,
    orderId: randomUUID(),
  });
  printTradeResult(trade);

  console.log(`\n5. Withdraw ${formatUsdc(SMALL_AMOUNT_ATOMIC)} to the user's Solana address`);
  const after = await getBalance(kash, account.accountId);
  if (BigInt(after.availableAtomic) < ONE_USDC_ATOMIC) {
    console.log(`  Skipped: only ${formatUsdc(after.availableAtomic)} is left to withdraw.`);
    return;
  }
  const withdrawal = await withdraw(kash, {
    accountId: account.accountId,
    amountAtomic: SMALL_AMOUNT_ATOMIC,
    requestId: randomUUID(),
  });
  printWithdrawalResult(withdrawal);
}

async function firstTradeableMarket(kash: KashClient): Promise<string> {
  const markets = await listOpenMarkets(kash, { limit: 50 });
  const market = markets.find(isTradeable);
  if (market === undefined) throw new StepStoppedError('No tradeable market is open right now.');
  console.log(`  using market ${market.id}: ${market.title ?? '(untitled)'}`);
  return market.id;
}

if (isMain(import.meta.url)) await runMain(main);
