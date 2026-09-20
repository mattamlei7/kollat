# Borrow Router — Strategy Notes & Build Prompt

2026-09-17 · @Someone

## What's actually strong

**The non-custodial posture is the asset, not the limitation.** Robinhood's own crypto product routes on-chain lending through a self-custody wallet, and its custody page states plainly that it does not lend or leverage custodied crypto. That is a deliberate post-Celsius legal position. Any regulated counterparty will land on the same shape. Borrow Router was already built for it.

**The normalization layer is the real IP.** Every protocol reduced to `(collateral -> debt)` with `ltv`, `liquidationThreshold`, `liquidationPenalty` and an oracle price, so one formula in `lib/math/health.ts` computes capacity, health factor and liquidation price across all seven. That data model is what survives. The UI is not.

**`scripts/verify.ts` is worth more than it looks.** Cross-checking every adapter against the protocol's own front-end is what makes a compliance team comfortable. It is the seed of a reconciliation product.

**The hard rules are already in place.** Adapters are read-only, no method may build or sign a transaction, no API keys reach client code. Those are exactly the questions a vendor security review asks. Do not relax them casually.

**The tailwind is real.** Lending sits at roughly $54B TVL across 380+ protocols, Aave handles close to half of active DeFi loans, and Coinbase's BTC-backed loan product runs on Morpho as its rail. Demand for "cash without selling my BTC" is mainstream. Only the plumbing is niche.

## Hard truths

**The comparison layer is commoditized.** DefiLlama ships a free Borrow Aggregator and Yields product covering more protocols. DeFiRate publishes a borrow-rate table across Aave v3, Morpho Blue, Spark, Sky, Compound v3 and Fluid. Apify has pay-per-call scrapers doing live supply/borrow APY across seven protocols and five chains for $0.001 a pool. Health factor and liquidation price are differentiators, but they are features, not a category.

**There is no moat in the repo.** Public contracts, published liquidation math, public APIs for Morpho and Euler, a few thousand lines. A competent dev clones the concept in three weekends. Nothing in `lib/` is secret.

**The only durable technical edge is maintenance.** Adapters rot. Aave ships a version, Morpho spawns markets, oracles get swapped, and someone has to be correct the Tuesday after. That is a Plaid-style integration moat: real, thin, and it only compounds once customers depend on it.

**A read-only widget dies in someone's roadmap prioritization.** Exchanges do not buy rate data; they have data teams and DefiLlama is free. They buy flow they can monetize, or risk they can stop owning. Anything else gets deprioritized.

**The moat conversation is premature without a pilot.** If there is no signed pilot or a warm intro two calls deep, the answer is more calls, not more code.

**"Nobody has built it" is not automatically an opportunity.** US retail crypto lending has an enforcement graveyard behind it: BlockFi, Celsius, Genesis, Gemini Earn. Some gaps are gaps because the product was illegal or unattractive, not because nobody thought of it. Always ask which kind you are looking at.

## The architecture decision

The question "how do I backend the lending process without touching money" resolves by asking one thing: **who holds the keys.** Three shapes:

1. **Transaction builder.** You return unsigned calldata; their wallet signs. No custody, minimal regulatory surface. The Enso / Li.Fi / 0x shape. This is how you get in the door.
2. **Orchestrator over their custody.** The exchange custodies in its own infra (Fireblocks, Anchorage, in-house). Your service decides, simulates and monitors. They are the regulated entity; you are software. This is where the B2B revenue is.
3. **You custody.** Do not.

**Repo implication.** Do not break the adapter contract. Add a parallel layer, `lib/actions/<protocol>.ts`, that emits `{to, data, value, chainId}` and nothing else. Read adapters stay pure. No signing method exists anywhere in the process. No key material is ever loaded. You keep the property you are selling and lose only the limitation.

**The product is not the calldata.** Anyone can encode an Aave `borrow` call. What gets bought:

