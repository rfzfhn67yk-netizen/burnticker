"use client";
import { useWatchlist } from "./useWatchlist";
import type { WatchKind } from "@/lib/burnticker/watchlist";

/** Follow or unfollow a coin or its next result, in this browser only (watchlist.ts). */
export function FollowButton({ ticker, kind = "coins", label }: { ticker: string; kind?: WatchKind; label?: string }) {
  const { list, ready, toggle } = useWatchlist();
  const on = list[kind].includes(ticker.toUpperCase());
  const what = label ?? `$${ticker}`;
  return <button type="button" className="bt-watch" aria-pressed={on} disabled={!ready} onClick={() => toggle(kind, ticker)} title="Kept in this browser only" aria-label={on ? `Stop following ${what}` : `Follow ${what}`}>{on ? "Following" : "Follow"}</button>;
}
