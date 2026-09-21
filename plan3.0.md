# Kollat — Product & Engineering Strategy

**Last updated: 2026-09-19.** Working document: what the product is, what is built, what
needs work, who to call, and what to bring.

Supersedes the roadmap in `borrow-router-plan.md` §3/§7 (kept as the v1 record) and the
build order in the strategy notes. The thesis and invariants in both still hold.

---

## 1. Executive assessment

**End goal (verbatim; the `northstar` agent in `.claude/agents/` checks work against this):**

> Kollat's end goal is to make it easy for ordinary people to borrow against their crypto
> through the wallets and exchanges they already use.
>
> A user should be able to say, "I want to borrow $5,000 without selling my crypto," and have
> their existing app help them understand their options, choose a suitable borrowing route,
> and complete the loan — with clear costs and liquidation risks.
>
> Policy checks, monitoring, and audit records are supporting infrastructure — not the end
> product or the reason users care.

Everything below is the means to that. A partner buys safety and an audit trail; the user
gets a borrow that is clearer and less frightening than today. If a feature serves the buyer
but not the user, it is off-goal. "Complete the loan" is part of the goal: execution is
optional per partner, not optional for the product — if the partner cannot complete the loan
with its own tooling, Kollat supplies it (§6.6, Phase 4).

Kollat should become a B2B risk-control and integration service for wallets,
custodians, crypto neobanks, and exchanges that want to expose onchain borrowing without
maintaining every lending protocol themselves.

The defensible product is not a consumer rate-comparison page, and it is not transaction
encoding by itself. Free aggregators already compare borrow routes, and Aave, Morpho, and
routing providers already ship signer-ready transaction tooling. The opportunity is the
operational layer around those transactions:

- normalize markets and positions across protocols;
- enforce each partner's lending policy before a transaction reaches a user;
- independently simulate and verify the resulting position;
- monitor risk after execution and deliver actionable alerts;
- reconcile onchain state with the partner's records;
- maintain an audit trail explaining every decision.

The service remains non-custodial. Kollat never holds customer assets, loads private
keys, signs transactions, or issues a stablecoin. The partner's wallet or custody system
remains the signer.

This is viable as a focused B2B service and **is not commercially validated yet**. No
prospect has been contacted. Broad execution work begins only after a design partner commits
engineering time, signs a letter of intent, or funds a pilot.

---

## 2. Positioning

> Kollat is the policy, risk, and reconciliation layer for embedded onchain borrowing.

For a partner, the service answers four questions:

1. What can this account safely borrow across approved venues?
2. Does the proposed action comply with our policy?
3. What will the account look like after the action executes?
4. Has the position become unsafe, or diverged from our records?

The pitch line, said out loud: *"We keep lending integrations correct, enforce your policy,
monitor your users' risk, and give your ops team an audit trail. You sign; we never hold
keys."* Not "we compare seven protocols."

The initial buyer is a self-custody wallet — short integration path, product team that wants
a borrow tab, no appetite for a risk desk. Kollat supplies normalized data and policy
decisions; the wallet retains user-controlled signing. Qualified custodians and exchanges
come later, because they require stronger operational controls, procurement, legal review,
and service guarantees.

---

## 3. Invariants and non-goals

### Invariants (never relax)

- Adapters are read-only.
- No signer or key material exists in the process.
- No API keys in client code.
- Every protocol normalizes to the same shape.

These four fit on one page and are the pre-answer to a partner's security review. Item 1 in
§5 turns them into a test.

### Explicit non-goals

- Custody or key management.
- Signing or submitting transactions from Kollat-controlled accounts.
- Issuing a stablecoin or operating fiat rails.
- Extending undercollateralized credit.
- Guaranteeing returns, liquidity, protocol security, or liquidation avoidance.
- Supporting every market merely because it exists.
- Building seven custom execution adapters before customer validation.
- Replacing the partner's compliance, legal, custody, or incident-response functions.

---

## 4. What exists today

A read-only Next.js application, roughly 5,700 lines across app, adapters, components,
scripts, and tests, with 20 tests.

### Product surface

