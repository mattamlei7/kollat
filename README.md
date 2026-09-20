# Borrow Router

Read-only comparison of crypto-backed USDC borrowing across Aave v3, Spark, Compound v3, Morpho Blue, Fluid, Euler v2 and Moonwell on Ethereum, Base, Arbitrum, Optimism, Polygon and Avalanche. Paste an address, see what it could borrow on each protocol, at what rate, and where it would be liquidated. Existing positions are shown with the protocol's own health factor.

Non-custodial by construction: there is no wallet connection, no signing, no write path. Every number comes from the protocol's own contracts (or, for Morpho and Euler market discovery, their public APIs) via server-side RPC.

## Run

```
npm install
cp .env.example .env.local   # optional: private RPC URLs
npm run dev                  # http://localhost:3000 (homepage) · /borrow (the app)
```

| Command | What |
|---|---|
| `npm run dev` | Dev server |
| `npm run build && npm start` | Production build |
| `npm test` | Unit tests for the risk math (`lib/math/health.ts`) |
| `npm run verify -- <address> [--chain 1\|8453] [--protocol <id>]` | Print every adapter's markets, rates, capacity and positions for an address, to check against the protocol front-ends |

API routes: `GET /api/markets?chain=1,8453`, `GET /api/account/<address-or-ens>?chain=…`, `POST /api/decide` (`{ policy, proposal }` → policy decision; see `policy.example.json`), `GET /api/health`.

Every result carries `fetchedAt`, `stale` and `block` (the chain head observed before the read); every snapshot carries `completeness` — reads attempted / ok / stale / failed, the block range per chain, and each failure's code. A consumer should treat `failed > 0` or `stale > 0` as "not the whole picture".

## Layout

```
lib/protocols/types.ts      LendingProtocol adapter contract (the product)
lib/protocols/base.ts       caching, error-to-value, default capacity calc
lib/protocols/<name>.ts     one adapter per protocol
lib/protocols/registry.ts   the list of live (protocol, chain) instances
lib/math/health.ts          HF, max borrow, liquidation price, cost delta
lib/snapshot.ts             joins all adapters into one response for the UI
app/(site)/                 marketing homepage (/) — persistent WebGL sphere behind the sections
app/borrow/                 the comparison app (/borrow)
components/scene/           particle sphere, starfield, scroll-driven camera
components/site/            homepage sections
components/Rail.tsx         borrow simulator (pure over lib/math/health.ts)
scripts/verify.ts           CLI cross-check tool
```

## Coverage

Discovery is deliberately narrow; a position outside it is not shown and a market outside it is not compared. Anyone consuming the API should treat these as the contract:

| Protocol | What is listed | What is not |
|---|---|---|
| Aave v3 / Spark | Every reserve that can collateralise USDC | Positions with non-USDC debt still show, with all debt legs |
| Compound v3 | Native-USDC Comets only | USDC.e Comets (Polygon), bridged-USDbC Comet (Base) |
| Morpho Blue | USDC-loan markets with ≥ $250k supplied; one market per collateral (most liquidity) | Smaller markets, and positions in any market not chosen |
| Fluid | USDC-debt vaults; one vault per collateral (most borrowable) | Smart-collateral / smart-debt vaults, and positions in vaults not chosen |
| Euler v2 | Top 4 USDC vaults by size; one collateral vault per token | Other vaults; positions on sub-accounts whose controller is elsewhere are listed but not folded into simulations |
| Moonwell | Comptroller core markets | Positions in unlisted markets (a note is added when one is detected) |

Simulations fold an existing position into the new borrow only when they share a health factor: the same account-level protocol, the same isolated market, or the same Euler debt vault.

## Adding a protocol

Every protocol is normalised into `(collateral → debt)` markets with `ltv`, `liquidationThreshold`, `liquidationPenalty` and oracle prices, so one formula computes capacity, health factor and liquidation price for all of them.

1. Add the id to `ProtocolId` in `lib/protocols/types.ts`.
2. Create `lib/protocols/<name>.ts` extending `BaseLendingProtocol` and implement the three reads: `fetchMarkets`, `fetchRates`, `fetchPositions`. Throw on failure; the base class turns it into a `Result` error value. Override `getBorrowCapacity` only if the default (markets × wallet balances) is wrong for the protocol.
3. Register instances in `lib/protocols/registry.ts` and add an entry to `PROTOCOL_META` (name, close factor, app URL).
4. Run `npm run verify -- <address> --protocol <id>` against a known position and compare with the protocol's UI before trusting it.

Rules: adapters are read-only, no method may build or sign a transaction, and no API keys reach client code.
