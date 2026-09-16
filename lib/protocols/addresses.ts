import type { Address } from "viem";
import type { ChainId } from "./types";

/**
 * Addresses not covered by @bgd-labs/aave-address-book.
 * Spark: resolved on-chain 2026-09-14 — Pool.ADDRESSES_PROVIDER() → provider,
 * provider.getPriceOracle() / getPoolDataProvider(); UiPoolDataProvider decodes
 * with the v3.0 struct (Spark is a v3.0.2 fork).
 */
export const SPARK_ETHEREUM = {
  POOL: "0xC13e21B648A5Ee794902342038FF3aDAB66BE987" as Address,
  POOL_ADDRESSES_PROVIDER: "0x02C3eA4e34C0cBd694D2adFa2c690EECbC1793eE" as Address,
  UI_POOL_DATA_PROVIDER: "0xF028c2F4b19898718fD0F77b9b881CbfdAa5e8Bb" as Address,
  ORACLE: "0x8105f69D9C41644c6A0803fDA7D03Aa70996cFD9" as Address,
  PROTOCOL_DATA_PROVIDER: "0xFc21d6d146E6086B8359705C8b28512a983db0cb" as Address,
};

/**
 * Compound v3 Comet with native USDC as the base (debt) asset.
 * Verified on-chain (baseToken() → USDC): mainnet + Base 2026-09-15, Arbitrum + Optimism 2026-09-16.
 * Not listed: Base cUSDbCv3 (deprecated bridged USDbC), Polygon (only a USDC.e Comet exists), Avalanche (no Comet).
 */
export const COMET_USDC: Partial<Record<ChainId, Address>> = {
  1: "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
  8453: "0xb125E6687d4313864e53df431d5425969c15Eb2F",
  42161: "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf",
  10: "0x2e44e174f7D53F0212823acC11C01A11d58c5bCB",
};

/**
 * Morpho Blue singleton per chain. Mainnet and Base share the CREATE2 address;
 * the 2025 deployments differ (taken from the Morpho API `morphoBlue.address`, 2026-09-16).
 * Not on Avalanche.
 */
export const MORPHO_BLUE: Partial<Record<ChainId, Address>> = {
  1: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  8453: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  42161: "0x6c247b1F6182318877311737BaC0844bAa518F5e",
  137: "0x1bF0c2541F820E775182832f06c0B7Fc27A25f67",
  10: "0xce95AfbB8EA029495c66020883F87aaE8864AF92",
};

/** Native (Circle-issued) USDC, the only loan asset in v1. symbol() verified on every chain. */
export const USDC: Record<ChainId, Address> = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  10: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  137: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  43114: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
};

/** Bridged USDC whose on-chain symbol is also "USDC"; relabelled so it can't be confused with the loan asset. */
export const BRIDGED_USDC: Partial<Record<ChainId, Address>> = {
  42161: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
  10: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
  137: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  43114: "0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664",
};

/** Fluid VaultResolver — same CREATE2 address on mainnet, Base, Arbitrum, Polygon (deployments.md, 2026-09-16). */
export const FLUID_VAULT_RESOLVER: Address = "0xA5C3E16523eeeDDcC34706b0E6bE88b4c6EA95cC";
export const FLUID_CHAINS: ChainId[] = [1, 8453, 42161, 137];

/** Euler v2 EVC per chain (euler-interfaces/addresses/<chain>/CoreAddresses.json). Polygon and Optimism have no live USDC vaults. */
export const EULER_EVC: Partial<Record<ChainId, Address>> = {
  1: "0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383",
  8453: "0x5301c7dD20bD945D2013b48ed0DEE3A284ca8989",
  42161: "0x6302ef0F34100CDDFb5489fbcB6eE1AA95CD1066",
  43114: "0xddcbe30A761Edd2e19bba930A977475265F36Fa1",
};

/** Moonwell Comptrollers (docs.moonwell.fi; getAllMarkets verified on-chain 2026-09-16). Base core markets currently have borrow caps of 1 wei. */
export const MOONWELL_COMPTROLLER: Partial<Record<ChainId, Address>> = {
  8453: "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C",
  10: "0xCa889f40aae37FFf165BccF69aeF1E82b5C511B9",
};