- Marketing site at `/` with live market statistics.
- Borrow comparison application at `/borrow`.
- Address and ENS lookup.
- Account polling every 30 seconds; market polling every 60 seconds.
- Comparison of wallet collateral, maximum USDC capacity, borrow APY, and liquidation price.
- Existing-position display with computed health factor, risk band, liquidation prices, and
  protocol notes.
- Hypothetical borrow simulator that incorporates existing positions.
- Two server routes: `/api/markets` and `/api/account/<addr>`.
- `scripts/verify.ts`, a CLI for comparing adapter output against protocol frontends.

### Protocol and chain coverage

| Protocol | Ethereum | Base | Arbitrum | Optimism | Polygon | Avalanche |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Aave v3 | Yes | Yes | Yes | Yes | Yes | Yes |
| Spark | Yes | | | | | |
| Compound v3 | Yes | Yes | Yes | Yes | | |
| Morpho Blue | Yes | Yes | Yes | Yes | Yes | |
| Fluid | Yes | Yes | Yes | | Yes | |
| Euler v2 | Yes | Yes | Yes | | | Yes |
| Moonwell | | Yes | | Yes | | |

Seven protocols across six chains — 26 configured protocol-chain adapter instances.

### Architectural strengths

- Every protocol normalizes to `(collateral → debt)` markets carrying LTV, liquidation
  threshold, liquidation penalty, protocol oracle price, liquidity, and status.
- The adapter contract exposes reads only; it cannot construct or sign a transaction.
- Contract access is server-side, batched through `viem`, with public RPC fallbacks.
- Errors return as structured values, so one failing protocol still yields partial results.
- Market, rate, and account reads use an in-process stale-while-revalidate cache.
- Shared health-factor and liquidation math keeps protocol comparisons consistent.
- Big integers stay exact until JSON serialization.

### Deliberate coverage limits

The application selects a manageable route per asset rather than representing every market:

- Morpho considers listed USDC markets with at least $250,000 supplied, then keeps the
  deepest market per collateral.
- Fluid keeps the plain USDC vault with the most borrowable liquidity per collateral, and
  excludes smart-collateral and smart-debt vaults.
- Euler examines the four largest discovered USDC debt vaults and keeps one preferred route
  per collateral.
- Moonwell can omit positions in markets absent from its current market map.
- Aave E-mode and isolation-mode caps are not fully modeled.

Every API response and partner-facing document must state these boundaries. **"Best" means
best among admitted and successfully read routes**, not every route that exists onchain. The
README coverage table exists for exactly this reason — say it before they find it.

### Fixed 2026-09-19

- Supply-cap simulations (Compound, Moonwell) overstated safety; capacity, health factor, and
  liquidation math now use the amount the protocol can actually accept.
- Aave E-mode and Euler showed our computed health factor instead of the protocol's; the
  protocol-reported value is now authoritative where it exists, with the computed value
  retained for reconciliation and material disagreement flagged.
- Euler and Fluid positions folded into unrelated simulations; ambiguous `marketId: null` is
  replaced by an explicit position scope, so isolated positions only fold into compatible
  simulations.
- The in-process cache was unbounded; now bounded.
- The account route had no deadline; now deadlined.
- README coverage table added.

### Not built

Historical pre-deployment assessment superseded by §5: the read-only app is deployed,
policy evaluation is built, and Postgres persistence plus monitoring/webhooks are implemented.
Database operation, scheduled monitoring and external delivery still need deployment-level
verification. No transaction execution is built.

---

## 5. What needs work — ranked

Ordered by what a partner's security and compliance review asks first, then by what
accumulates value while running. Everything above the line reuses the existing reads; none of
it requires a new adapter.

