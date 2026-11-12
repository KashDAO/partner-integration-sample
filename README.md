# Kash partner integration sample

A small, runnable example of a company ("Example Wallet") offering Kash prediction
markets to its own users through the Kash partner API v1, using the official
TypeScript SDK, [`@kashdao/sdk`](https://www.npmjs.com/package/@kashdao/sdk) 0.4.

Each step is a short, readable script you can run on its own against Kash staging:

1. create a Kash account for one of your users;
2. look the account up, by Kash's id or by your own;
3. read its balance;
4. list open markets, quote a trade and place it for the user;
5. withdraw USDC to the user's registered address;
6. receive and verify webhooks;
7. run the whole journey in one go.

The code favours clarity over abstraction: copy what you need into your own server.

- Partner integration guide: https://docs.kash.bot/developer-docs/partner-integration/overview
- Partner quickstart: https://docs.kash.bot/developer-docs/partner-integration/quickstart
- TypeScript SDK: https://docs.kash.bot/developer-docs/rest-api/sdks/typescript (package: https://www.npmjs.com/package/@kashdao/sdk)

## How a partner integration works

You build your own interface and call the Kash API from your server. Each of your
users who opts in gets their own Kash account with its own Solana wallet. Kash
executes their trades, pays their winnings into that wallet, and sends withdrawals
only to the address you registered for them. You move your users' USDC into their
accounts' Solana deposit addresses.

A few rules shape every call:

- **Acting for a user.** Calls made for one user (balance, trades, portfolio,
  redemptions, traces) pass that user's `accountId` as `account`; the SDK sends it as
  the `Kash-Account` header. The `partnerAccounts` methods name the account in the URL
  instead, and markets and quotes act for no account.
- **Idempotency.** Account and withdrawal creates send an `Idempotency-Key`, so
  retrying after a timeout returns the first answer rather than acting twice;
  withdrawals require one. Trades send your order reference as `clientRequestId`,
  which Kash keeps per account with no time limit, so retrying an order can never
  place it twice. Reuse a key or id only to retry the same request with the same body.
- **Two units for money, never a float.** Balances, quotes, withdrawals, fees and
  webhooks use integer strings in USDC atomic units (6 decimals): `"2500000"` is
  2.5 USDC. `trades.create` alone takes a decimal USDC string (`"2.5"`). Every flag in
  this sample takes atomic units, and
  [`src/format.ts`](src/format.ts) converts with `atomicToTradeAmount` at the one call
  that needs it.
- **Webhooks are prompts, not facts.** Deliveries can repeat and arrive out of order.
  Process each event id once and re-read the current state from the API.

## Prerequisites

- Node.js 22.9 or later (see `.nvmrc`).
- A Kash partner **test** key (`kash_test_...`) and its webhook signing secret
  (`whsec_...`). See [Getting a staging key](#getting-a-staging-key).

## Setup

```sh
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable              | What it is                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `KASH_API_KEY`        | Your partner key. `kash_test_...` on staging.                                            |
| `KASH_BASE_URL`       | `https://api-staging.kash.bot/v1` for staging, `https://api.kash.bot/v1` for production. |
| `KASH_WEBHOOK_SECRET` | Your webhook signing secret. Only `npm run webhooks` needs it.                           |
| `PORT`                | The port the webhook server listens on. Default 3000.                                    |

Values already set in your shell take precedence over `.env`, so you can also inject
them from a secrets manager. Keep keys and secrets on your server only, and never
commit `.env`.

## Getting a staging key

Ask Kash for partner access on staging and tell them the HTTPS URL your webhook
server will be reachable at (see [Receiving webhooks](#6-receive-webhooks)). Kash
sends you a `kash_test_` partner key and the signing secret for your webhook URL.

Staging runs on Solana devnet with test USDC; nothing there is real money. It is
shared and runs ahead of production, so expect it to change while you build.

## Running the steps

Arguments go after `--`. Every command prints what it did; on failure it prints the
Kash error code, what it means for you, and the request id to quote to Kash support.

### 1. Create an account

```sh
npm run create-account -- --external-id user-8841 \
  --destination <the user's Solana address> --country GB
```

Call this when the user opts in. `--external-id` is your own id for the user;
`--destination` is where their withdrawals go; `--country` is their real country
(ISO 3166-1 alpha-2), which drives Kash's country rules. The user's consent (when
they agreed and to which terms) is sent with it; pass `--accepted-at` with the time
your app recorded, or the current time is used.

The new account is `provisioning` until its wallet is ready. Running the command
again for the same `--external-id` returns the same account with
`outcome: existing` and creates nothing. See
[`src/steps/create-account.ts`](src/steps/create-account.ts).

### 2. Look an account up

```sh
npm run account -- --id <accountId>
npm run find -- --external-id user-8841
```

Both show the status and, once the account is `active`, its Solana `depositAddress`.
To wait for a new account, the walkthrough uses the SDK's
`partnerAccounts.waitUntilActive`; in production, the `account.active` webhook tells
you without polling.

### 3. Read the balance

```sh
npm run balance -- --account <accountId>
```

Shows the USDC on chain, the amount held by withdrawals still in progress, and what
is available to trade or withdraw. A balance Kash cannot read is an error, never zero.

### 4. Markets and trades

```sh
npm run markets
npm run trade -- --account <accountId> --market <marketId> --outcome 0 --amount 1000000
```

`markets` lists markets worth offering a user: tradeable now, not closing within the
next hour, and not one of staging's automated test markets (titles starting
`zz-fixture`).

`trade` checks the market takes trades, quotes the buy (tokens out and the average
price per token), checks the balance, places it for the account and waits for a final
status with the SDK's `trades.waitForCompletion`. The trade carries your order
reference twice: as `clientRequestId`, so `--order-id` retries the same order safely,
and in `metadata`, which every trade webhook echoes back. Trade webhooks do not carry
the account id, so metadata is how you match them to your user. If `trades.create`
fails, the error shows the `clientRequestId` it sent, for retrying that same trade.
See [`src/steps/trade.ts`](src/steps/trade.ts).

### 5. Withdraw

```sh
npm run withdraw -- --account <accountId> --amount 1000000
npm run withdraw -- --account <accountId> --amount 1000000 --quote-only
```

Quotes the withdrawal and shows what the user should see before confirming: what
arrives, the network fee, the total that leaves the balance, and the most the account
can withdraw now. The fee figures are optional in the API: when Kash does not
disclose them the sample says "not disclosed", never zero. It then creates the
withdrawal with an idempotency key and waits with the SDK's
`partnerAccounts.withdrawals.waitForCompletion` until it is `completed`, `failed` or
`cancelled`, and shows the fee actually charged.

A retry with the same `--request-id` returns the same withdrawal. If the first
attempt is still running, the SDK retries with the same key by itself; if
`IDEMPOTENCY_REQUEST_IN_PROGRESS` still reaches you, list the account's withdrawals
before retrying with that same key. Withdrawals are held for 24 hours after a
destination change. See [`src/steps/withdraw.ts`](src/steps/withdraw.ts).

### 6. Receive webhooks

```sh
npm run webhooks
```

Starts an HTTP server on `PORT` that accepts `POST /webhooks`. For each delivery it:

1. verifies the `X-Kash-Signature` header against the raw body with the SDK's
   `webhooks.constructEvent` (an HMAC-SHA256 under your secret, at most five minutes
   old), answering `400` if it fails;
2. skips an event id it has already handled, answering `200`;
3. acknowledges with `200` an event type newer than your SDK version
   (`isUnknownWebhookEvent`), logging its id so you can have it resent with
   `webhooks.redeliver` after upgrading;
4. handles every known type: `trade.*`, `account.*`, `withdrawal.*` and
   `payout.completed`, re-reading the current state from the API;
5. answers `200`, or `500` if handling failed so that Kash retries. A known type
   whose body does not match its schema gets `422`, which Kash does not retry.

Kash must reach the server over HTTPS. While testing, expose it with any HTTPS tunnel,
for example:

```sh
cloudflared tunnel --url http://localhost:3000
```

and use `https://<tunnel host>/webhooks` as your webhook URL. The handler is in
[`src/webhooks/handler.ts`](src/webhooks/handler.ts) and the per-event logic in
[`src/webhooks/reconcile.ts`](src/webhooks/reconcile.ts). In production, record
handled event ids in your database rather than in memory.

### 7. The whole journey

```sh
npm run walkthrough -- --external-id user-8841 \
  --destination <the user's Solana address> --country GB
```

Creates the account, waits for it to become active and reads its balance. If the
account holds less than 1 USDC, it prints the deposit address and stops. Once it is
funded, run it again with the same `--external-id`: it buys 1 USDC of an outcome on
the first tradeable market (or `--market` and `--outcome`) and withdraws 1 USDC back
to the user's Solana address. It refuses a live key.

## Getting test USDC

Accounts are funded by sending USDC on Solana to their `depositAddress`. On staging,
ask Kash for test USDC and give them the account's deposit address (`npm run account`
or the walkthrough prints it).

## Errors you will branch on

Every SDK error is a `KashError` subclass with a stable `code`. Compare it with
`KASH_ERROR_CODE` and keep a default branch, because the API adds codes over time.
The SDK already retries rate limits, server errors and network failures with backoff.
[`src/errors.ts`](src/errors.ts) shows the handling for each:

| Code                              | Meaning                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `ACCOUNT_NOT_ACTIVE`              | The account is provisioning, suspended or failed; the message says which.                    |
| `ACCOUNT_NOT_FOUND`               | Unknown, another partner's, or released.                                                     |
| `INSUFFICIENT_BALANCE`            | More than the account can spend.                                                             |
| `WITHDRAWALS_HELD`                | 24-hour hold after a destination change; `retryAfterSeconds` is the time left.               |
| `WITHDRAWAL_BELOW_MINIMUM`        | Below the network's minimum or its fee.                                                      |
| `DESTINATION_NOT_SUPPORTED`       | Kash cannot withdraw to that network here.                                                   |
| `IDEMPOTENCY_REQUEST_IN_PROGRESS` | An earlier request with this key is still running: read state, then retry with the same key. |
| `IDEMPOTENCY_KEY_CONFLICT`        | The key was used with a different request.                                                   |
| `RATE_LIMIT_EXCEEDED`             | A rate limit ran out; `retryAfterSeconds` says when to try again.                            |

Rate limits are checked together: 3,000 requests a minute per partner, 3,000 per key,
and 60 a minute for each account on the calls made for it. Prefer webhooks to polling.

## Staging limitations

- Withdrawals to **Arc** are not available on staging: a withdrawal or quote for an
  account whose destination is on Arc answers `422 DESTINATION_NOT_SUPPORTED`. Creating
  an account with an Arc destination works. Test withdrawals with a Solana
  destination.
- Test USDC comes from Kash on request.

## Moving to production

1. Ask Kash to approve your organisation for production. This is a one-time review.
2. Create a production partner key (`kash_live_...`). It must have an IP allowlist of
   your servers, and each entry must be specific: a single address, an IPv4 range of
   /16 or narrower, or an IPv6 range of /48 or narrower. A key without one answers
   `403 PARTNER_KEY_REQUIRES_IP_ALLOWLIST`.
3. Set `KASH_BASE_URL=https://api.kash.bot/v1`. Your test key does not work there.
4. Register your production webhook URL and store its new signing secret: staging and
   production secrets are separate.

Production moves real USDC. The walkthrough refuses live keys on purpose.

## Project layout

```
src/
  client.ts            the one KashClient
  config.ts            environment settings
  cli.ts               flag parsing and error output for the steps
  errors.ts            branching on Kash error codes
  format.ts            USDC amounts: atomic units, and the decimal trades.create takes
  steps/               one runnable file per step
  webhooks/handler.ts  verify, de-duplicate, choose the response status
  webhooks/reconcile.ts what to do for each event type
test/
  webhook-handler.test.ts
```

## Checks

```sh
npm run typecheck   # tsc --noEmit, strict
npm test            # node --test: signed, tampered, stale, duplicate and failing deliveries
```

## Licence

MIT. See [LICENSE](LICENSE).
