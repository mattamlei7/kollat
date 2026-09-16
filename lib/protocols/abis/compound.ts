import { parseAbi } from "viem";

/** Compound v3 Comet — the read surface this adapter uses. */
export const COMET_ABI = parseAbi([
  "function baseToken() view returns (address)",
  "function baseTokenPriceFeed() view returns (address)",
  "function numAssets() view returns (uint8)",
  "function getAssetInfo(uint8 i) view returns ((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))",
  "function getPrice(address priceFeed) view returns (uint256)",
  "function getUtilization() view returns (uint256)",
  "function getBorrowRate(uint256 utilization) view returns (uint64)",
  "function getSupplyRate(uint256 utilization) view returns (uint64)",
  "function isWithdrawPaused() view returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function totalBorrow() view returns (uint256)",
  "function totalsCollateral(address asset) view returns (uint128 totalSupplyAsset, uint128 reserved)",
  "function borrowBalanceOf(address account) view returns (uint256)",
  "function collateralBalanceOf(address account, address asset) view returns (uint128)",
  "function isLiquidatable(address account) view returns (bool)",
]);
