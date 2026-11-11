/**
 * USDC amounts.
 *
 * The partner API sends and accepts USDC as integer strings in atomic units
 * (6 decimals): `'2500000'` is 2.5 USDC. `trades.create` is the exception: its
 * `amount` is a USDC decimal string (`'2.5'`). Never use floating point for
 * money; these helpers work on strings and bigints only.
 */

const USDC_DECIMALS = 6;
const USDC_SCALE = 10n ** BigInt(USDC_DECIMALS);

/** `'2500000'` to `'2.5'`. */
export function atomicToDecimal(atomic: string | bigint): string {
  const value = BigInt(atomic);
  const whole = value / USDC_SCALE;
  const fraction = (value % USDC_SCALE).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '');
  return fraction === '' ? whole.toString() : `${whole}.${fraction}`;
}

/** `'2500000'` to `'2.5 USDC'`, for display. */
export function formatUsdc(atomic: string | bigint): string {
  return `${atomicToDecimal(atomic)} USDC`;
}

/** The smaller of two atomic amounts. */
export function minAtomic(a: string | bigint, b: string | bigint): bigint {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? x : y;
}

/** One USDC in atomic units. */
export const ONE_USDC_ATOMIC = USDC_SCALE;
