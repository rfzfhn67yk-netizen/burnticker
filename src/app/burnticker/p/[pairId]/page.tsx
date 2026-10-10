"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

/**
 * A rivalry pair's shared page. A scoreboard header (burns A : B, supply A : B, the last settlement with its market ticker and result,
 * the next scheduled market with each side's Kalshi-implied chance — display only), the share line (dailyPost.ts pairDailyText, built
 * by the API), both receipts tables stacked, both rules. The receipts are the scoreboard. The static twin is tokenPage.ts renderPairHtml.
 */
interface Receipt { eventId: string; settledAt: string; result: string | null; value: string | null; units: number; status: string; burned: string | null; txUrl: string | null; signature: string | null; verify?: { verified: boolean; checks: string[] } }
interface Side { status: { ticker: string; name: string; mint: string; supply: { current: string; initial: string }; burned: { total: string; count: number; pctOfSupply: number }; rules: { statement: string; sha256: string }; next: { impliedChance: number | null; nextMarket: string | null }; status: string }; receipts: Receipt[] }
interface Tally {
  burnsA: number; burnsB: number; burnedA: string; burnedB: string; supplyA: string; supplyB: string; supplyPctA: number; supplyPctB: number; settlements: number; voids: number;
  lastSettlement: { eventId: string; settledAt: string; burnedSide: "A" | "B" | null; result: string | null; value: string | null; burned: string | null } | null;
  next: { market: string | null; closeTime: string | null; chanceA: number | null; chanceB: number | null };
}
interface Data { pair: { pairId: string; selectorKey: string; createdAt: number }; a: Side; b: Side; tally: Tally; share: string; stubs: string[] }
const fmt = (s: string) => { const [w, f] = s.split("."); return w.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? `.${f}` : ""); };