| # | Item | Why | Size |
|---|---|---|---|
| ~~1~~ | ~~**No-signing invariant test**~~ Done 2026-09-19: `tests/no-signing.test.ts` | Proves the thing being sold. First question in any vendor review | — |
| ~~2~~ | ~~**Golden reconciliation fixtures**~~ Done 2026-09-19 for Aave ×2 + Morpho at block 26013108 (`tests/fixtures.test.ts`, needs archive RPC). Euler and the rest still open | `verify.ts` prints tables; nothing is asserted | Euler next |
| ~~3~~ | ~~**Fail-closed rules**~~ Done 2026-09-19: contract in `lib/protocols/base.ts` (`unpriced` markets, `INVALID_DATA` positions, balance reads throw); policy denies on stale/old/unavailable. Open: Moonwell silent omission | The difference between a risk-control service and a dashboard | — |
| ~~4~~ | ~~**Deploy**~~ Live at borrow-router.vercel.app on Alchemy; `/api/health` added 2026-09-20. **Uptime monitor not yet pointed at it** | "Here is our uptime record" cannot be backfilled | 5 min |
| ~~5~~ | ~~**Snapshot persistence**~~ Built 2026-09-20: `lib/db.ts` (Neon), decisions + the snapshots they rest on, `GET /api/decisions`. **Unverified until `DATABASE_URL` is set in Vercel** | The reconciliation record is the moat, and it is worth zero until day one of writing it | — |
| ~~6~~ | ~~**Policy engine**~~ Done 2026-09-20: `lib/policy.ts`, `POST /api/decide`, `policy.example.json`. Missing: per-tenant storage, per-day notional, block numbers | The one thing protocols structurally cannot offer — they cannot say no to themselves | — |
| ~~7~~ | ~~**Monitor + signed webhooks**~~ Built 2026-09-20: `lib/monitor.ts`, `/api/cron/monitor`, `/api/track`, `/api/webhooks`, `docs/webhooks.md`. Needs `DATABASE_URL` + `CRON_SECRET` and a 5-minute pinger | Cheapest sellable thing, and good pilot bait | — |
| — | *line: everything below waits for a named partner* | | |
| 8 | Preflight via `eth_simulateV1` / `simulateContract` — no fork, no Anvil | Only for the partner's protocols | after pilot |
| 9 | Execution — wrap Aave Kit / Morpho SDK and verify their output against our math; hand-encode only where no SDK exists | Builders are commodity; verification is not | after pilot |
| 10 | Partner auth, tenant isolation, quotas, rate limiting | Edge (Vercel/Cloudflare) for rate limiting; API keys once there is someone to key | after pilot |

### Service hardening — alongside items 4–7

Local reliability follow-up (2026-09-20): atomic linked audit evidence, stale-aware monitoring,
atomic event/outbox state changes, leased delivery claims and per-attempt history now have
offline Postgres regression tests. Operator secrets are header-only and full audit history
requires authentication. Read provenance is explicitly observational, not exact-block proof.
See `docs/reliability.md` and `docs/webhooks.md` for rollout, legacy-record limits, and the
deployment verification still required. This note is not a claim that these changes are deployed.

1. Separate upstream API failures, RPC failures, invalid protocol data, timeouts, policy
   failures, and internal errors into a real error taxonomy.
2. ~~Attach chain block numbers and source timestamps to normalized data.~~ Done 2026-09-20: `Result.block`.
3. ~~Return partial results with explicit completeness metadata.~~ Done 2026-09-20: `completeness` on every snapshot.
4. Add structured logs, trace IDs, health checks, latency metrics, upstream error metrics,
   and alert-delivery metrics.
5. Keep sensitive account data out of ordinary logs, and define a retention policy for audit
   records.

### Coverage quality — when the API becomes partner-facing

1. Move market-selection rules into explicit, testable discovery policies.
2. Return omitted-market counts and machine-readable reasons.
3. Add partner allowlists for approved protocol deployments, debt assets, collateral assets,
   and oracles.
4. Detect material differences between protocol-reported and locally computed risk.
5. Add a recurring verification job that alerts when addresses, ABIs, market structure, or
   normalized values change unexpectedly.

### Smaller debts — fix when touched

- Adding a protocol touches four files; the plan said one (`types.ts` `ProtocolId`,
  `registry.ts`, `client-types.ts` `PROTOCOL_URL`, adapter).
- The price-shock control from the v1 spec was never built (`shockLegs` exists, unused).
- `cappedByLiquidity` also means supply-capped — rename or split before the API is public.
- Morpho and Euler market discovery depend on their public APIs with no SLA.

---

## 6. Product deliverables

### 6.1 Normalized risk API

