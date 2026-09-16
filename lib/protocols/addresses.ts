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
 * Compound v3 Comet with USDC as the base (debt) asset.
 * Verified on-chain 2026-09-15: baseToken() → USDC on both chains.
 * Base's cUSDbCv3 (bridged USDbC) is deprecated and not included.
 */
export const COMET_USDC: Record<ChainId, Address> = {
  1: "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
  8453: "0xb125E6687d4313864e53df431d5425969c15Eb2F",
};

/** Morpho Blue singleton — the same address on every chain. */
export const MORPHO_BLUE: Address = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";

/** Native USDC, the only loan asset in v1. */
export const USDC: Record<ChainId, Address> = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};
