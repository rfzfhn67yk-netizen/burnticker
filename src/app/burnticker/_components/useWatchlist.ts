"use client";
import { useCallback, useEffect, useState } from "react";
import { readWatchlist, toggleWatch, writeWatchlist, WATCH_EVENT, WATCH_KEY, type WatchKind, type Watchlist } from "@/lib/burnticker/watchlist";

/** The browser-local watchlist (watchlist.ts) for client components, kept in step across components and tabs. Never sent anywhere. */
export function useWatchlist(): { list: Watchlist; ready: boolean; toggle: (kind: WatchKind, ticker: string) => void } {
  const [list, setList] = useState<Watchlist>({ coins: [], results: [] });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const load = () => setList(readWatchlist());
    load(); setReady(true);
    const onStorage = (e: StorageEvent) => { if (e.key === WATCH_KEY) load(); };
    window.addEventListener(WATCH_EVENT, load); window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener(WATCH_EVENT, load); window.removeEventListener("storage", onStorage); };
  }, []);
  const toggle = useCallback((kind: WatchKind, ticker: string) => { const next = toggleWatch(readWatchlist(), kind, ticker); setList(next); writeWatchlist(next); }, []);
  return { list, ready, toggle };
}