Returns partner-approved markets, wallet holdings, existing positions, available capacity,
rate information, health factors, liquidation exposure, data freshness, and completeness.

Minimum behavior:

- results are tied to a chain block number;
- every field identifies its source and freshness;
- partial failures remain visible;
- excluded routes carry a machine-readable reason;
- no unsupported or stale value is interpreted as zero;
- responses are deterministic for the same configuration and block.

### 6.2 Partner policy engine

Evaluated before any quote or transaction reaches a user. Deny-by-default and versioned.

Initial rules: allowed chains; allowed protocol deployments; allowed debt and collateral
assets; maximum requested and post-action LTV; minimum post-action health factor; maximum
notional per transaction and per day; minimum market liquidity; maximum oracle/data age;
maximum permitted reconciliation difference; blocked protocol or market status.

Every decision returns `decisionId`, `policyVersion`, `allow`/`deny`, stable reason codes, a
human-readable explanation, input block numbers and timestamps, and normalized pre-action and
proposed post-action risk. Every decision is logged.

**User-facing by requirement, not courtesy** (this is where the end goal lives): a deny always
carries `safeMaxUsd` — the amount that *would* pass — and every decision carries the drawdown
to liquidation ("ETH would have to fall 31%") so the partner can show the user something
better than "transaction failed". Built 2026-09-20 (`lib/policy.ts`); the sentence the user
sees is the next field to add.

### 6.3 Monitoring and signed webhooks

Track approved partner-account-protocol tuples and notify when:

- health factor crosses a configured band;
- distance to liquidation falls below a threshold;
- an oracle or required price becomes unavailable;
- borrow liquidity falls sharply, or a cap is exhausted;
- a protocol, market, borrow action, or collateral action is paused;
- normalized risk materially disagrees with the protocol;
- data cannot be refreshed inside the freshness objective.

Delivery is HMAC-signed, replay-safe, idempotent, and at-least-once. Payloads carry an event
ID, decision or position reference, observed block, event time, policy version, current risk,
previous risk, and reason code. Retry with exponential backoff; expose delivery history to
the partner.

### 6.4 Reconciliation and audit records

Persist enough to reconstruct why a result was produced: partner and environment; normalized
request; policy version and decision; source block numbers; protocol adapter versions;
preflight inputs and results; webhook events and delivery attempts; the resulting observed
position after execution.

Append-only, access-controlled, exportable as JSON or CSV for a pilot.

### 6.5 Preflight API

Once the read and policy layers are trustworthy, accept a partner-provided unsigned action or
transaction plan and return decode and target validation; the policy decision; simulation
success or revert reason; asset and allowance changes; post-action debt and collateral;
post-action health factor and liquidation exposure; and material differences from the
original quote.

Never return an approval when simulation is unavailable. Bind each result to a block, policy
version, expiry, account, chain, and transaction hash or canonical plan hash.

### 6.6 Optional unsigned execution integration

Build transactions only after a partner asks. Prefer the official Aave and Morpho SDKs, then
independently decode, policy-check, and simulate their output. Custom builders only where no
maintained SDK exists.

Kollat returns unsigned requirements and transaction data. It does not instantiate a
signer, accept a private key, relay through an account it controls, or move user funds
through its own infrastructure.

---

## 7. Demo

### 7.1 What to bring to a partner call

Bring evidence, not slides. In priority order:

1. **Live URL** on a private RPC, with the uptime log visible (§5 item 4).
2. **Three reconciled addresses** — `verify.ts` output beside screenshots of the protocol's
   own frontend for the same address at the same block, health factors matching. One Aave
   E-mode account, one Morpho isolated market, one Euler sub-account.
3. **The invariant test** green in CI, plus the four invariants on one page. This is the
   security-review pre-answer.
4. **The README coverage table** — say what isn't covered before they find it.
5. **A sample policy for their shape** — one protocol, two collaterals, 40% max LTV, USDC
   only — and the deny log it produces on a violating request. Even a JSON file works.
6. **A sample signed webhook payload** for a health-factor band crossing, with the
   verification snippet.
7. **The pitch line** from §2.

