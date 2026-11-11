/**
 * Step 5: withdraw USDC to the account's registered destination.
 *
 *   npm run withdraw -- --account <accountId> --amount <USDC atomic units>
 *
 * Optional: --request-id <your own reference> (default: a new UUID). The
 * request id is the idempotency key: retrying with the same one can never
 * withdraw twice.
 *
 * Funds only ever go to the destination registered on the account; the
 * request names just the amount.
 */

import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { KASH_ERROR_CODE, KashConflictError } from '@kashdao/sdk';
import type {
  KashClient,
  PartnerWithdrawalCreateResult,
  PartnerWithdrawalResource,
} from '@kashdao/sdk';

import { getKashClient } from '../client.js';
import {
  StepStoppedError,
  isMain,
  parseAtomicAmount,
  parseFlags,
  requireFlag,
  runMain,
} from '../cli.js';
import { formatUsdc } from '../format.js';
import { pollUntil } from '../poll.js';

/** Statuses after which a withdrawal does not change again. */
const FINAL_WITHDRAWAL_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

export type WithdrawInput = {
  readonly accountId: string;
  readonly amountAtomic: string;
  /** Your own reference for this withdrawal; one per withdrawal you intend. */
  readonly requestId: string;
};

export async function withdraw(
  kash: KashClient,
  input: WithdrawInput
): Promise<PartnerWithdrawalResource> {
  const { accountId, amountAtomic, requestId } = input;
  console.log(
    `Withdrawal request ${requestId} (pass --request-id ${requestId} to retry it safely)`
  );

  // 1. Quote: what would arrive, and the most the account can withdraw now.
  //    A quote is not a promise: the withdrawal also checks the account is
  //    active and the 24-hour hold after a destination change.
  const quote = await kash.partnerAccounts.withdrawals.quote(accountId, { amountAtomic });
  console.log(
    `Quote for ${formatUsdc(amountAtomic)} to ${quote.destination.network} ${quote.destination.address}:`
  );
  console.log(
    `  arrives:         ${quote.receiveEstimated ? 'at least ' : ''}${formatUsdc(quote.receiveAtomic)}`
  );
  console.log(`  most available:  ${formatUsdc(quote.maxAmountAtomic)}`);
  if (BigInt(amountAtomic) > BigInt(quote.maxAmountAtomic)) {
    throw new StepStoppedError(
      `${formatUsdc(amountAtomic)} is more than the ${formatUsdc(quote.maxAmountAtomic)} the account can withdraw now.`
    );
  }

  // 2. Create it with the idempotency key, which the SDK requires here.
  const created = await createWithRetry(kash, accountId, amountAtomic, `withdraw-${requestId}`);
  console.log(
    `Withdrawal ${created.withdrawalId}: ${created.status} (${created.outcome}` +
      `${created.idempotentReplay ? ', stored answer to an earlier request' : ''})`
  );

  // 3. Wait for a final status. In production the withdrawal.completed or
  //    withdrawal.failed webhook tells you without polling.
  return pollUntil(
    () => kash.partnerAccounts.withdrawals.get(accountId, created.withdrawalId),
    (w) => FINAL_WITHDRAWAL_STATUSES.has(w.status),
    {
      intervalMs: 3_000,
      timeoutMs: 300_000,
      description: `withdrawal ${created.withdrawalId} to finish`,
      onValue: logStatusChanges(),
    }
  );
}

/**
 * `IDEMPOTENCY_REQUEST_IN_PROGRESS` means an earlier request with this key is
 * still running, typically after a timeout. It is not a refusal: retry with
 * the SAME key and Kash returns that request's answer. Never switch to a new
 * key, which could withdraw twice.
 */
async function createWithRetry(
  kash: KashClient,
  accountId: string,
  amountAtomic: string,
  idempotencyKey: string
): Promise<PartnerWithdrawalCreateResult> {
  const maxAttempts = 5;
  for (let attempt = 1; ; attempt++) {
    try {
      return await kash.partnerAccounts.withdrawals.create(
        accountId,
        { amountAtomic },
        { idempotencyKey }
      );
    } catch (err) {
      const inProgress =
        err instanceof KashConflictError &&
        err.code === KASH_ERROR_CODE.IDEMPOTENCY_REQUEST_IN_PROGRESS;
      if (!inProgress || attempt >= maxAttempts) throw err;
      console.log(
        '  an earlier request with this key is still running; retrying with the same key'
      );
      await sleep(2_000 * attempt);
    }
  }
}

function logStatusChanges(): (w: PartnerWithdrawalResource) => void {
  let last: string | undefined;
  return (w) => {
    if (w.status !== last) console.log(`  status: ${w.status}`);
    last = w.status;
  };
}

export function printWithdrawalResult(w: PartnerWithdrawalResource): void {
  // Statuses are an open set: give the switch a default for ones added later.
  switch (w.status) {
    case 'completed':
      console.log(
        `Withdrawal completed. Delivered: ${
          w.deliveredAmountAtomic === null ? '(not measured)' : formatUsdc(w.deliveredAmountAtomic)
        }`
      );
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
  const flags = parseFlags(['account', 'amount', 'request-id']);
  const result = await withdraw(getKashClient(), {
    accountId: requireFlag(flags.account, 'account'),
    amountAtomic: parseAtomicAmount(flags.amount, 'amount'),
    requestId: flags['request-id'] ?? randomUUID(),
  });
  printWithdrawalResult(result);
}

if (isMain(import.meta.url)) await runMain(main);
