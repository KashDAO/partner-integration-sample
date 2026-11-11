/**
 * Step 2a: read one account by Kash's `accountId`.
 *
 *   npm run account -- --id <accountId>
 */

import type { PartnerAccountResource } from '@kashdao/sdk';

import { getKashClient } from '../client.js';
import { isMain, parseFlags, requireFlag, runMain } from '../cli.js';

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

async function main(): Promise<void> {
  const flags = parseFlags(['id']);
  const accountId = requireFlag(flags.id, 'id');
  const account = await getKashClient().partnerAccounts.get(accountId);
  console.log('Account:');
  printAccount(account);
}

if (isMain(import.meta.url)) await runMain(main);