Do not demo: the seven-protocol comparison table as the headline (they will compare it to
DefiLlama, which is free), calldata generation (Aave Kit and Morpho SDK do it), or the
marketing homepage.

### 7.2 Scope

Audience: product, engineering, risk, and compliance representatives of a self-custody
wallet. Limit the demo to Ethereum and Base; Aave v3 and Morpho Blue; native USDC debt; WETH
plus one additional approved collateral per chain; read API, policy decisions, monitoring,
webhooks, and reconciliation. No custody, signing, transaction submission, or production
funds.

Fixed-block fixtures are the reliable baseline. A live RPC mode can supplement the demo but
must never be the only path.

### 7.3 Required scenarios

1. **Account discovery** — submit an address, show normalized holdings and positions from
   both protocols with block and freshness information.
2. **Safe proposal** — evaluate a conservative borrow, return an allow decision with
   resulting health factor and liquidation distance.
3. **Policy rejection** — submit a borrow exceeding maximum LTV, show a stable denial reason
   plus the safe maximum.
4. **Protocol restriction** — attempt a route outside the allowlist, demonstrate
   deny-by-default.
5. **Stale or unavailable data** — simulate an RPC or oracle failure, show a fail-closed
   decision rather than a zero or fabricated value.
6. **Risk transition** — apply a deterministic collateral price shock, cross a monitoring
   threshold, generate a signed webhook.
7. **Webhook retry** — return a temporary failure from the receiver, demonstrate idempotent
   retry and delivery history.
8. **Reconciliation** — show quote, policy decision, expected post-state, observed position,
   and any variance in one audit timeline.
9. **Adapter disagreement** — a fixture where local and protocol-reported health differ;
   surface the discrepancy and use the configured authoritative value.

### 7.4 Artifacts

Hosted sandbox with synthetic partner credentials · seeded fixed-block accounts and
deterministic fixtures · OpenAPI description and importable API collection · five-minute
scripted walkthrough plus a longer engineering walkthrough · architecture and data-flow
diagram · security boundary document showing keys and signers are absent · example partner
policy file · webhook receiver example with signature verification and replay protection ·
reconciliation report export · known limitations and supported-market document · test report
showing fixture blocks, expected values, and reconciliation tolerances.

### 7.5 Acceptance criteria

- All required scenarios run repeatedly without reliance on live third-party availability.
- No allow decision is produced from missing, stale, or inconsistent required inputs.
- Risk calculations match approved fixtures within documented rounding tolerances.
- Every policy decision is explainable and traceable to a versioned policy.
- Webhook signature verification, idempotency, and retries are demonstrated.
- The audit timeline connects request, decision, simulated result, event, and delivery.
- No process in the demo environment has access to a private key or signing capability.

---

## 8. Potential customers

Sell where one person can say yes. Everything below is a prospect hypothesis — no
relationships, no endorsements, nobody contacted, and no verified need. Before outreach,
confirm current product scope, geography, integrations, and the right buyer.

### Tier 1 — self-custody wallets with a Buy button and nothing after it

Users hold BTC and ETH; the wallet wants a borrow tab without standing up a risk desk. Best
profile: active swap or earn products, a product team interested in borrowing, no appetite
for maintaining lending risk logic across several protocols.

- **Candidates:** Rainbow, Zerion, Rabby, Trust Wallet, Phantom (EVM side), MetaMask,
  Coinbase Wallet, Uniswap Wallet, Exodus, Ledger Live, Safe (as embed).
- **Buyer:** head of product, wallet partnerships, DeFi product lead, risk lead, or
  engineering lead.
- **Pitch:** add policy-controlled borrowing and continuous risk monitoring without building
  and maintaining every protocol integration.
- **The one question:** *"If a user gets liquidated through your UI, who gets the support
  ticket, and what do you show them today?"*

### Tier 2 — regional and mid-tier exchanges outside the US

A simpler regulatory question than the US majors, and a real desire for product parity with
Coinbase without hiring a DeFi team.

- **Candidates:** Bitpanda, Bitstamp, Bitvavo, Luno, Independent Reserve, Swyftx, CoinJar,
  Kraken (larger and slower).
