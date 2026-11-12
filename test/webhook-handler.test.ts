/**
 * The webhook handler against real signature verification: the SDK's
 * `constructEvent`, fed deliveries signed with the SDK's own test helper
 * exactly as Kash signs them.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';

import { KashClient } from '@kashdao/sdk';
import type { WebhookEvent } from '@kashdao/sdk';
import { generateTestWebhookSignature } from '@kashdao/sdk/testing';

import { createWebhookHandler } from '../src/webhooks/handler.js';

const SECRET = 'whsec_test_only_not_a_real_secret';
// Shape-valid and never sent anywhere: constructEvent makes no network call.
const kash = new KashClient({ apiKey: `kash_test_${'0'.repeat(32)}` });

function sign(payload: string, secret = SECRET, timestampMs = Date.now()): Promise<string> {
  return generateTestWebhookSignature({ payload, secret, timestampMs });
}

function accountActiveBody(eventId = randomUUID()): string {
  return JSON.stringify({
    id: eventId,
    type: 'account.active',
    apiVersion: '2026-08-19',
    createdAt: new Date().toISOString(),
    data: {
      accountId: randomUUID(),
      externalId: 'user-8841',
      status: 'active',
      depositAddress: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
      activatedAt: new Date().toISOString(),
    },
  });
}

describe('createWebhookHandler', () => {
  let received: WebhookEvent[];
  let handle: ReturnType<typeof createWebhookHandler>;

  beforeEach(() => {
    received = [];
    handle = createWebhookHandler({
      kash,
      secret: SECRET,
      onEvent: async (event) => {
        received.push(event);
      },
      log: () => {},
    });
  });

  it('accepts a correctly signed event and hands it on once', async () => {
    const body = accountActiveBody();
    const result = await handle({ rawBody: body, signature: await sign(body) });

    assert.equal(result.status, 200);
    assert.equal(received.length, 1);
    assert.equal(received[0]?.type, 'account.active');
    if (received[0]?.type === 'account.active') {
      assert.equal(received[0].data.externalId, 'user-8841');
    }
  });

  it('rejects a tampered body with 401, which Kash retries, and does not hand it on', async () => {
    const body = accountActiveBody();
    const signature = await sign(body);
    const tampered = body.replace('user-8841', 'user-0001');

    const result = await handle({ rawBody: tampered, signature });

    assert.equal(result.status, 401);
    assert.equal(received.length, 0);
  });

  it('rejects a signature made with another secret', async () => {
    const body = accountActiveBody();
    const result = await handle({
      rawBody: body,
      signature: await sign(body, 'whsec_someone_else'),
    });

    assert.equal(result.status, 401);
    assert.equal(received.length, 0);
  });

  it('rejects a signature older than five minutes (a replay)', async () => {
    const body = accountActiveBody();
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
    const result = await handle({
      rawBody: body,
      signature: await sign(body, SECRET, sixMinutesAgo),
    });

    assert.equal(result.status, 401);
    assert.equal(received.length, 0);
  });

  it('rejects a delivery without a signature header', async () => {
    const result = await handle({ rawBody: accountActiveBody(), signature: undefined });

    assert.equal(result.status, 401);
    assert.equal(received.length, 0);
  });

  it('answers a repeated delivery of the same event id with 200 without handling it again', async () => {
    const body = accountActiveBody();
    const first = await handle({ rawBody: body, signature: await sign(body) });
    const second = await handle({ rawBody: body, signature: await sign(body) });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(second.body.detail, 'Duplicate.');
    assert.equal(received.length, 1);
  });

  it('answers 500 when handling fails, and handles the retry', async () => {
    let failNext = true;
    const flaky = createWebhookHandler({
      kash,
      secret: SECRET,
      onEvent: async (event) => {
        if (failNext) {
          failNext = false;
          throw new Error('database unavailable');
        }
        received.push(event);
      },
      log: () => {},
    });
    const body = accountActiveBody();

    const first = await flaky({ rawBody: body, signature: await sign(body) });
    const retry = await flaky({ rawBody: body, signature: await sign(body) });

    assert.equal(first.status, 500);
    assert.equal(retry.status, 200);
    assert.equal(received.length, 1);
  });

  it('acknowledges a verified event type this SDK does not know without handling it', async () => {
    const body = JSON.stringify({
      id: randomUUID(),
      type: 'something.new',
      apiVersion: '2026-08-19',
      createdAt: new Date().toISOString(),
      data: {},
    });
    const result = await handle({ rawBody: body, signature: await sign(body) });

    assert.equal(result.status, 200);
    assert.equal(result.body.detail, 'Unknown event type acknowledged.');
    assert.equal(received.length, 0);
  });

  it('answers 500, which Kash retries, to a verified known event whose body does not match its schema', async () => {
    const body = JSON.stringify({
      id: randomUUID(),
      type: 'account.active',
      apiVersion: '2026-08-19',
      createdAt: new Date().toISOString(),
      data: { accountId: 'not-a-uuid' },
    });
    const result = await handle({ rawBody: body, signature: await sign(body) });

    assert.equal(result.status, 500);
    assert.equal(received.length, 0);
  });
});
