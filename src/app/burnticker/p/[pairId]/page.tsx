"use client";

import { useEffect, useState } from "react";
import { HostDiagnostics } from "../../_components/HostDiagnostics";
import Link from "next/link";
import { EmptyState } from "../../_components/EmptyState";
import { receiptRowStatus } from "@/lib/burnticker/verificationStatus";
import { PairFundsFlow } from "../../_components/PairFundsFlow";
import { pairRuleVersion } from "@/lib/burnticker/pairFundsFlow";
import { useLaunchAvailability } from "../../_components/useLaunchAvailability";
import { useParams } from "next/navigation";
import { EmbedSnippet } from "../../_components/EmbedSnippet";
import { likeHref } from "@/lib/burnticker/templates";
import { CANDIDATES_PAIR_SENTENCE, GAME_PAIR_SENTENCE, PAIR_BURN_SENTENCE } from "@/lib/burnticker/describe";
import { isMeetingsSelector, MEETINGS_PAIR_PAGE_LINE } from "@/lib/burnticker/guidedLaunch";
import { TermNote } from "../../_components/Term";
import { CurveBar } from "../../_components/CoinCard";
import { BURNS_AFTER_GRADUATION, COIN_TAB_LABEL, checkReceiptHref, coinTabs, initialTab, raydiumLink, ruleFacts, type CoinTab } from "@/lib/burnticker/coinPage";
import { fixed } from "@/lib/burnticker/safeFormat";

/**
 * A rivalry pair's shared page, in the coin page's order (website-11, 2026-10-12; src/lib/burnticker/coinPage.ts). ON TOP, for each
 * side: its chart (GeckoTerminal's embed when the pool is indexed), ONE outbound link "Trade on Raydium", and a static read of its
 * curve; then the scoreboard (burns A : B, supply A : B, the last settlement, the next scheduled market by name, no odds). THEN THE TABS:
 * "Burn log" (the Burn Derby strip when there is one, and both receipts tables, each receipt with "Check receipt"), "Rule" (where the
 * money goes, both locked rules with hash, dial, window and end), and "Holders" only when either side's holders were read. The share
 * line (dailyPost.ts pairDailyText, built by the API) closes the page. No thread. The static twin is tokenPage.ts renderPairHtml.
 */
/**
 * website-23 (WIRING-SETTLED-PAIRS): a settled-event pair (two candidates in one race, two teams in one game) reads two markets or two
 * series, never one, so its line is the pair's own sentence, keyed on the locked statement as tokenPage.ts settledLineOf keys it.
 */
