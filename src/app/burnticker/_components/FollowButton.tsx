"use client";
import { useWatchlist } from "./useWatchlist";
import type { WatchKind } from "@/lib/burnticker/watchlist";

/**
 * Follow or unfollow a coin or its next result, in this browser only (watchlist.ts). `watchKey` is the coin's network and mint
 * (coinWatchKey), so two coins on one ticker are followed separately (private review 8 F1); `ticker` only names it.
 */
export function FollowButton({ watchKey, ticker, kind = "coins", label }: { watchKey: string; ticker: string; kind?: WatchKind; label?: string }) {
  const { list, ready, toggle } = useWatchlist();
  const on = list[kind].includes(watchKey);
  const what = label ?? `$${ticker}`;
  return <button type="button" className="bt-watch" aria-pressed={on} disabled={!ready} onClick={() => toggle(kind, watchKey)} title="Kept in this browser only" aria-label={on ? `Stop following ${what}` : `Follow ${what}`} data-watch-key={watchKey}>{on ? "Following" : "Follow"}</button>;
}
