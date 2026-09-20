# Webhooks

Borrow Router watches each tracked `(partner, account, chain, protocol)` and POSTs an event when the
account's worst position changes risk band (`comfortable` → `watch` → `danger` → `liquidatable`), when
its data stops being readable, and when it is readable again.

## Event

```json
{
  "id": "5f0c…",                      // idempotency key — process each id once
  "kind": "band_changed",             // | "data_unavailable" | "data_restored"
  "partner": "demo-wallet",
  "createdAt": "2026-09-20T18:04:11Z",
  "attempt": 1,
  "data": {
    "address": "0x…", "chainId": 1, "protocolId": "aave-v3",
    "block": 26020956, "stale": false, "at": 1789999451000,
    "previous": { "band": "watch", "healthFactor": 1.31 },
    "current":  { "band": "danger", "healthFactor": 1.17, "drawdownToLiquidation": 0.145 },
    "position": { … the normalised position … }
  }
}
```

Headers: `x-event-id`, `x-attempt`, `x-signature: sha256=<hex HMAC-SHA256 of the raw body with your secret>`.

Delivery is at-least-once: a 2xx marks it delivered; anything else is retried with exponential
backoff (1, 2, 4 … 128 minutes, 8 attempts). Delivery history: `GET /api/webhooks?partner=…`.

## Receiver (Node)

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export async function handler(req, res) {
  const raw = await readRawBody(req);                       // sign the bytes, not a re-serialised object
  const expected = "sha256=" + createHmac("sha256", process.env.BR_SECRET).update(raw).digest("hex");
  const given = req.headers["x-signature"] ?? "";
  if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return res.status(401).end();
  const event = JSON.parse(raw);
  if (await alreadySeen(event.id)) return res.status(200).end();   // idempotent
  await handle(event);
  res.status(200).end();
}
```

## Registering an account

```
POST /api/track   (Authorization: Bearer <CRON_SECRET>)
{ "partner": "demo-wallet", "address": "0x…", "chainId": 1, "protocolId": "aave-v3",
  "webhookUrl": "https://partner.example/hooks/borrow-router", "secret": "<≥16 chars>" }
```

The monitor tick is `GET /api/cron/monitor` with the same secret (`Authorization` header or `?key=`).
Vercel Cron runs it daily as a floor; point any pinger at it every 5 minutes for real monitoring.
