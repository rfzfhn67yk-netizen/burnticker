"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DeficitPrelaunch as Data } from "@/lib/burnticker/deficitPrelaunch";
import { EmptyState } from "../../_components/EmptyState";
import { BurnMath } from "../../_components/BurnMath";
import { ReadinessPanel } from "../../_components/ReadinessPanel";
import { readinessOf, type Readiness } from "@/lib/burnticker/readiness";
import type { DeficitQueue } from "@/lib/burnticker/deficitQueue";
import { EVENT_LABEL, type ActivityEvent } from "@/lib/burnticker/activity";
import { progressOf } from "@/lib/burnticker/progress";
import { QueuePanel } from "../../_components/QueuePanel";
import { ProgressStrip } from "../../_components/ProgressStrip";
import { FIRST_BURN_PATH_URL } from "@/lib/burnticker/currentStatusLinks";
import { COIN_FEED_LINK, CSV_LINK_COPY, csvHref, feedHref } from "@/lib/burnticker/exportLinks";
import { TradeButtons } from "../../_components/TradeLinks";
import { coinLinks } from "@/lib/burnticker/tradeLinks";
import { graduationExplainer } from "@/lib/burnticker/graduationLine";
import { nextResultLinks } from "@/lib/burnticker/followFeeds";
import { coinWatchKey } from "@/lib/burnticker/watchlist";
import { FollowFeeds } from "../../_components/FollowFeeds";

/**
 * /burnticker/t/DEFICIT BEFORE THE COIN IS REGISTERED ON THIS HOST (website brief 2026-10-11 §1). A useful page instead of "no token":
 * what $DEFICIT is, the rule in one sentence, the 2 % / $1B dial, the launch date when one is set, the whitepaper, the real devnet
 * rehearsal receipt with a verify action, and the served $DEFICIT site as the canonical page (rel=canonical + the visible link).
 * Data: GET /api/burnticker/deficit-prelaunch (deficitPrelaunch.ts — the locked rules file and config/burnticker/current-status.json).
 */
type Full = Data & { queue?: DeficitQueue; keeper?: { readiness: Readiness | null; curve: { phase: "curve" | "migrating" | "graduated"; raised: string; threshold: string } | null; events: ActivityEvent[] } | null;
  /** owner 2026-10-14: the created coin's mint (config/own-tokens.json), for the trade link; null before the create */
  mint?: string | null };

