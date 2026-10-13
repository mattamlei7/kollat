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

/** Whether a holding can back a loan: some route lends against it, none does, or a protocol read failed so we cannot tell. */
export type HoldingStatus = "supported" | "unsupported" | "data-unavailable";

export interface Row {
  holding: HoldingJson;
  status?: HoldingStatus;
  /** One cell per protocol: its largest active market for this collateral, or why there is none. */
  cells: Record<string, Cell>;
  /** Every active market per protocol for this collateral (some protocols list several, with different terms). */
  options?: Record<string, Extract<Cell, { kind: "capacity" }>[]>;
  /** Column key with the largest max borrow, if any. Used to pick a starting route, never shown as a recommendation. */
  best: string | null;
}

export interface ChainTable {
  chainId: number;
  columns: Column[];
  rows: Row[];
  totals: Record<string, number>;
}

/** The markets a protocol offers for this holding, falling back to its single cell. */
export function marketsOf(row: Row, colKey: string): Extract<Cell, { kind: "capacity" }>[] {
  const listed = row.options?.[colKey];
  if (listed?.length) return listed;
  const cell = row.cells[colKey];
  return cell?.kind === "capacity" ? [cell] : [];
}

/** A holding is supported when any protocol lends against it. */
export const statusOf = (row: Row): HoldingStatus => row.status ?? (Object.values(row.cells).some((c) => c.kind === "capacity") ? "supported" : "unsupported");

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
    case "unpriced":
      return "no oracle price";
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
        // A stale rate read counts too: rates are what the comparison ranks.
        stale: (p.capacity.ok && p.capacity.stale) || (mp?.markets.ok ? mp.markets.stale : false) || (mp?.rates.ok ? mp.rates.stale : false),
      };
    });

    const holdings = account.holdings.filter((h) => h.token.chainId === chainId);
    const rows: Row[] = holdings.map((holding) => {
      const cells: Record<string, Cell> = {};
      const options: Row["options"] = {};
      let best: string | null = null;
      let bestValue = 0;
      for (const p of protos) {
        const key = protocolKey(p);
        if (!p.capacity.ok) {
          cells[key] = { kind: "unavailable", reason: "unavailable" };
          continue;
        }
        // Every market whose collateral is this holding's token.
        const listed = p.capacity.data
          .map((c) => ({ c, m: byId.get(c.marketId) }))
          .filter((x): x is { c: CapacityJson; m: MarketJson } => !!x.m && x.m.collateral.address.toLowerCase() === holding.token.address.toLowerCase());
        if (!listed.length) {
          cells[key] = { kind: "unavailable", reason: "not listed" };
          continue;
        }
        const active = listed.filter((x) => x.m.status === "active");
        if (!active.length) {
          cells[key] = { kind: "unavailable", reason: statusReason(listed[0].m.status) };
          continue;
        }
        const opts = active
          .map(({ c, m }) => ({ kind: "capacity" as const, market: m, capacity: c, rate: rateById.get(m.id) ?? null }))
          .sort((a, b) => b.capacity.maxBorrowUsd - a.capacity.maxBorrowUsd);
        options[key] = opts;
        cells[key] = opts[0];
        if (opts[0].capacity.maxBorrowUsd > bestValue) {
          bestValue = opts[0].capacity.maxBorrowUsd;
          best = key;
        }
      }
      const status: HoldingStatus = Object.values(options).length
        ? "supported"
        : Object.values(cells).some((c) => c.kind === "unavailable" && c.reason === "unavailable")
          ? "data-unavailable"
          : "unsupported";
      return { holding, status, cells, options, best };
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
