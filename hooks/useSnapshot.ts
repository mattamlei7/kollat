"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountJson, MarketsJson } from "@/lib/client-types";

export type ChainParam = "1" | "8453" | "all";

interface State<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  fetchedAt: number | null;
}

const ACCOUNT_POLL_MS = 30_000;
const MARKETS_POLL_MS = 60_000;

function usePolled<T>(url: string | null, intervalMs: number): State<T> & { refresh: () => void } {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: !!url, fetchedAt: null });
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!url) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      const body = await res.json();
      if (!res.ok) {
        setState({ data: null, error: body?.error ?? `Request failed (${res.status})`, loading: false, fetchedAt: Date.now() });
        return;
      }
      setState({ data: body as T, error: null, loading: false, fetchedAt: Date.now() });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setState((s) => ({ ...s, error: (e as Error).message, loading: false, fetchedAt: Date.now() }));
    }
  }, [url]);

  useEffect(() => {
    if (!url) {
      setState({ data: null, error: null, loading: false, fetchedAt: null });
      return;
    }
    load();
    const id = setInterval(load, intervalMs);
    return () => {
      clearInterval(id);
      abort.current?.abort();
    };
  }, [url, intervalMs, load]);

  return { ...state, refresh: load };
}

export function useMarkets(chain: ChainParam) {
  return usePolled<MarketsJson>(`/api/markets?chain=${chain}`, MARKETS_POLL_MS);
}

export function useAccount(input: string | null, chain: ChainParam) {
  const url = input ? `/api/account/${encodeURIComponent(input)}?chain=${chain}` : null;
  return usePolled<AccountJson>(url, ACCOUNT_POLL_MS);
}
