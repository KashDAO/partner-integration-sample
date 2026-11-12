import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MIN_TRADE_ATOMIC, placeTrade } from '../src/steps/trade.js';

import type { KashClient } from '@kashdao/sdk';

// Any call means the check did not run first.
const untouched = new Proxy({}, {
  get: () => {
    throw new Error('the client must not be called for a trade under the minimum');
  },
}) as unknown as KashClient;

test('refuses a trade under 1 USDC before calling the API', async () => {
  await assert.rejects(
    placeTrade(untouched, {
      accountId: '00000000-0000-4000-8000-000000000001',
      marketId: '00000000-0000-4000-8000-000000000002',
      outcomeIndex: 0,
      amountAtomic: '500000',
      orderId: 'order-1',
    }),
    /smallest trade is/
  );
});

test('the minimum is 1 USDC', () => {
  assert.equal(MIN_TRADE_ATOMIC, 1_000_000n);
});