- **Preflight simulation.** Fork-simulate before returning the tx; return post-state health factor. No exchange puts a button in front of a customer that might revert.
- **Monitoring and webhooks.** Health factor crosses a threshold, you push. Recurring revenue, and the piece a custodian genuinely will not build.
- **Per-customer policy allowlists.** Only these protocols, these collaterals, max LTV 40%. No compliance team approves unbounded routing into permissionless Morpho markets.
- **Reconciliation.** Position state their ledger team can tie out. Boring. It is why procurement signs.

**On "lending is too niche and sophisticated."** Half right. The comparison tool is niche because only sophisticated users compare liquidation thresholds. The underlying demand is not niche at all. The sophistication is the moat; hiding it well is the product. The end user should never see the words "liquidation threshold." More assets moving on chain is a tailwind, not a threat: every new tokenized collateral type is one more adapter in a normalization layer you already own.

## Go-to-market: order of operations

**Correction to the working assumption.** Robinhood is not absent from this. Their crypto page already offers lending USDG on chain through a self-custody wallet with real-time accrual, and they explicitly do not lend or leverage custodied crypto. So the gap is narrower and more specific than "exchanges don't have lending": **lend is solved, borrow is not.** Nobody has made the self-custody borrow flow non-terrifying for a retail broker's compliance team. That is the actual wedge, and it is a better pitch because it is true.

**Robinhood is the outcome, not the first customer.** They have Robinhood Chain, an in-house crypto org, and a public-company vendor risk process. Best case is a 12-month cycle and a security review. Likely case is your product gets scoped into a planning doc and built internally. Final boss is the right read; you do not fight the final boss first.

**Sell to the tier where one person can say yes:**

- Self-custody wallet apps that have a Buy button and nothing after it
- Regional and mid-tier exchanges outside the US, where the regulatory question is simpler
- Crypto-native neobanks and card products whose users hold BTC and want spending power
- Qualified custodians whose institutional clients ask for on-chain borrow and who will not build a risk engine

These close in weeks. They also break your adapters in ways that make the product actually good, which is the part you cannot buy.

**Then the final boss conversation changes shape.** It stops being a cold pitch and becomes "we are the default routing layer for eleven wallets, here is our uptime and our reconciliation record." At that point it is usually an acquisition conversation, not a procurement one. Better ending anyway.

## Dead ends

**Do not issue your own USD token.** Taking custody of customer dollars and issuing a redeemable token makes you a stablecoin issuer and a money transmitter. Under the GENIUS Act, offering a payment stablecoin to people in the US without qualifying as a permitted payment stablecoin issuer is unlawful. Permitted issuers are essentially bank subsidiaries, OCC-licensed nonbanks, or state-qualified issuers. Effective date is the earlier of 18 months after the July 18, 2025 enactment (January 18, 2027) or 120 days after final regulations; OCC, FDIC and Treasury rules were still in proposed form through mid-2026, with transitional deadlines running to July 2028. Add FinCEN MSB registration and state money transmitter licenses on top.

**It is also strategically backwards.** Fiat rails and money transmitter licenses are your customer's moat. The moment you say "I will also issue a dollar token," you stop being their bridge and become their competitor, and you lose the partnership you are currently selling. This is not step two. It is a different company aimed at your own pipeline.

**Do not custody.** Not customer USD, not customer crypto, not keys. The entire value of the pitch is that you are software and they are the regulated entity.

**The real step two is execution.** Route the borrow, take bps on flow, keep the user self-custodying. Same data model, same math, adjacent to what already exists in the repo.

*Not legal advice. Before writing custodial code, talk to fintech counsel; the licensing answer determines the architecture, not the reverse.*

## The code prompt (paste this when you're ready to build)

