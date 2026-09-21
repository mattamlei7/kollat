# Borrow Router / Kollat: product north star

Owner's clarification, 2026-09-20. Borrow Router and the Kollat name in the repository
refer to this project; this document does not authorize a branding change.

## The end job

Make it easy for ordinary people to obtain and manage a loan against their crypto,
through the wallets and exchanges they already use, without having to navigate lending
protocols themselves or sell the collateral to obtain liquidity.

Borrow Router supplies the infrastructure behind that embedded borrowing experience.
The partner retains the customer relationship and signing flow. The end product is a
usable borrowing journey, not just a rate-comparison page or a risk dashboard.

Example user intent: "I want to borrow $5,000 against my crypto without selling it."
That is an illustrative journey, not a promise that every account qualifies or that any
particular amount, asset, chain, or jurisdiction will be supported.

## The journey the infrastructure should enable

1. **Start inside an existing wallet or exchange.** The user expresses an amount and
   sees which of their assets could support it.
2. **Understand eligible options.** The app explains feasible routes, available amounts,
   rates/costs, collateral requirements, and liquidation exposure within supported venues.
3. **Choose a suitable route.** Guidance reflects the user's needs and partner constraints;
   the lowest headline rate is not automatically the right route.
4. **Complete the borrow.** The partner's authorized signing/submission flow carries out
   the agreed action, and the user gets a clear success, failure, or pending outcome.
5. **Manage the loan.** The user can understand the outstanding debt, changing costs and
   risk, and the available actions to repay, adjust collateral, or close the position.

These are destination capabilities, not a claim that the current demo implements them.
The precise first partner workflow and division of responsibilities still need validation.

## End-user outcome, buyer, and supporting work

- **End user:** a person seeking liquidity against their crypto through an app they use.
- **Integrating customer:** a wallet or exchange; other distribution partners remain possible.
  Wallet-first is the current discovery hypothesis, not a permanent exclusion of exchanges.
- **Supporting capabilities:** normalized protocol data, routing, policy checks, simulations,
  persistent evidence, monitoring, webhooks, reconciliation, and reliable integration APIs.
  Each should enable a named part of the borrower journey or remove a concrete partner
  adoption blocker. Necessary safety work is legitimate even when invisible to the user.
- **Commercial evidence:** real workflow requirements, integration participation, and a
  credible willingness to pay. Interview counts and pleasant feedback alone are not demand.

Do not redefine the destination as "selling policy checks, monitoring, and audit logs."
That can describe a first paid slice, but it is not the owner's end goal. Equally, do not
skip essential correctness or authorization controls merely to demonstrate a borrow button.

## Boundaries and stage

- Preserve the working Next.js application and existing demo at
  `https://borrow-router.vercel.app/`. Inspect current code and changes before proposing
  replacements. Local tests, a deployment, and a verified partner workflow are different evidence.
- Borrow Router does not custody assets or hold signing keys. Read adapters remain read-only.
  Future transaction preparation/integration must retain partner-controlled signing and must
  be scoped and reviewed; today's lack of execution is a stage boundary, not the end goal.
- No guarantees of the best rate across all markets, universal coverage, or liquidation avoidance.
- Use `plan3.0.md` for the current sequencing and partner-validation gates. A commercially
  useful first slice can be narrower than the destination. Broad execution should follow
  a concrete validated workflow; do not turn that gate into a permanent ban on completing loans.
- Do not treat an assistant's recommendation as a founder decision. Distinguish facts,
  hypotheses, and proposed changes. The owner's latest explicit direction can revise this
  charter; surface the change rather than silently preserving an outdated goal.

## Cross-reference test

For a proposed feature, plan, marketing claim, or completed change, ask:

1. Which borrower step does this advance, or which specific adoption/safety blocker does it remove?
2. What evidence supports doing it now? Is it an observed need, a prerequisite, or a hypothesis?
3. What is the smallest useful scope and an observable acceptance check?
4. What still separates this work from a real embedded borrowing experience?

Keep alignment separate from priority: something can fit the destination and still be premature.
Do not judge progress only by adapter count, passing tests, infrastructure volume, or dashboards.
Ultimately look for a partner-integrated user journey that people can understand, complete,
and manage, backed by a business relationship that sustains it.

## Using the reviewer

Ask: "Use the product-alignment agent to review this feature/plan/diff against PRODUCT_GOAL.md."
For the reusable Codex skill: `$product-alignment` followed by the proposed work or review scope.
If the custom agent is unavailable in a client, ask the main assistant to read
`.agents/skills/product-alignment/SKILL.md` and perform the same read-only review.
Claude Code also receives the goal pointer through its existing `@AGENTS.md` import.

The reviewer is an on-demand cross-check, not a background watcher or authority to edit,
deploy, contact prospects, or veto the owner's decisions.
