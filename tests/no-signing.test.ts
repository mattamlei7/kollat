import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The invariant being sold: nothing server-side can create an account, sign, or broadcast.
// Server-side = everything the API routes and CLI can reach. Components are client UI and
// have no RPC access, so a symbol there is copy, not capability.
const SERVER_DIRS = ["lib", "app/api", "scripts"];
const FORBIDDEN_IMPORTS = ["viem/accounts", "ethers", "@ethersproject", "web3", "bip39", "@scure/bip32", "@scure/bip39"];
const FORBIDDEN_SYMBOLS = [
  "createWalletClient", "privateKeyToAccount", "mnemonicToAccount", "hdKeyToAccount", "toAccount",
  "signTransaction", "signMessage", "signTypedData", "sendTransaction", "sendRawTransaction",
  "writeContract", "prepareTransactionRequest", "PRIVATE_KEY", "MNEMONIC",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}
// ponytail: regex comment strip; fine until a string literal contains "//".
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("no-signing invariant", () => {
  const files = SERVER_DIRS.flatMap(walk).map((path) => ({ path, src: stripComments(readFileSync(path, "utf8")) }));
  it("scans something", () => expect(files.length).toBeGreaterThan(10));
  it("imports no signing or key libraries", () => {
    const hits = files.flatMap(({ path, src }) => FORBIDDEN_IMPORTS.filter((m) => new RegExp(`from\\s+["']${m}`).test(src)).map((m) => `${path}: ${m}`));
    expect(hits).toEqual([]);
  });
  it("references no account creation, signing, or broadcast symbols", () => {
    const hits = files.flatMap(({ path, src }) => FORBIDDEN_SYMBOLS.filter((s) => new RegExp(`\\b${s}\\b`).test(src)).map((s) => `${path}: ${s}`));
    expect(hits).toEqual([]);
  });
  it("declares no signing dependency", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => FORBIDDEN_IMPORTS.some((m) => d === m || d.startsWith(m + "/")))).toEqual([]);
  });
});
