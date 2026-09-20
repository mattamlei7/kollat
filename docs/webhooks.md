# Webhooks

Kollat watches each tracked `(partner, account, chain, protocol)` and POSTs an event when the
account's worst position changes risk band (`comfortable` → `watch` → `danger` → `liquidatable`), when
its data stops being readable, and when it is readable again.

The first fresh observation establishes a baseline and emits **no event**. A stale fallback,
failed read, invalid health factor, future timestamp, or observation older than 15 minutes
is unavailable. Fresh observations inherit the age/staleness of their cached market inputs.
Repeated unavailable observations do not repeat the event; only fresh valid data can restore it.
The last good risk band is retained across outages. Restoration can also emit a band change.

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

Delivery uses at-least-once retry semantics, bounded to **8 total attempts**; it does not
guarantee eventual delivery. A 2xx marks success; failures retry after 1, 2, 4, 8, 16, 32,
and 64 minutes, on the next scheduler tick after the delay. Redirects are rejected.

Tracking state, events and outbox entries commit atomically. Concurrent observations use
a revision check. Senders atomically claim due entries with 120-second leases, longer than
the route's 60-second lifetime and request's 10-second timeout. A crashed worker's claim
becomes retryable when its lease expires; a crash can still mean the receiver got a request
whose acknowledgement was not stored. Receivers must deduplicate by event ID.

Delivery history: `GET /api/webhooks?partner=…`, with the operator Bearer header. Each entry
includes `attempts` (start/completion timestamps, status and error) and `exhausted`. A null
completion means the attempt was started but its outcome is unknown, not that nothing was
sent. Exhausted entries require operator investigation. Legacy deliveries have only their
old summary; attempt history begins after this migration.

## Receiver (Node)

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export async function handler(req, res) {
  const raw = await readRawBody(req);                       // sign the bytes, not a re-serialised object
  const expected = Buffer.from("sha256=" + createHmac("sha256", process.env.BR_SECRET).update(raw).digest("hex"));
  const given = req.headers["x-signature"] ?? "";
  if (typeof given !== "string") return res.status(401).end();
  const supplied = Buffer.from(given);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return res.status(401).end();
  const event = JSON.parse(raw);
  // Implement this with a unique event ID and transactional business effects.
  // A separate alreadySeen()/handle() pair races under duplicate delivery.
  await processOnceAtomically(event.id, event);
  res.status(200).end();
}
```

## Registering an account

```
POST /api/track   (Authorization: Bearer <CRON_SECRET>)
{ "partner": "demo-wallet", "address": "0x…", "chainId": 1, "protocolId": "aave-v3",
  "webhookUrl": "https://partner.example/hooks/kollat", "secret": "<≥16 chars>" }
```

The receiver example is pseudocode: supply raw-body reading and durable transactional
deduplication appropriate to your server. Do not acknowledge before committing processing.

## Scheduler and deployment

1. Connect Neon and ensure `DATABASE_URL` is present in the intended Vercel environment.
2. Set a long random `CRON_SECRET`, then redeploy. Never share it in a URL, screenshot, or log.
3. Configure a scheduler for `GET /api/cron/monitor` every five minutes with
   `Authorization: Bearer <CRON_SECRET>`. **`?key=` is no longer accepted.** An external
   scheduler must explicitly use GET; HEAD returns 405 and never runs a tick. If a service
   cannot attach headers, use another scheduler rather than exposing the admin secret.
4. Keep the separate `/api/health` uptime check. It checks chain RPC availability, not database
   health or successful alert delivery. Watch tick failures and exhausted deliveries too.

The existing Vercel cron is daily; it sends the Bearer header automatically. Both schedules
can overlap safely, but duplicate HTTP delivery remains possible after crashes. A missing
or failed database returns 503 from the tick rather than a misleading successful empty run.

Migrations are additive and run on first use under transaction-scoped locks. Existing records
are preserved. Pause old scheduler workers and allow old invocations to finish during rollout:
older code does not honor the new leases/revisions. Re-enable only after the new deployment
is active. The shared secret is operator access, not partner authentication or tenant isolation.

## Verification

Run `npm exec vitest run tests/persistence-monitor.test.ts` for the deterministic offline
lifecycle: fresh baseline → stale/unavailable → fresh/restored + changed band → signed POST
→ failed attempt → successful retry. It executes real Postgres SQL in memory and checks the
raw bytes sent to a fake receiver; it does not prove Vercel-to-receiver network delivery.

For a deployment smoke test, register a dedicated test account and receiver, call the tick,
and check the stored baseline. A stable Euler fixture account will not automatically send
a webhook. Confirm a subsequent real risk/data transition and its signed receipt before
claiming end-to-end delivery. Use an isolated, explicitly authorized synthetic test if you
need an immediate transition; do not alter user funds or poison production data to force one.
