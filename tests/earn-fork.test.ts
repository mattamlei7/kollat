import { createPublicClient, createTestClient, createWalletClient, defineChain, encodeFunctionData, erc20Abi, http, parseAbi, parseEther, parseUnits, type Address, type PublicClient } from "viem";
import { arbitrum, base, mainnet } from "viem/chains";
import { describe, expect, it } from "vitest";
import { withGasBuffer, type PlanStep } from "../lib/execution/common";
import { depositPlan, readFundingFor, readHolding, withdrawPlan } from "../lib/earn/execute";
import { readEarn } from "../lib/earn/read";

// Every earn destination on one forked chain: deposit → position → partial withdrawal → full withdrawal → USDC back.
//   anvil --fork-url https://base-rpc.publicnode.com
//   FORK_RPC_URL=http://127.0.0.1:8545 FORK_OF=8453 npx vitest run tests/earn-fork.test.ts
const RPC = process.env.FORK_RPC_URL;
const CHAIN_ID = Number(process.env.FORK_OF) || 8453;
const REAL = { 1: mainnet, 8453: base, 42161: arbitrum }[CHAIN_ID]!;

describe.skipIf(!RPC)(`earn lifecycles on a ${REAL?.name} fork`, async () => {
  // Destinations and their receipt tokens come from the same reader the app uses (real chain), then run on the fork.
  const { opportunities } = RPC ? await readEarn([CHAIN_ID]) : { opportunities: [] };
  for (const dest of opportunities) {
    it(`${dest.name} (${dest.product})`, async ({ task }) => {
      expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(RPC!).hostname);
      const transport = http(RPC, { timeout: 60_000 });
      const chain = defineChain({ ...REAL, id: await createPublicClient({ transport }).getChainId() });
      const f = createPublicClient({ chain, transport }) as PublicClient;
      expect(await f.request({ method: "web3_clientVersion" as never })).toMatch(/anvil/i);
      const t = createTestClient({ chain, mode: "anvil", transport });
      const w = createWalletClient({ chain, transport });
      const user = `0x${[...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, "0")).join("")}` as Address;
      await t.impersonateAccount({ address: user });
      await t.setBalance({ address: user, value: parseEther("10") });
      const usdc = dest.asset.address;
      const start = parseUnits("1000", dest.asset.decimals);
      await f.request({ method: "anvil_dealERC20" as never, params: [user, usdc, `0x${start.toString(16)}`] as never });
      const balance = () => f.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [user] });
      const send = async (steps: PlanStep[]) => {
        for (const s of steps) {
          const gas = withGasBuffer(await f.estimateGas({ account: user, to: s.to, data: s.data, value: s.value }));
          const hash = await w.sendTransaction({ account: user, to: s.to, data: s.data, value: s.value, gas });
          expect((await f.waitForTransactionReceipt({ hash })).status, s.label).toBe("success");
        }
      };
      // Share math can round down by a unit or two on the way in and out.
      const dust = 3n;

      const funding = await readFundingFor(f, dest, user);
      expect(funding.balance).toBe(start);
      const steps = depositPlan({ dest, user, amount: start, ...funding });
      expect(steps.map((s) => s.label)).toEqual(["Approve USDC", "Deposit"]);
      await send(steps);
      expect(await balance()).toBe(0n);
      const opened = await readHolding(f, dest, user);
      expect(opened.assets).toBeGreaterThanOrEqual(start - dust);
      // The approval was exact: nothing is left approved after the deposit.
      expect(await f.readContract({ address: usdc, abi: erc20Abi, functionName: "allowance", args: [user, dest.target] })).toBe(0n);

      if (dest.product === "aave-supply" && CHAIN_ID === 8453) {
        // Exercise the interaction with Borrow: a supplied position can secure existing debt.
        const snapshot = await t.snapshot();
        try {
          const abi = parseAbi(["function borrow(address,uint256,uint256,uint16,address)"]);
          await send([{ label: "Borrow against supplied USDC", to: dest.target, value: 0n, data: encodeFunctionData({ abi, functionName: "borrow", args: [usdc, parseUnits("500", 6), 2n, 0, user] }) }]);
          const constrained = await readHolding(f, dest, user);
          expect(constrained.withdrawable).toBeGreaterThan(0n);
          expect(constrained.withdrawable).toBeLessThan(constrained.assets);
          expect(constrained.withdrawalNote).toMatch(/existing loan/);
          expect(() => withdrawPlan({ dest, user, holding: constrained })).toThrow();
          await send(withdrawPlan({ dest, user, amount: constrained.withdrawable, holding: constrained }));
        } finally { await t.revert({ id: snapshot }); }
      }

      const part = parseUnits("400", dest.asset.decimals);
      await send(withdrawPlan({ dest, user, amount: part, holding: opened }));
      expect(await balance()).toBe(part);
      const mid = await readHolding(f, dest, user);
      expect(mid.assets).toBeGreaterThanOrEqual(start - part - dust);
      expect(mid.assets).toBeLessThanOrEqual(start - part + dust);

      await send(withdrawPlan({ dest, user, holding: mid }));
      const end = await readHolding(f, dest, user);
      expect(end.assets).toBe(0n);
      expect(await balance()).toBeGreaterThanOrEqual(start - dust);
      (task.meta as { lifecycle?: object }).lifecycle = {
        destination: dest.id, chainId: CHAIN_ID, deposited: start.toString(),
        opened: opened.assets.toString(), partialWithdrawal: part.toString(),
        remaining: mid.assets.toString(), closed: end.assets.toString(), returned: (await balance()).toString(),
      };
    }, 180_000);
  }
});
