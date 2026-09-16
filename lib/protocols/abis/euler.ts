import { parseAbi } from "viem";

/** Euler Vault Kit (EVK) vault — ERC-4626 with borrowing. LTVs are 1e4-scaled. */
export const EVAULT_ABI = parseAbi([
  "function asset() view returns (address)",
  "function oracle() view returns (address)",
  "function unitOfAccount() view returns (address)",
  "function LTVList() view returns (address[])",
  "function LTVBorrow(address collateral) view returns (uint16)",
  "function LTVLiquidation(address collateral) view returns (uint16)",
  "function maxLiquidationDiscount() view returns (uint16)",
  "function caps() view returns (uint16 supplyCap, uint16 borrowCap)",
  "function cash() view returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function interestRate() view returns (uint256)",
  "function interestFee() view returns (uint16)",
  "function debtOf(address account) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function accountLiquidity(address account, bool liquidation) view returns (uint256 collateralValue, uint256 liabilityValue)",
]);

export const EULER_ROUTER_ABI = parseAbi(["function getQuote(uint256 inAmount, address base, address quote) view returns (uint256)"]);

export const EVC_ABI = parseAbi([
  "function getControllers(address account) view returns (address[])",
  "function getCollaterals(address account) view returns (address[])",
]);
