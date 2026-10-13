"use client";

import { safeCreatorLink } from "@/lib/burnticker/creatorProfile";
import { REHEARSAL_SENTENCE } from "@/lib/burnticker/rehearsalCopy";
import { useEffect, useState } from "react";
import { HostDiagnostics } from "../../_components/HostDiagnostics";
import Link from "next/link";
import { useLaunchAvailability } from "../../_components/useLaunchAvailability";
import { DEFICIT_SITE } from "@/lib/burnticker/creatorLaunches";
import { DeficitPrelaunch } from "./DeficitPrelaunch";
import { EmptyState } from "../../_components/EmptyState";
import { ReadinessPanel } from "../../_components/ReadinessPanel";
import { readinessFromStatus } from "@/lib/burnticker/readiness";
import { FIRST_BURN_PATH_URL } from "@/lib/burnticker/currentStatusLinks";
import { receiptRowStatus } from "@/lib/burnticker/verificationStatus";
import { useParams } from "next/navigation";
import { CoinThumb, CurveBar, VenueChip, ago } from "../../_components/CoinCard";
import { COIN_TAB_LABEL, burnsAfterGraduation, checkReceiptHref, coinTabs, holdersShareLine, initialTab, marketFacts, raydiumLink, ruleFacts, type CoinTab, type FactRow } from "@/lib/burnticker/coinPage";
import { useHome } from "../../_components/useHome";
import { QueuePanel } from "../../_components/QueuePanel";
import { ProgressStrip } from "../../_components/ProgressStrip";
import { RetirementFacts } from "../../_components/RetirementFacts";
import { progressOf } from "@/lib/burnticker/progress";
import { EVENT_LABEL, eventsFromStatus } from "@/lib/burnticker/activity";
import { PinnedCheck, type PinnedView } from "../../_components/PinnedCheck";
import { createdBy, creatorHref, SHARE_COPY } from "@/lib/burnticker/creatorBenefits";
import { shortAddress } from "@/lib/burnticker/walletShell";
import { RANK_MEANING } from "@/lib/burnticker/cardView";
import { ShareBlock } from "../../creator/ShareBlock";
import { SETTLEMENT_LINK } from "@/lib/burnticker/settlementCopy";
import { likeHref } from "@/lib/burnticker/templates";
import { postGraduationShareLine } from "@/lib/burnticker/feeShareLine";
import { PERPETUAL_SENTENCE } from "@/lib/burnticker/describe";
import { COIN_FEED_LINK, CSV_LINK_COPY, csvHref, feedHref } from "@/lib/burnticker/exportLinks";
import type { LifecycleDatesJson, PoolMarketJson, StatedJson } from "@/lib/burnticker/pageTypes";
import { statedSentences } from "@/lib/burnticker/sources/polyStated";
import { CHOOSER_COPY, chooserRows, isMintKey, type CoinCandidate } from "@/lib/burnticker/coinKey";

/**
 * THE COIN PAGE (LAUNCHPAD-PATH §6; re-ordered by website-11 on 2026-10-12 for the owner's review items 6 and 8, as the website brief
 * rewrites them; src/lib/burnticker/coinPage.ts holds the order). The header: image, name, $TICKER, the mint with a copy button and the
 * creator's links. ON TOP: the chart (GeckoTerminal's embed of the pool that trades now when one is indexed, else Burnticker's own
 * readings chart with burn markers) and beside it ONE outbound link, "Trade on Raydium", to this coin on Raydium. Burnticker never
 * takes an order, so there is no buy or sell panel. Beside the link: a static read of the pool (the curve as SOL raised of the
 * graduation threshold) and the readiness state, which says in plain words that burns begin after graduation and pool registration.
 * THEN THE TABS, in this order: "Burn log" (the receipts, each with "Check receipt" to the in-browser verifier, and verify-it-yourself),
 * "Rule" (the locked rule text, its hash, the dial, the window and the end, the fees, signers and addresses), and "Holders" only when
 * holder data was read. There is no thread, and nothing counts down. The site's disclaimers live once, in the footer.
 */