- **Buyer:** lending or earn product, institutional product, custody engineering, compliance,
  vendor risk.
- **Pitch:** a maintained risk-control layer for non-custodial or partner-custodied
  borrowing.
- **The one question:** *"Do you want flow you can monetize, or risk you can stop owning?"* —
  the answer decides whether you lead with policy or with monitoring.

### Tier 3 — crypto neobanks and card products

Users want spending power without selling BTC, so borrow is the natural product. Best
profile: self-custody or partner-custody architecture already in place.

- **Candidates:** Gnosis Pay and its ecosystem apps, Ready (ex-Argent), Fold, Cypher,
  Holyheld, stablecoin account providers, regional crypto neobanks.
- **Buyer:** lending product lead, card product lead, chief risk officer, partnerships lead.
- **Pitch:** policy-controlled credit against approved onchain collateral, with monitoring
  and operational evidence.
- **The one question:** *"What does your card-spend-against-collateral flow look like when
  ETH drops 30% overnight?"*

### Tier 4 — qualified custodians and custody infrastructure

Clients ask for onchain borrow; the custodian does not want to build a risk engine.

- **Candidates:** BitGo, Copper, Anchorage Digital, Fireblocks (as marketplace), Fordefi,
  Zodia, Hex Trust.
- **Buyer:** product infrastructure, institutional DeFi, digital-asset operations, risk, or
  custody engineering.
- **Pitch:** normalized lending risk and reconciliation that plugs into customer-controlled
  policy and signing infrastructure.
- **The one question:** *"What would your ops team need to tie out a client's Aave position
  against your ledger at month-end?"*

These buyers expect tenant isolation, role-based access, audit exports, formal incident
response, stronger service objectives, and a security review. Plan for a longer cycle.

### Large US platforms — outcome, not first customer

Coinbase (Morpho, cbBTC, US-only) is the reference case, not a target. Robinhood is evidence
that embedded self-custody lending is possible, and is a roughly twelve-month vendor cycle
that will probably end in building internally. Gemini likewise. Talk to them after eleven
wallets, not before — at which point the conversation tends to be acquisition rather than
procurement, which is a better ending anyway.

### Protocols as the second payer

Later, and worth remembering: once Kollat sits inside several wallets, Morpho and Aave
curators may pay for qualified borrow flow. That turns competition with their BD teams into a
channel relationship.

---

## 9. Customer discovery

Ask each prospective partner:

1. Are customers currently asking to borrow against crypto without selling it?
2. Which assets, chains, protocols, and jurisdictions would be permitted?
3. Who signs and submits the transaction?
4. What risk limits must be enforced before the transaction reaches the signer?
5. Which data source is authoritative when calculations disagree?
6. Which events need real-time alerts, and what response should each trigger?
7. How does the operations team reconcile onchain positions today?
8. What audit evidence is required before launch?
9. What uptime, freshness, and support objectives are required?
10. Would you pay for a pilot, commit engineering time, or sign a letter of intent?

Record the answers as product requirements. Do not present a predetermined seven-protocol
execution roadmap as the only option.

**The decisive question, verbatim:** *"Would you pay us to keep lending integrations correct,
enforce your policies, monitor customer risk, and give your operations team an audit trail?"*

Yes → viable. *"We just want signer-ready Aave transactions"* → the official SDK already does
that; walk away.

---

## 10. The gate and the pilot

Build items 8–10 in §5 only when one of these exists:

- a design partner supplying requirements and test accounts;
- a paid pilot;
- a written LOI contingent on security and compliance review;
- a customer committing engineering time to an integration.

### Pilot shape

One partner, separate sandbox credentials · Aave v3 and Morpho Blue only · Ethereum and Base
only · USDC debt with a small partner-approved collateral allowlist · conservative LTV cap ·
read, policy, monitoring, webhook, and audit APIs · partner-provided unsigned transaction
plans for optional preflight · unsigned transactions only · full request, policy, simulation,
and result log. No production execution until security, legal, and acceptance reviews close.

**Pilot outcome to prove:** one wallet can rely on Kollat to evaluate, monitor, and
reconcile a narrow set of lending positions without granting any signing authority.

