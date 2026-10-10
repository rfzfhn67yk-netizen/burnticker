"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

/**
 * THE TOKEN PAGE (LAUNCHPAD-PATH §6) rendered from /api/burnticker/tokens/[ticker]: supply and burned, the readings series with burn
 * markers, the pool and the next-burn clock, the receipts table (oracle, market, result, settled, source URL, units, spent, bought,
 * burned, tx, verify-it-yourself), the rule and its hash, attesters and quorum, the creator, the fee split, LP burned 100%, what the
 * operator can and cannot do, the curve embed placeholder, the disclaimer, and for Kalshi feeds the market-implied chance (display only).
 * The static site the keeper publishes (data/burnticker-site/t/<ticker>/) carries the same numbers; this page is the in-app view.
 */
interface Status { ticker: string; name: string; mint: string; cluster: string; status: string; oracle: string; selectorKey: string; seriesTitle: string | null; mode: string; rules: { sha256: string; sha12: string; statement: string; oneShot: boolean }; addresses: { mint: string; mintUrl: string; feePda: string; feePdaUrl: string; feeWsol: string | null; feeWsolUrl: string | null; vault: string | null; vaultUrl: string | null; creator: string; creatorUrl: string; programId: string; poolId: string | null; launchTx: string | null; launchTxUrl: string | null }; supply: { initial: string; current: string; source: string }; burned: { total: string; pctOfSupply: number; count: number; last30d: string }; pool: { feePdaSol: string | null; spendableSol: string | null; reserveSol: string; vaultBalance: string | null; vaultAllocation: string | null; shortfallOutstanding: string }; next: { nextCheckAt: string | null; impliedChance: number | null; impliedBasis: string | null; nextMarket: string | null; nextCloseTime: string | null; awaitingFinal: number }; feed: { lastEventId: string | null; lastValue: string | null; lastSettledAt: string | null; readings: number; lastFetchAt: string | null; lastError: string | null }; attesters: { pubkey: string; role: string; active: boolean }[]; quorum: number; fees: { sentence: string; curve: { legs: { label: string; bps: number; recipient: string; dial: string }[]; totalBps: number }; postGraduation: { legs: { label: string; bps: number; recipient: string; dial: string }[]; totalBps: number } }; health: { pending: number; unverified: number; lastError: string | null }; disclosure: { disclaimer: string; eventContract: string | null }; trust: { lpBurnedPct: number; creatorCashBps: number; teamAllocationPct: number; operator: { can: string[]; cannot: string[]; placeholder: boolean }; registerUrl: string } }
interface Receipt { eventId: string; settledAt: string; oracle: string; market: string; result: string | null; value: string | null; title: string | null; method: string | null; sourceUrl: string | null; settlementSourceUrl: string | null; units: number; status: string; skippedReason: string | null; spent: string | null; got: string | null; burned: string | null; memo: string | null; signature: string | null; txUrl: string | null; verify: { curl: string; formula: string; expected: string; checks: string[]; verified: boolean } }
interface Reading { id: string; at: string; result: string | null; value: string | null; title: string | null }
interface Data { status: Status; receipts: Receipt[]; readings: Reading[]; rulesText: string; stubs: string[] }

const fmt = (s: string) => { const [w, f] = s.split("."); return w.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? `.${f}` : ""); };

function Chart({ readings, receipts }: { readings: Reading[]; receipts: Receipt[] }) {
  const pts = readings.filter((r) => r.value !== null);
  if (pts.length < 2) return <p className="text-neutral-500 text-xs">{readings.length ? `${readings.length} settled market(s) read — ${readings.filter((r) => r.result === "yes").length} YES, ${readings.filter((r) => r.result === "no").length} NO` : "The chart appears after the second reading."}</p>;
  const W = 720, H = 220, L = 56, R = 10, T = 10, B = 24;
  const xs = pts.map((_, i) => i), ys = pts.map((p) => Number(p.value));
  const yMin = Math.min(...ys), yMax = Math.max(...ys), pad = (yMax - yMin) * 0.06 || 1;
  const sx = (i: number) => L + (i / Math.max(1, xs.length - 1)) * (W - L - R), sy = (v: number) => T + (1 - (v - (yMin - pad)) / (yMax - yMin + 2 * pad)) * (H - T - B);
  const burnsBy = new Map(receipts.filter((b) => b.status === "confirmed").map((b) => [b.eventId, b.units]));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-neutral-800 bg-neutral-900" role="img" aria-label="readings with burn markers">
      <polyline fill="none" stroke="#ecebe6" strokeWidth={1.5} points={pts.map((_, i) => `${sx(i).toFixed(1)},${sy(ys[i]).toFixed(1)}`).join(" ")} />
      {pts.map((p, i) => burnsBy.has(p.id) ? <circle key={p.id} cx={sx(i)} cy={sy(ys[i])} r={2 + Math.sqrt(burnsBy.get(p.id)!)} fill="#e2774f" fillOpacity={0.8}><title>{p.id}: {burnsBy.get(p.id)} unit(s)</title></circle> : null)}
      <text x={L - 4} y={sy(yMax) + 4} textAnchor="end" fill="#a19e96" fontSize={10}>{yMax}</text><text x={L - 4} y={sy(yMin) + 4} textAnchor="end" fill="#a19e96" fontSize={10}>{yMin}</text>
      <text x={L} y={H - 6} fill="#a19e96" fontSize={10}>{pts[0].id}</text><text x={W - R} y={H - 6} textAnchor="end" fill="#a19e96" fontSize={10}>{pts[pts.length - 1].id}</text>
    </svg>
  );
}

