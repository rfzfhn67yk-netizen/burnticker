"use client";

import { coinCanonicalHref } from "@/lib/burnticker/coinKey";
import { DRAFT_ROUTE_LINE, LOOKUP_LABEL, walletAddressProblem } from "@/lib/burnticker/guidedLaunch";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletButton, useOpenWalletList } from "../_components/WalletButton";
import { WALLET_COPY, meState, meWallet, shortAddress, wantsConnect } from "@/lib/burnticker/walletShell";
import { ANALYTICS_COPY, CREATOR_PAGE } from "@/lib/burnticker/creatorBenefits";
import { WEEK_MEANING } from "@/lib/burnticker/coinRank";
import { LaunchChecklist } from "../_components/LaunchChecklist";
import { DRAFTS_HEADING, meCoinView, splitMeCoins, stateChip } from "@/lib/burnticker/meCoins";
import { TradeButtons } from "../_components/TradeLinks";
import { useLaunchAvailability } from "../_components/useLaunchAvailability";
import { coinLinks } from "@/lib/burnticker/tradeLinks";
import { readLatest, shownFor } from "@/lib/burnticker/latestRead";

/**
 * THE CREATOR DASHBOARD (2026-10-10; gated by the shell's wallet since website-13, 2026-10-12): "Your coins" is the one page a connected
 * wallet opens. Disconnected, it shows the connect prompt (walletShell.ts meState), never an empty list; the static pages' "Connect
 * wallet" arrives with ?connect=1 and the wallet list opens. Connect a wallet (read-only: nothing is signed) or look up an address, and see every coin and pair
 * it created (GET /api/burnticker/v1/creators/{wallet}): state, queued units, next settlement, last reading and how many independent
 * reads confirmed it, receipts, the wind-down, the coin page, and "copy today's post" — the lint-checked text from the post generator,
 * copied to the clipboard; nothing is posted for you.
 *
 * website-17 (creator benefits item 5): with a CONNECTED wallet only (not a pasted address), each coin also shows its rank line, page
 * views (this site keeps no counts, so it says so) and follows (kept in each visitor's browser, so not countable), and a "This week"
 * block of copyable lint-clean text, from GET /burnticker/creator/<wallet>/summary (the creator page's numbers). Words: creatorBenefits.ts.
 */
interface Summary { coins: { ticker: string; mint?: string; receipts: number; week: number; rank: string | null; summary: string }[] }
interface Coin { ticker: string; name: string; mint: string; page: string; state: string; badge: string | null; queuedUnits: number; nextSettlementAt: string | null; lastReading: { id: string | null; value: string | null; at: string | null } | null; agreement: { reads: number; methods: string | null; held: string | null }; receipts: number; windDown: string | null; pairId: string | null; todayPost: { text: string; lintOk: boolean; hits: string[] }; loading?: boolean }
interface Data { wallet: string; coins: Coin[]; pairs: { pairId: string; page: string; sides: string[]; voided: boolean }[] }
const denver = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "—");

