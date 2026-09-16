import { parseAbi } from "viem";

/** Moonwell = Compound v2 fork with per-timestamp rates. */
export const COMPTROLLER_ABI = parseAbi([
  "function getAllMarkets() view returns (address[])",
  "function oracle() view returns (address)",
  "function liquidationIncentiveMantissa() view returns (uint256)",
  "function markets(address) view returns (bool isListed, uint256 collateralFactorMantissa)",
  "function borrowCaps(address) view returns (uint256)",
  "function supplyCaps(address) view returns (uint256)",
  "function borrowGuardianPaused(address) view returns (bool)",
  "function mintGuardianPaused(address) view returns (bool)",
  "function getAssetsIn(address) view returns (address[])",
  "function getAccountLiquidity(address) view returns (uint256 err, uint256 liquidity, uint256 shortfall)",
]);

export const MTOKEN_ABI = parseAbi([
  "function underlying() view returns (address)",
  "function getCash() view returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function totalReserves() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function exchangeRateStored() view returns (uint256)",
  "function borrowRatePerTimestamp() view returns (uint256)",
  "function supplyRatePerTimestamp() view returns (uint256)",
  "function getAccountSnapshot(address) view returns (uint256 err, uint256 mTokenBalance, uint256 borrowBalance, uint256 exchangeRateMantissa)",
]);

export const ORACLE_ABI = parseAbi(["function getUnderlyingPrice(address mToken) view returns (uint256)"]);
