# Borrow Router — Business Plan & Build Spec

## 1. The thesis

Exchanges have the customers. DeFi protocols have the rates and the balance sheet.
Coinbase proved the pairing works: it routes user collateral into Morpho on Base,
provides only the interface, and crossed $1B in originations within eight months of
launching in January 2025. Every other exchange, wallet, and crypto-holding fintech
now has the same board-level question and no in-house answer.

**The company:** the neutral integration layer that lets any platform offer
crypto-backed borrowing against Aave, Morpho, Spark and Compound — without building
smart-contract infrastructure, and without Coinbase's vertical advantages
(owning Base, issuing cbBTC).

**The differentiator Coinbase structurally can't copy:** they route to one protocol.
We route to the best one, per asset, per size, per moment.

---

## 2. What to build first (and why it's this)

Do **not** start with the custodial product. Start with the piece that touches no
funds, needs no license, and requires no partner to sign anything.

**MVP: a non-custodial borrow router.**
A user connects a read-only wallet address (or just types one in). The app shows:
what they hold, what they could borrow against it across every major protocol, at
what rate, at what liquidation price, and what it costs them to be on the wrong one.

Why this first:
- **Zero regulatory surface.** Read-only, non-custodial, no money movement. It's a
  data product until the day you decide it isn't.
- **It is the sales deck.** You walk into Kraken with a working thing showing their
  users' aggregate borrowing capacity, not a slide.
- **It generates the proprietary asset.** Rate history, routing decisions, liquidation
  telemetry. That data is what makes the routing engine defensible later.
- **Buildable in days, not quarters.**

### Deliberately out of scope for v1
Transaction signing. Custody. Fiat rails. Wrapped-asset issuance. Any write path at all.

---

## 3. Product roadmap

**v1 — Router (weeks 0–4).** Read-only. Wallet or address input, cross-protocol
rate comparison, health-factor and liquidation simulator, "you're leaving X bps on
the table" analysis. Public, free.

**v2 — Execute (weeks 4–12).** Add wallet connection and transaction building. User
signs; we never hold keys. Still non-custodial, still no license in most
jurisdictions — but verify this with counsel before shipping, not after.

**v3 — Embed (quarter 2+).** The actual business: a widget + API that exchanges and
wallets drop into their apps. They keep the customer relationship; we handle
protocol routing, position monitoring, and liquidation alerts. Revenue is basis
points on originated volume or a flat platform fee.

**v4 — Markets Coinbase can't serve.** Their product launched US-only and excludes
New York. Non-US exchanges are the wedge with the least competitive pressure.

---

## 4. Business model

| Stage | Who pays | How |
|---|---|---|
| v1 | Nobody | Distribution and data collection |
| v2 | Users | Optional routing fee on execution, or free to build volume |
| v3 | Platforms | bps on originated loan volume + monitoring SaaS fee |
| v3+ | Protocols | Morpho/Aave curators pay for qualified borrow flow |

The v3 line is the real company. v1 and v2 exist to make v3 credible.

---

## 5. The honest risk register

- **Coinbase builds the aggregation layer themselves.** Likely eventually. Your
  window is the gap between "one-protocol integration" and "multi-protocol routing,"
  plus every platform that isn't Coinbase.
- **Exchange partnerships are the entire v3 business.** Nothing else matters if no
  exchange says yes. Start those conversations the week v1 ships, not after v2.
- **Regulatory reclassification.** The moment you touch funds or take a spread, the
  analysis changes — money transmission, custody, possibly lending licenses. Coinbase
  sunset its first Borrow program in 2023 amid an SEC fight. Get securities and money
  transmission counsel before v2, and structure v2 so the non-custodial answer is
  clean and documented.
- **Liquidation blame.** Users blame the interface regardless of who ran the loan.
  Over-invest in warning UX — it's a product requirement, not a legal footnote.
- **Smart-contract risk you didn't write.** You inherit the risk of every protocol
  you route to and own none of the upside if it goes well.

This is not legal or financial advice — the regulatory path here genuinely needs a
specialist, early.

---

## 6. First 30 days

1. Build v1 (the prompt below).
2. Ship it publicly. Post it where DeFi borrowers already are.
3. Instrument everything — which assets, which sizes, where routing beats the default.
4. Book calls with 5 non-Coinbase exchanges and 5 wallet companies. Lead with the tool.
5. Retain crypto-regulatory counsel. Scope: what v2 requires, jurisdiction by jurisdiction.

---

# 7. The Claude Code prompt

Copy everything below this line into Claude Code.

---

Build a non-custodial DeFi borrow router as a web app. It is **read-only** — it never
requests a signature, never moves funds, and has no write path. Treat that as a hard
architectural constraint, not a preference.

## What it does

A user enters an Ethereum address (or connects a wallet read-only). The app fetches
their token balances and shows them, across Aave v3, Morpho, Compound v3 and Spark:

1. **Borrowing capacity** — for each collateral asset they hold, the maximum USDC
   borrowable on each protocol, given each protocol's LTV parameters for that asset.
2. **Cost comparison** — current variable borrow APR per protocol, with the
   difference stated in real money: "Borrowing $50,000 on Aave instead of Morpho
   costs you $1,240 more per year."
3. **Liquidation simulator** — a slider for borrow amount that live-updates the
   health factor and the collateral price at which liquidation triggers. Include a
   second control for a hypothetical collateral price drop, so the user can see what
   a 30% move does to their position before they take one.
4. **Existing positions** — if the address already has open positions on any
   supported protocol, surface them with current health factor and a plain-language
   risk read.

## Technical requirements

- Next.js (App Router) + TypeScript + Tailwind.
- Chain data via viem. Read protocol state directly from contracts where practical;
  use each protocol's public subgraph/API where contract reads are impractical.
  Support Ethereum mainnet and Base at minimum.
- Aggressive caching of rate data — assume free-tier RPC limits. Revalidate on an
  interval, not per keystroke.
- Every protocol lives behind a common `LendingProtocol` adapter interface:
  `getMarkets()`, `getBorrowCapacity(address)`, `getPositions(address)`,
  `getRates()`. Adding a fifth protocol must mean writing one adapter file and
  nothing else. This interface is the actual product — design it first and show it
  to me before building the rest.
- Handle the empty case (address holds nothing borrowable) and the error case (RPC
  down, protocol paused) as designed states, not thrown exceptions.
- No API keys in client code.

## Risk UX — treat this as a core feature

Liquidation warnings are the product's integrity, not a disclaimer. Health factor
must be continuously visible once an amount is selected, not tucked in a tooltip.
When a simulated position enters dangerous territory, the interface says what
happens in plain language — what gets sold, at what price, and what the user keeps —
rather than turning a number red. Never present a borrow amount without its
liquidation price adjacent to it.

## Design direction

Audience is people who already hold six figures of crypto and understand
collateralization. They do not need to be sold to; they need to be shown numbers
they can trust. Density over whitespace, legibility over polish, numbers as the hero.

Avoid the generated-fintech defaults: no identical rounded cards in a grid, no
gradient washes, no all-caps eyebrow labels, no fade-up-on-scroll. Pick a type and
color system that is specific to this brief and **justify it to me in one short
paragraph before you write CSS.** The structural rules below are not negotiable; the
palette itself is yours to propose.

### Structure — hairlines, not cards

- One near-black canvas. Every structural boundary is a **1px hairline at ~20% opacity
  of a mid-grey** — never a bordered box, never a background change, never a shadow.
  Sections stack vertically in a single column, each closed with a bottom hairline.
- **Zero `box-shadow` in the entire app** except popovers and modals (one value, e.g.
  `0 8px 24px rgba(0,0,0,0.12)`).
- Exactly three surface levels, used strictly: (1) canvas — the page; (2) raised —
  genuine content objects only, like a rate-history tile or a position card;
  (3) control fill — interactive things only. Do not introduce a fourth, and do not
  use "raised" to group page regions; that is the hairline's job.
- **Two-column layout.** Main column = protocol comparison, separated from a **sticky
  right rail (~400–425px, 32px padding)** by a single vertical hairline. The rail holds
  the borrow-amount slider, the live health factor, and the liquidation price. It must
  not scroll away — this is the mechanism that satisfies "health factor continuously
  visible," and it is the single most important structural decision in the app.
- Data tables **bleed to the full column width** while their cells stay inside the 32px
  gutter, so a row hover spans edge to edge.

### Density

Take the density of a professional terminal, not a consumer app:

| | consumer default | use this |
|---|---|---|
| table row height | 60–64px | **40px** |
| control height | 40–56px | **32–36px** |
| border radius | pills (9999px) | **6px** — 12px for modals, 4px for inline badges |
| hero number | 80px | **one** number at 32–40px, per view, max |

No pill-shaped buttons. No 24px-radius cards laid out in a grid.

### Numbers