### Partner commitments

Named product and engineering owners · written supported-use-case and jurisdiction
assumptions · approved protocol, chain, asset, and risk policy · test accounts or agreed
public fixtures · a webhook receiver and integration engineering time · weekly acceptance
review · commercial intent if the agreed success criteria are met.

### Go / no-go gates

Demo → pilot: only when a partner supplies requirements and engineering participation.

Pilot → production: only when reconciliation and policy tests meet agreed tolerances; the
security review finds no signing or custody capability; incident and support responsibilities
are documented; the partner approves the supported-market boundaries; legal counsel reviews
the actual flow, fees, jurisdictions, and customer communications; and commercial terms
justify ongoing adapter maintenance.

Do not build broad multi-protocol execution unless a committed customer requires it.

---

## 11. Roadmap

### Phase 0 — correctness foundation *(partially complete)*

- ~~Fix the supply-cap, authoritative-risk, and position-scope defects.~~ Done 2026-09-19.
- ~~Document discovery boundaries and exclusions.~~ README coverage table, 2026-09-19.
- Add the no-signing invariant test.
- Add fixed-block adapter fixtures and reconciliation assertions.
- Define fail-closed rules for degraded data.

*Exit:* supported fixture accounts reconcile with expected protocol state, and incomplete or
stale data cannot produce an approval.

### Phase 1 — demo service

- Deploy on private RPCs and start the uptime clock.
- Extract the normalized risk API from the consumer application.
- Add snapshot persistence.
- Add versioned partner policy evaluation with decision reason codes.
- Add deterministic price-shock monitoring and signed webhooks.
- Add append-only sandbox audit records and export.
- Package the demo artifacts and scripted scenarios.

*Exit:* every demo acceptance scenario is repeatable without live RPC dependencies.

### Phase 2 — design-partner pilot

- Add partner authentication, tenant isolation, quotas, shared caching, observability, and
  request deadlines.
- Integrate the partner's policy and webhook receiver.
- Add live monitoring and recurring reconciliation.
- Establish supported-block freshness and support objectives.

*Exit:* the partner completes acceptance testing and confirms commercial intent.

### Phase 3 — preflight

- Decode and validate partner-provided unsigned action plans.
- Simulate at a pinned block and return normalized post-state.
- Bind approvals to transaction-plan hashes, policy versions, and expirations.
- Reconcile predicted against observed results.

*Exit:* supported actions simulate reliably and post-execution state stays within the agreed
variance.

### Phase 4 — selective transaction construction

- Integrate the official Aave and Morpho SDKs for partner-requested actions.
- Independently decode, policy-check, simulate, and audit SDK output.
- Add other protocols only when customer demand and maintenance economics justify them.

*Exit:* a partner-controlled signer executes approved transactions in its own environment
without exposing keys to Kollat.

---

## 12. Success metrics

### Correctness and reliability

- Share of supported adapter fixtures within reconciliation tolerance.
- Number and severity of discrepancies between local and protocol-reported risk.
- Share of responses meeting freshness requirements.
- Partial and total upstream failure rate.
- P50, P95, and P99 API latency by chain and protocol.
- Monitor detection latency and webhook delivery latency.
- Webhook retry and duplicate-processing rate.

### Product value

- Active monitored accounts and positions.
- Onchain exposure covered by policy and monitoring.
- Policy decisions by allow and deny reason.
- Incidents or unsafe actions prevented.
- Reconciliation exceptions caught before partner escalation.
- Partner engineering time saved against maintaining adapters internally.

### Commercial validation

- Qualified customer interviews.
- Design partners contributing engineering time.
- Letters of intent or paid pilots.
- Pilot-to-production conversion.
- Annual contract value against adapter and support cost.
- Expansion into additional protocols, chains, or monitored accounts.

Avoid vanity metrics — website visits, raw count of discovered markets — unless they
correlate with partner adoption.

---

## 13. Risks, mitigations, and open questions