type Link_ = { label: string; url: string };
interface Market { phase: "curve" | "migrating" | "graduated" | null; curve: { raised: string; threshold: string; remaining: string; quote: string; progressPct: number; poolId: string; marketCap?: string | null } | null; curveNote: string; graduatedPool: string | null; holders: { count: number | null; countNote: string; top: { account: string; owner: string | null; amount: string; pct: number; label: string | null }[] | null; topNote: string; top10?: { owner: string; amount: string; pct: number | null; label: string | null }[] | null; top10Pct?: number | null; top10PctUnlabelled?: number | null }; pool?: PoolMarketJson | null; poolNote?: string; dates?: LifecycleDatesJson | null; trade: { links: { id: string; label: string; url: string }[]; note: string | null }; chart: { provider: string | null; embedUrl: string | null; pageUrl: string | null; note: string }; readAt: string | null; error: string | null }
interface Status { program?: { initialized: boolean } | null; ticker: string; name: string; mint: string; cluster: string; status: string; launchedAt: string | null; oracle: string; selectorKey: string; seriesTitle: string | null; mode: string; rules: { sha256: string; sha12: string; statement: string; oneShot: boolean }; addresses: { mint: string; mintUrl: string; feePda: string; feePdaUrl: string; feeWsol: string | null; feeWsolUrl: string | null; vault: string | null; vaultUrl: string | null; creator: string; creatorUrl: string; programId: string; poolId: string | null; launchTx: string | null; launchTxUrl: string | null }; supply: { initial: string; current: string; source: string }; burned: { total: string; pctOfSupply: number; count: number; last30d: string; lastAt?: string | null }; pool: { feePdaSol: string | null; spendableSol: string | null; reserveSol: string; vaultBalance: string | null; vaultAllocation: string | null; shortfallOutstanding: string }; next: { nextCheckAt: string | null; impliedChance: number | null; impliedBasis: string | null; nextMarket: string | null; nextCloseTime: string | null; awaitingFinal: number }; feed: { lastEventId: string | null; lastValue: string | null; lastSettledAt: string | null; readings: number; lastFetchAt: string | null; lastError: string | null }; attesters: { pubkey: string; role: string; active: boolean }[]; quorum: number; fees: { sentence: string; curve: { legs: { label: string; bps: number; recipient: string; dial: string }[]; totalBps: number }; postGraduation: { legs: { label: string; bps: number; recipient: string; dial: string }[]; totalBps: number } }; health: { pending: number; unverified: number; lastError: string | null }; disclosure: { disclaimer: string; eventContract: string | null }; trust: { lpBurnedPct: number; lpLockedPct?: number; creatorCashBps: number; teamAllocationPct: number; operator: { can: string[]; cannot: string[]; placeholder: boolean }; registerUrl: string }; lp?: LpBlock | null; profile?: { imageUrl: string | null; description: string; links: Link_[]; oneLiner: string; badge?: string; note?: string; affiliation?: string }; pinned?: PinnedView | null; market?: Market; pair: { pairId: string; side: "A" | "B"; counterpart: { ticker: string; name: string }; tally: { burnsThis: number; burnsOther: number }; pageUrl: string } | null }
interface Receipt { eventId: string; settledAt: string; oracle: string; market: string; result: string | null; value: string | null; title: string | null; method: string | null; sourceUrl: string | null; settlementSourceUrl: string | null; units: number; status: string; skippedReason: string | null; spent: string | null; got: string | null; burned: string | null; memo: string | null; signature: string | null; txUrl: string | null; verify: { curl: string; formula: string; expected: string; checks: string[]; verified: boolean } }
/** status.json `lp` (LP locked forever, 2026-10-10; src/lib/burnticker/lockFees.ts LpLockJson). */
interface LpBlock { policy: string; lockProgram: string; feeKey: string | null; feeKeyOwner: string | null; lockedLiquidity: string | null; lockedPct: number; split: { burnBps: number; operatorBps: number }; operatorTreasury: string | null; lastClaim: { at: string; line: string; txUrl: string | null } | null; totals: { claims: number; sol: string; toBurnPool: string; toOperator: string }; urls: { lockProgram: string | null; feeKey: string | null; feeKeyOwner: string | null; lockedLiquidity: string | null; operatorTreasury: string | null }; line: string; note: string | null }
interface Reading { id: string; at: string; result: string | null; value: string | null; title: string | null }
interface Data { status: Status & { lifecycle?: { line: string } | null; stated?: StatedJson | null }; receipts: Receipt[]; readings: Reading[]; rulesText: string; stubs: string[] }

const fmt = (s: string) => { const [w, f] = s.split("."); return w.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? `.${f}` : ""); };
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
/** "1 burn" / "3 burns": a count with the right noun. */
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Chart({ readings, receipts }: { readings: Reading[]; receipts: Receipt[] }) {
  const pts = readings.filter((r) => r.value !== null);
  if (pts.length < 2) return <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-neutral-800 text-xs text-neutral-500 px-4 text-center">{readings.length ? `${readings.length === 1 ? "One settled result has" : `${readings.length} settled results have`} been read: ${readings.filter((r) => r.result === "yes").length} YES and ${readings.filter((r) => r.result === "no").length} NO. A line chart appears once the source publishes numbers.` : "The chart of settled readings appears after the second reading."}</div>;
  const W = 720, H = 240, L = 56, R = 10, T = 10, B = 24;
  const ys = pts.map((p) => Number(p.value));
  const yMin = Math.min(...ys), yMax = Math.max(...ys), pad = (yMax - yMin) * 0.06 || 1;
  const sx = (i: number) => L + (i / Math.max(1, pts.length - 1)) * (W - L - R), sy = (v: number) => T + (1 - (v - (yMin - pad)) / (yMax - yMin + 2 * pad)) * (H - T - B);
  const burnsBy = new Map(receipts.filter((b) => b.status === "confirmed").map((b) => [b.eventId, b.units]));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-neutral-800 bg-neutral-900" role="img" aria-label="settled readings with burn markers">
      <polyline fill="none" stroke="currentColor" className="text-neutral-200" strokeWidth={1.5} points={pts.map((_, i) => `${sx(i).toFixed(1)},${sy(ys[i]).toFixed(1)}`).join(" ")} />
      {pts.map((p, i) => burnsBy.has(p.id) ? <circle key={p.id} cx={sx(i)} cy={sy(ys[i])} r={2 + Math.sqrt(burnsBy.get(p.id)!)} fill="#c8873a" fillOpacity={0.85}><title>{`${p.id}: ${count(burnsBy.get(p.id)!, "unit")} burned`}</title></circle> : null)}
      <text x={L - 4} y={sy(yMax) + 4} textAnchor="end" className="fill-neutral-400" fontSize={10}>{yMax}</text><text x={L - 4} y={sy(yMin) + 4} textAnchor="end" className="fill-neutral-400" fontSize={10}>{yMin}</text>
      <text x={L} y={H - 6} className="fill-neutral-400" fontSize={10}>{pts[0].id}</text><text x={W - R} y={H - 6} textAnchor="end" className="fill-neutral-400" fontSize={10}>{pts[pts.length - 1].id}</text>
    </svg>
  );
}

/** A fact list: label, value (a dash with the reason when this site did not read it), and the meaning or reason as small print. */
function Facts({ rows, label }: { rows: FactRow[]; label: string }) {
  return (
    <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2" aria-label={label}>
      {rows.map((r) => (
        <div key={r.key} data-fact={r.key} className="min-w-0">
          <dt className="text-neutral-500">{r.label}</dt>
          <dd className="break-all text-neutral-100">{r.href && r.value ? <a className="underline" href={r.href} rel="noopener" target="_blank">{r.value}</a> : r.value ?? "—"}</dd>
          {r.note && <dd className="text-[11px] text-neutral-500">{r.note}</dd>}
          {r.more && <dd className="text-[11px]"><Link className="underline" href={r.more.href}>{r.more.label}</Link></dd>}
        </div>
      ))}
    </dl>
  );
}

