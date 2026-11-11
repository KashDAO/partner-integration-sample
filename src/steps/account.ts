/**
 * Step 2a: read one account by Kash's `accountId`.
 *
 *   npm run account -- --id <accountId>
 *
 * Also exports `waitForActive`, which polls until a new account has its
 * wallet. In production, the `account.active` webhook tells you the same
 * thing without polling.
 */

import type { KashClient, PartnerAccountResource } from '@kashdao/sdk';

import { getKashClient } from '../client.js';
import { isMain, parseFlags, requireFlag, runMain } from '../cli.js';
import { pollUntil } from '../poll.js';

export function printAccount(account: PartnerAccountResource): void {
  console.log(`  accountId:      ${account.accountId}`);
  console.log(`  externalId:     ${account.externalId}`);
  console.log(`  status:         ${account.status}`);
  console.log(
    `  depositAddress: ${account.depositAddress ?? '(none until the account is active)'}`
  );
  console.log(`  destination:    ${account.destination.network} ${account.destination.address}`);
  console.log(`  country:        ${account.country}`);
  console.log(`  createdAt:      ${account.createdAt}`);
}

/**
 * Polls the account until it leaves `provisioning`, and returns it. The
 * caller decides what a final status other than `active` means.
 */
export async function waitForActive(
  kash: KashClient,
  accountId: string,
  timeoutMs = 120_000
): Promise<PartnerAccountResource> {
  let last: string | undefined;
  return pollUntil(
    () => kash.partnerAccounts.get(accountId),
    (account) => account.status !== 'provisioning',
    {
      intervalMs: 2_000,
      timeoutMs,
      description: `account ${accountId} to finish provisioning`,
      onValue: (account) => {
        if (account.status !== last) console.log(`  status: ${account.status}`);
        last = account.status;
      },
    }
  );
}

async function main(): Promise<void> {
  const flags = parseFlags(['id']);
  const accountId = requireFlag(flags.id, 'id');
  const account = await getKashClient().partnerAccounts.get(accountId);
  console.log('Account:');
  printAccount(account);
}

if (isMain(import.meta.url)) await runMain(main);