| Risk | Mitigation |
|---|---|
| Protocol upgrades silently change behavior | Version adapters, run fixed-block and live canaries, alert on ABI or reconciliation changes. |
| RPC or API outages produce incomplete risk | Multiple providers, explicit completeness metadata, deadlines, stale limits, fail-closed policy. |
| Oracle failure or manipulation | Partner allowlists, freshness checks, protocol-oracle validation, discrepancy alerts. |
| The service appears to guarantee protocol safety | Define supported calculations and limitations precisely; report evidence and confidence, never guarantees. |
| Official SDKs commoditize execution | Sell cross-protocol policy, monitoring, reconciliation, and maintenance — not calldata. |
| Free aggregators commoditize comparison | Focus on account-specific controls, auditability, and operational integration. |
| Enterprise sales cycles consume runway | Start with one wallet-sized design partner; require concrete commitments before broad builds. |
| Customer requirements fragment the product | Keep a stable normalized core; express customization through versioned partner policies. |
| Regulatory characterization changes with the flow | Preserve the no-custody and no-signing boundaries; obtain counsel for each production commercial model. |
| Sensitive account activity leaks | Minimize stored data, isolate tenants, encrypt records, restrict access, set retention and deletion policies. |

### Open questions

- **The protocols are the integration layer.** Aave Kit previews health factor before
  signing; the Morpho SDK builds signer-ready transactions with post-op health validation and
  courts the same wallets. Neutrality plus policy plus audit trail is the answer, and it has
  to be the pitch.
- **Compliance collapses routing to one protocol.** Expect it. The value is the layer around
  the protocol, not the choice between seven.
- **"The customer signs" is not a regulatory clean sheet.** Routing recommendations, fees,
  geography, and customer type all change the analysis. Counsel before any write path. No
  stablecoin and no custody remains unchanged, with the GENIUS Act effective January 2027 at
  the latest.
- **Enforcement history.** BlockFi, Celsius, Genesis, Gemini Earn. Confirm the retail
  self-custody borrow gap is "nobody built it," not "it was unattractive or illegal."
- **Liquidation blame lands on the interface**, regardless of who ran the loan. Warning UX is
  a product requirement, not a nicety.
- **Unverified claims currently sitting in these documents:** Coinbase "$1B originations in
  eight months"; "$54B lending TVL, 380+ protocols." Re-source before either appears in a
  deck.

---

## 14. Immediate next actions

1. Convert the remaining §5 items 1–3 into tracked issues, each with a fixture that
   reproduces the problem.
2. Define the normalized risk response and policy decision schemas on paper before
   implementing new routes.
3. Build the deterministic Aave and Morpho demo fixture set.
4. Deploy on private RPCs and start the uptime clock.
5. Prepare the one-page partner pitch around policy, monitoring, and reconciliation.
6. Run ten interviews across wallet product, engineering, and risk leaders.
7. Find one design partner willing to supply policy requirements and integration time.
8. Reassess preflight and transaction construction only after those interviews reveal a
   concrete workflow.

---

## 15. Documents and references

| File | Status |
|---|---|
| `borrow-router-plan.md` | Original plan and v1 spec. §1 thesis ("we route to the best one") and §3 roadmap (consumer v2) superseded. §7 spec is the v1 record; the design appendix stands. |
| `Kollat — Strategy Notes & Build Prompt.md` | 2026-09-17 reflection. Diagnosis, invariants, dead ends, and the gate still hold. Build order superseded — monitoring was step 6, and now precedes execution. |
| `README.md` | Current; coverage table added 2026-09-19. |
| this file | Current working state. Update when an item in §5 moves. |

**External references**

- Robinhood's embedded self-custody lending model: <https://robinhood.com/us/en/support/articles/crypto-earn/>
- Free comparison competition: <https://defillama.com/borrow>
- Official transaction integration competition: [Aave Kit](https://aave.com/build),
  [Morpho SDK](https://docs.morpho.org/developers/sdks/morpho-sdk/),
  [Enso lending integrations](https://docs.enso.build/pages/use-cases/lending-markets/index)
- Stablecoin rulemaking context: <https://occ.treas.gov/news-issuances/news-releases/2026/nr-occ-2026-9.html>

---

*This document is product and engineering strategy, not legal advice. Production
architecture, marketing, fees, supported jurisdictions, and customer flows require review by
qualified counsel.*
