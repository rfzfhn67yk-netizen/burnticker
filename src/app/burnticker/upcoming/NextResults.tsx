"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useHome } from "../_components/useHome";
import { useWatchlist } from "../_components/useWatchlist";
import { FollowButton } from "../_components/FollowButton";
import { EmptyState } from "../_components/EmptyState";
import { SETTLEMENT_LABEL, upcomingNotice, type UpcomingRow } from "@/lib/burnticker/upcoming";
import { WATCH_FORGET, WATCH_NOTE, coinWatchKey, fetchCoinInventory, watchAmbiguous, type CoinInventory } from "@/lib/burnticker/watchlist";

/**
 * NEXT RESULTS (website-14, product idea 3; src/lib/burnticker/upcoming.ts). For each coin, the result its rule waits for, the source,
 * the source's own schedule (this site promises no time) and where the latest result stands, from GET /api/burnticker/home. A visitor
 * can follow a result in this browser only (watchlist.ts) and narrow the list to those. Loading, error and empty each say so in words.
 */
const denver = (iso: string) => { try { return `${new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso))} Denver time`; } catch { return iso; } };

export default function NextResults() {
  const { data, error } = useHome();

  const [only, setOnly] = useState(false);
  // website-15 (code review 6 P2 2): ready, partial or unavailable; a failure is never an empty list
  const set = data?.upcoming ?? null;
  const all: UpcomingRow[] = Array.isArray(set?.rows) ? set!.rows : [];
  // private review 8 F1: a followed result is a coin key (network and mint), never a ticker. Private review 9 F1: an old ticker follow is
  // migrated only against the COMPLETE inventory of coins (every status, watchlist.ts resolveLegacyFrom), never these filtered rows; until
  // it is read, or when it cannot be, nothing migrates and the old follow stays
  const [inventory, setInventory] = useState<CoinInventory | null>(null);
  useEffect(() => { let live = true; void fetchCoinInventory().then((x) => { if (live) setInventory(x); }); return () => { live = false; }; }, []);
  const watch = useWatchlist(inventory ? inventory.coins : null);
  const keyOf = (r: UpcomingRow) => coinWatchKey(r.network, r.mint);
  const rows = all.filter((r) => { const k = keyOf(r); return !only || (!!k && watch.list.results.includes(k)); });
  const notice = data ? upcomingNotice(set) : null;
  const failed = !!data && (!set || set.state === "unavailable");
  return (
    <main className="mx-auto max-w-4xl px-4 py-6 space-y-4 text-sm">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Next results</h1>
        <p className="text-neutral-300">Each coin burns only when its own result is published. This page lists the result each coin waits for, who publishes it, and the publisher&apos;s own schedule. Publication times come from the source and may change.</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
          <button type="button" className="bt-watch" aria-pressed={only} onClick={() => setOnly(!only)}>{only ? "Showing the results you follow" : "Show only the results you follow"}</button>
          <span>{WATCH_NOTE}</span>
        </div>
      </header>
      {/* private review 9 F1: an old follow that two or more coins could mean stays visible until the visitor picks one or forgets it */}
      {watch.ambiguous.filter((a) => a.kind === "results").map((a) => (
        <div key={a.ticker} className="rounded-md border border-amber-700/60 p-3 text-xs" role="status" data-watch-ambiguous={a.ticker}>
          <p>{watchAmbiguous(a.ticker, a.candidates.length)}</p>
          <ul className="mt-2 space-y-1">{all.filter((r) => r.ticker.toUpperCase() === a.ticker && keyOf(r)).map((r) => <li key={keyOf(r)!} className="flex flex-wrap items-center gap-2"><a className="underline" href={r.href}>{r.name}</a><span className="font-mono text-neutral-500">{r.mint}</span><FollowButton watchKey={keyOf(r)!} ticker={r.ticker} kind="results" label={`the next result for this $${r.ticker}`} /></li>)}</ul>
          {a.candidates.length > all.filter((r) => r.ticker.toUpperCase() === a.ticker && keyOf(r)).length && <p className="mt-1 text-neutral-400">Some coins with this ticker have no pending result, so they are not listed here. They are on the coins page.</p>}
          <button type="button" className="bt-watch mt-2" onClick={() => watch.forget("results", a.ticker)}>{WATCH_FORGET}</button>
        </div>
      ))}
      {!data && !error && <EmptyState kind="loading" body="Reading the next results." />}
      {error && <EmptyState kind="unavailable" body="The next results could not be read just now. Try again in a moment." details={error} />}
      {failed && <EmptyState kind="unavailable" body={notice!} details={set?.omitted.map((o) => `$${o.ticker}: ${o.reason}`).join(" ") || undefined} />}
      {data && !failed && set?.state === "partial" && <p className="text-xs text-amber-300" role="status" data-upcoming-partial>{notice}</p>}
      {data && !failed && rows.length === 0 && <EmptyState compact kind="no-activity" body={only && all.length ? "You do not follow any result yet. Turn this filter off and press Follow on a row. Your list stays in this browser." : notice ?? "No pending results."} />}
      {data && rows.length > 0 && (
        <ol className="space-y-3" aria-label="Next results">
          {rows.map((r) => (
            <li key={keyOf(r) ?? r.ticker} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3" data-upcoming={r.ticker} data-status={r.status}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold"><a className="underline" href={r.href}>{r.name} <span className="font-mono text-neutral-400">${r.ticker}</span></a>{r.network !== "mainnet" && <span className="ml-2 bt-chip">devnet</span>}</h2>
                {keyOf(r) && <FollowButton watchKey={keyOf(r)!} ticker={r.ticker} kind="results" label={`the next result for $${r.ticker}`} />}
              </div>
              <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                <div><dt className="text-neutral-500">The result it waits for</dt><dd className="text-neutral-100">{r.event}</dd></div>
                <div><dt className="text-neutral-500">Who publishes it</dt><dd className="text-neutral-100">{r.sourceUrl ? <a className="underline" href={r.sourceUrl} rel="noopener" target="_blank">{r.source}</a> : r.source}</dd></div>
                <div><dt className="text-neutral-500">The source&apos;s schedule</dt><dd className="text-neutral-200">{r.schedule}{r.nextAt ? ` The next check is at ${denver(r.nextAt)}.` : ""}</dd></div>
                <div><dt className="text-neutral-500">The latest result</dt><dd><span className="mr-1 bt-chip" data-settlement={r.status}>{SETTLEMENT_LABEL[r.status]}</span><span className="text-neutral-200">{r.statusText}</span>{r.receiptHref && <> <Link className="underline" href={r.receiptHref}>Check its receipt</Link></>}</dd></div>
              </dl>
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-neutral-500"><Link className="underline" href="/burnticker">All coins</Link>. A burn also needs its coin&apos;s pool to be registered first. <Link className="underline" href="/burnticker/how-a-burn-works">Watch how a burn works</Link>.</p>
    </main>
  );
}