- `font-variant-numeric: tabular-nums` on **every** numeric cell, no exceptions.
- Numeric columns are **right-aligned**. Comparison is the entire point; digits must
  align on the decimal across rows. (Consumer crypto UIs almost universally left-align
  these. Don't.)
- Static values only. **No animated digit odometers, counters, or roll-ups.** They cost
  a frame of legibility on exactly the numbers a user is trying to verify against a
  protocol's own front end, and they degrade badly under `prefers-reduced-motion`.
  A rate is either 5.84% or it isn't.
- Consistent precision per column, not per value.

### Color — one job

Chrome is achromatic. Navigation, links, icons, borders and the primary button carry
**no hue**: white, near-black, and greys only. A primary action is a **white fill with
near-black text.**

Color belongs to risk, and only to risk:

- **Risk state uses tinted washes, not bright text.** A ~10% tint of the semantic hue
  composited onto the near-black canvas produces a fill that reads as state at a glance
  without shouting (safe ≈ very dark green, caution ≈ very dark amber, danger ≈ very
  dark red). Use these for health-factor band chips, the simulator's state, and the
  active row in a liquidation table.
- **Saturated hue is rationed to three places:** the health-factor number, the
  liquidation price, and the warning copy that fires when a simulated position enters
  danger. Nothing else.
- **Rate deltas are typographic, not chromatic.** "−142 bps" is set in the strong
  weight; "+142 bps" is regular. Optionally a single muted arrow glyph. The moment every
  row on the page has a green or red number, color stops meaning risk and the warning
  system is dead.
- Never color alone: pair every risk state with a word and a glyph.

### Two interaction patterns to build

1. **Sliding-indicator segmented control.** A track with a single absolutely-positioned
   indicator that animates `left`/`width` (~200ms ease) between options. Use for chain
   switching, protocol filtering, and the rate-history timeframe. Where the control sits
   over risk data, the indicator's fill takes the **current risk color** — one state
   value propagating to several elements is what makes an interface feel wired together
   rather than decorated.
2. **Dotted-underline definition labels.** `text-decoration: underline dotted` on every
   piece of jargon — LTV, liquidation LTV, health factor, utilization, borrow APR vs.
   net APR — revealing a definition on hover *and* keyboard focus. Dense and
   unobtrusive; it lets expert terminology stay in the UI instead of being dumbed down
   or bloated with helper text.

### Drill-down without losing context

When a user wants a protocol's full parameters, **push a sub-view into the right rail**
(slide in from the right, with a back affordance and a centered title) rather than
opening a modal or navigating away. The comparison table stays on screen; the user never
loses their place.

### Designed states

Empty, loading, and error are compositions, not fallbacks:

- **Empty** (address holds nothing borrowable): a real heading at the largest UI size,
  a muted one-sentence explanation, and one action. Not a centered grey string.
- **Error** (RPC down, protocol paused): name the protocol, name what failed, and keep
  every *other* protocol's row live. A partial comparison is still useful; a blanked
  page is not.
- **Loading**: skeleton rows at the real row height, so the table does not reflow on
  arrival.

### Non-negotiables

Fully responsive. Keyboard accessible — the borrow-amount slider must be operable by
arrow keys with the health factor updating live in an `aria-live` region.
`prefers-reduced-motion: reduce` disables the indicator slide, the rail push, and all
chart animation. Focus ring is a visible 2px outline at 2px offset on every interactive
element.

## Build order

Adapter interface and one protocol (Aave v3) end to end → verify against real
addresses → then the remaining three adapters → then comparison UI → then simulator.

Do not scaffold all four protocols at once. Get one correct first and show me the
numbers so I can check them against the protocol's own front end.

---

# Appendix — provenance of the design direction

The structural rules in §7 came from a measured teardown of Coinbase's Trade surface
(computed styles read off the live DOM, not estimated from screenshots). Roughly a third
of that UI transfers to this brief; the rest fights it. Kept for reference so the
reasoning survives, and so nothing gets re-litigated mid-build.

| Pattern | Verdict |
|---|---|
| Hairline-only page structure (1px @ 20% grey, no cards for regions) | **Take wholesale** |
| Sticky right rail beside a bordered main column | **Take wholesale** — it *is* the simulator |
| Rail push/pop sub-navigation instead of modals | **Take** |
| Sliding-indicator segmented control | **Take** |
| ~10% tinted washes on near-black for state | **Take** — best idea in the reference |
| Dotted-underline definition labels | **Take** |
| Full-bleed row hover at ~35% of the raised surface | **Take** |
| Small inline badges (4px radius, quiet fill) | **Take** — protocol names, chain tags, "best rate" |
| 2px round-capped chart line + end dot ringed in canvas color | **Take** (drop the rest of the ornament) |
| Designed empty-state composition | **Take** the shape; write your own copy |
| Generous 32px section padding | **Reduce** to ~20–24px |
| 24px-radius asset tiles in a 4-up grid | **Reject** — literally the banned pattern |
| Pill radii on every control | **Reject** — reads consumer, fights density |
| 80px odometer amount display | **Reject** — theatrics on the one number that must be trusted |
| Accent hue across nav, links, icon discs, CTA | **Reject** — spends the color budget on chrome |
| Green/red on every row's change cell | **Reject** — destroys risk signaling by inflation |
| Left-aligned numeric columns | **Reject** — breaks digit alignment; comparison is the product |
| Chart dot-matrix texture + pulsing halo marker | **Reject** — decoration this audience doesn't need |
