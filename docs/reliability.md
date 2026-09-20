# Audit and monitoring reliability

These changes harden the existing Next.js/Neon service; they do not introduce another
backend or storage system. PGlite is a test-only, in-memory Postgres engine.

## Audit contract

`POST /api/decide` evaluates the supplied policy and proposal over market and account
snapshots. With a configured database, one transaction writes:

- The decision and proposal, full policy values, complete input envelopes, record version
  (`2`), and evaluator commit (`VERCEL_GIT_COMMIT_SHA`, or `local`).
- A snapshot row for each market/rate/capacity/position result, including errors and
  provenance, linked by `snapshots.decision_id` to the decision.

Any failed insert rolls back the whole transaction. The API returns 503,
`error: "AUDIT_UNAVAILABLE"`, `allow: false`, and `persisted: false` rather than releasing
an unrecorded approval. With no `DATABASE_URL`, the demo still evaluates read-only proposals
but returns `persisted: false`; a partner requiring an audit trail must reject such results.
Console diagnostics contain decision IDs and outcomes, not a substitute audit record.

`GET /api/decisions?address=…` now requires the operator Bearer header. It returns the
versioned evidence envelope in `payload`. Pre-migration rows remain readable but have no
record version or complete evidence; pre-migration snapshots have a null decision link.
Those gaps cannot be repaired by guessing which old rows belong together.

## Provenance contract

An observed chain head is not the block at which every number was read. The API preserves
the legacy `block` field, but explicitly distinguishes `observed-head`,
`pinned-contract-reads`, and `unknown` provenance. Dependent results retain their market
input's provenance and inherit its oldest timestamp and stale status. Snapshot block ranges
are labeled `observed-heads-not-exact-state` and include direct market dependencies.

This allows inspection/re-evaluation of the **retained inputs**. It does not claim that
production reads are an atomic onchain snapshot, that public discovery APIs were block-pinned,
or that all possible positions were discovered. Fixture cache keys include the selected pin
so data from one pin is not silently reused for another.

## Validation and remaining operational work

`npm test` runs offline unit tests plus the actual audit/outbox SQL against in-memory
Postgres. Tests cover atomic rollback, stale-data suppression/restoration, interleaved
observations and deliveries, expired claims, HMAC request bytes, retries, attempt history,
exhaustion, operator authentication and audit-write failure responses.

PGlite has one database connection. The tests exercise interleaved workers and actual SQL
constraints, but are not a multi-connection Neon concurrency/load test. Before a partner
pilot, verify the migrations, production connection, overlapping invocations and a signed
webhook receipt in an isolated deployed environment. Four real-chain reconciliation tests
still require an archive RPC and live discovery APIs.

See [webhooks](webhooks.md) for rollout and scheduler changes. No remote database setup,
Vercel deployment, scheduler registration or webhook registration is performed by local tests.
Per-partner auth, quotas, retention policy, multi-instance cache consistency and exact-block
production snapshots remain separate work; this patch does not claim to implement them.
