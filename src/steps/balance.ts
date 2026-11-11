/**
 * Step 3: read what an account holds and can spend.
 *
 *   npm run balance -- --account <accountId>
 *
 * Calls made for one user pass `account`, which the SDK sends as the
 * `Kash-Account` header.
 */

import type { BalanceResource, KashClient } from '@kashdao/sdk';

import { getKashClient } from '../client.js';
import { isMain, parseFlags, requireFlag, runMain } from '../cli.js';
import { formatUsdc } from '../format.js';

export async function getBalance(kash: KashClient, accountId: string): Promise<BalanceResource> {
  // A balance Kash cannot read is an error (DEPENDENCY_UNAVAILABLE), never a zero.
  return kash.balance.get({ account: accountId });
}

export function printBalance(balance: BalanceResource): void {
  console.log(`  on chain:               ${formatUsdc(balance.usdcAtomic)}`);
  console.log(`  held by withdrawals:    ${formatUsdc(balance.pendingWithdrawalsAtomic)}`);
  console.log(`  available to spend:     ${formatUsdc(balance.availableAtomic)}`);
  console.log(`  read from the chain at: ${balance.observedAt}`);
}

async function main(): Promise<void> {
  const flags = parseFlags(['account']);
  const accountId = requireFlag(flags.account, 'account');
  console.log(`Balance of ${accountId}:`);
  printBalance(await getBalance(getKashClient(), accountId));
}

if (isMain(import.meta.url)) await runMain(main);
