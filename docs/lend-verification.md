# Lending verification — October 13, 2026

The configured USDC deposit and withdrawal paths passed contract-fork testing at all 12 destinations. The browser flow passed at all five Base destinations with an injected test wallet connected to a local fork. No production transactions were sent; nothing was committed or deployed.

## Contract coverage

Each destination was tested with 1,000 USDC deposited, 400 USDC withdrawn, then a full exit. Assertions verify the receipt position, exact approval consumption, partial withdrawal amount, zero remaining redeemable assets and USDC returned to the wallet (up to three base units of share-rounding dust). Test wallet balances are seeded; protocol capacity and liquidity are not increased.

| Network | Destinations passed | Fork block |
| --- | --- | --- |
| Ethereum | Aave supply; SparkLend supply; Spark Savings sUSDC; Steakhouse USDC; Gauntlet USDC Prime | 26184597 |
| Base | Aave supply; Spark Savings sUSDC; Gauntlet USDC Prime; Steakhouse USDC; Spark USDC Vault on Morpho | 52558765 |
| Arbitrum | Aave supply; Spark Savings sUSDC | 514476505 |

The Base Aave case also borrows 500 USDC against the supplied position inside a temporary snapshot. It verifies that full withdrawal is refused, the displayed conservative withdrawal limit is positive but less than the position, and that withdrawal of the calculated amount actually succeeds. The snapshot is restored before the ordinary lifecycle continues.

[Final contract matrix](../test-results/earn-lifecycle-2026-10-13T15-54-37-549Z/summary.json). Per-chain `*-earn.json` files include individual test assertions and balance evidence. Earlier matrix runs also passed, before the additional account-debt checks.

## Browser coverage

[Full browser run](../test-results/lend-browser-2026-10-13T15-56-17-826Z/results.json): all five Base destinations passed 100 USDC deposit, 40 USDC withdrawal, and full exit through the UI. Twenty successful local transactions were submitted. No page errors were observed.

Verified: approval rejection and retry; amount above balance; excess decimal precision; account change; disconnect; stale opportunities excluded; partial provider failure; initial API outage and recovery through retry. Layouts at 1440, 1280 and 390 pixels had no horizontal overflow; screenshots are saved with the run and were visually inspected.

[Additional review checks](../test-results/lend-browser-2026-10-13T16-00-24-907Z/results.json) confirm that changing the amount clears the review and stale data returned during confirmation sends no transaction. This run also repeated the layout and failure-state checks, with zero page errors.

The browser uses headless Edge and an injected EIP-1193 provider backed by an impersonated local Anvil wallet. It is not a MetaMask/Rabby extension test. The earning snapshot is read from the real local API and replayed for stable browser comparisons; failure states are deliberately injected. Non-Base public browser RPCs are blocked in this test, and their position reads correctly appear unavailable. Contract tests separately cover Ethereum and Arbitrum.

Some preliminary browser setup attempts failed because development RPC configuration pointed to the local fork itself, or because an upstream RPC timed out. These were infrastructure failures; their reports are retained. The successful full run above completed all listed flows.

## Fixes made during verification

- Wallet-account changes remount account-specific state, clearing old balances, positions and reviews.
- Amount changes invalidate the deposit review, including preflight work still in progress.
- Deposit confirmation rejects stale, unknown, failed or missing-capacity data; unknown destinations do not rank.
- The transaction runner rechecks the selected account and network before signing and verifies the local fork. Local execution requires a distinct fork chain ID.
- Duplicate runs are blocked, and receipt timeouts keep tracking the existing transaction rather than offering to submit another deposit. Unmounting stops subsequent unsigned steps.
- Aave/SparkLend holdings account for paused withdrawals and existing debt. Debt-constrained amounts use bounded simulation to show a conservative estimate; RPC errors propagate instead of appearing as zero liquidity.
- Post-transaction wallet refresh failures are reported rather than silently swallowed.
- The navigation mode label now reflects local-fork, wallet-execution or read-only mode.

These checks protect the connected-wallet deposit and withdrawal journey and its interaction with existing borrowing positions.

## Build and ordinary checks

- Ordinary suite: 118 passed, 6 skipped. Opt-in live/fork suites are separate.
- TypeScript: passed.
- ESLint: passed.
- Production build: passed, including `/lend` and `/api/earn`.

## Scope limits

This covers the 12 configured USDC destinations, not every vault or asset offered by these protocols. Market data, capacity and liquidity can change after the recorded blocks. Contract tests run over a short interval, not a long interest-accrual period. Browser extension prompts, hardware wallets, mainnet transactions, transaction replacement/cancellation and recovery after a page reload during a pending transaction have not been certified by these runs. The receipt-timeout retry protection is within the current mounted transaction flow.

Execution follows the existing environment switch; the observed development environment uses a Base fork with chain ID 31337. The test runner stops the Anvil processes it starts. It does not leave a fork running for interactive use.

## Reproduce

```powershell
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run lint
npm.cmd run build
node scripts/test-fork-lifecycle.cjs --earn
node scripts/test-lend-browser.cjs
```

The browser script requires the local app at port 3000 configured for a Base fork at port 8545 with chain ID 31337, headless Edge/Playwright, and Anvil. It refuses to overwrite an existing RPC server at port 8545. `--checks-only` skips the five deposit/withdrawal lifecycles and exercises review validation and UI states. The fork matrix records JSON evidence and requires the expected number of passing destinations, preventing skipped or empty suites from being reported as passes.
