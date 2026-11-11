/**
 * Step 2b: find an account by YOUR id for the user (its `externalId`).
 *
 *   npm run find -- --external-id <id>
 *
 * Useful after a crash mid-onboarding, when you know your user but did not
 * store the `accountId` Kash returned.
 */

import { getKashClient } from '../client.js';
import { isMain, parseFlags, requireFlag, runMain } from '../cli.js';

import { printAccount } from './account.js';

async function main(): Promise<void> {
  const flags = parseFlags(['external-id']);
  const externalId = requireFlag(flags['external-id'], 'external-id');

  // An exact match, case included. `null` means you have no account for this
  // id: never created, or released.
  const account = await getKashClient().partnerAccounts.findByExternalId(externalId);
  if (account === null) {
    console.log(`No account for externalId "${externalId}".`);
    return;
  }
  console.log('Account:');
  printAccount(account);
}

if (isMain(import.meta.url)) await runMain(main);
