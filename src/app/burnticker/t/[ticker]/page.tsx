"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CoinThumb, CurveBar, VenueChip, ago, until } from "../../_components/CoinCard";
import { PinnedCheck, type PinnedView } from "../../_components/PinnedCheck";
import { EmbedSnippet } from "../../_components/EmbedSnippet";
import { likeHref } from "@/lib/burnticker/templates";

/**
 * THE COIN PAGE (LAUNCHPAD-PATH §6; laid out like a launchpad coin page on 2026-10-10 — docs/burnticker/ui-conventions.md): the header
 * with image, name, $TICKER, the mint with a copy button and the creator's links; LEFT the chart (GeckoTerminal's embed of the pool
 * that trades now when one is indexed — mainnet — else Burnticker's own readings chart with burn markers) and the receipts tape under it;
 * RIGHT a sticky panel — Trade (deep links to Raydium / Jupiter for the mint: Burnticker hosts no swap, no amount presets), the bonding
 * curve (SOL raised of the graduation threshold), holders ("—" with the reason when not read), and the RULE CARD (the locked rule in one
 * sentence, the next burn, the pool, what the operator can and cannot do). Then verify-it-yourself, fees, attesters and addresses.
 */
type Link_ = { label: string; url: string };
interface Market { phase: "curve" | "migrating" | "graduated" | null; curve: { raised: string; threshold: string; remaining: string; quote: string; progressPct: number; poolId: string } | null; curveNote: string; graduatedPool: string | null; holders: { count: number | null; countNote: string; top: { account: string; owner: string | null; amount: string; pct: number; label: string | null }[] | null; topNote: string }; trade: { links: { id: string; label: string; url: string }[]; note: string | null }; chart: { provider: string | null; embedUrl: string | null; pageUrl: string | null; note: string }; readAt: string | null; error: string | null }
interface Status { program?: { initialized: boolean } | null; ticker: string; name: string; mint: string; cluster: string; status: string; launchedAt: string | null; oracle: string; selectorKey: string; seriesTitle: string | null; mode: string; rules: { sha256: string; sha12: string; statement: string; oneShot: boolean }; addresses: { mint: string; mintUrl: string; feePda: string; feePdaUrl: string; feeWsol: string | null; feeWsolUrl: string | null; vault: string | null; vaultUrl: string | null; creator: string; creatorUrl: string; programId: string; poolId: string | null; launchTx: string | null; launchTxUrl: string | null }; supply: { initial: string; current: string; source: string }; burned: { total: string; pctOfSupply: number; count: number; last30d: string; lastAt?: string | null }; pool: { feePdaSol: string | null; spendableSol: string | null; reserveSol: string; vaultBalance: string | null; vaultAllocation: string | null; shortfallOutstanding: string }; next: { nextCheckAt: string | null; impliedChance: number | null; impliedBasis: string | null; nextMarket: string | null; nextCloseTime: string | null; awaitingFinal: number }; feed: { lastEventId: string | null; lastValue: string | null; lastSettledAt: string | null; readings: number; lastFetchAt: string | null; lastError: string | null }; attesters: { pubkey: string; role: string; active: boolean }[]; quorum: number; fees: { sentence: string; curve: { legs: { label: string; bps: number; recipient: string; dial: string }[]; totalBps: number }; postGraduation: { legs: { label: string; bps: number; recipient: string; dial: string }[]; totalBps: number } }; health: { pending: number; unverified: number; lastError: string | null }; disclosure: { disclaimer: string; eventContract: string | null }; trust: { lpBurnedPct: number; lpLockedPct?: number; creatorCashBps: number; teamAllocationPct: number; operator: { can: string[]; cannot: string[]; placeholder: boolean }; registerUrl: string }; lp?: LpBlock | null; profile?: { imageUrl: string | null; description: string; links: Link_[]; oneLiner: string; badge?: string; note?: string; affiliation?: string }; pinned?: PinnedView | null; market?: Market; pair: { pairId: string; side: "A" | "B"; counterpart: { ticker: string; name: string }; tally: { burnsThis: number; burnsOther: number }; pageUrl: string } | null }
interface Receipt { eventId: string; settledAt: string; oracle: string; market: string; result: string | null; value: string | null; title: string | null; method: string | null; sourceUrl: string | null; settlementSourceUrl: string | null; units: number; status: string; skippedReason: string | null; spent: string | null; got: string | null; burned: string | null; memo: string | null; signature: string | null; txUrl: string | null; verify: { curl: string; formula: string; expected: string; checks: string[]; verified: boolean } }
/** status.json `lp` (LP locked forever, 2026-10-10; src/lib/burnticker/lockFees.ts LpLockJson). */
interface LpBlock { policy: string; lockProgram: string; feeKey: string | null; feeKeyOwner: string | null; lockedLiquidity: string | null; lockedPct: number; split: { burnBps: number; operatorBps: number }; operatorTreasury: string | null; lastClaim: { at: string; line: string; txUrl: string | null } | null; totals: { claims: number; sol: string; toBurnPool: string; toOperator: string }; urls: { lockProgram: string | null; feeKey: string | null; feeKeyOwner: string | null; lockedLiquidity: string | null; operatorTreasury: string | null }; line: string; note: string | null }
interface Reading { id: string; at: string; result: string | null; value: string | null; title: string | null }
interface Data { status: Status & { lifecycle?: { line: string } | null }; receipts: Receipt[]; readings: Reading[]; rulesText: string; stubs: string[] }