export default function CreatorDashboard() {
  const wallet = useWallet();
  const openList = useOpenWalletList();
  // owner 2026-10-14: each created coin's card carries its trade link, on this host's network (devnet coins get the explorer only)
  const host = useLaunchAvailability().cluster ?? "mainnet";
  const [pasted, setPasted] = useState("");
  // audit 3 item 103: the lookup is a form: the address is checked on blur and on submit, a wrong one says what is expected, and the
  // lookup's state is said beside the button (the registry is read only for a well-formed address)
  const [addr, setAddr] = useState(""), [addrErr, setAddrErr] = useState<string | null>(null);
  const lookUp = () => { const v = addr.trim(); const why = walletAddressProblem(v); setAddrErr(why); if (!why) setPasted(v); };
  // the static pages' "Connect wallet" deep link: open the wallet list on arrival (once), unless a wallet is already connected
  useEffect(() => { if (wantsConnect(window.location.search) && !wallet.connected) openList(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const connectedKey = wallet.connected ? wallet.publicKey?.toBase58() ?? null : null;
  // audit 2026-10-15 F7: each answer is kept with the wallet it was read for, and shown only while that wallet is on screen (latestRead.ts)
  const [slot, setSlot] = useState<{ key: string; value: Data } | null>(null), [errSlot, setErrSlot] = useState<{ key: string; value: string } | null>(null), [busy, setBusy] = useState(false), [copied, setCopied] = useState<string | null>(null);
  const who = meWallet({ connected: wallet.connected, publicKey: connectedKey, pasted })?.wallet ?? "";
  const d = shownFor(slot, who), err = shownFor(errSlot, who);
  const st = meState({ connected: wallet.connected, connecting: wallet.connecting, publicKey: connectedKey, pasted, busy, error: err, data: d });
  useEffect(() => {
    if (!who) { setBusy(false); return; }
    setBusy(true);
    // a newer wallet cancels this read; an older answer that lands late is dropped
    return readLatest(who, (signal) => fetch(`/api/burnticker/v1/creators/${who}`, { signal }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); return j as Data; }),
      (r) => { if (r.ok) { setSlot({ key: r.key, value: r.value }); setErrSlot(null); } else setErrSlot({ key: r.key, value: r.error }); setBusy(false); });
  }, [who]);
  // website-17 item 5: the creator page's numbers, for a connected wallet only; kept per wallet and reset on its own (F7)
  const mine = st.kind !== "prompt" && st.kind !== "connecting" && st.source === "connected" ? st.wallet : "";
  const [sumSlot, setSumSlot] = useState<{ key: string; value: Summary | null } | null>(null);
  const sumRead = mine && sumSlot?.key === mine ? sumSlot : null;
  const sum = sumRead?.value ?? null, sumErr = !!sumRead && sumRead.value === null;
  useEffect(() => {
    if (!mine) return;
    return readLatest(mine, (signal) => fetch(`/burnticker/creator/${mine}/summary`, { signal }).then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return (await r.json()) as Summary; }),
      (r) => setSumSlot({ key: r.key, value: r.ok ? r.value : null }));
  }, [mine]);
  // prelaunch audit 2026-10-18: matched on the mint, so two coins on one ticker never swap ranks
  const rankOf = (mint: string) => (sum ? sum.coins.find((x) => x.mint === mint)?.rank ?? null : null);
  const weekText = sum ? sum.coins.map((x) => x.summary).join("\n") : "";
  const copyWeek = async () => { try { await navigator.clipboard.writeText(weekText); setCopied("week"); setTimeout(() => setCopied(null), 2000); } catch { setCopied(null); } };
  const copy = async (c: Coin) => { try { await navigator.clipboard.writeText(c.todayPost.text); setCopied(c.mint); setTimeout(() => setCopied(null), 2000); } catch { setCopied(null); } };
  const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-5 text-sm">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Your coins</h1>
        {st.kind === "prompt" || st.kind === "connecting"
          ? <div className={card + " space-y-2"} data-me-state={st.kind}><p className="text-neutral-300">{WALLET_COPY.prompt}</p><WalletButton variant="menu" /></div>
          : <p className="text-neutral-400" data-me-state={st.kind}>{st.source === "connected" ? <>Showing the coins created by your connected wallet, <span className="font-mono">{shortAddress(st.wallet)}</span>. <Link className="underline" href={`/burnticker/creator/${st.wallet}`} data-creator-page>{ANALYTICS_COPY.creatorPage}</Link>.</> : <>Showing the coins created by <span className="font-mono">{shortAddress(st.wallet)}</span>. No wallet is connected.</>}</p>}
        <details className="text-xs" open={!!addr || !!pasted}><summary className="cursor-pointer text-neutral-400">{WALLET_COPY.lookup}</summary>
          <form className="mt-2 flex max-w-md flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); lookUp(); }} noValidate data-lookup-form>
            <label htmlFor="me-wallet" className="w-full text-neutral-400">{LOOKUP_LABEL}</label>
            <input id="me-wallet" className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm" placeholder="A creator's wallet address" value={addr} autoComplete="off" spellCheck={false} aria-invalid={!!addrErr} aria-describedby="me-wallet-status" onChange={(e) => { setAddr(e.target.value); if (addrErr) setAddrErr(null); }} onBlur={() => { if (addr.trim()) setAddrErr(walletAddressProblem(addr.trim())); }} />
            <button type="submit" className="rounded border border-neutral-700 px-3 py-1 hover:border-amber-400">Look up</button>
            <p id="me-wallet-status" className={`w-full ${addrErr ? "text-red-400" : "text-neutral-500"}`} role={addrErr ? "alert" : "status"}>{addrErr ?? (busy ? "Looking up this wallet's coins." : pasted && d ? `Showing ${shortAddress(pasted)}.` : "")}</p>
          </form>
        </details>
        {/* audit 3 item 137: without a wallet, the way back to a draft or a new preview */}
        {(st.kind === "prompt" || st.kind === "connecting") && <p className="text-xs text-neutral-400" data-me-draft-route><Link className="underline" href="/burnticker/launch">{DRAFT_ROUTE_LINE}</Link></p>}
      </header>
      {st.kind === "loading" && <p className="text-neutral-500" role="status">Reading the coin registry.</p>}
      {st.kind === "error" && <p className="text-red-400" role="alert">The coins for this wallet could not be read just now. {st.message}</p>}
      {d && st.kind === "empty" && <p className={card + " text-neutral-400"}>No coins were created by <span className="font-mono">{shortAddress(d.wallet)}</span> yet. <Link className="underline" href="/burnticker/templates">Start from a template</Link>.</p>}
      {d && d.pairs.length > 0 && <section className="space-y-1"><h2 className="font-medium">Pairs</h2><ul className="flex flex-wrap gap-2">{d.pairs.map((p) => <li key={p.pairId}><Link className="underline font-mono" href={p.page}>{p.sides.map((s) => `$${s}`).join(" vs ")}</Link>{p.voided && <span className="ml-1 text-xs text-amber-300">voided</span>}</li>)}</ul></section>}
      {mine && d && d.coins.length > 0 && sum && sum.coins.length > 0 && (
        <section className={card + " space-y-2 text-xs"} aria-label={ANALYTICS_COPY.weekHeading} data-week-summary>
          <h2 className="text-sm font-medium">{ANALYTICS_COPY.weekHeading}</h2>
          <pre className="whitespace-pre-wrap rounded bg-neutral-950 p-2 text-neutral-300">{weekText}</pre>
          <div className="flex flex-wrap items-center gap-3"><button className="rounded border border-neutral-700 px-2 py-1 hover:border-amber-400" onClick={() => void copyWeek()}>{copied === "week" ? "Copied" : ANALYTICS_COPY.copySummary}</button><span className="text-neutral-500">{WEEK_MEANING}</span></div>
        </section>
      )}
      {d && d.coins.length > 0 && (() => {
        // launch night 2026-10-13 (meCoins.ts): created coins first; a draft (prepared, never signed) has its own card that says it is not
        // created, with no wind-down, no settlement facts and no post to copy
        const { created, drafts } = splitMeCoins(d.coins);
        return (<>
        {created.length > 0 && <ul className="grid gap-3 md:grid-cols-2" aria-label="your coins">
          {created.map((c) => (
            <li key={c.mint} className={card + " space-y-2"} data-coin-state={c.state}>
              <div className="flex flex-wrap items-center gap-2"><Link className="font-mono text-base underline" href={coinCanonicalHref(c.mint)}>${c.ticker}</Link><span className="text-neutral-400">{c.name}</span><span className="bt-chip">{stateChip(c.state)}</span>{c.badge && <span className="bt-chip bt-chip-window">{c.badge}</span>}</div>
              {/* sixth pass B-10: this coin's page read is still running on the server; its registry facts show meanwhile */}
              {c.loading && <p className="text-xs text-neutral-300" role="status" data-me-loading>{CREATOR_PAGE.coinLoading}</p>}
              <div data-me-trade><TradeButtons links={coinLinks({ cluster: host, mint: c.mint, phase: null, status: "live" })} mint={c.mint} ticker={c.ticker} compact /></div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-neutral-500">queued units</dt><dd>{c.queuedUnits}</dd>
                <dt className="text-neutral-500">next settlement</dt><dd>{c.nextSettlementAt ? `${denver(c.nextSettlementAt)} (Denver)` : "none scheduled"}</dd>
                <dt className="text-neutral-500">last reading</dt><dd>{c.lastReading ? `${c.lastReading.id ?? "—"}: ${c.lastReading.value ?? "—"}` : "none yet"}</dd>
                <dt className="text-neutral-500">confirmed by</dt><dd>{c.agreement.held ? <span className="text-amber-300">held: {c.agreement.held}</span> : c.agreement.reads >= 2 ? `${c.agreement.reads} independent reads (${c.agreement.methods})` : c.agreement.reads === 1 ? "one read" : "—"}</dd>
                <dt className="text-neutral-500">receipts</dt><dd>{c.receipts}</dd>
                <dt className="text-neutral-500">wind-down</dt><dd>{c.windDown ?? "—"}</dd>
                {mine && <>
                  <dt className="text-neutral-500">{ANALYTICS_COPY.rank}</dt><dd data-rank>{rankOf(c.mint) ?? (sumErr ? ANALYTICS_COPY.rankUnavailable : "—")}</dd>
                  <dt className="text-neutral-500">{ANALYTICS_COPY.views}</dt><dd>{ANALYTICS_COPY.viewsNone}</dd>
                  <dt className="text-neutral-500">{ANALYTICS_COPY.follows}</dt><dd>{ANALYTICS_COPY.followsNone}</dd>
                </>}
              </dl>
              {/* website-26 (WIRING-FEATURES item 10): the six post-launch steps and what comes next, and who does it */}
              <LaunchChecklist mint={c.mint} />
              <details className="text-xs"><summary className="cursor-pointer text-neutral-300">Today&apos;s post {c.todayPost.lintOk ? "passes the wording check." : <span className="text-red-400" data-refused>fails the wording check because of {c.todayPost.hits.join(", ")}.</span>}</summary><pre className="mt-1 whitespace-pre-wrap rounded bg-neutral-950 p-2 text-neutral-300">{c.todayPost.text}</pre></details>
              <button className="rounded border border-neutral-700 px-2 py-1 text-xs hover:border-amber-400 disabled:opacity-40" disabled={!c.todayPost.lintOk} onClick={() => void copy(c)}>{copied === c.mint ? "copied ✓" : "copy today's post"}</button>
            </li>
          ))}
        </ul>}
        {drafts.length > 0 && <section className="space-y-2" aria-label={DRAFTS_HEADING} data-me-drafts>
          <h2 className="font-medium">{DRAFTS_HEADING}</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {drafts.map((c) => { const v = meCoinView(c, d.coins); return (
              <li key={c.mint} className={card + " space-y-2 text-xs"} data-coin-state={c.state}>
                <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-base">${c.ticker}</span><span className="text-neutral-400">{c.name}</span><span className="bt-chip">{v.chip}</span></div>
                {v.lines.map((l) => <p key={l} className="text-neutral-300">{l}</p>)}
                {v.launchLink && <p><Link className="underline" href="/burnticker/launch">{DRAFT_ROUTE_LINE}</Link></p>}
                <p className="break-all font-mono text-neutral-500">Draft mint {c.mint}</p>
              </li>
            ); })}
          </ul>
        </section>}
        </>);
      })()}
    </main>
  );
}
