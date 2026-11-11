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

- Kash documentation: https://docs.kash.bot
- API reference: https://docs.kash.bot (API reference section)
- SDK: https://www.npmjs.com/package/@kashdao/sdk

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
- **Idempotency.** Every write in this sample sends an `Idempotency-Key`, so retrying
  after a timeout returns the first answer rather than acting twice. Withdrawals
  require one. Reuse a key only for a retry of the same request with the same body.
- **Money is never a float.** Amounts are integer strings in USDC atomic units (6
  decimals): `"2500000"` is 2.5 USDC. The one exception is `trades.create`, whose
  `amount` is a USDC decimal string (`"2.5"`); [`src/format.ts`](src/format.ts)
  converts between them.
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

`trade` checks the market takes trades, quotes the buy, checks the balance, places it
for the account and waits for a final status with the SDK's `waitForCompletion`. The
trade carries your own order reference in `metadata`, which every trade webhook
echoes back: trade webhooks do not carry the account id, so this is how you match
them to your user. Pass `--order-id` to retry the same order safely. See
[`src/steps/trade.ts`](src/steps/trade.ts).

### 5. Withdraw

```sh
npm run withdraw -- --account <accountId> --amount 1000000
```

Quotes the withdrawal (what arrives, and the most the account can withdraw now),
creates it with an idempotency key, then polls until it is `completed`, `failed` or
`cancelled`. A retry with the same `--request-id` returns the same withdrawal; if the
first attempt is still running, Kash answers `IDEMPOTENCY_REQUEST_IN_PROGRESS` and the
sample retries with the same key. Withdrawals are held for 24 hours after a
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
3. handles every event type: `trade.*`, `account.*`, `withdrawal.*` and
   `payout.completed`, re-reading the current state from the API;
4. answers `200`, or `500` if handling failed so that Kash retries.

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

| Code                              | Meaning                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `ACCOUNT_NOT_ACTIVE`              | The account is provisioning, suspended or failed; the message says which.      |
| `ACCOUNT_NOT_FOUND`               | Unknown, another partner's, or released.                                       |
| `INSUFFICIENT_BALANCE`            | More than the account can spend.                                               |
| `WITHDRAWALS_HELD`                | 24-hour hold after a destination change; `retryAfterSeconds` is the time left. |
| `WITHDRAWAL_BELOW_MINIMUM`        | Below the network's minimum or its fee.                                        |
| `DESTINATION_NOT_SUPPORTED`       | Kash cannot withdraw to that network here.                                     |
| `IDEMPOTENCY_REQUEST_IN_PROGRESS` | An earlier request with this key is still running: retry with the same key.    |
| `IDEMPOTENCY_KEY_CONFLICT`        | The key was used with a different request.                                     |
| `RATE_LIMIT_EXCEEDED`             | A rate limit ran out; `retryAfterSeconds` says when to try again.              |

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
  format.ts            USDC amount helpers
  poll.ts              polling for state without an SDK wait helper
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
