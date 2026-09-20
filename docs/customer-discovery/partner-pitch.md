# Kollat

## Borrowing inside your wallet, with policy checks and an explainable record

Kollat is building a policy, risk-monitoring, and reconciliation layer for wallets that want to offer collateral-backed borrowing. The goal is simple: help users understand their borrowing choices inside the wallet they already use, while giving the wallet team controls and evidence it can stand behind.

### The problem we want to validate

Adding a borrow button creates questions beyond transaction construction: Which lending markets do you permit? What happens when data is incomplete? Who notices a deteriorating position? When a user contacts support, can your team explain what was shown, why an action was allowed, and what actually happened onchain?

We are looking for wallet teams that already encounter these problems, or have a concrete borrowing launch blocked by them.

### What you can try today

Our working read-only demo compares supported USDC borrowing routes, estimates borrowing capacity and liquidation risk, and displays discovered existing positions. It requires no wallet connection or signing. Coverage is bounded; it does not discover every market or position, and estimates are not guarantees against liquidation.

Try it: [borrow-router.vercel.app/borrow](https://borrow-router.vercel.app/borrow).

An initial policy-evaluation API also exists in the codebase. Persistent decision records, ongoing monitoring, signed webhooks, and operational reconciliation are proposed pilot work, not production capabilities being offered today.

### The proposed design-partner pilot

Start with one agreed workflow across Aave v3 and Morpho Blue on Ethereum and Base, using USDC debt and a small approved collateral list. Narrow further if your workflow allows.

Together, we would define and test:

- **Policy:** permitted venues, assets, and risk limits; explicit rejection when required data is missing or too old.
- **Monitoring:** agreed risk events delivered to your team, with clear response ownership.
- **Reconciliation and evidence:** retained inputs and decisions, compared with observed onchain positions so discrepancies can be investigated.

Success means passing agreed test cases and showing your team can explain a decision, receive an alert, and identify a discrepancy. Kollat would never hold assets or keys, sign, or submit transactions. Signing stays with your wallet or custody system. The initial pilot would use agreed public fixtures or test accounts, with no production execution.

### The ask

A 20-minute conversation with the person responsible for borrowing product, engineering, or risk. If there is a fit, we would scope a paid pilot with named product and engineering owners, written policy requirements, integration time, and acceptance criteria. Scope and pricing would be agreed together.

First question: **When a borrowing user needs help, who owns the support ticket, and what evidence can they see today?**
