/**
 * A plain polling loop, for state the SDK has no wait helper for (an account
 * becoming active, a withdrawal finishing). In production prefer the
 * webhooks (`account.active`, `withdrawal.completed`) and poll only as a
 * fallback.
 */

import { setTimeout as sleep } from 'node:timers/promises';

export class PollTimeoutError extends Error {
  override readonly name = 'PollTimeoutError';
}

export type PollOptions<T> = {
  /** Time between reads. */
  readonly intervalMs: number;
  /** Total time to wait before giving up. */
  readonly timeoutMs: number;
  /** Called with each value read, for progress output. */
  readonly onValue?: (value: T) => void;
  /** What the timeout error should say it was waiting for. */
  readonly description: string;
};

/** Reads `read()` until `isDone` says so, or throws `PollTimeoutError`. */
export async function pollUntil<T>(
  read: () => Promise<T>,
  isDone: (value: T) => boolean,
  options: PollOptions<T>
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    const value = await read();
    options.onValue?.(value);
    if (isDone(value)) return value;
    if (Date.now() + options.intervalMs > deadline) {
      throw new PollTimeoutError(
        `Gave up after ${Math.round(options.timeoutMs / 1000)}s waiting for ${options.description}.`
      );
    }
    await sleep(options.intervalMs);
  }
}