const settledLineOf = (statement: string): string | null => (/ Candidates pair /.test(statement) ? CANDIDATES_PAIR_SENTENCE : / One-game pair /.test(statement) ? GAME_PAIR_SENTENCE : null);
interface Receipt { eventId: string; settledAt: string; result: string | null; value: string | null; units: number; status: string; burned: string | null; spent?: string | null; txUrl: string | null; signature: string | null; verify?: { verified: boolean; checks: string[] } }
interface Side { rulesText?: string; status: { ticker: string; name: string; mint: string; cluster?: string; market?: { phase: "curve" | "migrating" | "graduated" | null; curve: { raised: string; threshold: string; progressPct: number; quote: string } | null; curveNote: string; graduatedPool: string | null; holders: { count: number | null; countNote: string; top: { account: string; owner: string | null; pct: number; label: string | null }[] | null; topNote: string }; trade: { links: { id: string; label: string; url: string }[]; note: string | null }; chart: { embedUrl: string | null; pageUrl: string | null; note: string } } | null; disclosure?: { disclaimer: string; eventContract: string | null }; supply: { current: string; initial: string }; burned: { total: string; count: number; pctOfSupply: number }; rules: { statement: string; sha256: string; oneShot?: boolean }; next: { impliedChance: number | null; nextMarket: string | null }; status: string; lp?: { lockedPct: number; feeKey: string | null; feeKeyOwner: string | null; lockProgram: string; split: { burnBps: number; operatorBps: number }; urls: { feeKey: string | null; feeKeyOwner: string | null; lockProgram: string | null }; lastClaim: { line: string; txUrl: string | null } | null } | null }; receipts: Receipt[] }
interface Tally {
  burnsA: number; burnsB: number; burnedA: string; burnedB: string; supplyA: string; supplyB: string; supplyPctA: number; supplyPctB: number; settlements: number; voids: number;
  lastSettlement: { eventId: string; settledAt: string; burnedSide: "A" | "B" | null; result: string | null; value: string | null; burned: string | null } | null;
  next: { market: string | null; closeTime: string | null; chanceA: number | null; chanceB: number | null };
  /** Winner takes the burn (API 1.10.0): fees from both coins burn the winner's supply; forwarded SOL each way. */
  winnerTakesBurn?: boolean; forwardedAtoB?: string; forwardedBtoA?: string;
  /** The attester fact while one key attests both coins (tokenPage.ts PAIR_SOLE_ATTESTER_LINE). */
  attesterLine?: string | null;
  /** Round 2: unlinked on chain — two plain coins now. */
  unpaired?: { reason: string; at: string } | null;
}
interface Curve { phase: string; raised: string; threshold: string; progressPct: number; quote: string }
interface Clause { voidBy: string; state: "live" | "waiting" | "voided"; waitingOn: ("A" | "B")[]; decidedAt: string | null; detail: string | null }
interface DerbyDay { day: number; windowId: string; status: "decided" | "withheld"; winner: "A" | "B" | "tie" | null; a: { symbol: string; changePct: string | null }; b: { symbol: string; changePct: string | null } | null; margin: string | null; crossMargin: string | null; reason: string | null; proofSha256: string | null; proof: { label: string; url: string | null; detail: string }[] }
interface Derby { pair: { selector: string; window: string; measure: string; flip: boolean; symbols: { a: string; b: string | null }; season: { start: string; days: number; endsOn: string; over: boolean; windows: number; windowsDone: number }; score: { a: number; b: number; ties: number; withheld: number; dayNumber: number }; forwarded?: { aToB: string; bToA: string; windows: number }; days: DerbyDay[]; retired: { a: string | null; b: string | null }; note: string }; tickers: { a: string; b: string }; post: string | null }
interface Data { pair: { pairId: string; selectorKey: string; createdAt: number }; a: Side; b: Side; tally: Tally & { clause?: Clause | null; curveA?: Curve | null; curveB?: Curve | null }; share: string; derby?: Derby | null; stubs: string[] }
// audit 2026-10-15 H7: a value that is not a finite number is a dash, never "NaN%"
const pctFmt = (s: string | null) => (s === null || !Number.isFinite(Number(s)) ? "—" : `${Number(s) > 0 ? "+" : Number(s) < 0 ? "−" : ""}${Math.abs(Number(s)).toFixed(2)}%`);
/** "1 result" / "3 results": a count with the right noun. */
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fmt = (s: string) => { const [w, f] = s.split("."); return w.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? `.${f}` : ""); };