const fmt = (s: string) => { const [w, f] = s.split("."); return w.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? `.${f}` : ""); };
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
const denver = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "—");

function Chart({ readings, receipts }: { readings: Reading[]; receipts: Receipt[] }) {
  const pts = readings.filter((r) => r.value !== null);
  if (pts.length < 2) return <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-neutral-800 text-xs text-neutral-500 px-4 text-center">{readings.length ? `${readings.length} settled result(s) read — ${readings.filter((r) => r.result === "yes").length} YES, ${readings.filter((r) => r.result === "no").length} NO. The line appears once a source publishes numbers.` : "The chart of settled readings appears after the second reading."}</div>;
  const W = 720, H = 240, L = 56, R = 10, T = 10, B = 24;
  const ys = pts.map((p) => Number(p.value));
  const yMin = Math.min(...ys), yMax = Math.max(...ys), pad = (yMax - yMin) * 0.06 || 1;
  const sx = (i: number) => L + (i / Math.max(1, pts.length - 1)) * (W - L - R), sy = (v: number) => T + (1 - (v - (yMin - pad)) / (yMax - yMin + 2 * pad)) * (H - T - B);
  const burnsBy = new Map(receipts.filter((b) => b.status === "confirmed").map((b) => [b.eventId, b.units]));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-neutral-800 bg-neutral-900" role="img" aria-label="settled readings with burn markers">
      <polyline fill="none" stroke="currentColor" className="text-neutral-200" strokeWidth={1.5} points={pts.map((_, i) => `${sx(i).toFixed(1)},${sy(ys[i]).toFixed(1)}`).join(" ")} />
      {pts.map((p, i) => burnsBy.has(p.id) ? <circle key={p.id} cx={sx(i)} cy={sy(ys[i])} r={2 + Math.sqrt(burnsBy.get(p.id)!)} fill="#c8873a" fillOpacity={0.85}><title>{p.id}: {burnsBy.get(p.id)} unit(s) burned</title></circle> : null)}
      <text x={L - 4} y={sy(yMax) + 4} textAnchor="end" className="fill-neutral-400" fontSize={10}>{yMax}</text><text x={L - 4} y={sy(yMin) + 4} textAnchor="end" className="fill-neutral-400" fontSize={10}>{yMin}</text>
      <text x={L} y={H - 6} className="fill-neutral-400" fontSize={10}>{pts[0].id}</text><text x={W - R} y={H - 6} textAnchor="end" className="fill-neutral-400" fontSize={10}>{pts[pts.length - 1].id}</text>
    </svg>
  );
}

