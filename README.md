# Borrow Router

Read-only comparison of crypto-backed USDC borrowing across Aave v3, Spark, Compound v3 and Morpho Blue on Ethereum and Base. Paste an address, see what it could borrow on each protocol, at what rate, and where it would be liquidated. Existing positions are shown with the protocol's own health factor.

Non-custodial by construction: there is no wallet connection, no signing, no write path. Every number comes from the protocol's own contracts (or, for Morpho market discovery, its public API) via server-side RPC.

## Run

```
npm install
cp .env.example .env.local   # optional: private RPC URLs
npm run dev                  # http://localhost:3000
```

| Command | What |
|---|---|
| `npm run dev` | Dev server |
| `npm run build && npm start` | Production build |
| `npm test` | Unit tests for the risk math (`lib/math/health.ts`) |
| `npm run verify -- <address> [--chain 1\|8453] [--protocol <id>]` | Print every adapter's markets, rates, capacity and positions for an address, to check against the protocol front-ends |

API routes: `GET /api/markets?chain=1,8453` and `GET /api/account/<address-or-ens>?chain=…`.

## Layout

```
lib/protocols/types.ts      LendingProtocol adapter contract (the product)
lib/protocols/base.ts       caching, error-to-value, default capacity calc
lib/protocols/<name>.ts     one adapter per protocol
lib/protocols/registry.ts   the list of live (protocol, chain) instances
lib/math/health.ts          HF, max borrow, liquidation price, cost delta
lib/snapshot.ts             joins all adapters into one response for the UI
components/Rail.tsx         borrow simulator (pure over lib/math/health.ts)
scripts/verify.ts           CLI cross-check tool
```

## Adding a protocol

Every protocol is normalised into `(collateral → debt)` markets with `ltv`, `liquidationThreshold`, `liquidationPenalty` and oracle prices, so one formula computes capacity, health factor and liquidation price for all of them.

1. Add the id to `ProtocolId` in `lib/protocols/types.ts`.
2. Create `lib/protocols/<name>.ts` extending `BaseLendingProtocol` and implement the three reads: `fetchMarkets`, `fetchRates`, `fetchPositions`. Throw on failure; the base class turns it into a `Result` error value. Override `getBorrowCapacity` only if the default (markets × wallet balances) is wrong for the protocol.
3. Register instances in `lib/protocols/registry.ts` and add an entry to `PROTOCOL_META` (name, close factor, app URL).
4. Run `npm run verify -- <address> --protocol <id>` against a known position and compare with the protocol's UI before trusting it.

Rules: adapters are read-only, no method may build or sign a transaction, and no API keys reach client code.
