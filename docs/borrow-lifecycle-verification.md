# Borrow lifecycle verification

Run date: October 12, 2026 (October 13 UTC). Local working tree; not committed or deployed.

This checks the borrower steps of receiving a loan, making a partial repayment, and closing the loan with collateral returned. Tests execute Kollat's actual contract transaction plans against local Anvil forks of deployed protocols. They do not exercise the browser, wallet extension, partner integration, or production signing flow.

## Results

Final result across 26 protocol/chain combinations: **25 passed; Moonwell on Base failed at borrowing because its market borrow cap was reached.** All three Polygon cases passed on retry.

| Protocol | Passed chains | Remaining issue |
| --- | --- | --- |
| Aave V3 | Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche | None in sampled flows |
| Spark | Ethereum | None in sampled flow |
| Compound V3 | Ethereum, Base, Arbitrum, Optimism | None in sampled flows |
| Morpho Blue | Ethereum, Base, Arbitrum, Optimism, Polygon | None in sampled flows |
| Moonwell | Optimism | Base borrow reverted: `market borrow cap reached` |
| Fluid | Ethereum, Base, Arbitrum, Polygon | None in sampled flows |
| Euler V2 | Ethereum, Base, Arbitrum, Avalanche | None in sampled flows |

Moonwell Base did not complete the lifecycle. The 500 USDC borrow failed at the market's borrow-cap check. No market caps or protocol liquidity were changed to force a pass. Its repayment/withdrawal path on Base remains unverified by this run.

The first Polygon attempt failed because the upstream RPC returned HTTP 403 during a storage read. The retry uses a different public RPC, preserving the original failure evidence.

## What a pass asserts

1. Prepare and execute collateral approval/wrapping/deposit and borrowing steps; transaction receipts succeed.
2. The test wallet receives exactly 500 USDC and the position contains the supplied collateral and debt.
3. Repay exactly 200 USDC from the wallet; debt decreases to approximately 300 USDC and collateral stays supplied.
4. Repay the remaining debt and withdraw collateral; the executor reports zero debt and zero supplied collateral.
5. The wallet receives the collateral back, as its token or the native asset, within a one-part-per-million rounding tolerance. Native gas costs are accounted for.

Fresh impersonated wallets are funded on the local fork. Non-native collateral is seeded where necessary. The wallet receives one additional USDC before full repayment to cover accrued interest. Protocol caps and liquidity remain unchanged. No production funds are used.

One collateral/market is sampled per protocol and chain. Native collateral is preferred; Morpho, Fluid and Euler select a market from their discovery data, with a fallback to another collateral where needed. This is not coverage of every vault, collateral, existing position, or market configuration. Market discovery can use live APIs; transactions execute at the recorded fork block. Interest is exercised over the short test duration, not a long holding period.

## Evidence

- [Initial 26-case matrix](../test-results/lifecycle-2026-10-13T02-56-47-032Z/summary.json): 22 passed, one market-cap failure, one Polygon RPC failure and two cases blocked by that RPC failure.
- [Polygon retry](../test-results/lifecycle-2026-10-13T03-06-08-889Z/summary.json).
- Each directory contains per-case Vitest JSON reports and logs. Early reports record the passing lifecycle assertion; later reports additionally contain three balance/position stages in assertion metadata. Assertions were retained throughout.

| Chain | Initial fork block | Retry fork block |
| --- | --- | --- |
| Ethereum | 26180724 | — |
| Base | 52535430 | — |
| Arbitrum | 514308394 | — |
| Optimism | 158130836 | — |
| Polygon | 95436856 | 95436986 |
| Avalanche | 97411842 | — |

The ordinary suite separately passed 101 tests with 5 skipped. Typecheck and targeted lint passed. These results do not replace the fork matrix or establish browser end-to-end coverage.

## Reproduce

Requires installed project dependencies and Anvil with `anvil_dealERC20` support (tested with 1.6.0-rc1) on PATH:

```powershell
node scripts/test-fork-lifecycle.cjs
```

Optional filters: `LIFECYCLE_CHAIN` (numeric chain ID), `LIFECYCLE_PROTOCOL` (executor protocol ID). `RPC_URL_MAINNET`, `RPC_URL_BASE`, `RPC_URL_ARBITRUM`, `RPC_URL_OPTIMISM`, `RPC_URL_POLYGON` and `RPC_URL_AVALANCHE` select upstream providers. The runner loads local environment configuration, starts local forks, records blocks/results, restores snapshots between cases, and stops its fork processes afterward. A passing process exit alone is insufficient: the runner also requires a passing lifecycle assertion in the JSON report.