function CopyButton({ text, label = "copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="bt-copy" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => setDone(false)); }} aria-label={`Copy ${label}`}>{done ? "copied" : label}</button>;
}

export default function TokenPage() {
  const { ticker } = useParams<{ ticker: string }>();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { fetch(`/api/burnticker/tokens/${encodeURIComponent(ticker)}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setD(j); }).catch((e) => setErr(String(e.message ?? e))); }, [ticker]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (err) return <main className="p-6 text-red-400">{err}</main>;
  if (!d) return <main className="p-6 text-neutral-400">Loading…</main>;
  const s = d.status, m = s.market, prof = s.profile;
  const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
  const rows = [...d.receipts].reverse();
  const nextAt = s.next.nextCloseTime ?? s.next.nextCheckAt;
  const venue = s.oracle === "kalshi" ? "Kalshi" : s.oracle === "polymarket" ? "Polymarket (result read on Polygon)" : "first-party feed";

  return (
    <main className="mx-auto max-w-6xl px-4 py-5 space-y-5 text-sm">
      <p className="text-xs"><Link className="underline" href="/burnticker">← Coins</Link></p>

      {/* ---- header: image, name, ticker, mint + copy, links ---- */}
      <header className="flex gap-4">
        <CoinThumb src={prof?.imageUrl ?? null} ticker={s.ticker} size={72} generated />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5"><VenueChip oracle={s.oracle} />{m?.phase === "graduated" && <span className="bt-chip bt-chip-grad">graduated</span>}{s.status !== "live" && <span className="bt-chip bt-chip-draft">{s.status}</span>}{prof?.badge && <span className="bt-chip bt-chip-window" title="the coin's window, fixed in its rule">{prof.badge}</span>}<span className="text-xs text-neutral-500">{s.cluster} · {s.launchedAt ? `launched ${ago(s.launchedAt, now)}` : "not launched"}</span></div>
          <h1 className="text-2xl font-semibold leading-tight">{s.name} <span className="font-mono text-lg text-neutral-400">${s.ticker}</span></h1>
          <p className="text-neutral-300">{prof?.oneLiner ?? s.seriesTitle ?? s.selectorKey}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
            <span className="font-mono" title={s.mint}>CA {short(s.mint)}</span><CopyButton text={s.mint} label="copy address" />
            {/* growth batch: the program's own word on this mint (verifyMint.ts) — the verifier page answers for any mint */}
            {s.program?.initialized ? <Link className="bt-chip bt-chip-grad" href={`/burnticker/verify?mint=${s.mint}`} title="the burn_receipts program holds a TokenConfig for this mint">verified by program · mint {short(s.mint)}</Link> : <Link className="underline" href={`/burnticker/verify?mint=${s.mint}`} title="the burn_receipts program's TokenConfig is not read on this host">check this mint</Link>}
            {(prof?.links ?? []).map((l) => <a key={l.url} href={l.url} rel="nofollow noopener ugc" target="_blank" className="underline">{l.label}</a>)}
          </div>
          {prof?.description && <p className="text-sm text-neutral-200 max-w-2xl leading-relaxed">{prof.description}</p>}
          {prof?.note && <div className="max-w-2xl rounded border border-neutral-700 p-2 text-xs text-neutral-300"><div className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">creator&apos;s note — not part of the rule</div>{prof.note}</div>}
          <p className="text-xs text-neutral-500">{prof?.affiliation ?? "Not affiliated with any team, league, candidate, agency or market."}</p>
          <p><Link className="inline-block rounded border border-neutral-700 px-2 py-1 text-xs hover:border-amber-400" href={likeHref(s.ticker)}>Launch one like this →</Link> <Link className="text-xs underline text-neutral-400" href="/burnticker/templates">all templates</Link></p>
          <PinnedCheck pinned={s.pinned} />
        </div>
      </header>

      {s.pair && <Link href={s.pair.pageUrl} className={card + " block"}><span className="text-xs text-neutral-400">rivalry pair</span> <span className="font-mono">${s.ticker} {s.pair.tally.burnsThis} : {s.pair.tally.burnsOther} ${s.pair.counterpart.ticker}</span> <span className="text-xs underline">pair page →</span></Link>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ---- LEFT: chart + receipts tape ---- */}
        <div className="min-w-0 space-y-5">
          <section aria-label="Chart">
            {m?.chart.embedUrl ? (
              <>
                <iframe title={`${s.ticker} chart on GeckoTerminal`} src={m.chart.embedUrl} className="h-[420px] w-full rounded-lg border border-neutral-800 bg-neutral-900" loading="lazy" referrerPolicy="no-referrer" allow="clipboard-write" />
                <p className="mt-1 text-xs text-neutral-500">{m.chart.note}{m.chart.pageUrl && <> · <a className="underline" href={m.chart.pageUrl} rel="noopener" target="_blank">open on GeckoTerminal</a></>}</p>
              </>
            ) : (
              <>
                <div className="mb-1 flex items-baseline justify-between gap-2"><h2 className="font-medium">{s.seriesTitle ?? s.selectorKey}</h2><span className="text-xs text-neutral-500">dots mark burns</span></div>
                <Chart readings={d.readings} receipts={d.receipts} />
                <p className="mt-1 text-xs text-neutral-500">Settled readings from {venue}{s.feed.lastEventId ? ` · latest ${s.feed.lastValue ?? ""} ${s.feed.lastEventId}` : ""}.{m?.chart.note ? ` ${m.chart.note}.` : ""}</p>
              </>
            )}
          </section>

          <section aria-label="Receipts">
            <div className="mb-2 flex items-baseline justify-between"><h2 className="font-medium">Receipts</h2><span className="text-xs text-neutral-500">{s.burned.count} burn(s) · {fmt(s.burned.total)} burned ({s.burned.pctOfSupply.toFixed(2)}%)</span></div>
            {rows.length === 0 ? <p className="text-neutral-500">No receipts yet — the first settlement after launch prints the first one.</p> : (
              <ol className="bt-tape">
                {rows.map((b) => (
                  <li key={b.eventId} className="bt-tape-row">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-mono text-xs">{b.settledAt.slice(0, 16).replace("T", " ")}Z</span>
                      <span className="font-mono text-xs truncate" title={b.title ?? ""}>{b.market}</span>
                      <span className="font-mono text-xs uppercase">{b.result ?? b.value ?? "—"}</span>
                    </div>
                    {b.title && /settled on /.test(b.title) && <div className="mt-1 text-[11px] text-neutral-400">{[...new Set((b.title.match(/settled on [^·]+· confirmed by [^·]+/g) ?? []).map((x) => x.trim()))].join(" · ")}{[...b.title.matchAll(/see this game on ESPN → (https:\/\/www\.espn\.com\/\S+)/g)].map((m) => <a key={m[1]} className="ml-2 underline" href={m[1]} rel="noopener" target="_blank">see this game on ESPN →</a>)}</div>}
                    <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                      <span>{b.status === "confirmed" ? <><b className="tabular-nums">{fmt(b.burned ?? "0")}</b> burned · {b.units} unit(s){b.spent ? ` · spent ${b.spent}` : ""}</> : <span className="text-neutral-500" title={b.skippedReason ?? ""}>{b.status}{b.skippedReason ? ` — ${b.skippedReason}` : ""}</span>}</span>
                      <span className="flex gap-2">{b.txUrl && <a className="underline" href={b.txUrl}>tx</a>}{b.settlementSourceUrl && <a className="underline" href={b.settlementSourceUrl}>source</a>}{b.verify.verified ? <span className="text-emerald-400" title="recomputed; matches the memo">✓ verified</span> : b.status === "confirmed" ? <span className="text-red-400" title={b.verify.checks.join("; ")}>! check</span> : null}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        {/* ---- RIGHT: trade links, curve, holders, rule card ---- */}
        <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          <section className={card} aria-label="Trade">
            <h2 className="font-medium">Trade</h2>
            <p className="mt-1 text-xs text-neutral-500">Burnticker hosts no swap. These open the venues where ${s.ticker} trades, for this mint.</p>
            {m && m.trade.links.length > 0 ? (
              <div className="mt-2 grid gap-2">{m.trade.links.map((l, i) => <a key={l.id} href={l.url} rel="noopener" target="_blank" className={i === 0 ? "bt-launch-btn text-center" : "bt-ghost-btn text-center"}>{l.label} ↗</a>)}</div>
            ) : <p className="mt-2 rounded border border-dashed border-neutral-700 p-2 text-xs text-neutral-400">{m?.trade.note ?? "trade links appear once the coin is launched"}</p>}
            <div className="mt-2 flex items-center gap-2 text-xs"><span className="font-mono truncate text-neutral-400" title={s.mint}>{s.mint}</span><CopyButton text={s.mint} /></div>
          </section>

          <section className={card} aria-label="Bonding curve">
            <CurveBar c={{ phase: m?.phase ?? null, progressPct: m?.curve?.progressPct ?? (m?.phase === "graduated" ? 100 : null), raised: m?.curve?.raised ?? null, threshold: m?.curve?.threshold ?? null, quote: m?.curve?.quote ?? null, curveNote: m?.curveNote }} />
            <p className="mt-2 text-xs text-neutral-400">{m?.phase === "graduated" ? `The curve completed; the LP was locked 100% forever at graduation and ${s.ticker} trades on Raydium CPMM${m.graduatedPool ? ` (${short(m.graduatedPool)})` : ""}.` : m?.curve ? `${Number(m.curve.remaining).toFixed(2)} ${m.curve.quote} to graduation. When the curve fills, the pool moves to Raydium and the LP is locked forever; its fees fund the burn.` : <span title={m?.curveNote}>— {m?.curveNote ?? "curve not read"}</span>}</p>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div title={m?.holders.countNote}><dt className="text-neutral-500">holders</dt><dd className="font-mono">{m?.holders.count ?? "—"}</dd></div>
              <div><dt className="text-neutral-500">supply left</dt><dd className="font-mono tabular-nums">{(100 - s.burned.pctOfSupply).toFixed(2)}%</dd></div>
            </dl>
            {m?.holders.top && m.holders.top.length > 0 && (
              <details className="mt-2 text-xs"><summary className="cursor-pointer text-neutral-400">Top holders ({m.holders.top.length})</summary>
                <ol className="mt-1 space-y-0.5">{m.holders.top.slice(0, 20).map((h, i) => <li key={h.account} className="flex justify-between gap-2 font-mono"><span>{i + 1}. {short(h.owner ?? h.account)}{h.label ? <span className="ml-1 text-neutral-500">({h.label})</span> : null}</span><span className="tabular-nums">{h.pct.toFixed(2)}%</span></li>)}</ol>
                <p className="mt-1 text-neutral-500">{m.holders.topNote}</p>
              </details>
            )}
          </section>

          <section className={card + " bt-rule-card"} aria-label="The rule">
            <div className="flex items-baseline justify-between"><h2 className="font-mono text-xs uppercase tracking-widest">The rule · locked</h2><a className="text-[11px] underline" href={`/api/burnticker/tokens/${s.ticker}?format=rules`}>rules.json</a></div>
            <p className="mt-2">{s.rules.statement}</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div><dt className="text-neutral-500">next result</dt><dd className="font-mono" title={denver(nextAt)}>{s.rules.oneShot && !nextAt ? "resolves once" : until(nextAt, now)}</dd></div>
              <div><dt className="text-neutral-500">last burn</dt><dd className="font-mono">{ago(s.burned.lastAt ?? null, now)}</dd></div>
              <div><dt className="text-neutral-500">{s.mode === "buyback" ? "burn pool" : "vault"}</dt><dd className="font-mono">{s.mode === "buyback" ? (s.pool.feePdaSol === null ? "—" : `${s.pool.feePdaSol} SOL`) : (s.pool.vaultBalance === null ? "—" : fmt(s.pool.vaultBalance))}</dd></div>
              <div><dt className="text-neutral-500">burned</dt><dd className="font-mono tabular-nums">{s.burned.pctOfSupply.toFixed(2)}%</dd></div>
            </dl>
            <p className="mt-2 text-[11px] text-neutral-500 break-all">sha256 {s.rules.sha256}</p>
            <details className="mt-2 text-xs"><summary className="cursor-pointer text-neutral-400">What the operator can and cannot do</summary>
              <p className="mt-1"><b>Can:</b> {s.trust.operator.can.join("; ")}.</p><p className="mt-1"><b>Cannot:</b> {s.trust.operator.cannot.join("; ")}.</p>
              <p className="mt-1 text-neutral-500">From the <Link className="underline" href={s.trust.registerUrl}>Powers Register</Link>{s.trust.operator.placeholder ? " (placeholder until the program is deployed)" : ""}. Creator cash from fees {s.trust.creatorCashBps} bps · LP locked {s.trust.lpLockedPct ?? 100}% (fees 80% burn pool / 20% operator) · team allocation {s.trust.teamAllocationPct}%.</p>
            </details>
          </section>

          {s.lp && <LpLockCard lp={s.lp} card={card} />}
        </aside>
      </div>

      <section id="verify" className="scroll-mt-20">
        <h2 className="font-medium mb-2">Verify it yourself</h2>
        {rows.length === 0 ? <p className="text-neutral-500 text-xs">Each receipt gets its curl, formula and memo here.</p> : rows.slice(0, 40).map((b) => <details key={b.eventId} className={card + " mb-2"}><summary className="cursor-pointer">{b.settledAt.slice(0, 10)} · {b.market} — {b.result ?? b.value}, {b.units} unit(s), {b.status === "confirmed" ? `${fmt(b.burned ?? "0")} burned` : b.status}{b.verify.verified ? " ✓" : ""}</summary>
          <p className="mt-2">1. Read the settled result from the source:</p><pre className="text-xs bg-neutral-950 rounded p-2 overflow-x-auto">{b.verify.curl}</pre>{b.method && <p className="text-xs text-neutral-500">Value read by: {b.method}</p>}
          <p>2. Apply the rule:</p><pre className="text-xs bg-neutral-950 rounded p-2 overflow-x-auto">{b.verify.formula}</pre>
          <p>3. Expected: <strong>{b.verify.expected}</strong></p>
          <p>4. The receipt memo on chain{b.txUrl && <> (<a className="underline" href={b.txUrl}>transaction</a>)</>}:</p><pre className="text-xs bg-neutral-950 rounded p-2 overflow-x-auto">{b.memo ?? `no transaction — ${b.status}`}</pre>
          {b.verify.checks.length > 0 && <p className="text-red-400">Checks that did not pass: {b.verify.checks.join("; ")}</p>}
        </details>)}
      </section>

      {s.status !== "draft" && s.status !== "expired" && <EmbedSnippet kind="coin" id={s.ticker} label={`$${s.ticker}`} />}

      <section className="space-y-2">
        <h2 className="font-medium">Fees</h2><p>{s.fees.sentence}</p>
        {[s.fees.curve, s.fees.postGraduation].map((f, k) => <div key={k} className="overflow-x-auto rounded-lg border border-neutral-800"><table className="w-full text-xs"><thead className="text-neutral-400 text-left"><tr><th className="p-2">{k === 0 ? "curve" : "post-graduation"}</th><th className="p-2 text-right">bps</th><th className="p-2 text-right">SOL per 1 SOL</th><th className="p-2">to</th><th className="p-2">dial</th></tr></thead><tbody>{f.legs.map((l) => <tr key={l.label} className="border-t border-neutral-800"><td className="p-2">{l.label}</td><td className="p-2 text-right">{l.bps}</td><td className="p-2 text-right">{(l.bps / 10000).toFixed(6).replace(/0+$/, "")}</td><td className="p-2">{l.recipient}</td><td className="p-2 text-neutral-500">{l.dial}</td></tr>)}<tr className="border-t border-neutral-800"><td className="p-2">total</td><td className="p-2 text-right">{f.totalBps}</td><td></td><td></td><td></td></tr></tbody></table></div>)}
      </section>
      <section className={card}><h2 className="font-medium">Attesters</h2><p>Quorum {s.quorum} of {s.attesters.length}: {s.attesters.map((a) => `${a.pubkey} (${a.role}${a.active ? "" : ", inactive"})`).join(", ") || "none recorded"}. Level 1: our data key signs each reading. Level 2 adds an independent attester per selector. Level 3: a proof of the API response (zkTLS) or an on-chain settlement where the venue publishes one.</p></section>
      <section className={card + " text-xs"}><h2 className="font-medium text-sm">Addresses</h2><ul className="space-y-1 break-all"><li>Mint <a className="underline" href={s.addresses.mintUrl}><code>{s.addresses.mint}</code></a></li><li>Burn pool = the burn program&apos;s fee PDA = the LaunchLab creator (anyone can deposit, nobody can withdraw; the keeper only pays gas) <a className="underline" href={s.addresses.feePdaUrl}><code>{s.addresses.feePda}</code></a></li>{s.addresses.feeWsol && <li>Fee PDA&apos;s WSOL account (claimed curve fees land here) <a className="underline" href={s.addresses.feeWsolUrl!}><code>{s.addresses.feeWsol}</code></a></li>}{s.addresses.vault && <li>Vault <a className="underline" href={s.addresses.vaultUrl!}><code>{s.addresses.vault}</code></a></li>}{s.addresses.poolId && <li>LaunchLab pool <code>{s.addresses.poolId}</code></li>}<li>Creator <a className="underline" href={s.addresses.creatorUrl}><code>{s.addresses.creator}</code></a></li><li>Receipts program <code>{s.addresses.programId}</code></li>{s.addresses.launchTx && <li>Launch <a className="underline" href={s.addresses.launchTxUrl!}><code>{s.addresses.launchTx}</code></a></li>}</ul></section>
      {s.disclosure.eventContract && <p className={card + " border-l-4 border-l-orange-500 text-xs"}>{s.disclosure.eventContract}</p>}
      {/* No burn pool is ever left behind (2026-10-10): the coin's lifecycle line and the fee flow. */}
      <p className="text-xs text-neutral-400">{s.lifecycle ? `${s.lifecycle.line} · ` : ""}creator fees → burn pool → burned; LP locked forever, its fees → 80% burn pool / 20% operator (fixed in code).</p>
      <footer className="text-xs text-neutral-500">{s.disclosure.disclaimer} Health: {s.health.pending} pending, {s.health.unverified} unverified{s.health.lastError ? ` · last error: ${s.health.lastError}` : ""}.{m?.readAt ? ` Curve read ${m.readAt}.` : ""}{d.stubs.length ? ` On this host: ${d.stubs.join(" · ")}` : ""}</footer>
    </main>
  );
}

/** "LP locked forever · fees fund the burn" with the lock addresses (Solscan) and the last claim_lock_fees receipt. */
function LpLockCard({ lp, card }: { lp: LpBlock; card: string }) {
  const addr = (a: string | null, url: string | null, empty: string) => (a ? (url ? <a className="underline font-mono break-all" href={url}>{short(a)}</a> : <span className="font-mono">{short(a)}</span>) : <span className="text-neutral-500">{empty}</span>);
  return (
    <section className={card} aria-label="LP locked forever">
      <h2 className="font-mono text-xs uppercase tracking-widest">LP locked forever · fees fund the burn</h2>
      <p className="mt-2 text-xs">{lp.lockedPct}% of the graduation LP is locked with Raydium&apos;s LP lock and can never be withdrawn. The Fee Key is owned by the burn program; anyone can claim its fees: {lp.split.burnBps / 100}% of the SOL side to this coin&apos;s burn pool, {lp.split.operatorBps / 100}% to the operator, the coin side burned. Fixed in code.</p>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div><dt className="text-neutral-500">lock program</dt><dd>{addr(lp.lockProgram, lp.urls.lockProgram, "—")}</dd></div>
        <div><dt className="text-neutral-500">Fee Key</dt><dd>{addr(lp.feeKey, lp.urls.feeKey, "at graduation")}</dd></div>
        <div><dt className="text-neutral-500">Fee Key owner</dt><dd>{addr(lp.feeKeyOwner, lp.urls.feeKeyOwner, "—")}</dd></div>
        <div><dt className="text-neutral-500">operator treasury</dt><dd>{addr(lp.operatorTreasury, lp.urls.operatorTreasury, "not pinned")}</dd></div>
      </dl>
      <p className="mt-2 text-[11px] text-neutral-400">{lp.lastClaim ? <>{lp.lastClaim.txUrl ? <a className="underline" href={lp.lastClaim.txUrl}>{lp.lastClaim.line}</a> : lp.lastClaim.line} · {lp.totals.claims} claim(s), {lp.totals.toBurnPool} SOL to the burn pool, {lp.totals.toOperator} SOL to the operator</> : "No LP-fee claim yet."}</p>
      {lp.note && <p className="mt-1 text-[11px] text-neutral-500">{lp.note}</p>}
    </section>
  );
}