function CopyButton({ text, label = "copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="bt-copy" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => setDone(false)); }} aria-label={`Copy ${label}`}>{done ? "copied" : label}</button>;
}

export default function TokenPage() {
  const { ticker } = useParams<{ ticker: string }>();
  const [d, setD] = useState<Data | null>(null);
  const launch = useLaunchAvailability();
  const home = useHome();
  const [err, setErr] = useState<string | null>(null);
  // the time the page was read; "launched 3d ago" and "last burn 2h ago" are past records, and nothing on this page counts down
  const [now] = useState(() => Date.now());
  const [tab, setTab] = useState<CoinTab>("burns");
  // owner 2026-10-12, tickers are not unique: the segment is a mint or a ticker, and a ticker several coins share answers 300 with the coins
  const [choices, setChoices] = useState<{ ticker: string; candidates: CoinCandidate[] } | null>(null);
  useEffect(() => { fetch(`/api/burnticker/tokens/${encodeURIComponent(ticker)}`).then(async (r) => { const j = await r.json(); if (r.status === 300) { setChoices(j); return; } if (!r.ok) throw new Error(j.error ?? r.statusText); setD(j); }).catch((e) => setErr(String(e.message ?? e))); }, [ticker]);
  // website-17 wiring item 1: the rank line from the creator summary; nothing when the read fails (never a guessed rank)
  const [rank, setRank] = useState<string | null>(null);
  useEffect(() => { const c = d?.status.addresses.creator, t = d?.status.ticker; if (!c || !t) return; fetch(`/burnticker/creator/${encodeURIComponent(c)}/summary`).then((r) => (r.ok ? r.json() : null)).then((j: { coins?: { ticker: string; rank: string | null }[] } | null) => setRank(j?.coins?.find((x) => x.ticker === t)?.rank ?? null)).catch(() => setRank(null)); }, [d]);
  const hasHolders = !!d?.status.market?.holders.top10?.length;
  useEffect(() => { if (d) setTab(initialTab(window.location.hash, coinTabs(hasHolders))); }, [d, hasHolders]);
  // review 2 §2: a ticker this host has no record of explains itself (and $DEFICIT links its served page) instead of a bare error line
  if (choices) return <TickerChooser ticker={choices.ticker} candidates={choices.candidates} />;
  if (err) return /no token/i.test(err) ? <NotRegistered ticker={ticker} /> : <main className="mx-auto max-w-3xl px-4 py-6"><EmptyState kind="unavailable" body={`The page for $${ticker.toUpperCase()} could not be read just now.`} details={err} /></main>;
  if (!d) return <main className="mx-auto max-w-3xl px-4 py-6"><EmptyState kind="loading" /></main>;
  const s = d.status, m = s.market, prof = s.profile;
  // the coin's own links: by mint when it was opened by its mint, else by its ticker (one coin holds it, or the API would have listed several)
  const key = isMintKey(ticker) ? ticker : s.ticker;
  const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
  const rows = [...d.receipts].reverse();
  const venue = s.oracle === "kalshi" ? "the prediction market that settles it" : s.oracle === "polymarket" ? "Polymarket, with each result read on Polygon" : "the source's own published data";
  const trade = raydiumLink(m?.trade);
  const facts = ruleFacts(d.rulesText, s.rules.oneShot);
  const tabs = coinTabs(hasHolders);
  const ready = readinessFromStatus(s as unknown as Parameters<typeof readinessFromStatus>[0], d.receipts as unknown as Parameters<typeof readinessFromStatus>[1]);
  // readiness.ts decides: a coin on its curve, or graduated with its pool not yet registered, cannot burn yet
  const preBurn = ready.state === "on-curve" || ready.state === "awaiting-registration";
  const afterGraduation = burnsAfterGraduation(m?.curve?.threshold ?? null, m?.curve?.quote ?? "SOL");
  // ChatGPT audit 6 A10: the market facts this site read, and Burnticker's own facts, equally legible; a dash with a reason for the rest
  const market = marketFacts({ cluster: s.cluster, status: s.status, mint: s.mint, mintUrl: s.addresses.mintUrl, creator: s.addresses.creator, creatorUrl: s.addresses.creatorUrl, launchedAt: s.launchedAt, phase: m?.phase ?? null, curve: m?.curve ?? null, curveNote: m?.curveNote ?? null, graduatedPool: m?.graduatedPool ?? null, holdersCount: m?.holders.count ?? null, holdersNote: m?.holders.countNote ?? "This site has not read the holders.", pool: m?.pool ?? null, poolNote: m?.poolNote ?? null, dates: m?.dates ?? null, feesCurveBps: s.fees.curve.totalBps, feesPoolBps: s.fees.postGraduation.totalBps, readAt: m?.readAt ?? null });
  const latest = [...d.receipts].filter((r) => r.status === "confirmed" && r.signature).sort((a, b) => b.settledAt.localeCompare(a.settledAt))[0] ?? null;
  const nextAt = s.next.nextCloseTime ?? s.next.nextCheckAt;
  const burnFacts: FactRow[] = [
    { key: "trigger", label: "What fires the rule", value: prof?.oneLiner ?? s.seriesTitle ?? s.selectorKey, note: latest?.settlementSourceUrl ? "The source of the latest result is linked." : `Read from ${venue}.`, href: latest?.settlementSourceUrl ?? null },
    { key: "next", label: "Next result", value: nextAt ? `${nextAt.slice(0, 16).replace("T", " ")} UTC` : "None scheduled", note: nextAt ? "Times are in UTC. The source publishes the result after this." : "This rule has no scheduled result this site knows of.", more: SETTLEMENT_LINK },
    { key: "budget", label: "Burn pool", value: s.mode === "buyback" ? (s.pool.feePdaSol === null ? "Not read here" : `${s.pool.feePdaSol} SOL`) : (s.pool.vaultBalance === null ? "Not read here" : fmt(s.pool.vaultBalance)), note: s.mode === "buyback" ? `SOL set aside for this coin's burns. ${s.pool.reserveSol} SOL of it is kept back for fees.` : "Tokens set aside for this coin's burns." },
    { key: "burned", label: "Burned so far", value: `${fmt(s.burned.total)} of ${fmt(s.supply.initial)} tokens`, note: `${s.burned.pctOfSupply.toFixed(2)}% of the supply, in ${count(s.burned.count, "burn")}.` },
    { key: "last", label: "Last receipt", value: latest ? latest.settledAt.slice(0, 10) : "None yet", note: latest ? "Check it in your browser." : preBurn ? afterGraduation : "The next result that counts prints the first one.", href: latest ? checkReceiptHref(latest.signature, s.cluster) : null },
    { key: "pending", label: "Waiting", value: s.health.pending === 0 ? "Nothing waiting" : count(s.health.pending, "receipt"), note: s.health.pending ? "A burn can wait for the pool's checks or a spend floor. The unspent funds stay in the burn pool." : null },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 py-5 space-y-5 text-sm">
      <p className="text-xs"><Link className="underline" href="/burnticker">← Coins</Link></p>

      {/* ---- header: image, name, ticker, mint + copy, links ---- */}
      <header className="flex gap-4">
        <CoinThumb src={prof?.imageUrl ?? null} ticker={s.ticker} size={72} generated />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5"><VenueChip oracle={s.oracle} />{m?.phase === "graduated" && <span className="bt-chip bt-chip-grad">graduated</span>}{s.status !== "live" && <span className="bt-chip bt-chip-draft">{s.status}</span>}{prof?.badge && <span className="bt-chip bt-chip-window" title="the coin's window, fixed in its rule">{prof.badge}</span>}<span className="text-xs text-neutral-500">{s.cluster}, {s.launchedAt ? `launched ${ago(s.launchedAt, now)}` : "not launched"}</span></div>
          <h1 className="text-2xl font-semibold leading-tight">{s.name} <span className="font-mono text-lg text-neutral-400">${s.ticker}</span></h1>
          <p className="text-neutral-300">{prof?.oneLiner ?? s.seriesTitle ?? s.selectorKey}</p>
          <p className="text-xs"><Link className="underline" href={creatorHref(s.addresses.creator)} data-created-by>{createdBy(shortAddress(s.addresses.creator))}</Link></p>
          {s.stated && <p className="text-xs text-neutral-400" data-stated>{statedSentences(s.stated, s.stated.finalAfter)}</p>}
          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
            <span className="font-mono" title={s.mint}>CA {short(s.mint)}</span><CopyButton text={s.mint} label="copy address" />
            {/* growth batch: the program's own word on this mint (verifyMint.ts) — the verifier page answers for any mint */}
            {s.program?.initialized ? <Link className="bt-chip bt-chip-grad" href={`/burnticker/verify?mint=${s.mint}`} title="The burn program has a record for this coin.">verified by program · mint {short(s.mint)}</Link> : <Link className="underline" href={`/burnticker/verify?mint=${s.mint}`} title="This site has not read the burn program's record for this coin.">check this coin</Link>}
            {(prof?.links ?? []).filter(safeCreatorLink).map((l) => <a key={l.url} href={l.url} rel="noopener noreferrer nofollow ugc" target="_blank" className="underline">{l.label}</a>)}
          </div>
          {prof?.description && <p className="text-sm text-neutral-200 max-w-2xl leading-relaxed whitespace-pre-line" data-coin-description>{prof.description}</p>}
          {prof?.note && <div className="max-w-2xl rounded border border-neutral-700 p-2 text-xs text-neutral-300"><div className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">creator&apos;s note (not part of the rule)</div>{prof.note}</div>}
          <p className="text-xs text-neutral-500">{prof?.affiliation ?? "This coin is not affiliated with any team, league, candidate, agency or market."}</p>
          {launch.open && <p><Link className="inline-block rounded border border-neutral-700 px-2 py-1 text-xs hover:border-amber-400" href={likeHref(s.ticker)}>Launch one like this →</Link> <Link className="text-xs underline text-neutral-400" href="/burnticker/templates">all templates</Link></p>}
          <PinnedCheck pinned={s.pinned} />
        </div>
      </header>

      {s.pair && <Link href={s.pair.pageUrl} className={card + " block"}><span className="text-xs text-neutral-400">This coin is one side of a rivalry pair. Burns so far:</span> <span className="font-mono">${s.ticker} {s.pair.tally.burnsThis} : {s.pair.tally.burnsOther} ${s.pair.counterpart.ticker}</span> <span className="text-xs underline">Open the pair page</span></Link>}

      {/* ---- TOP (review item 6 as the website brief rewrites it): the chart, and one outbound link to the coin's own pool. No order panel. ---- */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="Chart" className="min-w-0">
          {m?.chart.embedUrl ? (
            <>
              <iframe title={`${s.ticker} chart on GeckoTerminal`} src={m.chart.embedUrl} className="h-[420px] w-full rounded-lg border border-neutral-800 bg-neutral-900" loading="lazy" referrerPolicy="no-referrer" allow="clipboard-write" />
              <p className="mt-1 text-xs text-neutral-500">{m.chart.note}{m.chart.pageUrl && <> <a className="underline" href={m.chart.pageUrl} rel="noopener" target="_blank">Open this chart on GeckoTerminal.</a></>}</p>
            </>
          ) : (
            <>
              <div className="mb-1 flex items-baseline justify-between gap-2"><h2 className="font-medium">{s.seriesTitle ?? s.selectorKey}</h2><span className="text-xs text-neutral-500">Dots mark burns.</span></div>
              <Chart readings={d.readings} receipts={d.receipts} />
              <p className="mt-1 text-xs text-neutral-500">These are settled readings from {venue}.{s.feed.lastEventId ? ` The latest is ${s.feed.lastValue ? `${s.feed.lastValue} for ` : ""}${s.feed.lastEventId}.` : ""}{m?.chart.note ? ` ${m.chart.note}${/[.!?]$/.test(m.chart.note) ? "" : "."}` : ""}</p>
            </>
          )}
        </section>

        <aside className="space-y-3 lg:self-start" aria-label="Trade and pool">
          <section className={card} aria-label="Trade">
            <p className="mb-2 text-xs text-neutral-400" data-fees-before-trade>Each trade pays {s.fees.curve.totalBps / 100}% on the curve and {s.fees.postGraduation.totalBps / 100}% in the Raydium pool. Raydium shows how far your trade moves the pool, and your slippage setting, before you sign.</p>
            {trade ? <a href={trade.url} rel="noopener" target="_blank" className="bt-launch-btn block text-center" data-trade-link>{trade.label} ↗</a>
              : <p className="rounded border border-dashed border-neutral-700 p-2 text-xs text-neutral-400">{m?.trade.note ?? "The trade link appears once the coin is launched."}</p>}
            <p className="mt-2 text-xs text-neutral-500">Burnticker never takes an order and has no swap of its own. {trade ? `This link opens Raydium, set to $${s.ticker}.` : ""}</p>
          </section>

          {/* a static read of the pool, from the API: the curve as SOL raised of the graduation threshold, or the pool it trades in now */}
          <section className={card} aria-label="Pool">
            <CurveBar c={{ phase: m?.phase ?? null, progressPct: m?.curve?.progressPct ?? (m?.phase === "graduated" ? 100 : null), raised: m?.curve?.raised ?? null, threshold: m?.curve?.threshold ?? null, quote: m?.curve?.quote ?? null, curveNote: m?.curveNote }} />
            <p className="mt-2 text-xs text-neutral-400">{m?.phase === "graduated" ? `The bonding curve is complete. At graduation, all of the liquidity was locked forever. $${s.ticker} now trades in a Raydium pool${m.graduatedPool ? ` (${short(m.graduatedPool)})` : ""}.` : m?.curve ? `${Number(m.curve.remaining).toFixed(2)} ${m.curve.quote} to go before graduation. When the curve fills, the coin moves to a Raydium pool and its liquidity is locked forever. The pool's fees fund the burn.` : <span title={m?.curveNote}>{m?.curveNote ?? "The curve has not been read."}</span>}</p>
            {preBurn && <p className="mt-2 text-xs text-neutral-300" data-burns-after-graduation>{afterGraduation}</p>}
            <p className="mt-2 text-[11px] text-neutral-500">{m?.readAt ? `This site read the pool at ${m.readAt.slice(11, 16)} UTC.` : "This site has not read the pool."} {(100 - s.burned.pctOfSupply).toFixed(2)}% of the supply is left.</p>
          </section>

          <section className={card} aria-label="Progress"><h2 className="mb-2 text-xs font-mono uppercase tracking-widest text-neutral-500">Where this coin stands</h2><ProgressStrip p={progressOf(ready, { raiseSol: m?.curve ? Number(m.curve.threshold) : null, raisedSol: m?.curve ? Number(m.curve.raised) : null, queuedUnits: s.ticker === "DEFICIT" && home.data?.deficitQueue.state === "queued" ? home.data.deficitQueue.units : null })} /></section>
          <ReadinessPanel r={ready} firstBurnPathUrl={FIRST_BURN_PATH_URL} />
          {s.ticker === "DEFICIT" && home.data && <QueuePanel q={home.data.deficitQueue} />}
        </aside>
      </div>

      {/* ---- the market facts and the burn facts (ChatGPT audit 6 A10), side by side and equally legible ---- */}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className={card} aria-labelledby="facts-market-h"><h2 id="facts-market-h" className="mb-2 font-medium">The coin</h2><Facts rows={market} label="Market facts" /></section>
        <section className={card} aria-labelledby="facts-burn-h"><h2 id="facts-burn-h" className="mb-2 font-medium">Its burns</h2><Facts rows={burnFacts} label="Burn facts" /></section>
      </div>

      {/* ---- TABS: Burn log first, then Rule, then Holders when holder data was read. No thread. ---- */}
      <div className="bt-tabs" role="tablist" aria-label="About this coin">
        {tabs.map((t) => <button key={t} id={`tab-${t}`} type="button" role="tab" aria-selected={tab === t} aria-controls={`panel-${t}`} className={`bt-tab${tab === t ? " is-active" : ""}`} onClick={() => setTab(t)}>{COIN_TAB_LABEL[t]}</button>)}
      </div>

      {/* website-10's coin cards link "Check receipt" to #receipts; the anchor sits on the burn log so the link lands here */}
      <span id="receipts" />
      <div id="panel-burns" role="tabpanel" aria-labelledby="tab-burns" hidden={tab !== "burns"} className="space-y-5">
        {(() => {
          // website-14 (platform item 6): signed readings, the graduation and the pool registration as their own rows, beside the receipts
          const other = eventsFromStatus(s as unknown as Parameters<typeof eventsFromStatus>[0], d.receipts).filter((e) => e.kind !== "burn");
          return other.length ? <section aria-label="Readings and milestones"><ol className="bt-tape">{other.map((e) => <li key={`${e.kind}-${e.at}`} className="bt-tape-row text-xs" data-kind={e.kind}><span className="bt-ticker-kind">{EVENT_LABEL[e.kind]}</span><a className="underline" href={e.href}>{e.text}</a></li>)}</ol></section> : null;
        })()}
        <section aria-label="Burn log">
          <p className="mb-2 text-xs text-neutral-500">{count(s.burned.count, "burn")} so far, and {fmt(s.burned.total)} tokens burned. That is {s.burned.pctOfSupply.toFixed(2)}% of the supply. Each receipt below can be checked in your browser.</p>
          {rank && <p className="mb-2 text-xs text-neutral-400" data-rank title={RANK_MEANING}>{rank}</p>}
          <p className="mb-2 flex flex-wrap gap-x-4 text-xs"><a className="underline" href={csvHref(key, "burns")} download>{CSV_LINK_COPY.burnsLink}</a><a className="underline" href={csvHref(key, "readings")} download>{CSV_LINK_COPY.readingsLink}</a><a className="underline" href={feedHref({ coin: key }, "rss")}>{COIN_FEED_LINK}</a></p>
          {rows.length === 0 ? <p className="text-neutral-500">There are no receipts yet. {preBurn ? afterGraduation : "The next result that counts prints the first one."}</p> : (
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
                    <span>{b.status === "confirmed" ? <><b className="tabular-nums">{fmt(b.burned ?? "0")}</b> burned from {count(b.units, "unit")}{b.spent ? `, spending ${b.spent} SOL` : ""}</> : <span className="text-neutral-500" title={b.skippedReason ?? ""}>{b.status}{b.skippedReason ? `. ${b.skippedReason}` : ""}</span>}</span>
                    <span className="flex flex-wrap gap-2">{b.txUrl && <a className="underline" href={b.txUrl}>transaction</a>}{b.settlementSourceUrl && <a className="underline" href={b.settlementSourceUrl}>source</a>}{(() => { const v = receiptRowStatus(b); return <span className={v.status === "passed" ? "text-emerald-400" : v.status === "failed" ? "text-red-400" : "text-neutral-500"} title={v.title} data-receipt-status={v.status}>{v.status === "passed" ? "✓ " : v.status === "failed" ? "✗ " : ""}{v.label}</span>; })()}{(() => { const href = checkReceiptHref(b.signature, s.cluster); return href ? <a className="underline font-medium" href={href} data-check-receipt>Check receipt</a> : null; })()}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section id="verify" className="scroll-mt-20">
          <h2 className="font-medium mb-2">Verify it yourself</h2>
          {rows.length === 0 ? <p className="text-neutral-500 text-xs">Each receipt shows up here with the command, the formula and the on-chain memo you can use to check it.</p> : rows.slice(0, 40).map((b) => <details key={b.eventId} className={card + " mb-2"}><summary className="cursor-pointer">{b.settledAt.slice(0, 10)}, {b.market}: {b.result ?? b.value}, {count(b.units, "unit")}, {b.status === "confirmed" ? `${fmt(b.burned ?? "0")} burned` : b.status} ({receiptRowStatus(b).label})</summary>
            <p className="mt-2">1. Read the settled result from the source:</p><pre className="text-xs bg-neutral-950 rounded p-2 overflow-x-auto">{b.verify.curl}</pre>{b.method && <p className="text-xs text-neutral-500">The value was read by {b.method}.</p>}
            <p>2. Apply the rule:</p><pre className="text-xs bg-neutral-950 rounded p-2 overflow-x-auto">{b.verify.formula}</pre>
            <p>3. Check that you get this: <strong>{b.verify.expected}</strong></p>
            <p>4. The receipt memo on chain{b.txUrl && <> (<a className="underline" href={b.txUrl}>transaction</a>)</>}:</p><pre className="text-xs bg-neutral-950 rounded p-2 overflow-x-auto">{b.memo ?? `No transaction. The status is ${b.status}.`}</pre>
            {b.verify.checks.length > 0 && <p className="text-red-400">Checks that did not pass: {b.verify.checks.join("; ")}</p>}
          </details>)}
        </section>
        <p className="text-xs text-neutral-500">{s.health.pending === 1 ? "One receipt is" : `${s.health.pending} receipts are`} pending and {s.health.unverified === 1 ? "one is" : `${s.health.unverified} are`} unverified.{s.health.lastError ? ` The last error was: ${s.health.lastError}` : ""}</p>
      </div>

      <div id="panel-rule" role="tabpanel" aria-labelledby="tab-rule" hidden={tab !== "rule"} className="space-y-5">
        <section className={card + " bt-rule-card"} aria-label="The rule">
          <div className="flex items-baseline justify-between"><h2 className="font-mono text-xs uppercase tracking-widest">The rule, locked at launch</h2><a className="text-[11px] underline" href={`/api/burnticker/tokens/${encodeURIComponent(key)}?format=rules`}>rules.json</a></div>
          <p className="mt-2">{s.rules.statement}</p>
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
            <div><dt className="text-neutral-500">The dial</dt><dd>{facts.dial ?? "The rule file does not name a share of the burn pool."}</dd></div>
            <div><dt className="text-neutral-500">The window</dt><dd>{facts.window}{prof?.badge ? ` The rule's window reads ${prof.badge}.` : ""}</dd></div>
            <div><dt className="text-neutral-500">The end</dt><dd>{s.lifecycle ? `${s.lifecycle.line} ` : ""}{facts.end}{facts.window !== PERPETUAL_SENTENCE && <RetirementFacts className="mt-1" />}</dd></div>
          </dl>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div><dt className="text-neutral-500">results read</dt><dd className="font-mono">{s.feed.readings}</dd></div>
            <div><dt className="text-neutral-500">last burn</dt><dd className="font-mono">{ago(s.burned.lastAt ?? null, now)}</dd></div>
            <div><dt className="text-neutral-500">{s.mode === "buyback" ? "burn pool" : "vault"}</dt><dd className="font-mono">{s.mode === "buyback" ? (s.pool.feePdaSol === null ? "—" : `${s.pool.feePdaSol} SOL`) : (s.pool.vaultBalance === null ? "—" : fmt(s.pool.vaultBalance))}</dd></div>
            <div><dt className="text-neutral-500">burned</dt><dd className="font-mono tabular-nums">{s.burned.pctOfSupply.toFixed(2)}%</dd></div>
          </dl>
          <p className="mt-2 text-[11px] text-neutral-500 break-all">Rule hash (sha256): {s.rules.sha256}</p>
          <details className="mt-2 text-xs"><summary className="cursor-pointer text-neutral-400">What the operator can and cannot do</summary>
            <p className="mt-1"><b>Can:</b> {s.trust.operator.can.join("; ")}.</p><p className="mt-1"><b>Cannot:</b> {s.trust.operator.cannot.join("; ")}.</p>
            <p className="mt-1 text-neutral-500">These lists come from the <Link className="underline" href={s.trust.registerUrl}>Powers Register</Link>.{s.trust.operator.placeholder ? " The register file is not on this site, so these rows come from its settings." : ""} {s.trust.creatorCashBps === 0 ? "Creators get no cash from fees." : `Creators get ${s.trust.creatorCashBps / 100}% of fees in cash.`} {s.trust.lpLockedPct ?? 100}% of the liquidity is locked. {postGraduationShareLine(s.fees.postGraduation)} The team allocation is {s.trust.teamAllocationPct}%.</p>
          </details>
        </section>
        {s.disclosure.eventContract && <p className={card + " border-l-4 border-l-orange-500 text-xs"}>{s.disclosure.eventContract}</p>}
        {/* No burn pool is ever left behind (2026-10-10): the fee flow. The coin's lifecycle line is in "The end" above. */}
        <p className="text-xs text-neutral-400">Creator fees go to the burn pool and are burned. The liquidity is locked forever. {postGraduationShareLine(s.fees.postGraduation)}</p>
        {s.lp && <LpLockCard lp={s.lp} card={card} />}
        <section className="space-y-2">
          <h2 className="font-medium">Fees</h2><p>{s.fees.sentence}</p>
          {[s.fees.curve, s.fees.postGraduation].map((f, k) => <div key={k} className="overflow-x-auto rounded-lg border border-neutral-800"><table className="w-full text-xs"><thead className="text-neutral-400 text-left"><tr><th className="p-2">{k === 0 ? "On the curve" : "After graduation"}</th><th className="p-2 text-right">Basis points</th><th className="p-2 text-right">SOL per 1 SOL</th><th className="p-2">Paid to</th><th className="p-2">Setting</th></tr></thead><tbody>{f.legs.map((l) => <tr key={l.label} className="border-t border-neutral-800"><td className="p-2">{l.label}</td><td className="p-2 text-right">{l.bps}</td><td className="p-2 text-right">{(l.bps / 10000).toFixed(6).replace(/0+$/, "")}</td><td className="p-2">{l.recipient}</td><td className="p-2 text-neutral-500">{l.dial}</td></tr>)}<tr className="border-t border-neutral-800"><td className="p-2">total</td><td className="p-2 text-right">{f.totalBps}</td><td></td><td></td><td></td></tr></tbody></table></div>)}
        </section>
        <section className={card}><h2 className="font-medium">Reading signers</h2><p>{s.attesters.length ? <>Each reading needs {s.quorum} of {count(s.attesters.length, "signature")} from these keys: {s.attesters.map((a) => `${a.pubkey} (${a.role}${a.active ? "" : ", inactive"})`).join(", ")}.</> : "No signers are recorded."} At level 1, our data key signs each reading. Level 2 adds an independent signer for each source. Level 3 adds a proof of the source&apos;s response (zkTLS), or an on-chain result where the market publishes one.</p></section>
        <section className={card + " text-xs"}><h2 className="font-medium text-sm">Addresses</h2><ul className="space-y-1 break-all"><li>Mint <a className="underline" href={s.addresses.mintUrl}><code>{s.addresses.mint}</code></a> <CopyButton text={s.mint} /></li><li>Burn pool. This is the burn program&apos;s fee account, and it is also the coin&apos;s creator on LaunchLab. Anyone can deposit and nobody can withdraw. The keeper only pays network fees. <a className="underline" href={s.addresses.feePdaUrl}><code>{s.addresses.feePda}</code></a></li>{s.addresses.feeWsol && <li>The burn pool&apos;s wrapped SOL account, where claimed curve fees land <a className="underline" href={s.addresses.feeWsolUrl!}><code>{s.addresses.feeWsol}</code></a></li>}{s.addresses.vault && <li>Vault <a className="underline" href={s.addresses.vaultUrl!}><code>{s.addresses.vault}</code></a></li>}{s.addresses.poolId && <li>LaunchLab pool <code>{s.addresses.poolId}</code></li>}<li>Creator <a className="underline" href={s.addresses.creatorUrl}><code>{s.addresses.creator}</code></a></li><li>Burn program <code>{s.addresses.programId}</code></li>{s.addresses.launchTx && <li>Launch <a className="underline" href={s.addresses.launchTxUrl!}><code>{s.addresses.launchTx}</code></a></li>}</ul></section>
        {/* the rule's own footer line (rules.ts DISCLAIMER_FOOTER); the site's disclaimers live once, in the footer */}
        <p className="text-xs text-neutral-500" data-rule-footer>{s.disclosure.disclaimer}</p>
      </div>

      {hasHolders && m?.holders.top10 && (
        <div id="panel-holders" role="tabpanel" aria-labelledby="tab-holders" hidden={tab !== "holders"}>
          <section className={card} aria-label="Holders">
            <h2 className="font-medium">The largest holders</h2>
            <ol className="mt-2 space-y-0.5 text-xs">{m.holders.top10.map((h, i) => <li key={h.owner} className="flex justify-between gap-2 font-mono"><span className="min-w-0 truncate">{i + 1}. {short(h.owner)}{h.label ? <span className="ml-1 text-neutral-500">({h.label})</span> : null}</span><span className="tabular-nums">{h.pct === null ? h.amount : `${h.pct.toFixed(2)}%`}</span></li>)}</ol>
            <p className="mt-2 text-xs text-neutral-500">{holdersShareLine(m.holders.top10Pct, m.holders.top10PctUnlabelled)} {m.holders.count === null ? m.holders.countNote : `There are ${m.holders.count} holders.`}</p>
          </section>
        </div>
      )}

      {s.status !== "draft" && s.status !== "expired" && <section className={card + " text-xs"} aria-label={SHARE_COPY.heading}><h2 className="font-medium text-sm">{SHARE_COPY.heading}</h2><div className="mt-2"><ShareBlock ticker={s.ticker} id={key} /></div></section>}
      <HostDiagnostics stubs={d.stubs} />
    </main>
  );
}

/** "Liquidity locked forever, and its fees fund the burn" with the lock addresses (Solscan) and the last claim_lock_fees receipt. */
function LpLockCard({ lp, card }: { lp: LpBlock; card: string }) {
  const addr = (a: string | null, url: string | null, empty: string) => (a ? (url ? <a className="underline font-mono break-all" href={url}>{short(a)}</a> : <span className="font-mono">{short(a)}</span>) : <span className="text-neutral-500">{empty}</span>);
  return (
    <section className={card} aria-label="LP locked forever">
      <h2 className="font-mono text-xs uppercase tracking-widest">Liquidity locked forever</h2>
      <p className="mt-2 text-xs">{lp.lockedPct}% of the liquidity from graduation is locked with Raydium&apos;s lock and can never be withdrawn. The burn program owns the Fee Key, which collects the locked liquidity&apos;s share of the pool&apos;s trading fees. Anyone can claim those fees. Of those liquidity fees, {lp.split.burnBps / 100}% of the SOL goes to this coin&apos;s burn pool and {lp.split.operatorBps / 100}% goes to the operator. The coin&apos;s own tokens from the fees are burned. These shares are fixed in code.</p>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div><dt className="text-neutral-500">lock program</dt><dd>{addr(lp.lockProgram, lp.urls.lockProgram, "—")}</dd></div>
        <div><dt className="text-neutral-500">Fee Key</dt><dd>{addr(lp.feeKey, lp.urls.feeKey, "at graduation")}</dd></div>
        <div><dt className="text-neutral-500">Fee Key owner</dt><dd>{addr(lp.feeKeyOwner, lp.urls.feeKeyOwner, "—")}</dd></div>
        <div><dt className="text-neutral-500">operator treasury</dt><dd>{addr(lp.operatorTreasury, lp.urls.operatorTreasury, "not recorded yet")}</dd></div>
      </dl>
      <p className="mt-2 text-[11px] text-neutral-400">{lp.lastClaim ? <>{lp.lastClaim.txUrl ? <a className="underline" href={lp.lastClaim.txUrl}>{lp.lastClaim.line}</a> : lp.lastClaim.line} {lp.totals.claims === 1 ? "There has been one claim" : `There have been ${lp.totals.claims} claims`} so far: {lp.totals.toBurnPool} SOL to the burn pool and {lp.totals.toOperator} SOL to the operator.</> : "Nobody has claimed the pool's fees yet."}</p>
      {lp.note && <p className="mt-1 text-[11px] text-neutral-500">{lp.note}</p>}
    </section>
  );
}

/** A ticker several coins share (tickers are not unique, owner 2026-10-12): each coin by name, mint, creator and rule, linked by its mint. */
function TickerChooser({ ticker, candidates }: { ticker: string; candidates: CoinCandidate[] }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 space-y-3 text-sm" data-ticker-chooser>
      <p className="text-xs"><Link className="underline" href="/burnticker">← Coins</Link></p>
      <h1 className="text-xl font-semibold">${ticker}</h1>
      <p className="text-neutral-300">{CHOOSER_COPY.intro(ticker)}</p>
      <ul className="space-y-2">
        {chooserRows(candidates).map((c) => (
          <li key={c.mint} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3" data-candidate={c.mint}>
            <Link className="font-medium underline" href={c.href}>{c.name} <span className="font-mono text-neutral-400">${c.ticker}</span></Link>
            <p className="mt-1 text-neutral-300">{c.rule}</p>
            <p className="mt-1 text-xs text-neutral-500"><span title={c.mint}>{CHOOSER_COPY.mint} <span className="font-mono">{c.mintShort}</span></span>. {CHOOSER_COPY.creator} <span className="font-mono">{c.creatorShort}</span>.</p>
          </li>
        ))}
      </ul>
    </main>
  );
}

/** A ticker with no record on this host: say so plainly; $DEFICIT's own page is served at DEFICIT_SITE until it is registered here. */
function NotRegistered({ ticker }: { ticker: string }) {
  if (isMintKey(ticker)) return <main className="mx-auto max-w-3xl px-4 py-6 space-y-2 text-sm" data-not-registered><EmptyState kind="not-launched" compact body="No coin with this mint address is registered on this site, so there is no rule, receipt or reading to show here." /><p><Link className="underline" href={`/burnticker/verify?mint=${ticker}`}>Check this address with the burn program</Link>.</p></main>;
  const t = ticker.toUpperCase();
  // website brief §1: $DEFICIT gets a real pre-launch page (canonical: DEFICIT_SITE) instead of the one-line notice
  if (t === "DEFICIT") return <DeficitPrelaunch fallbackSite={DEFICIT_SITE} />;
  return <NotRegisteredNotice t={t} />;
}

/** The one-line notice; a disclosed rehearsal coin (transparency.json `rehearsals`, served by the trust API) says what it is instead. */
function NotRegisteredNotice({ t }: { t: string }) {
  const [rehearsal, setRehearsal] = useState<{ symbol: string; mint: string | null; status: string } | null>(null);
  useEffect(() => { fetch("/api/burnticker/trust").then((r) => (r.ok ? r.json() : null)).then((j: { transparency?: { rehearsals?: { symbol: string; mint: string | null; status: string }[] } } | null) => setRehearsal(j?.transparency?.rehearsals?.find((x) => x.symbol.toUpperCase() === t) ?? null)).catch(() => setRehearsal(null)); }, [t]);
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 space-y-2 text-sm" data-not-registered>
      <h1 className="text-xl font-semibold">${t}</h1>
      {rehearsal ? (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 space-y-2" data-rehearsal-coin>
          <p className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">Disclosed rehearsal coin</p>
          <p data-rehearsal-sentence>{REHEARSAL_SENTENCE}</p>
          {rehearsal.mint && <p className="text-xs text-neutral-400 break-all">Its mint address is <code>{rehearsal.mint}</code>. <Link className="underline" href={`/burnticker/verify?mint=${rehearsal.mint}`}>Check this coin with the burn program</Link>.</p>}
          <p className="text-xs text-neutral-400">The full record, including what it has and has not proved so far, is on the <Link className="underline" href="/burnticker/trust">Trust page</Link>.</p>
        </section>
      ) : <EmptyState kind="not-launched" compact body={`No coin with the ticker $${t} is registered on this site, so there is no rule, receipt or reading to show here.`} />}
      <p><Link className="underline" href="/burnticker">See all coins on this site</Link> or <Link className="underline" href="/burnticker/verify">check a token address</Link>.</p>
    </main>
  );
}
