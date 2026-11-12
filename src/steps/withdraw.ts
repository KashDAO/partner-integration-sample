/**
 * Step 5: withdraw USDC to the account's registered destination.
 *
 *   npm run withdraw -- --account <accountId> --amount <USDC atomic units>
 *
 * Optional:
 *   --request-id <your own reference> (default: a new UUID). It becomes the
 *     idempotency key: retrying with the same one can never withdraw twice.
 *   --quote-only to show the quote and stop before withdrawing.
 *
 * Funds only ever go to the destination registered on the account; the
 * request names just the amount. Every amount here is in ATOMIC units.
 */

import { randomUUID } from 'node:crypto';

import type { KashClient } from '@kashdao/sdk';
import type { PartnerWithdrawalQuote, PartnerWithdrawalResource } from '@kashdao/sdk/partner';

import { getKashClient } from '../client.js';
import {
  StepStoppedError,
  isMain,
  logStatusChanges,
  parseAtomicAmount,
  parseFlags,
  requireFlag,
  runMain,
} from '../cli.js';
import { formatAtomicUsdc, formatDisclosedAtomicUsdc } from '../format.js';

export type WithdrawInput = {
  readonly accountId: string;
  readonly amountAtomic: string;
  /** Your own reference for this withdrawal; one per withdrawal you intend. */
  readonly requestId: string;
};

/**
 * What a withdrawal would deliver and cost now. Show the fee and the total
 * to the user before they confirm. A quote is not a promise: the withdrawal
 * also checks that the account is active and the 24-hour hold after a
 * destination change.
 */
export async function quoteWithdrawal(
  kash: KashClient,
  accountId: string,
  amountAtomic: string
): Promise<PartnerWithdrawalQuote> {
  const quote = await kash.partnerAccounts.withdrawals.quote(accountId, { amountAtomic });
  const { destination } = quote;
  console.log(
    `Quote for ${formatAtomicUsdc(amountAtomic)} to ${destination.network} ${destination.address}:`
  );
  console.log(
    `  arrives:          ${quote.receiveEstimated ? 'at least ' : ''}${formatAtomicUsdc(quote.receiveAtomic)}`
  );
  // The fee fields are optional: absent means "not disclosed", never zero.
  const feeQualifier = quote.networkFeeEstimated === true ? 'at most ' : '';
  const fee = formatDisclosedAtomicUsdc(quote.networkFeeAtomic);
  console.log(
    `  network fee:      ${quote.networkFeeAtomic === undefined ? fee : feeQualifier + fee}`
  );
  console.log(`  leaves balance:   ${formatDisclosedAtomicUsdc(quote.totalDebitAtomic)}`);
  console.log(`  most withdrawable now: ${formatAtomicUsdc(quote.maxAmountAtomic)}`);
  return quote;
}

export async function withdraw(
  kash: KashClient,
  input: WithdrawInput
): Promise<PartnerWithdrawalResource> {
  const { accountId, amountAtomic, requestId } = input;
  console.log(
    `Withdrawal request ${requestId} (pass --request-id ${requestId} to retry it safely)`
  );

  // 1. Quote, so the user sees what arrives and what it costs.
  const quote = await quoteWithdrawal(kash, accountId, amountAtomic);
  if (BigInt(amountAtomic) > BigInt(quote.maxAmountAtomic)) {
    throw new StepStoppedError(
      `${formatAtomicUsdc(amountAtomic)} is more than the ${formatAtomicUsdc(quote.maxAmountAtomic)} the account can withdraw now.`
    );
  }

  // 2. Create it. The idempotency key is required: reuse it for every retry
  //    of this withdrawal. The SDK itself retries with the same key when
  //    Kash answers IDEMPOTENCY_REQUEST_IN_PROGRESS.
  const { withdrawal, outcome, idempotentReplay } = await kash.partnerAccounts.withdrawals.create(
    accountId,
    { amountAtomic },
    { idempotencyKey: `withdraw-${requestId}` }
  );
  console.log(
    `Withdrawal ${withdrawal.withdrawalId}: ${withdrawal.status} (${outcome}` +
      `${idempotentReplay ? ', stored answer to an earlier request with this key' : ''})`
  );

  // 3. Wait for completed, failed or cancelled. In production the
  //    withdrawal.completed or withdrawal.failed webhook tells you without
  //    polling.
  return kash.partnerAccounts.withdrawals.waitForCompletion(accountId, withdrawal.withdrawalId, {
    pollIntervalMs: 3_000,
    timeoutMs: 300_000,
    onStatus: logStatusChanges(),
  });
}

export function printWithdrawalResult(w: PartnerWithdrawalResource): void {
  // Statuses are an open set: give the switch a default for ones added later.
  switch (w.status) {
    case 'completed':
      console.log(
        `Withdrawal completed. Delivered: ${
          w.deliveredAmountAtomic === null
            ? '(not measured)'
            : formatAtomicUsdc(w.deliveredAmountAtomic)
        }`
      );
      console.log(`  network fee charged: ${formatDisclosedAtomicUsdc(w.networkFeeAtomic)}`);
      console.log(
        `  transaction: ${w.destinationTransactionHash ?? w.transactionHash ?? '(not recorded)'}`
      );
      break;
    case 'failed':
    case 'cancelled':
      console.log(
        `Withdrawal ${w.status}. Nothing was delivered; the withdrawal.failed webhook says why.`
      );
      break;
    default:
      console.log(`Withdrawal is ${w.status}.`);
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(['account', 'amount', 'request-id'], ['quote-only']);
  const accountId = requireFlag(flags.account, 'account');
  const amountAtomic = parseAtomicAmount(flags.amount, 'amount');
  if (flags['quote-only'] === true) {
    await quoteWithdrawal(getKashClient(), accountId, amountAtomic);
    return;
  }
  const result = await withdraw(getKashClient(), {
    accountId,
    amountAtomic,
    requestId: flags['request-id'] ?? randomUUID(),
  });
  printWithdrawalResult(result);
}

if (isMain(import.meta.url)) await runMain(main);
