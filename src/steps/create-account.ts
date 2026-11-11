/**
 * Step 1: create a Kash account for one of your users.
 *
 *   npm run create-account -- --external-id <your user id> \
 *     --destination <the user's Solana address> --country <ISO country, e.g. GB>
 *
 * Optional: --network solana|arc (default solana), --email <address>,
 * --accepted-at <ISO time the user agreed> (default now),
 * --terms-version <terms the user saw>.
 *
 * Call this when the user opts in, for example by tapping a button in your
 * app. The new account starts in `provisioning`; Kash sends `account.active`
 * with its Solana deposit address once its wallet is ready.
 */

import { createHash } from 'node:crypto';

import type { KashClient, PartnerAccountCreateResult } from '@kashdao/sdk';

import { getKashClient } from '../client.js';
import { UsageError, isMain, parseFlags, requireFlag, runMain } from '../cli.js';

import { printAccount } from './account.js';

/** The version of the terms your user accepted in your app. */
export const DEFAULT_TERMS_VERSION = 'kash-partner-2026-11';

export type CreateAccountInput = {
  /** Your own id for the user, unique in your organisation. */
  readonly externalId: string;
  /** Where the user's withdrawals go: their own address in your app. */
  readonly destination: { readonly network: string; readonly address: string };
  /** The user's real country, ISO 3166-1 alpha-2 in upper case. */
  readonly country: string;
  /** When the user agreed, as recorded by your app. Not in the future. */
  readonly acceptedAt: string;
  readonly termsVersion: string;
  readonly email?: string;
};

/**
 * Creates the account. Safe to call again for the same user: Kash answers
 * with the account you already hold for that `externalId` (`outcome:
 * 'existing'`) and creates nothing.
 */
export async function createAccount(
  kash: KashClient,
  input: CreateAccountInput
): Promise<PartnerAccountCreateResult> {
  return kash.partnerAccounts.create(
    {
      externalId: input.externalId,
      destination: { network: input.destination.network, address: input.destination.address },
      country: input.country,
      consent: { acceptedAt: input.acceptedAt, termsVersion: input.termsVersion },
      ...(input.email === undefined ? {} : { email: input.email }),
    },
    { idempotencyKey: onboardingKey(input.externalId, input.acceptedAt) }
  );
}

/**
 * One Idempotency-Key per opt-in: the same user and the same consent give the
 * same key, so retrying this request after a timeout returns the first answer
 * instead of doing the work twice. Reusing a key with a different body is
 * refused (`IDEMPOTENCY_KEY_CONFLICT`), which is why the consent time, which
 * your app records once, is part of it. Hashing keeps the key inside the
 * allowed characters whatever your user ids look like.
 */
export function onboardingKey(externalId: string, acceptedAt: string): string {
  const digest = createHash('sha256').update(`${externalId}\n${acceptedAt}`).digest('hex');
  return `onboard-${digest.slice(0, 32)}`;
}

export function printCreateResult(result: PartnerAccountCreateResult): void {
  console.log(
    result.outcome === 'created'
      ? 'Created a new account. It is provisioning; account.active follows when it is ready.'
      : 'You already have an account for this externalId; nothing was created.'
  );
  if (result.idempotentReplay) {
    // The account is as it was at that first request: read it for its status now.
    console.log('(Kash returned its stored answer to an earlier request with the same key.)');
  }
  console.log(`  outcome:        ${result.outcome}`);
  printAccount(result.account);
}

async function main(): Promise<void> {
  const flags = parseFlags([
    'external-id',
    'destination',
    'network',
    'country',
    'email',
    'accepted-at',
    'terms-version',
  ]);
  const acceptedAt = flags['accepted-at'] ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(acceptedAt))) {
    throw new UsageError('--accepted-at must be an ISO 8601 time, such as 2026-11-07T09:57:00Z.');
  }
  const email = flags.email;

  const account = await createAccount(getKashClient(), {
    externalId: requireFlag(flags['external-id'], 'external-id'),
    destination: {
      network: flags.network ?? 'solana',
      address: requireFlag(flags.destination, 'destination'),
    },
    country: requireFlag(flags.country, 'country').toUpperCase(),
    acceptedAt,
    termsVersion: flags['terms-version'] ?? DEFAULT_TERMS_VERSION,
    ...(email === undefined ? {} : { email }),
  });
  printCreateResult(account);
}

if (isMain(import.meta.url)) await runMain(main);
