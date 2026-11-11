/**
 * USDC amounts, in the two units the Kash API uses.
 *
 * - ATOMIC: an integer string of 6-decimal units, `'2500000'` is 2.5 USDC.
 *   Balances, quotes (`amountUsdcAtomic`), withdrawals and their fees, and
 *   webhook amounts all use it. This sample's flags take atomic units too.
 * - DECIMAL: a USDC string with up to 6 decimal places, `'2.5'`. Only
 *   `trades.create`'s `amount` takes it; convert with `atomicToTradeAmount`.
 *
 * Never use floating point for money; these helpers work on strings and
 * bigints only.
 */

const USDC_DECIMALS = 6;
const USDC_SCALE = 10n ** BigInt(USDC_DECIMALS);

/** One USDC in atomic units. */
export const ONE_USDC_ATOMIC = USDC_SCALE;

/**
 * Converts an atomic amount to the DECIMAL string `trades.create` takes:
 * `'2500000'` becomes `'2.5'`.
 */
export function atomicToTradeAmount(atomic: string | bigint): string {
  const value = BigInt(atomic);
  const whole = value / USDC_SCALE;
  const fraction = (value % USDC_SCALE).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '');
  return fraction === '' ? whole.toString() : `${whole}.${fraction}`;
}

/** An atomic amount for display: `'2500000'` becomes `'2.5 USDC'`. */
export function formatAtomicUsdc(atomic: string | bigint): string {
  return `${atomicToTradeAmount(atomic)} USDC`;
}

/**
 * An optional fee or total from the API, for display. The API omits these
 * when it does not disclose them; absent means "not disclosed", never zero.
 */
export function formatDisclosedAtomicUsdc(atomic: string | null | undefined): string {
  if (atomic === undefined) return 'not disclosed';
  if (atomic === null) return 'not charged yet';
  return formatAtomicUsdc(atomic);
}
