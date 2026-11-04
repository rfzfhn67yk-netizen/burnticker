"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { dropLegacy, readWatchlist, resolveLegacy, toggleWatch, writeWatchlist, WATCH_EVENT, WATCH_KEY, type AmbiguousFollow, type ListedCoin, type WatchKind, type Watchlist } from "@/lib/burnticker/watchlist";

/**
 * The browser-local watchlist (watchlist.ts) for client components, kept in step across components and tabs. Never sent anywhere. Follows
 * are coin keys (network and mint). Pass the coins the page lists as `listed`: an old ticker follow that matches exactly one of them
 * becomes that coin's key; one that matches several comes back in `ambiguous` for the visitor to settle (private review 8 F1).
 */
export function useWatchlist(listed: readonly ListedCoin[] | null = null): { list: Watchlist; ready: boolean; toggle: (kind: WatchKind, key: string) => void; forget: (kind: WatchKind, ticker: string) => void; ambiguous: AmbiguousFollow[] } {
  const [list, setList] = useState<Watchlist>({ coins: [], results: [], legacy: { coins: [], results: [] } });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const load = () => setList(readWatchlist());
    load(); setReady(true);
    const onStorage = (e: StorageEvent) => { if (e.key === WATCH_KEY) load(); };
    window.addEventListener(WATCH_EVENT, load); window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener(WATCH_EVENT, load); window.removeEventListener("storage", onStorage); };
  }, []);
  const resolved = useMemo(() => (listed ? resolveLegacy(list, listed) : null), [list, listed]);
  useEffect(() => { if (ready && resolved?.changed) { setList(resolved.list); writeWatchlist(resolved.list); } }, [ready, resolved]);
  const toggle = useCallback((kind: WatchKind, key: string) => { const next = toggleWatch(readWatchlist(), kind, key); setList(next); writeWatchlist(next); }, []);
  const forget = useCallback((kind: WatchKind, ticker: string) => { const next = dropLegacy(readWatchlist(), kind, ticker); setList(next); writeWatchlist(next); }, []);
  return { list, ready, toggle, forget, ambiguous: resolved?.ambiguous ?? [] };
}
