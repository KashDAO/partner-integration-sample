/**
 * Small command-line helpers shared by the steps: flag parsing, and a `main`
 * wrapper that prints errors the way a partner would want to read them.
 */

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { describeError } from './errors.js';

/** A command was run with missing or malformed flags. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}

/** A step stopped on purpose, before calling Kash, for the reason it gives. */
export class StepStoppedError extends Error {
  override readonly name = 'Stopped';
}

/**
 * Parses `--name value` flags. Every flag is a string; the step validates
 * the values it needs.
 */
export function parseFlags<const TName extends string>(
  names: readonly TName[],
  argv: readonly string[] = process.argv.slice(2)
): Partial<Record<TName, string>> {
  const options = Object.fromEntries(names.map((name) => [name, { type: 'string' as const }]));
  try {
    const { values } = parseArgs({ args: [...argv], options, strict: true });
    return values as Partial<Record<TName, string>>;
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
}

/** The flag's value, or a `UsageError` naming it. */
export function requireFlag(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim() === '') {
    throw new UsageError(`--${flag} is required.`);
  }
  return value.trim();
}

/** A positive whole number of USDC atomic units, such as `1000000` (1 USDC). */
export function parseAtomicAmount(value: string | undefined, flag: string): string {
  const amount = requireFlag(value, flag);
  if (!/^[1-9]\d*$/.test(amount)) {
    throw new UsageError(
      `--${flag} must be a positive whole number of USDC atomic units, such as 1000000 for 1 USDC.`
    );
  }
  return amount;
}

/** A non-negative integer, such as an outcome index. */
export function parseIndex(value: string | undefined, flag: string): number {
  const raw = requireFlag(value, flag);
  if (!/^\d+$/.test(raw)) throw new UsageError(`--${flag} must be a whole number, such as 0.`);
  return Number(raw);
}

/**
 * True when this module is the script Node was asked to run, so a step file
 * can both export its function (for the walkthrough) and run on its own.
 */
export function isMain(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return pathToFileURL(realpathSync(entry)).href === moduleUrl;
}

/** Runs a step, prints any error with its Kash error code, and sets the exit code. */
export async function runMain(step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch (err) {
    console.error(`\n${describeError(err)}`);
    process.exitCode = 1;
  }
}