export default function PairPage() {
  const { pairId } = useParams<{ pairId: string }>();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { fetch(`/api/burnticker/pairs/${encodeURIComponent(pairId)}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setD(j); }).catch((e) => setErr(String(e.message ?? e))); }, [pairId]);
  if (err) return <main className="p-6 text-red-400">{err}</main>;
  if (!d) return <main className="p-6 text-neutral-400">Loading…</main>;
  const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
  const A = d.a.status.ticker, B = d.b.status.ticker, t = d.tally, ls = t.lastSettlement;
  const sideName = (x: "A" | "B" | null) => (x === "A" ? `$${A}` : x === "B" ? `$${B}` : "neither side");
  const receiptsTable = (s: Side) => (
    <section>
      <h2 className="font-medium mb-2">Receipts — <Link className="underline" href={`/burnticker/t/${s.status.ticker}`}>${s.status.ticker}</Link> <span className="text-neutral-500 text-xs">({s.receipts.length})</span></h2>
      {s.receipts.length === 0 ? <p className="text-neutral-400 text-xs">No receipts yet for ${s.status.ticker}.</p> : (
        <div className="overflow-x-auto rounded-lg border border-neutral-800"><table className="w-full text-xs"><thead className="text-neutral-400 text-left"><tr><th className="p-2">Settled</th><th className="p-2">Market</th><th className="p-2">Result</th><th className="p-2 text-right">Units</th><th className="p-2 text-right">Burned</th><th className="p-2">Status</th><th className="p-2">Tx</th><th className="p-2">Check</th></tr></thead>
          <tbody>{[...s.receipts].sort((x, y) => (x.settledAt < y.settledAt ? 1 : -1)).map((r) => <tr key={r.eventId} className="border-t border-neutral-800"><td className="p-2">{r.settledAt.slice(0, 19).replace("T", " ")}</td><td className="p-2"><code>{r.eventId}</code></td><td className="p-2">{r.result ?? r.value ?? "—"}</td><td className="p-2 text-right tabular-nums">{r.units}</td><td className="p-2 text-right tabular-nums">{r.status === "confirmed" ? fmt(r.burned ?? "0") : "—"}</td><td className="p-2">{r.status}</td><td className="p-2">{r.txUrl && r.signature ? <a className="underline" href={r.txUrl}>{r.signature.slice(0, 10)}…</a> : "—"}</td><td className="p-2">{r.verify ? (r.verify.verified ? <span className="text-emerald-400">✓</span> : r.status === "confirmed" ? <span className="text-red-400" title={r.verify.checks.join("; ")}>!</span> : "…") : "—"}</td></tr>)}</tbody></table></div>
      )}
    </section>
  );
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-6 text-sm">
      <header><p className="text-xs"><Link className="underline" href="/burnticker">← Burnticker</Link></p><h1 className="text-2xl font-semibold"><Link className="underline" href={`/burnticker/t/${A}`}>${A}</Link> <span className="text-neutral-500">vs</span> <Link className="underline" href={`/burnticker/t/${B}`}>${B}</Link></h1><p className="text-neutral-400 text-xs">Rivalry pair <code>{d.pair.pairId}</code> · one selector <code>{d.pair.selectorKey}</code> · inverted mappings: each settlement burns exactly one side (a voided market burns neither). The receipts are the scoreboard.</p></header>

      <section className={card + " space-y-3"} aria-label="Scoreboard">
        <div className="text-center"><div className="text-xs text-neutral-400">burns</div><div className="text-4xl font-semibold tabular-nums">${A} {t.burnsA} <span className="text-neutral-500 text-2xl">:</span> {t.burnsB} ${B}</div><div className="text-xs text-neutral-500">{t.settlements} settlement(s){t.voids ? `, ${t.voids} void` : ""} · burned {fmt(t.burnedA)} : {fmt(t.burnedB)}</div></div>
        <div className="grid md:grid-cols-3 gap-2">
          <div className="rounded border border-neutral-800 p-2"><div className="text-xs text-neutral-400">supply left</div><div className="text-lg tabular-nums">{t.supplyPctA.toFixed(2)}% <span className="text-neutral-500">:</span> {t.supplyPctB.toFixed(2)}%</div><div className="text-xs text-neutral-500 tabular-nums">{fmt(t.supplyA)} : {fmt(t.supplyB)} of {fmt(d.a.status.supply.initial)} each</div></div>
          <div className="rounded border border-neutral-800 p-2"><div className="text-xs text-neutral-400">last settlement</div>{ls ? <><div><code>{ls.eventId}</code></div><div className="text-xs text-neutral-500">settled {(ls.result ?? ls.value ?? "—").toUpperCase()} · {ls.settledAt.slice(0, 16).replace("T", " ")}Z → {sideName(ls.burnedSide)} burned{ls.burned ? ` ${fmt(ls.burned)}` : ""}</div></> : <div className="text-xs text-neutral-500">none yet — the first settlement after launch burns one side</div>}</div>
          <div className="rounded border border-neutral-800 p-2"><div className="text-xs text-neutral-400">next scheduled market</div>{t.next.market ? <div><code>{t.next.market}</code></div> : <div>—</div>}<div className="text-xs text-neutral-500">{t.next.closeTime ? `closes ${t.next.closeTime}` : ""}</div></div>
        </div>
      </section>

      <section className={card}>
        <div className="flex items-center justify-between gap-2"><h2 className="font-medium">Share line</h2><button className="text-xs underline" onClick={() => { navigator.clipboard?.writeText(d.share).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? "copied" : "copy"}</button></div>
        <pre className="mt-2 whitespace-pre-wrap break-words text-xs bg-neutral-950 border border-neutral-800 rounded p-2">{d.share}</pre>
        <p className="text-xs text-neutral-500 mt-1">The same words as the pair post (dailyPost.ts pairDailyText): a report of the tally, never retyped.</p>
      </section>

      {receiptsTable(d.a)}
      {receiptsTable(d.b)}

      <section className="grid md:grid-cols-2 gap-3">{([[d.a, "A"], [d.b, "B"]] as const).map(([s, side]) => (
        <div className={card} key={side}><div className="text-xs text-neutral-400">side {side}</div><h2 className="font-medium"><Link className="underline" href={`/burnticker/t/${s.status.ticker}`}>${s.status.ticker}</Link> <span className="text-neutral-400 font-normal">{s.status.name}</span></h2><p className="text-xs text-neutral-400 mt-1">{s.status.rules.statement}</p><p className="text-xs text-neutral-500 mt-1 break-all">rules sha256 {s.status.rules.sha256}</p></div>
      ))}</section>
      <footer className="text-xs text-neutral-500">A memecoin pair. Each rule says what its supply does, not what either price does. Nobody is promised anything.{d.stubs.length ? ` On this host: ${d.stubs.join(" · ")}` : ""}</footer>
    </main>
  );
}
