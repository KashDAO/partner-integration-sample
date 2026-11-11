/**
 * How a partner branches on Kash errors.
 *
 * Every failure from the SDK is a `KashError` subclass with a stable `code`.
 * Compare `err.code` with `KASH_ERROR_CODE` rather than string literals, and
 * keep a `default` branch: the API adds codes without an SDK release.
 *
 * The SDK already retries what is safe to retry (429, 5xx, timeouts, network
 * errors) with backoff, so an error that reaches you has used up those
 * retries. What is left is for your app to decide.
 */

import {
  KASH_ERROR_CODE,
  KashConflictError,
  KashError,
  KashRateLimitError,
  KashServerError,
} from '@kashdao/sdk';

import { ConfigError } from './config.js';

/**
 * What the error means for a partner, and what to do next. Returns `undefined`
 * for codes this sample does not explain.
 */
export function partnerAdvice(err: KashError): string | undefined {
  const retryAfter = retryAfterSeconds(err);
  switch (err.code) {
    case KASH_ERROR_CODE.WITHDRAWALS_HELD:
      return (
        'Withdrawals are held for 24 hours after a destination change. ' +
        `Try again in ${formatSeconds(retryAfter)}. If you did not change the destination, ` +
        'suspend the account and contact Kash.'
      );
    case KASH_ERROR_CODE.INSUFFICIENT_BALANCE:
      return (
        'The amount is more than the account can spend. Read `availableAtomic` from the ' +
        'balance, or `maxAmountAtomic` from a withdrawal quote, and ask for less.'
      );
    case KASH_ERROR_CODE.ACCOUNT_NOT_ACTIVE:
      return (
        'The account is not active: it is still provisioning, suspended, or failed to ' +
        'provision (the message says which). Wait for the account.active webhook, or ' +
        'reactivate a suspended account.'
      );
    case KASH_ERROR_CODE.RATE_LIMIT_EXCEEDED:
      return (
        `A rate limit ran out. Try again in ${formatSeconds(retryAfter)}. Each account allows ` +
        '60 requests a minute on the calls made for it, so poll less often or use webhooks.'
      );
    case KASH_ERROR_CODE.DESTINATION_NOT_SUPPORTED:
      return (
        'Kash cannot withdraw to this destination network here. On staging, withdrawals to ' +
        'Arc are not available: test withdrawals with a Solana destination.'
      );
    case KASH_ERROR_CODE.IDEMPOTENCY_REQUEST_IN_PROGRESS:
      return (
        'An earlier request with this Idempotency-Key is still running. Nothing was refused: ' +
        'retry with the SAME key to receive its answer. A new key could act twice.'
      );
    case KASH_ERROR_CODE.IDEMPOTENCY_KEY_CONFLICT:
      return (
        'This Idempotency-Key was already used with a different request. Reuse a key only ' +
        'for a retry of the same request, with the same body.'
      );
    case KASH_ERROR_CODE.WITHDRAWAL_BELOW_MINIMUM:
      return 'The amount is below the minimum for this network or its fee; the message names the figure.';
    case KASH_ERROR_CODE.ACCOUNT_NOT_FOUND:
      return 'No account with this id: it is unknown, belongs to another partner, or was released.';
    case KASH_ERROR_CODE.PARTNER_KEY_REQUIRES_IP_ALLOWLIST:
      return 'Production partner keys need a specific IP allowlist. Edit the key in Kash and list your servers.';
    case KASH_ERROR_CODE.DEPENDENCY_UNAVAILABLE:
      return 'Kash could not read something it needs. Nothing changed, so it is safe to retry.';
    default:
      return undefined;
  }
}

/** A readable, secret-free description of any error the sample can hit. */
export function describeError(err: unknown): string {
  if (KashError.isKashError(err)) {
    const lines = [
      `${err.name} (${err.code}${err.statusCode === undefined ? '' : `, HTTP ${err.statusCode}`})`,
      `  ${err.message}`,
    ];
    const advice = partnerAdvice(err);
    if (advice !== undefined) lines.push(`  What to do: ${advice}`);
    if (err.requestId !== undefined)
      lines.push(`  Request id (quote it to Kash support): ${err.requestId}`);
    return lines.join('\n');
  }
  if (err instanceof ConfigError) return `Configuration: ${err.message}`;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return `Unexpected error: ${String(err)}`;
}

/** The server's Retry-After, on the error classes that carry one. */
function retryAfterSeconds(err: KashError): number | undefined {
  if (
    err instanceof KashConflictError ||
    err instanceof KashRateLimitError ||
    err instanceof KashServerError
  ) {
    return err.retryAfterSeconds;
  }
  return undefined;
}

function formatSeconds(seconds: number | undefined): string {
  if (seconds === undefined) return 'a little while';
  if (seconds < 120) return `${seconds} seconds`;
  if (seconds < 7200) return `${Math.ceil(seconds / 60)} minutes`;
  return `${Math.ceil(seconds / 3600)} hours`;
}
