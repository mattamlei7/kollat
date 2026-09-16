import { parseAbi } from "viem";

/** Morpho Blue singleton — the read surface this adapter uses. */
export const MORPHO_ABI = parseAbi([
  "function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
]);

/** A market's oracle: loan base units per collateral base unit, scaled by 1e36. */
export const MORPHO_ORACLE_ABI = parseAbi(["function price() view returns (uint256)"]);
