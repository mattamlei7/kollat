import { describe, expect, it } from "vitest";
import { decodeCap, subAccount } from "../lib/protocols/euler-v2";

describe("euler v2 helpers", () => {
  it("decodes EVK AmountCap (mantissa × 10^exponent / 100)", () => {
    expect(decodeCap(0)).toBeNull();
    // 43213 = mantissa 675, exponent 13 → 675 × 10^13 / 100 = 67.5M USDC in base units (read from K3 Prime USDC on 2026-09-16)
    expect(decodeCap(43213)).toBe(67_500_000_000_000n);
  });
  it("derives EVC sub-accounts by XOR-ing the low byte", () => {
    const owner = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    expect(subAccount(owner, 0)).toBe(owner);
    expect(subAccount(owner, 1).toLowerCase()).toBe("0xd8da6bf26964af9d7eed9e03e53415d37aa96044");
    expect(subAccount(owner, 255).toLowerCase()).toBe("0xd8da6bf26964af9d7eed9e03e53415d37aa960ba");
  });
});
