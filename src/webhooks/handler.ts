/**
 * The framework-free core of a Kash webhook endpoint: verify, de-duplicate,
 * hand the event on, and choose the HTTP status Kash should see.
 *
 * Kash retries a delivery until your endpoint answers 2xx, or answers 400,
 * 404, 410 or 422, which it treats as final. Deliveries can arrive more than
 * once and in any order, so:
 *
 * - process each event id once (here, an in-memory set; in production, a
 *   table with a unique key on the event id, written in the same transaction
 *   as your own state change);
 * - treat each event as a prompt to read the current state from the API, and
 *   compare the payload timestamps (`activatedAt`, `completedAt`, ...) rather
 *   than the order of arrival.
 */

import { KashValidationError, KashWebhookSignatureError } from '@kashdao/sdk';
import type { KashClient, WebhookEvent } from '@kashdao/sdk';

import { ConfigError } from '../config.js';

export type WebhookResponse = {
  readonly status: number;
  readonly body: { readonly received: boolean; readonly detail: string };
};

/** Where processed event ids are remembered. A `Set<string>` will do for a demo. */
export type ProcessedEventStore = {
  has(eventId: string): boolean;
  add(eventId: string): unknown;
  delete(eventId: string): unknown;
};

export type WebhookHandlerOptions = {
  /** Only `webhooks.constructEvent` is used, which makes no network call. */
  readonly kash: Pick<KashClient, 'webhooks'>;
  /** The endpoint's signing secret (`whsec_...`). */
  readonly secret: string;
  /** Your handling of one verified, new event. Throw to have Kash retry it. */
  readonly onEvent: (event: WebhookEvent) => Promise<void>;
  readonly processed?: ProcessedEventStore;
  readonly log?: (message: string) => void;
};

export type WebhookRequest = {
  /** The raw request body, exactly as received. Never a re-serialised object. */
  readonly rawBody: string;
  /** The `X-Kash-Signature` header. */
  readonly signature: string | undefined;
  /** The `X-Kash-Event-Id` header, used only for logging. */
  readonly eventIdHeader?: string | undefined;
};

export function createWebhookHandler(
  options: WebhookHandlerOptions
): (request: WebhookRequest) => Promise<WebhookResponse> {
  if (options.secret.trim() === '') {
    throw new ConfigError('A webhook signing secret is required.');
  }
  const processed = options.processed ?? new Set<string>();
  const log = options.log ?? ((message: string) => console.log(message));

  return async ({ rawBody, signature, eventIdHeader }) => {
    if (signature === undefined || signature === '') {
      return reply(400, false, 'Missing X-Kash-Signature header.');
    }

    let event: WebhookEvent;
    try {
      // Checks the HMAC and the timestamp (five minutes' tolerance), then
      // parses the body into a typed event.
      event = await options.kash.webhooks.constructEvent(rawBody, signature, options.secret);
    } catch (err) {
      if (err instanceof KashWebhookSignatureError) {
        // Not from Kash, altered on the way, or too old. 400 is final: Kash
        // will not retry it. Never log the header or the body of a request
        // that failed verification.
        log(`rejected a delivery: ${err.message}`);
        return reply(400, false, 'Invalid signature.');
      }
      if (err instanceof KashValidationError) {
        // The signature is valid, so this came from Kash, but this SDK
        // version does not know the event's shape (a newer event type).
        // Acknowledge it so Kash does not keep retrying, and record the id:
        // after upgrading the SDK you can ask Kash to send it again with
        // kash.webhooks.redeliver(eventId).
        log(
          `acknowledged an event this SDK cannot parse (id ${eventIdHeader ?? 'unknown'}): ${err.message}`
        );
        return reply(200, true, 'Unrecognised event acknowledged.');
      }
      throw err;
    }

    if (processed.has(event.id)) {
      log(`duplicate ${event.type} ${event.id}: already handled`);
      return reply(200, true, 'Duplicate.');
    }

    // Claim the id before handling it, so a concurrent redelivery of the same
    // event is treated as a duplicate; release it if handling fails, so the
    // retry is processed.
    processed.add(event.id);
    try {
      await options.onEvent(event);
    } catch (err) {
      processed.delete(event.id);
      log(
        `failed to handle ${event.type} ${event.id}: ${err instanceof Error ? err.message : String(err)}`
      );
      // Any 5xx makes Kash retry later.
      return reply(500, false, 'Handling failed; please retry.');
    }
    return reply(200, true, 'Handled.');
  };
}

function reply(status: number, received: boolean, detail: string): WebhookResponse {
  return { status, body: { received, detail } };
}