export default function PairPage() {
  const { pairId } = useParams<{ pairId: string }>();
  const [d, setD] = useState<Data | null>(null);
  const launch = useLaunchAvailability();
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<CoinTab>("burns");
  useEffect(() => { fetch(`/api/burnticker/pairs/${encodeURIComponent(pairId)}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setD(j); }).catch((e) => setErr(String(e.message ?? e))); }, [pairId]);
  const hasHolders = !!(d?.a.status.market?.holders.top?.length || d?.b.status.market?.holders.top?.length);
  useEffect(() => { if (d) setTab(initialTab(window.location.hash, coinTabs(hasHolders))); }, [d, hasHolders]);
  if (err) return <main className="mx-auto max-w-3xl px-4 py-6"><EmptyState kind={/no pair|not found|unknown pair/i.test(err) ? "not-launched" : "unavailable"} body={/no pair|not found|unknown pair/i.test(err) ? "No rivalry pair with this id is registered on this site." : "This pair could not be read just now."} details={err} /></main>;
  if (!d) return <main className="mx-auto max-w-3xl px-4 py-6"><EmptyState kind="loading" /></main>;
  const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
  const A = d.a.status.ticker, B = d.b.status.ticker, t = d.tally, ls = t.lastSettlement;
  const sideName = (x: "A" | "B" | null) => (x === "A" ? `$${A}` : x === "B" ? `$${B}` : "neither side");
  const tabs = coinTabs(hasHolders);
  const sides = [[d.a, "A", t.curveA ?? null], [d.b, "B", t.curveB ?? null]] as const;
  // a side known to be on its curve (or migrating) cannot burn yet; an unread curve says nothing either way
  const preBurn = sides.some(([s, , tc]) => s.status.status !== "draft" && s.status.status !== "expired" && ["curve", "migrating"].includes(s.status.market?.phase ?? tc?.phase ?? ""));
  const receiptsTable = (s: Side) => (
    <section>
      <h2 className="font-medium mb-2">Receipts for <Link className="underline" href={`/burnticker/t/${s.status.ticker}`}>${s.status.ticker}</Link></h2>
      {s.receipts.length === 0 ? <p className="text-neutral-400 text-xs">There are no receipts yet for ${s.status.ticker}.</p> : (
        <div className="overflow-x-auto rounded-lg border border-neutral-800"><table className="w-full text-xs"><thead className="text-neutral-400 text-left"><tr><th className="p-2">Settled</th><th className="p-2">Market</th><th className="p-2">Result</th><th className="p-2 text-right">Units</th><th className="p-2 text-right">Burned</th><th className="p-2">Status</th><th className="p-2">Transaction</th><th className="p-2">Check</th></tr></thead>
          <tbody>{[...s.receipts].sort((x, y) => (x.settledAt < y.settledAt ? 1 : -1)).map((r) => <tr key={r.eventId} className="border-t border-neutral-800"><td className="p-2">{r.settledAt.slice(0, 19).replace("T", " ")}</td><td className="p-2"><code>{r.eventId}</code></td><td className="p-2">{r.result ?? r.value ?? "—"}</td><td className="p-2 text-right tabular-nums">{r.units}</td><td className="p-2 text-right tabular-nums">{r.status === "confirmed" ? fmt(r.burned ?? "0") : r.status === "forwarded" ? <span className="text-amber-300">forwarded {r.spent ?? ""} SOL</span> : "—"}</td><td className="p-2">{r.status}</td><td className="p-2">{r.txUrl && r.signature ? <a className="underline" href={r.txUrl}>{r.signature.slice(0, 10)}…</a> : "—"}</td><td className="p-2 whitespace-nowrap">{(() => { const v = receiptRowStatus(r); return <span className={v.status === "passed" ? "text-emerald-400" : v.status === "failed" ? "text-red-400" : "text-neutral-500"} title={v.title}>{v.label}</span>; })()}{(() => { const href = checkReceiptHref(r.signature, s.status.cluster ?? "devnet"); return href ? <> <a className="underline font-medium" href={href} data-check-receipt>Check receipt</a></> : null; })()}</td></tr>)}</tbody></table></div>
      )}
    </section>
  );
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-6 text-sm">
      <header><p className="text-xs"><Link className="underline" href="/burnticker">← Burnticker</Link></p><h1 className="text-2xl font-semibold"><Link className="underline" href={`/burnticker/t/${A}`}>${A}</Link> <span className="text-neutral-500">vs</span> <Link className="underline" href={`/burnticker/t/${B}`}>${B}</Link></h1>{launch.open && <p className="mt-1"><Link className="inline-block rounded border border-neutral-700 px-2 py-1 text-xs hover:border-amber-400" href={likeHref(A)}>Launch a pair like this →</Link></p>}{(d.a.status as { profile?: { badge?: string } }).profile?.badge && <p className="mt-1"><span className="bt-chip bt-chip-window" title="the pair's window, fixed in both rules">{(d.a.status as { profile?: { badge?: string } }).profile!.badge}</span></p>}<p className="text-neutral-400 text-xs">This is the rivalry pair <code>{d.pair.pairId}</code>. {isMeetingsSelector(d.pair.selectorKey) ? <>{MEETINGS_PAIR_PAGE_LINE} A draw, a postponed or a cancelled game moves nothing.</> : settledLineOf(d.a.status.rules.statement) ? <span data-settled-pair-line>{settledLineOf(d.a.status.rules.statement)}</span> : <>Both coins read the same market (<code>{d.pair.selectorKey}</code>) with opposite rules, so each result burns exactly one side. A voided market burns neither.</>} The receipts are the scoreboard.</p></header>

      {/* ---- TOP, for each side: the chart, one outbound link to Raydium, and a static read of the curve. No order panel. ---- */}
      <section className="grid gap-3 md:grid-cols-2" aria-label="Both coins">{sides.map(([s, side, tc]) => {
        const m = s.status.market ?? null, trade = raydiumLink(m?.trade);
        const curve = m?.curve ?? tc;
        return (
          <div key={side} className={card + " min-w-0 space-y-2"} data-pair-side={side}>
            <div className="flex items-baseline justify-between gap-2"><h2 className="font-medium"><Link className="underline" href={`/burnticker/t/${s.status.ticker}`}>${s.status.ticker}</Link> <span className="text-neutral-400 font-normal">{s.status.name}</span></h2><span className="text-xs text-neutral-500">side {side}</span></div>
            {m?.chart.embedUrl ? <iframe title={`${s.status.ticker} chart on GeckoTerminal`} src={m.chart.embedUrl} className="h-64 w-full rounded border border-neutral-800 bg-neutral-950" loading="lazy" referrerPolicy="no-referrer" /> : <p className="text-xs text-neutral-500">{m?.chart.note ?? "This site has not read a pool for this coin, so there is no chart."}</p>}
            {trade ? <a href={trade.url} rel="noopener" target="_blank" className="bt-launch-btn block text-center" data-trade-link>{trade.label} ↗</a> : <p className="rounded border border-dashed border-neutral-700 p-2 text-xs text-neutral-400">{m?.trade.note ?? "The trade link appears once the coin is launched."}</p>}
            <CurveBar c={{ phase: (m?.phase ?? (tc?.phase as "curve" | "migrating" | "graduated" | undefined) ?? null), progressPct: curve?.progressPct ?? (m?.phase === "graduated" ? 100 : null), raised: curve?.raised ?? null, threshold: curve?.threshold ?? null, quote: curve?.quote ?? null, curveNote: m?.curveNote }} />
          </div>
        );
      })}</section>
      <p className="text-xs text-neutral-500">Burnticker never takes an order or holds funds: a swap goes straight to the coin's own Raydium curve or pool. Each link opens Raydium, set to that coin.</p>
      {(t.clause || preBurn) && <div className="text-sm" aria-label="Both or neither">{t.clause && <><span className={`rounded px-2 py-0.5 text-xs ${t.clause.state === "live" ? "bg-emerald-900 text-emerald-200" : t.clause.state === "voided" ? "bg-red-900 text-red-200" : "bg-amber-900 text-amber-200"}`}>{t.clause.state === "live" ? "live" : t.clause.state === "voided" ? "voided" : `waiting on ${t.clause.waitingOn.length === 1 ? `side ${t.clause.waitingOn[0]}` : "both sides"}`}</span> <span className="text-neutral-400 text-xs">Both or neither. Burns start once both coins have a registered pool. If {t.clause.voidBy} ends (UTC) without both, the pair voids.{t.clause.state === "voided" ? " The rule has ended, and both pools wind down over four weeks." : ""}{t.clause.detail ? ` ${t.clause.detail}` : ""}</span> </>}{preBurn && <span className="text-neutral-400 text-xs" data-burns-after-graduation>{BURNS_AFTER_GRADUATION}</span>}</div>}

      <section className={card + " space-y-3"} aria-label="Scoreboard">
        <div className="text-center"><div className="text-xs text-neutral-400">burns</div><div className="text-4xl font-semibold tabular-nums">${A} {t.burnsA} <span className="text-neutral-500 text-2xl">:</span> {t.burnsB} ${B}</div><div className="text-xs text-neutral-500">{count(t.settlements, "result")} so far{t.voids ? `, ${t.voids} of them void` : ""}. Tokens burned {fmt(t.burnedA)} : {fmt(t.burnedB)}.</div></div>
        {t.attesterLine && <div className="text-center text-xs text-neutral-400" aria-label="Attesters">{t.attesterLine}</div>}
        {t.unpaired && <div className="text-center text-xs text-neutral-300" aria-label="Unpaired">This pair was unlinked on {t.unpaired.at.slice(0, 10)} ({t.unpaired.reason}). They are two separate coins now, and nothing moves between them.</div>}
        {t.winnerTakesBurn && <div className="text-center text-xs text-amber-200" aria-label="Burned and forwarded">${A} has burned {fmt(t.burnedA)} and ${B} has burned {fmt(t.burnedB)}. ${A} has forwarded {t.forwardedAtoB ?? "0"} SOL to ${B}, and ${B} has forwarded {t.forwardedBtoA ?? "0"} SOL to ${A}.</div>}
        {t.winnerTakesBurn && <div className="text-center text-xs text-amber-200" aria-label="pair rule">{PAIR_BURN_SENTENCE}</div>}
        <TermNote ids={["receipt", "burnPool"]} />
        <div className="grid md:grid-cols-3 gap-2">
          <div className="rounded border border-neutral-800 p-2"><div className="text-xs text-neutral-400">supply left</div><div className="text-lg tabular-nums">{fixed(t.supplyPctA)}% <span className="text-neutral-500">:</span> {fixed(t.supplyPctB)}%</div><div className="text-xs text-neutral-500 tabular-nums">{fmt(t.supplyA)} : {fmt(t.supplyB)}, out of {fmt(d.a.status.supply.initial)} each</div></div>
          <div className="rounded border border-neutral-800 p-2"><div className="text-xs text-neutral-400">last settlement</div>{ls ? <><div><code>{ls.eventId}</code></div><div className="text-xs text-neutral-500">It settled {(ls.result ?? ls.value ?? "—").toUpperCase()} at {ls.settledAt.slice(0, 16).replace("T", " ")}Z, and {ls.burnedSide ? `${sideName(ls.burnedSide)} burned${ls.burned ? ` ${fmt(ls.burned)} tokens` : ""}` : "neither side burned"}.</div></> : <div className="text-xs text-neutral-500">None yet. The first result after launch burns one side.</div>}</div>
          <div className="rounded border border-neutral-800 p-2"><div className="text-xs text-neutral-400">next scheduled market</div>{t.next.market ? <div><code>{t.next.market}</code></div> : <div>—</div>}</div>
        </div>
      </section>

      {/* ---- TABS: Burn log first, then Rule, then Holders when either side's holders were read. No thread. ---- */}
      <div className="bt-tabs" role="tablist" aria-label="About this pair">
        {tabs.map((x) => <button key={x} id={`tab-${x}`} type="button" role="tab" aria-selected={tab === x} aria-controls={`panel-${x}`} className={`bt-tab${tab === x ? " is-active" : ""}`} onClick={() => setTab(x)}>{COIN_TAB_LABEL[x]}</button>)}
      </div>

      <div id="panel-burns" role="tabpanel" aria-labelledby="tab-burns" hidden={tab !== "burns"} className="space-y-6">
        {/* Burn Derby (2026-10-10): the running score (a receipt tally), the day-by-day strip with both readings, the season end, proof links. */}
        {d.derby && (
          <section className={card + " space-y-3"} aria-label="Burn Derby">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-medium">Burn Derby: {d.derby.pair.symbols.a}{d.derby.pair.symbols.b ? ` vs ${d.derby.pair.symbols.b}` : ""} <span className="text-xs text-neutral-500">({d.derby.pair.window}{d.derby.pair.flip ? ", one-shot flippening" : d.derby.pair.measure === "mcap" ? ", market-cap change" : ""})</span></h2><span className="text-xs text-neutral-400">The season ends {d.derby.pair.season.endsOn}. {d.derby.pair.season.windowsDone} of {d.derby.pair.season.windows} windows are read.</span></div>
            <div className="text-center text-3xl font-semibold tabular-nums">{d.derby.pair.symbols.a} {d.derby.pair.score.a} <span className="text-neutral-500 text-xl">–</span> {d.derby.pair.score.b} {d.derby.pair.symbols.b}<div className="text-xs text-neutral-500 font-normal">{count(d.derby.pair.score.ties, "tie")} and {d.derby.pair.score.withheld} withheld, on day {d.derby.pair.score.dayNumber}</div></div>
            {d.derby.pair.forwarded && d.derby.pair.forwarded.windows > 0 && <p className="text-center text-xs text-amber-200">Winner takes the burn. Over {count(d.derby.pair.forwarded.windows, "lost window")}, ${A} has forwarded {d.derby.pair.forwarded.aToB} SOL to ${B}, and ${B} has forwarded {d.derby.pair.forwarded.bToA} SOL to ${A}.</p>}
            {(d.derby.pair.retired.a || d.derby.pair.retired.b) && <p className="text-xs text-amber-300">{d.derby.pair.retired.a ? `$${A} retired: ${d.derby.pair.retired.a}. ` : ""}{d.derby.pair.retired.b ? `$${B} retired: ${d.derby.pair.retired.b}.` : ""} There are no more readings.</p>}
            <div className="flex flex-wrap gap-1" aria-label="Day strip">{d.derby.pair.days.map((x) => <span key={x.windowId} title={`${x.windowId}: ${x.a.symbol} ${pctFmt(x.a.changePct)}${x.b ? ` vs ${x.b.symbol} ${pctFmt(x.b.changePct)}` : ""}${x.reason ? ` — ${x.reason}` : ""}`} className={`inline-flex h-7 min-w-7 items-center justify-center rounded px-1 text-[11px] ${x.status === "withheld" ? "bg-neutral-800 text-neutral-400" : x.winner === "A" ? "bg-amber-500 text-neutral-950" : x.winner === "B" ? "bg-sky-500 text-neutral-950" : "bg-neutral-700"}`}>{x.status === "withheld" ? "–" : x.winner === "tie" ? "=" : x.winner ?? x.day}</span>)}</div>
            <div className="overflow-x-auto rounded border border-neutral-800"><table className="w-full text-xs"><thead className="text-neutral-400 text-left"><tr><th className="p-2">Day</th><th className="p-2">Window</th><th className="p-2">{d.derby.pair.symbols.a}</th>{d.derby.pair.symbols.b && <th className="p-2">{d.derby.pair.symbols.b}</th>}<th className="p-2">Result</th><th className="p-2">Proof</th></tr></thead>
              <tbody>{[...d.derby.pair.days].reverse().map((x) => <tr key={x.windowId} className="border-t border-neutral-800 align-top"><td className="p-2">{x.day}</td><td className="p-2">{x.windowId}</td><td className="p-2 tabular-nums">{pctFmt(x.a.changePct)}</td>{x.b && <td className="p-2 tabular-nums">{pctFmt(x.b.changePct)}</td>}<td className="p-2">{x.status === "withheld" ? <span className="text-neutral-400" title={x.reason ?? ""}>withheld, no burn</span> : x.winner === "A" ? `$${A} burns` : x.winner === "B" ? `$${B} burns` : x.winner === "tie" ? "tie, no burn" : "read"}</td><td className="p-2 space-y-0.5">{x.proof.map((pl) => <div key={pl.label}>{pl.url ? <a className="underline" href={pl.url}>{pl.label}</a> : pl.label} <span className="text-neutral-500">{pl.detail}</span></div>)}</td></tr>)}</tbody></table></div>
            {d.derby.post && <pre className="whitespace-pre-wrap break-words text-xs bg-neutral-950 border border-neutral-800 rounded p-2">{d.derby.post}</pre>}
            <p className="text-xs text-neutral-500">{d.derby.pair.note}. Readings come from Pyth (its Solana account, or a Hermes update with a key) or from a pool&apos;s time-weighted average (TWAP). A second data publisher cross-checks each one. One signer, run by the operator, signs every reading.</p>
          </section>
        )}
        {receiptsTable(d.a)}
        {receiptsTable(d.b)}
      </div>

      <div id="panel-rule" role="tabpanel" aria-labelledby="tab-rule" hidden={tab !== "rule"} className="space-y-6">
        {/* website brief §2: where the money goes, labelled by the pair's rule version */}
        {!t.unpaired && <PairFundsFlow version={pairRuleVersion(!!t.winnerTakesBurn)} tickers={{ a: A, b: B }} />}
        <section className="grid md:grid-cols-2 gap-3">{([[d.a, "A"], [d.b, "B"]] as const).map(([s, side]) => { const f = ruleFacts(s.rulesText ?? "", !!s.status.rules.oneShot); return (
          <div className={card + " bt-rule-card"} key={side}><div className="text-xs text-neutral-400">side {side}, locked at launch</div><h2 className="font-medium"><Link className="underline" href={`/burnticker/t/${s.status.ticker}`}>${s.status.ticker}</Link> <span className="text-neutral-400 font-normal">{s.status.name}</span></h2><p className="text-xs text-neutral-300 mt-1">{s.status.rules.statement}</p>
            <dl className="mt-2 space-y-1 text-xs"><div><dt className="inline text-neutral-500">The dial. </dt><dd className="inline">{f.dial ?? "The rule file does not name a share of the burn pool."}</dd></div><div><dt className="inline text-neutral-500">The window. </dt><dd className="inline">{f.window}</dd></div><div><dt className="inline text-neutral-500">The end. </dt><dd className="inline">{f.end}</dd></div></dl>
            <p className="text-xs text-neutral-500 mt-1 break-all">Rule hash (sha256): {s.status.rules.sha256}</p>{s.status.lp && <LpLine lp={s.status.lp} />}</div>
        ); })}</section>
        {d.a.status.disclosure?.eventContract && <p className={card + " border-l-4 border-l-orange-500 text-xs"}>{d.a.status.disclosure.eventContract}</p>}
        {/* the rule's own footer line (rules.ts DISCLAIMER_FOOTER); the site's disclaimers live once, in the footer */}
        {d.a.status.disclosure?.disclaimer && <p className="text-xs text-neutral-500" data-rule-footer>{d.a.status.disclosure.disclaimer}</p>}
      </div>

      {hasHolders && (
        <div id="panel-holders" role="tabpanel" aria-labelledby="tab-holders" hidden={tab !== "holders"}>
          <section className="grid md:grid-cols-2 gap-3">{sides.map(([s, side]) => { const h = s.status.market?.holders; return (
            <div key={side} className={card} aria-label={`Holders of ${s.status.ticker}`}><h2 className="font-medium">The largest holders of ${s.status.ticker}</h2>
              {h?.top?.length ? <ol className="mt-2 space-y-0.5 text-xs">{h.top.slice(0, 20).map((x, i) => <li key={x.account} className="flex justify-between gap-2 font-mono"><span className="min-w-0 truncate">{i + 1}. {(x.owner ?? x.account).slice(0, 4)}…{(x.owner ?? x.account).slice(-4)}{x.label ? <span className="ml-1 text-neutral-500">({x.label})</span> : null}</span><span className="tabular-nums">{fixed(x.pct)}%</span></li>)}</ol> : null}
              <p className="mt-2 text-xs text-neutral-500">{h?.topNote ?? "The holders were not read."}</p></div>
          ); })}</section>
        </div>
      )}

      <section className={card}>
        <div className="flex items-center justify-between gap-2"><h2 className="font-medium">Share line</h2><button className="text-xs underline" onClick={() => { navigator.clipboard?.writeText(d.share).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? "copied" : "copy"}</button></div>
        <pre className="mt-2 whitespace-pre-wrap break-words text-xs bg-neutral-950 border border-neutral-800 rounded p-2">{d.share}</pre>
        <p className="text-xs text-neutral-500 mt-1">These are the same words as the pair&apos;s post. They report the tally and are never retyped.</p>
      </section>
      {d.a.status.status !== "draft" && d.b.status.status !== "draft" && <EmbedSnippet kind="pair" id={d.pair.pairId} label={`$${A} vs $${B}`} />}
      <HostDiagnostics stubs={d.stubs} />
    </main>
  );
}

/** LP locked forever (2026-10-10): each side's lock, Fee Key and owner (Solscan), and its last LP-fee claim. */
function LpLine({ lp }: { lp: NonNullable<Side["status"]["lp"]> }) {
  const a = (addr: string | null, url: string | null, empty: string) => (addr ? (url ? <a className="underline font-mono" href={url}>{addr.slice(0, 4)}…{addr.slice(-4)}</a> : <span className="font-mono">{addr.slice(0, 4)}…{addr.slice(-4)}</span>) : <span>{empty}</span>);
  return (
    <div className="text-xs text-neutral-400 mt-2">
      <p className="font-mono uppercase tracking-widest text-[11px]">Liquidity locked forever</p>
      <p className="mt-1">{lp.lockedPct}% of the liquidity is locked. Its fees go {lp.split.burnBps / 100}% to the burn pool and {lp.split.operatorBps / 100}% to the operator, fixed in code. The lock program is {a(lp.lockProgram, lp.urls.lockProgram, "not known")}. The Fee Key is {a(lp.feeKey, lp.urls.feeKey, "shown at graduation")}, and its owner is {a(lp.feeKeyOwner, lp.urls.feeKeyOwner, "not known")}.</p>
      {lp.lastClaim && <p className="mt-1">{lp.lastClaim.txUrl ? <a className="underline" href={lp.lastClaim.txUrl}>{lp.lastClaim.line}</a> : lp.lastClaim.line}</p>}
    </div>
  );
}
