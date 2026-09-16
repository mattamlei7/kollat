import {
  CHAIN_LABEL,
  protocolKey,
  type AccountJson,
  type CapacityJson,
  type HoldingJson,
  type MarketJson,
  type MarketsJson,
  type PositionJson,
  type RateJson,
} from "./client-types";

/**
 * Client-side joins between the markets snapshot and the account snapshot.
 * Pure functions; no fetching.
 */

export interface Column {
  key: string;
  id: string;
  name: string;
  chainId: number;
  label: string;
  /** Set when the protocol failed for this account or its markets are unavailable. */
  error: string | null;
  stale: boolean;
}

export type Cell =
  | { kind: "capacity"; market: MarketJson; capacity: CapacityJson; rate: RateJson | null }
  | { kind: "unavailable"; reason: string };

export interface Row {
  holding: HoldingJson;
  cells: Record<string, Cell>;
  /** Column key with the largest max borrow, if any. */
  best: string | null;
}

export interface ChainTable {
  chainId: number;
  columns: Column[];
  rows: Row[];
  totals: Record<string, number>;
}

export function marketIndex(markets: MarketsJson | null) {
  const byId = new Map<string, MarketJson>();
  const rateById = new Map<string, RateJson>();
  for (const p of markets?.protocols ?? []) {
    if (p.markets.ok) for (const m of p.markets.data) byId.set(m.id, m);
    if (p.rates.ok) for (const r of p.rates.data) rateById.set(r.marketId, r);
  }
  return { byId, rateById };
}

export function statusReason(status: MarketJson["status"]): string {
  switch (status) {
    case "paused":
      return "paused";
    case "frozen":
      return "frozen";
    case "collateral-disabled":
      return "not accepted as collateral";
    default:
      return "";
  }
}

export function buildChainTables(markets: MarketsJson | null, account: AccountJson): ChainTable[] {
  const { byId, rateById } = marketIndex(markets);
  const tables: ChainTable[] = [];

  for (const chainId of account.chains) {
    const protos = account.protocols.filter((p) => p.chainId === chainId);
    const columns: Column[] = protos.map((p) => {
      const mp = markets?.protocols.find((x) => x.id === p.id && x.chainId === p.chainId);
      const marketsErr = mp && !mp.markets.ok ? mp.markets.error.message : null;
      const capErr = !p.capacity.ok ? p.capacity.error.message : null;
      return {
        key: protocolKey(p),
        id: p.id,
        name: p.name,
        chainId: p.chainId,
        label: p.name,
        error: capErr ?? marketsErr,
        stale: (p.capacity.ok && p.capacity.stale) || (mp?.markets.ok ? mp.markets.stale : false),
      };
    });

    const holdings = account.holdings.filter((h) => h.token.chainId === chainId);
    const rows: Row[] = holdings.map((holding) => {
      const cells: Record<string, Cell> = {};
      let best: string | null = null;
      let bestValue = 0;
      for (const p of protos) {
        const key = protocolKey(p);
        if (!p.capacity.ok) {
          cells[key] = { kind: "unavailable", reason: "unavailable" };
          continue;
        }
        // The market whose collateral is this holding's token.
        const cap = p.capacity.data.find((c) => {
          const m = byId.get(c.marketId);
          return m && m.collateral.address.toLowerCase() === holding.token.address.toLowerCase();
        });
        const market = cap ? byId.get(cap.marketId) : undefined;
        if (!cap || !market) {
          cells[key] = { kind: "unavailable", reason: "not listed" };
          continue;
        }
        if (market.status !== "active") {
          cells[key] = { kind: "unavailable", reason: statusReason(market.status) };
          continue;
        }
        cells[key] = { kind: "capacity", market, capacity: cap, rate: rateById.get(market.id) ?? null };
        if (cap.maxBorrowUsd > bestValue) {
          bestValue = cap.maxBorrowUsd;
          best = key;
        }
      }
      return { holding, cells, best };
    });

    const totals: Record<string, number> = {};
    for (const c of columns) {
      totals[c.key] = rows.reduce((s, r) => {
        const cell = r.cells[c.key];
        return s + (cell?.kind === "capacity" ? cell.capacity.maxBorrowUsd : 0);
      }, 0);
    }

    tables.push({ chainId, columns, rows, totals });
  }
  return tables;
}

export interface PositionView {
  key: string;
  protocolId: string;
  name: string;
  chainId: number;
  label: string;
  position: PositionJson;
  stale: boolean;
}

export function collectPositions(account: AccountJson): { positions: PositionView[]; errors: { name: string; message: string; retryable: boolean }[] } {
  const positions: PositionView[] = [];
  const errors: { name: string; message: string; retryable: boolean }[] = [];
  for (const p of account.protocols) {
    const label = `${p.name} · ${CHAIN_LABEL[p.chainId] ?? p.chainId}`;
    if (!p.positions.ok) {
      errors.push({ name: label, message: p.positions.error.message, retryable: p.positions.error.retryable });
      continue;
    }
    p.positions.data.forEach((position, i) => {
      if (position.collateral.length === 0 && position.debt.length === 0) return;
      positions.push({ key: `${protocolKey(p)}:${i}`, protocolId: p.id, name: p.name, chainId: p.chainId, label, position, stale: p.positions.ok && p.positions.stale });
    });
  }
  positions.sort((a, b) => (a.position.healthFactor ?? Infinity) - (b.position.healthFactor ?? Infinity));
  return { positions, errors };
}
