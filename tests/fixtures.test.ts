import { loadEnvConfig } from "@next/env";
import { describe, expect, it } from "vitest";

/**
 * Golden reconciliation fixtures: real accounts at a pinned mainnet block, checked
 * against a source that is not our math (Aave Pool.getUserAccountData, Morpho API).
 * Needs an archive RPC (public nodes drop state after ~128 blocks), so it skips
 * without RPC_URL_MAINNET in .env.local. Run: npm run test:fixtures
 */
loadEnvConfig(process.cwd());

const FIXTURES = [
  {
    name: "Aave v3 E-mode (category 40: WETH + LINK → USDC)",
    protocol: "aave-v3", block: 26_013_108n, // 2026-09-19
    address: "0x831F60741f44dC5cEd91A0888a6DB4e4FDB3Cd44",
    // Pool.getUserAccountData at BLOCK: totalCollateralBase, totalDebtBase (1e8), healthFactor (1e18)
    collateralUsd: 65_165.8458, debtUsd: 39_549.2889, hf: 1.2907188,
    thresholds: { WETH: 0.83, LINK: 0.71 },
  },
  {
    name: "Aave v3 cross-collateral (WBTC + cbBTC → USDC)",
    protocol: "aave-v3", block: 26_013_108n,
    address: "0xeE7ca610D896C53ffe716B801C05748EfD902954",
    collateralUsd: 12_057_184.0125, debtUsd: 8_497_872.6159, hf: 1.1067009,
    thresholds: { WBTC: 0.78, cbBTC: 0.78 },
  },
  {
    name: "Morpho Blue isolated market (cbBTC → USDC, LLTV 86%)",
    protocol: "morpho-blue", block: 26_013_108n,
    address: "0x56eCBF8844bD7a64dc661EC41D52005D4E224adc",
    // Morpho API marketPositions.healthFactor / state.*Usd, queried 2026-09-19 (API prices ≠ market oracle → 1% band)
    collateralUsd: 80_663_984, debtUsd: 37_435_763, hf: 1.8574227,
    thresholds: { cbBTC: 0.86 },
  },
  {
    // Owner with two EVC sub-accounts under the same USDC debt vault; the adapter must list both, each with its own HF.
    name: "Euler v2 sub-accounts (WETH → USDC and wstETH → USDC)",
    protocol: "euler-v2", block: 26_020_956n, // 2026-09-20
    address: "0xA7Bd8231281CE6a2ef840A9fce2C2557E5219472",
    // EVault accountLiquidity (healthFactorReported) at BLOCK, per sub-account
    positions: 2, collateralUsd: 1_200_627.11 + 465_293.99, debtUsd: 819_023.78 + 216_757.66, hf: [1.2607, 1.8032],
    thresholds: { WETH: 0.86, wstETH: 0.84 },
  },
] as const;

const within = (got: number, want: number, rel: number) => expect(Math.abs(got - want) / want).toBeLessThan(rel);

describe.skipIf(!process.env.RPC_URL_MAINNET)("golden fixtures @ pinned mainnet blocks", () => {
  for (const f of FIXTURES) {
    it(f.name, async () => {
      const { pinBlock } = await import("../lib/chains"); // after loadEnvConfig: chains reads RPC env at import
      const { PROTOCOLS } = await import("../lib/protocols/registry");
      pinBlock(1, f.block);
      const p = PROTOCOLS.find((x) => x.id === f.protocol && x.chainId === 1)!;
      const res = await p.getPositions(f.address);
      if (!res.ok) throw new Error(JSON.stringify(res.error));
      const hfs = "positions" in f ? [...f.hf] : [f.hf];
      expect(res.data).toHaveLength(hfs.length);
      const sorted = [...res.data].sort((a, b) => a.healthFactor! - b.healthFactor!);
      sorted.forEach((pos, i) => {
        within(pos.healthFactor!, hfs[i], 1e-3);
        if (pos.healthFactorReported !== null) within(pos.healthFactorReported, hfs[i], 1e-4);
      });
      const legs = sorted.flatMap((pos) => pos.collateral);
      within(legs.reduce((s, l) => s + l.usd, 0), f.collateralUsd, 1e-2);
      within(sorted.flatMap((pos) => pos.debt).reduce((s, l) => s + l.usd, 0), f.debtUsd, 1e-2);
      for (const [sym, lt] of Object.entries(f.thresholds)) {
        expect(legs.find((l) => l.token.symbol === sym)?.liquidationThreshold).toBeCloseTo(lt, 4);
      }
    }, 60_000);
  }
});
