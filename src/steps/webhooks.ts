/**
 * Step 6: receive Kash webhooks.
 *
 *   npm run webhooks
 *
 * Listens on PORT (default 3000) at POST /webhooks. Kash must reach it over
 * HTTPS, so expose it with a tunnel while testing, for example:
 *
 *   cloudflared tunnel --url http://localhost:3000
 *
 * and give Kash https://<tunnel host>/webhooks as your webhook URL.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { getKashClient } from '../client.js';
import { isMain, runMain } from '../cli.js';
import { optionalEnv, requireEnv } from '../config.js';
import { describeError } from '../errors.js';
import { createWebhookHandler } from '../webhooks/handler.js';
import { createReconciler } from '../webhooks/reconcile.js';

const WEBHOOK_PATH = '/webhooks';
/** Kash webhook bodies are small; refuse anything far larger. */
const MAX_BODY_BYTES = 1024 * 1024;

class BodyTooLargeError extends Error {
  override readonly name = 'BodyTooLargeError';
}

/** Reads the body as the exact bytes received. Signature checks need them unchanged. */
async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLargeError('Request body too large.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function main(): Promise<void> {
  const kash = getKashClient();
  const handle = createWebhookHandler({
    kash,
    secret: requireEnv('KASH_WEBHOOK_SECRET'),
    onEvent: createReconciler(kash),
  });
  const port = Number(optionalEnv('PORT') ?? 3000);

  const server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (req.method !== 'POST' || path !== WEBHOOK_PATH) {
        send(res, 404, { error: 'Not found' });
        return;
      }
      try {
        const result = await handle({
          rawBody: await readRawBody(req),
          signature: header(req, 'x-kash-signature'),
          eventIdHeader: header(req, 'x-kash-event-id'),
        });
        send(res, result.status, result.body);
      } catch (err) {
        if (err instanceof BodyTooLargeError) {
          send(res, 413, { error: err.message });
          return;
        }
        console.error(describeError(err));
        send(res, 500, { error: 'Internal error' });
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(`Listening for Kash webhooks on http://localhost:${port}${WEBHOOK_PATH}`);

  const stop = (): void => {
    console.log('Shutting down.');
    server.close();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (isMain(import.meta.url)) await runMain(main);