export default function TokenPage() {
  const { ticker } = useParams<{ ticker: string }>();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  useEffect(() => { fetch(`/api/burnticker/tokens/${encodeURIComponent(ticker)}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setD(j); }).catch((e) => setErr(String(e.message ?? e))); }, [ticker]);
  useEffect(() => { if (!d?.status.next.nextCheckAt) return; const at = Date.parse(d.status.next.nextCheckAt); const t = setInterval(() => { const ms = Math.max(0, at - Date.now()); setClock(ms ? `next check in ${Math.floor(ms / 3.6e6)}h ${Math.floor(ms % 3.6e6 / 6e4)}m ${Math.floor(ms % 6e4 / 1e3)}s` : "now"); }, 1000); return () => clearInterval(t); }, [d]);
  if (err) return <main className="p-6 text-red-400">{err}</main>;
  if (!d) return <main className="p-6 text-neutral-400">Loading…</main>;
  const s = d.status;
  const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
  const tile = (k: string, v: string, sub?: string) => <div key={k} className={card}><div className="text-xs text-neutral-400">{k}</div><div className="text-lg font-semibold tabular-nums">{v}</div>{sub && <div className="text-xs text-neutral-500">{sub}</div>}</div>;
  const rows = [...d.receipts].reverse();
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-6 text-sm">
      <header>
        <p className="text-xs"><Link className="underline" href="/burnticker">← Burnticker</Link></p>
        <h1 className="text-2xl font-semibold">${s.ticker} <span className="text-neutral-400 font-normal">{s.name}</span></h1>
        <p className="text-neutral-400 text-xs">{s.oracle === "kalshi" ? "Kalshi" : "first-party source"} · <code>{s.selectorKey}</code>{s.seriesTitle ? ` · ${s.seriesTitle}` : ""} · {s.cluster} · {s.status}</p>
      </header>
      <div className={card + " border-l-4 border-l-orange-500"}><strong>The rule.</strong> {s.rules.statement}<div className="text-xs text-neutral-500 mt-1">rules.json sha256 <code>{s.rules.sha256}</code> · <a className="underline" href={`/api/burnticker/tokens/${s.ticker}?format=rules`}>rules.json</a> · locked at launch; nobody can change it.{s.rules.oneShot && <> This rule resolves once{s.next.nextCloseTime ? `, on ${s.next.nextCloseTime}` : ""}; after that the supply is fixed.</>}</div></div>
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tile("Supply", fmt(s.supply.current), `of ${fmt(s.supply.initial)} (${s.supply.source})`)}
        {tile("Burned", fmt(s.burned.total), `${s.burned.pctOfSupply.toFixed(2)}% · ${s.burned.count} burn(s) · ${fmt(s.burned.last30d)} in 30 d`)}
        {s.mode === "buyback" ? tile("Burn pool", s.pool.feePdaSol === null ? "—" : `${s.pool.feePdaSol} SOL`, `spendable ${s.pool.spendableSol ?? "—"} after a ${s.pool.reserveSol} SOL reserve`) : tile("Vault", s.pool.vaultBalance === null ? "—" : fmt(s.pool.vaultBalance), `allocation ${fmt(s.pool.vaultAllocation ?? "0")} · shortfall owed ${fmt(s.pool.shortfallOutstanding)}`)}
        {tile("Next possible burn", clock || (s.rules.oneShot ? "resolves once" : "—"), s.next.awaitingFinal ? `${s.next.awaitingFinal} awaiting finalisation` : "the next reading of the selector")}
        {s.next.impliedChance !== null && tile("Market-implied chance of the next burn", `${(s.next.impliedChance * 100).toFixed(0)}%`, `${s.next.nextMarket ?? ""}${s.next.nextCloseTime ? ` · closes ${s.next.nextCloseTime}` : ""} · display only, never used by the rule`)}
      </section>
      <section><h2 className="font-medium mb-1">{s.seriesTitle ?? s.selectorKey}</h2><p className="text-xs text-neutral-500 mb-2">Latest: {s.feed.lastEventId ? `${s.feed.lastValue ?? ""} · ${s.feed.lastEventId} (${s.feed.lastSettledAt})` : "no reading yet"} · {s.feed.readings} reading(s){s.feed.lastError ? ` · last error: ${s.feed.lastError}` : ""}. Dots mark burns.</p><Chart readings={d.readings} receipts={d.receipts} /></section>
      <section>
        <h2 className="font-medium mb-2">Receipts</h2>
        {rows.length === 0 ? <p className="text-neutral-500">No receipts yet.</p> : (
          <div className="overflow-x-auto rounded-lg border border-neutral-800"><table className="w-full text-xs"><thead className="text-neutral-400 text-left"><tr><th className="p-2">Settled</th><th className="p-2">Market / period</th><th className="p-2">Result</th><th className="p-2 text-right">Value</th><th className="p-2 text-right">Units</th><th className="p-2 text-right">Spent</th><th className="p-2 text-right">Bought</th><th className="p-2 text-right">Burned</th><th className="p-2">Tx</th><th className="p-2">Source</th><th className="p-2">Check</th></tr></thead>
            <tbody>{rows.map((b) => <tr key={b.eventId} className="border-t border-neutral-800"><td className="p-2">{b.settledAt.slice(0, 19).replace("T", " ")}</td><td className="p-2" title={b.title ?? ""}><code>{b.market}</code></td><td className="p-2">{b.result ?? "—"}</td><td className="p-2 text-right tabular-nums">{b.value ?? "—"}</td><td className="p-2 text-right">{b.units}</td><td className="p-2 text-right">{b.status === "confirmed" ? b.spent ?? "—" : "—"}</td><td className="p-2 text-right">{b.got ? fmt(b.got) : "—"}</td><td className="p-2 text-right">{b.status === "confirmed" ? fmt(b.burned ?? "0") : <span className="text-neutral-500" title={b.skippedReason ?? ""}>{b.status}</span>}</td><td className="p-2">{b.txUrl ? <a className="underline" href={b.txUrl}>{b.signature!.slice(0, 10)}…</a> : "—"}</td><td className="p-2">{b.settlementSourceUrl && <a className="underline" href={b.settlementSourceUrl}>source</a>} {b.sourceUrl && <a className="underline" href={b.sourceUrl}>api</a>}</td><td className="p-2">{b.verify.verified ? <span className="text-emerald-400" title="recomputed; matches the memo">✓</span> : b.status === "confirmed" ? <span className="text-red-400" title={b.verify.checks.join("; ")}>!</span> : "…"}</td></tr>)}</tbody></table></div>
        )}
      </section>
      <section>
        <h2 className="font-medium mb-2">Verify it yourself</h2>
        {rows.slice(0, 40).map((b) => <details key={b.eventId} className={card + " mb-2"}><summary className="cursor-pointer">{b.settledAt.slice(0, 10)} · {b.market} — {b.result ?? b.value}, {b.units} unit(s), {b.status === "confirmed" ? `${fmt(b.burned ?? "0")} burned` : b.status}{b.verify.verified ? " ✓" : ""}</summary>
          <p className="mt-2">1. Read the settled result from the source:</p><pre className="text-xs bg-neutral-950 rounded p-2 overflow-x-auto">{b.verify.curl}</pre>{b.method && <p className="text-xs text-neutral-500">Value read by: {b.method}</p>}
          <p>2. Apply the rule:</p><pre className="text-xs bg-neutral-950 rounded p-2 overflow-x-auto">{b.verify.formula}</pre>
          <p>3. Expected: <strong>{b.verify.expected}</strong></p>
          <p>4. The receipt memo on chain{b.txUrl && <> (<a className="underline" href={b.txUrl}>transaction</a>)</>}:</p><pre className="text-xs bg-neutral-950 rounded p-2 overflow-x-auto">{b.memo ?? `no transaction — ${b.status}`}</pre>
          {b.verify.checks.length > 0 && <p className="text-red-400">Checks that did not pass: {b.verify.checks.join("; ")}</p>}
        </details>)}
      </section>
      <section><h2 className="font-medium mb-2">Trade</h2><div className={card + " border-dashed text-neutral-500 text-center"}>LaunchLab curve embed — pool <code>{s.addresses.poolId ?? "not created yet"}</code> (added when the LaunchLab adapter lands)</div></section>
      <section className="space-y-2">
        <h2 className="font-medium">Fees</h2><p>{s.fees.sentence}</p>
        {[s.fees.curve, s.fees.postGraduation].map((f, k) => <div key={k} className="overflow-x-auto rounded-lg border border-neutral-800"><table className="w-full text-xs"><thead className="text-neutral-400 text-left"><tr><th className="p-2">{k === 0 ? "curve" : "post-graduation"}</th><th className="p-2 text-right">bps</th><th className="p-2 text-right">SOL per 1 SOL</th><th className="p-2">to</th><th className="p-2">dial</th></tr></thead><tbody>{f.legs.map((l) => <tr key={l.label} className="border-t border-neutral-800"><td className="p-2">{l.label}</td><td className="p-2 text-right">{l.bps}</td><td className="p-2 text-right">{(l.bps / 10000).toFixed(6).replace(/0+$/, "")}</td><td className="p-2">{l.recipient}</td><td className="p-2 text-neutral-500">{l.dial}</td></tr>)}<tr className="border-t border-neutral-800"><td className="p-2">total</td><td className="p-2 text-right">{f.totalBps}</td><td></td><td></td><td></td></tr></tbody></table></div>)}
        <p className="text-xs text-neutral-500">Creator cash from fees: {s.trust.creatorCashBps} bps · LP burned at graduation: {s.trust.lpBurnedPct}% · team allocation: {s.trust.teamAllocationPct}%.</p>
      </section>
      <section className={card}><h2 className="font-medium">What the operator can and cannot do</h2><p className="text-xs text-neutral-500">From the <Link className="underline" href={s.trust.registerUrl}>Powers Register</Link>{s.trust.operator.placeholder ? " (placeholder until the program is deployed)" : ""}.</p><p className="mt-1"><strong>Can:</strong> {s.trust.operator.can.join("; ")}.</p><p><strong>Cannot:</strong> {s.trust.operator.cannot.join("; ")}.</p></section>
      <section className={card}><h2 className="font-medium">Attesters</h2><p>Quorum {s.quorum} of {s.attesters.length}: {s.attesters.map((a) => `${a.pubkey} (${a.role}${a.active ? "" : ", inactive"})`).join(", ") || "none recorded"}. Level 1: our data key signs each reading. Level 2 adds an independent attester per selector. Level 3: a proof of the API response (zkTLS) or an on-chain settlement where the venue publishes one.</p></section>
      <section className={card + " text-xs"}><h2 className="font-medium text-sm">Addresses</h2><ul className="space-y-1 break-all"><li>Mint <a className="underline" href={s.addresses.mintUrl}><code>{s.addresses.mint}</code></a></li><li>Burn pool = the burn program&apos;s fee PDA = the LaunchLab creator (anyone can deposit, nobody can withdraw; the keeper only pays gas) <a className="underline" href={s.addresses.feePdaUrl}><code>{s.addresses.feePda}</code></a></li>{s.addresses.feeWsol && <li>Fee PDA&apos;s WSOL account (claimed curve fees land here) <a className="underline" href={s.addresses.feeWsolUrl!}><code>{s.addresses.feeWsol}</code></a></li>}{s.addresses.vault && <li>Vault <a className="underline" href={s.addresses.vaultUrl!}><code>{s.addresses.vault}</code></a></li>}<li>Creator <a className="underline" href={s.addresses.creatorUrl}><code>{s.addresses.creator}</code></a></li><li>Receipts program <code>{s.addresses.programId}</code></li>{s.addresses.launchTx && <li>Launch <a className="underline" href={s.addresses.launchTxUrl!}><code>{s.addresses.launchTx}</code></a></li>}</ul></section>
      {s.disclosure.eventContract && <p className={card + " border-l-4 border-l-orange-500 text-xs"}>{s.disclosure.eventContract}</p>}
      <footer className="text-xs text-neutral-500">{s.disclosure.disclaimer} Health: {s.health.pending} pending, {s.health.unverified} unverified{s.health.lastError ? ` · last error: ${s.health.lastError}` : ""}.{d.stubs.length ? ` On this host: ${d.stubs.join(" · ")}` : ""}</footer>
    </main>
  );
}
