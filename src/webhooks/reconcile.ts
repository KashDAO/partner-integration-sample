/**
 * What to do with each Kash webhook event.
 *
 * A webhook says "something changed"; it is not the source of truth.
 * Deliveries can repeat and arrive out of order, so each handler below
 * re-reads the current state from the API and acts on that. Where your app
 * stores state, compare the payload's timestamp with what you hold and
 * ignore an older event.
 */

import type { KashClient, WebhookEvent } from '@kashdao/sdk';

import { formatUsdc } from '../format.js';

export function createReconciler(kash: KashClient): (event: WebhookEvent) => Promise<void> {
  return async (event) => {
    const log = (message: string): void => console.log(`[${event.type} ${event.id}] ${message}`);

    switch (event.type) {
      // ---- Trades ---------------------------------------------------------
      // Trade webhooks carry no account id. Match them to your user by the
      // trade id you stored, or by your own reference in `metadata`.
      case 'trade.confirmation-required': {
        log(
          `trade ${event.data.tradeId} needs the user's confirmation by ${event.data.confirmationExpiresAt}`
        );
        return;
      }
      case 'trade.completed':
      case 'trade.failed':
      case 'trade.rejected': {
        const { tradeId, metadata } = event.data;
        const accountId = metadata['kashAccountId'];
        if (accountId === undefined) {
          log(
            `trade ${tradeId} is ${event.data.status}; look it up by trade id in your own records`
          );
          return;
        }
        const trade = await kash.trades.get(tradeId, { account: accountId });
        log(
          `order ${metadata['exampleWalletOrderId'] ?? '(none)'}: trade ${trade.id} is now ${trade.status}` +
            (trade.errorCode === null ? '' : ` (${trade.errorCode})`)
        );
        return;
      }

      // ---- Accounts -------------------------------------------------------
      case 'account.active': {
        const account = await kash.partnerAccounts.get(event.data.accountId);
        log(
          `account for ${account.externalId} is ${account.status}; fund it on Solana at ${account.depositAddress ?? '(none)'}`
        );
        return;
      }
      case 'account.provisioning_failed': {
        // Final. Release the account and create it again, which gives it a
        // new accountId; tell Kash if it recurs.
        log(`account for ${event.data.externalId} could not be created: ${event.data.reason}`);
        return;
      }
      case 'account.destination_changed': {
        // Withdrawals are held for 24 hours from changedAt. If your app did
        // not make this change, suspend the account and contact Kash.
        const { previousDestination: before, destination: after } = event.data;
        log(
          `destination changed at ${event.data.changedAt} from ${before.network} ${before.address} ` +
            `to ${after.network} ${after.address}; check that your app made this change`
        );
        return;
      }
      case 'account.released': {
        log(
          `your link to the account for ${event.data.externalId} ended; no further events follow`
        );
        return;
      }

      // ---- Withdrawals ----------------------------------------------------
      case 'withdrawal.submitted':
      case 'withdrawal.completed':
      case 'withdrawal.failed': {
        const withdrawal = await kash.partnerAccounts.withdrawals.get(
          event.data.accountId,
          event.data.withdrawalId
        );
        const reason = event.type === 'withdrawal.failed' ? ` (${event.data.errorCode})` : '';
        log(
          `withdrawal ${withdrawal.withdrawalId} of ${formatUsdc(withdrawal.amountAtomic)} is now ${withdrawal.status}${reason}`
        );
        return;
      }

      // ---- Payouts --------------------------------------------------------
      case 'payout.completed': {
        const balance = await kash.balance.get({ account: event.data.accountId });
        log(
          `${formatUsdc(event.data.amountAtomic)} paid out for market ${event.data.marketId}; ` +
            `${formatUsdc(balance.availableAtomic)} now available`
        );
        return;
      }

      default: {
        // Every event type this SDK version knows is handled above, so this
        // line fails to compile when an SDK upgrade adds one.
        const unhandled: never = event;
        log(`no handler for ${String((unhandled as { type?: unknown }).type)}`);
      }
    }
  };
}