```
Context: Borrow Router is a Next.js + TypeScript app. It is a read-only comparison of
crypto-backed USDC borrowing across Aave v3, Spark, Compound v3, Morpho Blue, Fluid,
Euler v2 and Moonwell on Ethereum, Base, Arbitrum, Optimism, Polygon and Avalanche.

Current architecture:
  lib/protocols/types.ts      LendingProtocol adapter contract
  lib/protocols/base.ts       caching, error-to-value, default capacity calc
  lib/protocols/<name>.ts     one adapter per protocol (fetchMarkets/fetchRates/fetchPositions)
  lib/protocols/registry.ts   live (protocol, chain) instances + PROTOCOL_META
  lib/math/health.ts          HF, max borrow, liquidation price, cost delta
  lib/snapshot.ts             joins adapters into one response
  scripts/verify.ts           CLI cross-check against protocol front-ends

Invariants that must not change:
  - Adapters are read-only. No adapter method may build or sign a transaction.
  - No private keys or signers exist anywhere in this process.
  - No API keys reach client code.
  - Every protocol normalises to (collateral -> debt) with ltv,
    liquidationThreshold, liquidationPenalty and an oracle price.

GOAL: add a non-custodial execution layer so a B2B partner (a wallet app, a mid-tier
exchange, a custodian) can offer crypto-backed borrowing to their users. We build the
transaction; THEIR wallet or custody stack signs it. We never hold keys or funds.

Build, in this order, and stop after each for review:

1. lib/actions/types.ts
   Define BuiltTx = { to: `0x${string}`, data: `0x${string}`, value: bigint, chainId: number }
   and an IntentBuilder interface with buildSupply / buildBorrow / buildRepay /
   buildWithdraw, each returning BuiltTx[] (approvals may require more than one).
   Builders are pure encoders: viem encodeFunctionData only, zero RPC writes, zero signing.

2. lib/actions/<protocol>.ts
   One builder per protocol, mirroring lib/protocols/<name>.ts. Start with Aave v3
   and Morpho Blue only. Reuse the existing address book and market normalisation;
   do not duplicate registry data.

3. lib/actions/preflight.ts
   Given a BuiltTx[] and an account, simulate against a forked node and return
   { ok, revertReason?, postState: { healthFactor, liquidationPrice, borrowApr } }
   using the existing lib/math/health.ts. Never return an unsimulated tx to a caller.

4. lib/policy/index.ts
   Per-partner policy: allowed protocol ids, allowed collateral assets, max LTV,
   max notional per tx and per day, blocked chains. Evaluated BEFORE building.
   Deny-by-default. Every decision returns a structured reason, logged.

5. app/api/v1/intents/route.ts
   POST { partnerId, account, action, protocol, chain, collateral, debt, amount }
   -> policy check -> build -> preflight -> respond with { txs, preflight, quote }.
   Auth by partner API key, per-partner rate limit, full audit log of every request
   and response. The route must be incapable of signing; assert this in a test.

6. lib/monitor/
   Given tracked (partner, account, protocol, chain) tuples, poll positions via the
   EXISTING read adapters and fire a webhook when health factor crosses partner-set
   thresholds. Signed webhook payloads, at-least-once delivery, replay-safe.

7. Extend scripts/verify.ts
   For each builder, verify the built calldata decodes to the expected function and
   args, and that preflight's predicted post-state matches a real fork execution.
   This script is the artifact a partner's security review will ask to see.

Tests required: a unit test asserting no module under lib/actions exports or imports
anything capable of signing; preflight golden tests against known positions; policy
deny-path tests for every rule.

Do not add: fiat on-ramps, custody, key management, a stablecoin, or any code that
moves user funds through infrastructure we control.
```

## Answer these before writing more code

1. Is there a signed pilot, or an intro that has gone two calls deep? If not, the next unit of work is calls, not commits.
2. Which of the four customer tiers has someone you can reach this month?
3. For that customer: do they want flow they can monetize, or risk they can stop owning? The answer decides whether you build the intent API first or the monitoring service first.
4. What does their compliance team need to see before a routing layer goes in front of retail? Ask them directly; it is the spec.
5. Is "borrow is unsolved for self-custody retail" a gap because nobody built it, or because of enforcement history? Get a real answer before committing a year.

**Revisit trigger.** Come back to the code prompt above once question 1 is a yes. Building it before then is expensive speculation, and the partner's requirements will rewrite half of it anyway.
