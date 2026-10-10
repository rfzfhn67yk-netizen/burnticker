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
interface Curve { phase: string; raised: string; threshold: string; progressPct: number; quote: string }
interface Clause { voidBy: string; state: "live" | "waiting" | "voided"; waitingOn: ("A" | "B")[]; decidedAt: string | null; detail: string | null }
interface DerbyDay { day: number; windowId: string; status: "decided" | "withheld"; winner: "A" | "B" | "tie" | null; a: { symbol: string; changePct: string | null }; b: { symbol: string; changePct: string | null } | null; margin: string | null; crossMargin: string | null; reason: string | null; proofSha256: string | null; proof: { label: string; url: string | null; detail: string }[] }
interface Derby { pair: { selector: string; window: string; measure: string; flip: boolean; symbols: { a: string; b: string | null }; season: { start: string; days: number; endsOn: string; over: boolean; windows: number; windowsDone: number }; score: { a: number; b: number; ties: number; withheld: number; dayNumber: number }; days: DerbyDay[]; retired: { a: string | null; b: string | null }; note: string }; tickers: { a: string; b: string }; post: string | null }
interface Data { pair: { pairId: string; selectorKey: string; createdAt: number }; a: Side; b: Side; tally: Tally & { clause?: Clause | null; curveA?: Curve | null; curveB?: Curve | null }; share: string; derby?: Derby | null; stubs: string[] }
const pctFmt = (s: string | null) => (s === null ? "—" : `${Number(s) > 0 ? "+" : Number(s) < 0 ? "−" : ""}${Math.abs(Number(s)).toFixed(2)}%`);
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

      {/* Both or neither (2026-10-10): the pair's state, its void date, and both bonding curves side by side. */}
      {(t.clause || t.curveA || t.curveB) && (
        <section className={card + " space-y-2"} aria-label="Both or neither">
          {t.clause && <div className="text-sm"><span className={`rounded px-2 py-0.5 text-xs ${t.clause.state === "live" ? "bg-emerald-900 text-emerald-200" : t.clause.state === "voided" ? "bg-red-900 text-red-200" : "bg-amber-900 text-amber-200"}`}>{t.clause.state === "live" ? "live" : t.clause.state === "voided" ? "voided" : `waiting-on:${t.clause.waitingOn.length ? t.clause.waitingOn.join("|") : "A|B"}`}</span> <span className="text-neutral-400 text-xs">Both or neither — burns start once both coins have a registered pool; the pair voids if {t.clause.voidBy} ends (UTC) without both{t.clause.state === "voided" ? "; the rule has ended and both pools wind down over four weeks" : ""}.{t.clause.detail ? ` ${t.clause.detail}` : ""}</span></div>}
          <div className="grid md:grid-cols-2 gap-2">{([[A, t.curveA], [B, t.curveB]] as const).map(([tk, c]) => (
            <div key={tk} className="rounded border border-neutral-800 p-2"><div className="text-xs text-neutral-400">${tk} bonding curve</div>{c ? <><div className="h-2 rounded bg-neutral-800 mt-1"><div className="h-2 rounded bg-amber-400" style={{ width: `${Math.min(100, c.progressPct)}%` }} /></div><div className="text-xs text-neutral-500 mt-1">{c.raised} of {c.threshold} {c.quote} · {c.phase}</div></> : <div className="text-xs text-neutral-500">— (no chain read on this host)</div>}</div>
          ))}</div>
        </section>
      )}

      {/* Burn Derby (2026-10-10): the running score (a receipt tally), the day-by-day strip with both readings, the season end, proof links. */}
      {d.derby && (
        <section className={card + " space-y-3"} aria-label="Burn Derby">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-medium">Burn Derby · {d.derby.pair.symbols.a}{d.derby.pair.symbols.b ? ` vs ${d.derby.pair.symbols.b}` : ""} <span className="text-xs text-neutral-500">{d.derby.pair.window}{d.derby.pair.flip ? " · one-shot flippening" : d.derby.pair.measure === "mcap" ? " · market-cap change" : ""}</span></h2><span className="text-xs text-neutral-400">season ends {d.derby.pair.season.endsOn} · {d.derby.pair.season.windowsDone} of {d.derby.pair.season.windows} windows read</span></div>
          <div className="text-center text-3xl font-semibold tabular-nums">{d.derby.pair.symbols.a} {d.derby.pair.score.a} <span className="text-neutral-500 text-xl">–</span> {d.derby.pair.score.b} {d.derby.pair.symbols.b}<div className="text-xs text-neutral-500 font-normal">{d.derby.pair.score.ties} tie(s) · {d.derby.pair.score.withheld} withheld · day {d.derby.pair.score.dayNumber}</div></div>
          {(d.derby.pair.retired.a || d.derby.pair.retired.b) && <p className="text-xs text-amber-300">{d.derby.pair.retired.a ? `$${A} retired: ${d.derby.pair.retired.a}. ` : ""}{d.derby.pair.retired.b ? `$${B} retired: ${d.derby.pair.retired.b}.` : ""} No further readings.</p>}
          <div className="flex flex-wrap gap-1" aria-label="Day strip">{d.derby.pair.days.map((x) => <span key={x.windowId} title={`${x.windowId}: ${x.a.symbol} ${pctFmt(x.a.changePct)}${x.b ? ` vs ${x.b.symbol} ${pctFmt(x.b.changePct)}` : ""}${x.reason ? ` — ${x.reason}` : ""}`} className={`inline-flex h-7 min-w-7 items-center justify-center rounded px-1 text-[11px] ${x.status === "withheld" ? "bg-neutral-800 text-neutral-400" : x.winner === "A" ? "bg-amber-500 text-neutral-950" : x.winner === "B" ? "bg-sky-500 text-neutral-950" : "bg-neutral-700"}`}>{x.status === "withheld" ? "–" : x.winner === "tie" ? "=" : x.winner ?? x.day}</span>)}</div>
          <div className="overflow-x-auto rounded border border-neutral-800"><table className="w-full text-xs"><thead className="text-neutral-400 text-left"><tr><th className="p-2">Day</th><th className="p-2">Window</th><th className="p-2">{d.derby.pair.symbols.a}</th>{d.derby.pair.symbols.b && <th className="p-2">{d.derby.pair.symbols.b}</th>}<th className="p-2">Result</th><th className="p-2">Proof</th></tr></thead>
            <tbody>{[...d.derby.pair.days].reverse().map((x) => <tr key={x.windowId} className="border-t border-neutral-800 align-top"><td className="p-2">{x.day}</td><td className="p-2">{x.windowId}</td><td className="p-2 tabular-nums">{pctFmt(x.a.changePct)}</td>{x.b && <td className="p-2 tabular-nums">{pctFmt(x.b.changePct)}</td>}<td className="p-2">{x.status === "withheld" ? <span className="text-neutral-400" title={x.reason ?? ""}>withheld — no burn</span> : x.winner === "A" ? `$${A} burns` : x.winner === "B" ? `$${B} burns` : x.winner === "tie" ? "tie — no burn" : "read"}</td><td className="p-2 space-y-0.5">{x.proof.map((pl) => <div key={pl.label}>{pl.url ? <a className="underline" href={pl.url}>{pl.label}</a> : pl.label} <span className="text-neutral-500">{pl.detail}</span></div>)}</td></tr>)}</tbody></table></div>
          {d.derby.post && <pre className="whitespace-pre-wrap break-words text-xs bg-neutral-950 border border-neutral-800 rounded p-2">{d.derby.post}</pre>}
          <p className="text-xs text-neutral-500">{d.derby.pair.note}. Readings: Pyth (its Solana account, or a Hermes update with a key) or a pool TWAP, cross-read by an independent operator.</p>
        </section>
      )}

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