export function DeficitPrelaunch({ fallbackSite }: { fallbackSite: string }) {
  const [d, setD] = useState<Full | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetch("/api/burnticker/deficit-prelaunch").then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); setD(j); }).catch((e) => setErr(String((e as Error).message ?? e))); }, []);
  const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 space-y-4 text-sm" data-not-registered data-deficit-prelaunch>
      <link rel="canonical" href={d?.canonical ?? fallbackSite} />
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">$DEFICIT</h1>
        <p className="text-neutral-300">{d?.keeper ? "The first Burnticker coin: it burns when the U.S. national debt rises. It is created, and this site has not registered it yet, so the figures below come from its keeper's published files." : "The first Burnticker coin: it burns when the U.S. national debt rises. This site has not read it on this network, so it shows no rule account, reading or receipt here."}</p>
        {d?.mint && <div data-header-trade><TradeButtons links={coinLinks({ cluster: "mainnet", mint: d.mint, phase: d.keeper?.curve?.phase ?? null, status: "live" })} mint={d.mint} ticker="DEFICIT" /></div>}
        {/* campaign readiness item 6: Follow is this browser only, so the feed and the calendar sit beside it */}
        {d?.mint && <FollowFeeds watchKey={coinWatchKey("mainnet", d.mint)} ticker="DEFICIT" {...nextResultLinks(d.ticker, d.mint)} />}
        <p className="text-xs text-neutral-400">The $DEFICIT page itself is <a className="underline" href={d?.servedAt ?? fallbackSite}>{(d?.servedAt ?? fallbackSite).replace(/^https:\/\//, "").replace(/\/$/, "")}</a>.</p>
      </header>
      {!d && !err && <EmptyState kind="loading" body="Reading the $DEFICIT rule file." />}
      {err && <EmptyState kind="unavailable" body="This site could not read the $DEFICIT rule just now." details={err}><p className="mt-2"><a className="underline" href={fallbackSite}>Open the $DEFICIT page</a></p></EmptyState>}
      {d && <>
        {(() => {
          const r = d.keeper?.readiness ?? readinessOf({ launched: false, phase: null, raisedSol: null, poolVerified: null, latest: null });
          const c = d.keeper?.curve ?? null;
          return <>
            <section className={card} aria-label="Progress"><h2 className="mb-2 font-medium">Where $DEFICIT stands</h2><ProgressStrip p={progressOf(r, { raiseSol: c ? Number(c.threshold) : null, raisedSol: c ? Number(c.raised) : null, queuedUnits: d.queue?.state === "queued" ? d.queue.units : null })} />{c && c.phase !== "graduated" && c.phase !== "migrating" && graduationExplainer(c.threshold, "SOL", d.launch.seedSol ?? null) && <p className="mt-2 text-xs text-neutral-300" data-graduation-explainer>{graduationExplainer(c.threshold, "SOL", d.launch.seedSol ?? null)}</p>}</section>
            <ReadinessPanel r={r} firstBurnPathUrl={FIRST_BURN_PATH_URL} />
            {d.queue && <QueuePanel q={d.queue} />}
            <section className={card} aria-label="What launch day looks like"><h2 className="font-medium">What happens after launch</h2><p className="mt-1 text-xs text-neutral-300">Nothing burns until the curve fills and the debt rises. $DEFICIT first trades on its LaunchLab curve. The curve graduates once {c ? `${Number(c.threshold)} SOL` : "its raise"} has been raised, and a seed gift to the burn pool does not count toward that. {c ? "This site read that raise from the coin's own pool." : "The raise is read from the coin's own pool once it exists."} Then its Raydium pool is registered and verified. Only after that can a Treasury reading with at least one full $1B unit start a burn.</p></section>
            {d.keeper && <section className={card} aria-label="Burn log"><h2 className="font-medium">On chain so far</h2>{d.keeper.events.length === 0 ? <p className="mt-1 text-xs text-neutral-400">The keeper has not recorded anything on chain yet. Signed readings, burns, the graduation and the pool registration appear here as they happen.</p> : <ol className="bt-tape mt-2">{d.keeper.events.map((e) => <li key={`${e.kind}-${e.at}-${e.text}`} className="bt-tape-row text-xs" data-kind={e.kind}><span className="bt-ticker-kind">{EVENT_LABEL[e.kind]}</span><a className="underline" href={e.href}>{e.text}</a></li>)}</ol>}<p className="mt-2 flex flex-wrap gap-x-4 text-xs"><a className="underline" href={csvHref(d.ticker, "burns")} download>{CSV_LINK_COPY.burnsLink}</a><a className="underline" href={csvHref(d.ticker, "readings")} download>{CSV_LINK_COPY.readingsLink}</a><a className="underline" href={feedHref({ coin: d.ticker }, "rss")}>{COIN_FEED_LINK}</a></p></section>}
          </>;
        })()}
        <section className={card} aria-label="The rule">
          <h2 className="font-medium">The rule, in one sentence</h2>
          <p className="mt-1 text-neutral-100">{d.oneSentence}</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div><dt className="text-neutral-500">unit</dt><dd className="font-mono">{d.dial.unitLabel} of debt</dd></div>
            <div><dt className="text-neutral-500">per unit</dt><dd className="font-mono">{d.dial.percent} of what is left in the burn pool</dd></div>
            <div><dt className="text-neutral-500">launch date</dt><dd>{d.launch.date ?? (d.keeper ? "created, date not recorded" : "not announced")}</dd></div>
            <div><dt className="text-neutral-500">network</dt><dd>{d.keeper ? "mainnet" : "not launched on mainnet"}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-neutral-400">{d.keeper ? "" : `${d.launch.note} `}Holders&apos; balances are never touched: burns destroy only tokens the program bought with the burn pool.</p>
          <details className="mt-2 text-xs"><summary className="cursor-pointer text-neutral-300">The locked rule text</summary><p className="mt-1 text-neutral-300">{d.statement}</p><p className="mt-1 break-all text-neutral-500">The text comes from <a className="underline decoration-dotted" href={d.rulesUrl} target="_blank" rel="noreferrer">{d.rulesWords}</a>. Its sha256 is {d.rulesSha256}. That hash, not the file name, is what ties the coin to this exact text.</p></details>
        </section>
        <section className={card} aria-label="The devnet rehearsal">
          <h2 className="font-medium">A real burn from the devnet rehearsal</h2>
          <p className="mt-1 text-neutral-300">{d.rehearsal.demo.summary}</p>
          <p className="mt-2"><Link className="inline-block rounded bg-amber-400 px-3 py-1.5 font-semibold text-neutral-950" href={d.rehearsal.demo.checkHref}>Verify this receipt in your browser</Link> <a className="ml-2 text-xs underline" href={d.rehearsal.demo.explorerUrl}>transaction on the devnet explorer</a></p>
          <p className="mt-2 text-xs text-neutral-500">{d.rehearsal.note} Devnet is a rehearsal network; nothing there has money value.</p>
        </section>
        <BurnMath />
        <p className="text-xs"><a className="underline" href={d.whitepaper}>Whitepaper</a> · <a className="underline" href={d.servedAt}>The $DEFICIT page</a> · <Link className="underline" href="/burnticker/trust">Current status</Link> · <Link className="underline" href="/burnticker">All coins on this site</Link></p>
      </>}
    </main>
  );
}
