import { loadEnvConfig } from "@next/env";
import { describe, expect, it } from "vitest";

/**
 * Golden reconciliation fixtures: real accounts at a pinned mainnet block, checked
 * against a source that is not our math (Aave Pool.getUserAccountData, Morpho API).
 * Needs an archive RPC (public nodes drop state after ~128 blocks), so it skips
 * without RPC_URL_MAINNET in .env.local. Run: npm run test:fixtures
 */
loadEnvConfig(process.cwd());
const BLOCK = 26_013_108n; // 2026-09-19

const FIXTURES = [
  {
    name: "Aave v3 E-mode (category 40: WETH + LINK → USDC)",
    protocol: "aave-v3",
    address: "0x831F60741f44dC5cEd91A0888a6DB4e4FDB3Cd44",
    // Pool.getUserAccountData at BLOCK: totalCollateralBase, totalDebtBase (1e8), healthFactor (1e18)
    collateralUsd: 65_165.8458, debtUsd: 39_549.2889, hf: 1.2907188,
    thresholds: { WETH: 0.83, LINK: 0.71 },
  },
  {
    name: "Aave v3 cross-collateral (WBTC + cbBTC → USDC)",
    protocol: "aave-v3",
    address: "0xeE7ca610D896C53ffe716B801C05748EfD902954",
    collateralUsd: 12_057_184.0125, debtUsd: 8_497_872.6159, hf: 1.1067009,
    thresholds: { WBTC: 0.78, cbBTC: 0.78 },
  },
  {
    name: "Morpho Blue isolated market (cbBTC → USDC, LLTV 86%)",
    protocol: "morpho-blue",
    address: "0x56eCBF8844bD7a64dc661EC41D52005D4E224adc",
    // Morpho API marketPositions.healthFactor / state.*Usd, queried 2026-09-19 (API prices ≠ market oracle → 1% band)
    collateralUsd: 80_663_984, debtUsd: 37_435_763, hf: 1.8574227,
    thresholds: { cbBTC: 0.86 },
  },
] as const;

const within = (got: number, want: number, rel: number) => expect(Math.abs(got - want) / want).toBeLessThan(rel);

describe.skipIf(!process.env.RPC_URL_MAINNET)("golden fixtures @ mainnet block " + BLOCK, () => {
  for (const f of FIXTURES) {
    it(f.name, async () => {
      const { pinBlock } = await import("../lib/chains"); // after loadEnvConfig: chains reads RPC env at import
      const { PROTOCOLS } = await import("../lib/protocols/registry");
      pinBlock(1, BLOCK);
      const p = PROTOCOLS.find((x) => x.id === f.protocol && x.chainId === 1)!;
      const res = await p.getPositions(f.address);
      if (!res.ok) throw new Error(JSON.stringify(res.error));
      expect(res.data).toHaveLength(1);
      const pos = res.data[0];
      within(pos.healthFactor!, f.hf, 1e-3);
      if (pos.healthFactorReported !== null) within(pos.healthFactorReported, f.hf, 1e-4);
      within(pos.collateral.reduce((s, l) => s + l.usd, 0), f.collateralUsd, 1e-2);
      within(pos.debt.reduce((s, l) => s + l.usd, 0), f.debtUsd, 1e-2);
      for (const [sym, lt] of Object.entries(f.thresholds)) {
        expect(pos.collateral.find((l) => l.token.symbol === sym)?.liquidationThreshold).toBeCloseTo(lt, 4);
      }
    }, 60_000);
  }
});
