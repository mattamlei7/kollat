<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Product alignment

Before material feature planning, implementation, roadmap advice, or positioning work,
read `PRODUCT_GOAL.md`. The end goal is embedded crypto-backed borrowing through users'
existing wallets and exchanges. Policy, risk monitoring, and audit trails support that
journey; they are not the destination. Use `plan3.0.md` for sequencing, not to replace
the owner's stated outcome.

Briefly connect proposed work to a borrower step or concrete partner adoption/safety
blocker. For handoffs, distinguish what is implemented/tested from what is deployed or
verified end-to-end. Do not impose a full product review on tiny maintenance changes.

For an explicit alignment check, use the `product-alignment` agent or the workflow in
`.agents/skills/product-alignment/SKILL.md`. If custom agents are unavailable, perform
that review in the main thread. The reviewer advises; it does not change files or expand
the task. Do not spawn it for every edit or treat its recommendation as owner approval.
