"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/** The platform index (LAUNCHPAD-PATH §6 / the owner's trust requirements): live tokens, total burned, the audit badge, how it works. Facts only. */
interface Index { tokens: { ticker: string; name: string; selectorKey: string; seriesTitle: string | null; mode: string; status: string; burned: string; burns: number; pctOfSupply: number; impliedChance: number | null; oracle: string }[]; totals: { tokens: number; live: number; burns: number; burnedTokens: string }; audit: { ok: boolean; ranAt: string; receipts: number; mismatches: number; chainChecked: boolean } | null; cluster: string; stubs: string[] }

const fmt = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export default function BurntickerIndex() {
  const [ix, setIx] = useState<Index | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetch("/api/burnticker/tokens").then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setIx(j); }).catch((e) => setErr(String(e.message ?? e))); }, []);
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Burnticker</h1>
        <p className="text-neutral-400 text-sm">Tokens whose supply burns when a settled, public event says so — settled results only, never prices. Every burn is a receipt: the source, the rule, the arithmetic, the transaction.</p>
        <nav className="text-sm flex gap-4"><Link className="underline" href="/burnticker/launch">Launch a coin</Link><Link className="underline" href="/burnticker/trust">Trust page</Link></nav>
      </header>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {ix && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[["Live tokens", String(ix.totals.live)], ["Burns", String(ix.totals.burns)], ["Tokens burned", fmt(ix.totals.burnedTokens)], ["Public audit", ix.audit ? (ix.audit.ok ? "all receipts recompute" : `${ix.audit.mismatches} mismatch(es)`) : "not run yet"]].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"><div className="text-xs text-neutral-400">{k}</div><div className={`text-lg font-semibold ${k === "Public audit" ? (ix.audit?.ok ? "text-emerald-400" : ix.audit ? "text-red-400" : "text-neutral-400") : ""}`}>{v}</div>{k === "Public audit" && ix.audit && <div className="text-xs text-neutral-500">{ix.audit.receipts} receipt(s) · {ix.audit.chainChecked ? "source + chain" : "source only"} · {ix.audit.ranAt}</div>}</div>
            ))}
          </section>
          <section>
            <h2 className="font-medium mb-2">Tokens <span className="text-neutral-500 text-sm">({ix.cluster})</span></h2>
            {ix.tokens.length === 0 ? <p className="text-neutral-400 text-sm">No tokens yet.</p> : (
              <div className="overflow-x-auto rounded-lg border border-neutral-800">
                <table className="w-full text-sm"><thead className="text-neutral-400 text-left"><tr><th className="p-2">Ticker</th><th className="p-2">Name</th><th className="p-2">Event</th><th className="p-2">Mode</th><th className="p-2 text-right">Burned</th><th className="p-2 text-right">Burns</th><th className="p-2 text-right">Next-burn chance</th><th className="p-2">Status</th></tr></thead>
                  <tbody>{ix.tokens.map((t) => <tr key={t.ticker} className="border-t border-neutral-800"><td className="p-2"><Link className="underline" href={`/burnticker/t/${t.ticker}`}>${t.ticker}</Link></td><td className="p-2">{t.name}</td><td className="p-2" title={t.selectorKey}>{t.seriesTitle ?? t.selectorKey}</td><td className="p-2">{t.mode}</td><td className="p-2 text-right tabular-nums">{fmt(t.burned)} ({t.pctOfSupply.toFixed(2)}%)</td><td className="p-2 text-right tabular-nums">{t.burns}</td><td className="p-2 text-right tabular-nums">{t.impliedChance === null ? "—" : `${(t.impliedChance * 100).toFixed(0)}%`}</td><td className="p-2">{t.status}</td></tr>)}</tbody></table>
              </div>
            )}
          </section>
          <section className="text-sm text-neutral-300 space-y-2">
            <h2 className="font-medium text-neutral-100">How it works</h2>
            <ol className="list-decimal pl-5 space-y-1">
              <li>A creator picks an event source — a Kalshi series or market (tier 1), or a first-party primary source (tiers 3–5) — and a rule: what each settled outcome burns. The rule is hashed and locked at launch; nobody can change it.</li>
              <li>The token launches on Raydium LaunchLab through Burnticker&apos;s platform config. Its creator-fee slot pays its own burn pool, 100%; the developer takes 25 bps of curve volume; the LP is 100% burned at graduation; there is no team allocation.</li>
              <li>When the event settles, the keeper reads the settled result (never a price), computes the units with the published rule, and cranks the Receipts program: it spends the rule&apos;s share of the pool buying the token at market and burns everything received — or burns from a vesting vault — and writes the receipt memo on chain.</li>
              <li>Anyone can recompute every receipt from the source and the rule; the public audit script does it on a schedule and the badge above reports it. If we stop, anyone can crank with the same public readings.</li>
            </ol>
            {ix.stubs.length > 0 && <p className="text-neutral-500 text-xs">On this host: {ix.stubs.join(" · ")}</p>}
            <p className="text-neutral-500 text-xs">A memecoin. The rule says what the supply does, not what the price does. Nobody is promised anything.</p>
          </section>
        </>
      )}
    </main>
  );
}
