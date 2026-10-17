"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { balanceLine, capLine, DEFAULT_SLIPPAGE_BPS, feeLine, holdsLine, REFUSAL, SLIPPAGE_CHOICES_BPS, SWAP_COPY, SWAP_NOTICE } from "@/lib/burnticker/swap/copy";
import { formatAmount, parseAmount } from "@/lib/burnticker/swap/math";
import { balanceRefusal, buildSwap, coinRefusal, feeBps, marketRefusal, quoteSwap, requoteRefusal, walletRefusal, type Balances, type Market, type Network, type Quote, type Side } from "@/lib/burnticker/swap/plan";
import { connectionOn, explorerTxUrl, readBalances, readMarket } from "@/lib/burnticker/swap/chain";
import { browserSwapStore, loadPending, PendingWatch, reconcilePending, runSwap, type PendingSwap, type SwapOutcome } from "@/lib/burnticker/swap/pending";
import type { SwapGuard } from "@/lib/burnticker/swap/guard";

/**
 * THE COIN PAGE'S SWAP PANEL (swap-1, 2026-10-14; the owner: "make it so you can trade the launched coins on the site"). SOL to tokens
 * and back, straight against the coin's own Raydium pool: its LaunchLab curve before graduation, its CPMM pool once registered. The
 * decisions are src/lib/burnticker/swap/plan.ts; the chain steps are swap/chain.ts; every word is swap/copy.ts. The panel holds no key:
 * the connected wallet signs, after the network's simulation of the exact transaction has passed. It appears only for a live coin on
 * this host's own network, refuses the operator's own wallets (the trust page's rule) and the disclosed test coins, and shows the
 * external venues under itself as alternatives.
 */

export interface TradePanelProps {
  ticker: string; mint: string; status: string; cluster: string;
  /** the registered CPMM pool once the coin has graduated and the pool is registered here; null while on the curve */
  graduatedPool: string | null;
  /** the burn pool's basis points of each CPMM swap, from the page's fee table (fees.ts postGraduationFeesFor) */
  poolBurnBps: number;
  links: { id: string; label: string; url: string }[];
  /** the page's fee sentence (curve and pool fees), printed above the other venues */
  feesNote?: string;
  /** what the page says when there are no links yet (a draft, an unread pool) */
  linksNote?: string | null;
}

const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
const SOL_DECIMALS = 9;
type Step = "idle" | "quoting" | "simulating" | "signing" | "sending" | "confirming";
const STEP_TEXT: Record<Exclude<Step, "idle">, string> = { quoting: SWAP_COPY.quoting, simulating: SWAP_COPY.simulating, signing: SWAP_COPY.signing, sending: SWAP_COPY.sending, confirming: SWAP_COPY.confirming };

export function TradePanel(p: TradePanelProps) {
  const [guard, setGuard] = useState<SwapGuard | null | "failed">(null);
  useEffect(() => { fetch("/api/burnticker/swap-guard").then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((j: SwapGuard) => setGuard(j)).catch(() => setGuard("failed")); }, []);
  // walkthrough 13 (owner 2026-10-14, "fix the layout calls"): this row is the coin page's ONE place for the full set of trade links
  // (the header keeps only the primary button), so it renders even when the swap itself does not (loading, another network, a draft)
  const alternatives = (p.links.length > 0 || p.feesNote || p.linksNote) ? (
    <div className="text-xs" data-swap-alternatives>
      {p.feesNote && <p className="mb-1 text-neutral-400" data-fees-before-trade>{p.feesNote}</p>}
      {p.links.length > 0 ? <p><span className="text-neutral-500">{SWAP_COPY.otherVenues}: </span>
        {p.links.map((l, i) => <span key={l.id}>{i > 0 && <span className="text-neutral-500"> · </span>}<a className="underline" href={l.url} rel="noopener" target="_blank">{l.label}</a></span>)}</p>
        : p.linksNote ? <p className="text-neutral-400" data-trade-note>{p.linksNote}</p> : null}
    </div>
  ) : null;
  // the panel never appears for a coin that is not live on this host's own network
  const refusal = guard === null || guard === "failed" ? null : coinRefusal({ mint: p.mint, status: p.status, cluster: p.cluster, hostCluster: guard.cluster, testMints: guard.testMints });
  if (guard === null || (refusal && refusal !== REFUSAL.testCoin)) return alternatives ? <section className={card} aria-label={SWAP_COPY.otherVenues}>{alternatives}</section> : null;
  return (
    <section className={card} aria-label={SWAP_COPY.title} data-swap-panel>
      <p className="mb-2 text-[11px] text-neutral-400" data-swap-notice>{SWAP_NOTICE}</p>
      {refusal ? <p className="text-xs text-neutral-300" data-swap-refusal>{refusal}</p>
        : guard === "failed" ? <p className="text-xs text-neutral-300" data-swap-refusal>{REFUSAL.guardUnavailable}</p>
        : <Swap {...p} network={p.cluster as Network} operatorWallets={guard.operatorWallets} />}
      {alternatives && <div className="mt-3 border-t border-neutral-800 pt-2">{alternatives}</div>}
    </section>
  );
}

function Swap(p: TradePanelProps & { network: Network; operatorWallets: string[] }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const modal = useWalletModal();
  const mint = useMemo(() => new PublicKey(p.mint), [p.mint]);
  const pool = useMemo(() => (p.graduatedPool ? new PublicKey(p.graduatedPool) : null), [p.graduatedPool]);
  const [market, setMarket] = useState<Market | null>(null);
  const [marketErr, setMarketErr] = useState<string | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [side, setSide] = useState<Side>("sol-in");
  const [text, setText] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(DEFAULT_SLIPPAGE_BPS);
  const [step, setStep] = useState<Step>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ signature: string; balance: string; earlier?: boolean } | null>(null);
  // audit 2026-10-15 F2: a signed swap this tab has not seen settle (swap/pending.ts). While it is held nothing else is sent.
  const [pending, setPending] = useState<PendingSwap | null>(null);
  const [checking, setChecking] = useState(false);
  const store = useMemo(() => browserSwapStore(), []);
  // review 3d: one status read at a time, and a late answer never re-holds a settled swap
  const watch = useRef(new PendingWatch());
  const ownerKey = wallet.publicKey?.toBase58() ?? null;

  const decimals = market ? (market.kind === "curve" ? market.pool.decimalsA : 6) : 6;
  const sol = (x: bigint) => formatAmount(x, SOL_DECIMALS, 6);
  const tok = (x: bigint) => formatAmount(x, decimals, decimals);
  const inDecimals = side === "sol-in" ? SOL_DECIMALS : decimals;
  const fmtOut = (x: bigint) => (side === "sol-in" ? `${tok(x)} $${p.ticker}` : `${sol(x)} SOL`);

  const refresh = useCallback(async () => {
    setStep((s) => (s === "idle" ? "quoting" : s));
    try {
      if (!(await connectionOn(connection, p.network))) throw new Error(REFUSAL.wrongNetwork);
      const m = await readMarket(connection, p.network, mint, pool);
      setMarket(m); setMarketErr(marketRefusal(m, mint, Math.floor(Date.now() / 1000)));
      if (wallet.publicKey) setBalances(await readBalances(connection, wallet.publicKey, mint));
    } catch (e) { setMarketErr(String((e as Error).message ?? e)); }
    finally { setStep((s) => (s === "quoting" ? "idle" : s)); }
  }, [connection, p.network, mint, pool, wallet.publicKey]);
  useEffect(() => { const t = setTimeout(() => void refresh(), 0); return () => clearTimeout(t); }, [refresh]);

  const amount = parseAmount(text, inDecimals);
  const quote: Quote | null = useMemo(() => {
    if (!market || marketErr || amount === null || amount <= BigInt(0)) return null;
    try { return quoteSwap(market, side, amount, p.poolBurnBps); } catch { return null; }
  }, [market, marketErr, amount, side, p.poolBurnBps]);
  const minOut = quote ? (quote.amountOut * BigInt(10_000 - slippageBps)) / BigInt(10_000) : null;
  const fees = market ? feeBps(market) : null;
  const who = wallet.publicKey?.toBase58() ?? null;
  const walletNo = who ? walletRefusal(who, p.operatorWallets) : null;
  const inputNo = text.trim() === "" ? null : amount === null ? REFUSAL.amountFormat(inDecimals) : amount <= BigInt(0) ? REFUSAL.amount : quote && quote.amountOut <= BigInt(0) ? REFUSAL.noOutput : null;
  const balanceNo = quote && balances ? balanceRefusal(side, quote.amountIn, balances, { sol, tokens: tok, ticker: p.ticker }) : null;
  const blocked = walletNo ?? marketErr ?? inputNo ?? balanceNo;
  const busy = step !== "idle" || pending !== null || checking;

  const ctx = useCallback(() => ({ conn: connection, store, network: p.network, mint, owner: wallet.publicKey as PublicKey }), [connection, store, p.network, mint, wallet.publicKey]);
  const show = useCallback((o: SwapOutcome, earlier: boolean) => {
    if (o.kind === "pending") { watch.current.hold(o.pending); setPending(o.pending); return; }
    watch.current.hold(null); setPending(null);
    if (o.kind === "confirmed") {
      if (o.balances) setBalances(o.balances);
      setDone({ signature: o.signature, balance: o.balances ? balanceLine(tok(o.balances.tokens), p.ticker) : SWAP_COPY.balanceUnread, earlier });
      if (!earlier) setText("");
    } else if (o.kind === "failed") setErr(REFUSAL.failed(o.error));
    else if (o.kind === "unconfirmed") setErr(SWAP_COPY.unconfirmed);
    else setErr(SWAP_COPY.expired);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.ticker, decimals]);
  // a swap held from before a reload (or an error) is settled before anything else can be sent
  const check = useCallback(async (rec: PendingSwap) => {
    if (watch.current.checking) return;
    setChecking(true);
    try { const out = await watch.current.check(rec, (r) => reconcilePending(ctx(), r)); if (out) show(out, true); } finally { setChecking(false); }
  }, [ctx, show]);
  // the connected wallet's own held swap (review 3c): another wallet's record never shows here or blocks this one
  useEffect(() => { const rec = loadPending(store, p.network, p.mint, ownerKey); const t = setTimeout(() => { watch.current.hold(rec); setPending(rec); if (rec) void check(rec); }, 0); return () => clearTimeout(t); }, [store, p.network, p.mint, ownerKey, check]);
  // review follow-up 2: the check backs off after repeated read errors (PendingWatch.delayMs), instead of every 5 seconds forever
  useEffect(() => { if (!pending) return; let t: ReturnType<typeof setTimeout>, live = true; const tick = async () => { await check(pending); if (live) t = setTimeout(tick, watch.current.delayMs()); }; t = setTimeout(tick, watch.current.delayMs()); return () => { live = false; clearTimeout(t); }; }, [pending, check]);

  async function go() {
    if (!wallet.publicKey || !quote || minOut === null || blocked || busy || amount === null || pending) return;
    if (!wallet.signTransaction) { setErr(REFUSAL.cannotSign); return; }
    setErr(null); setDone(null);
    try {
      setStep("quoting");
      let fresh: Market | null = null;
      // third prelaunch audit F05: this swap's own reads, its send and its confirm run in one flight (swap/pending.ts runSwap), so a swap
      // still goes through once the proxy's ordinary lane is spent; the panel's passive refresh above stays in the ordinary lane
      const out = await runSwap(ctx(), { side, sign: (tx) => wallet.signTransaction!(tx), onStep: (s) => setStep(s), pollMs: 2000, held: pending, prepare: async () => {
        const owner = wallet.publicKey as PublicKey;
        if (!(await connectionOn(connection, p.network))) throw new Error(REFUSAL.wrongNetwork);
        // a fresh read right before signing: a pool that moved past the slippage setting is refused here, nothing is sent
        const m = await readMarket(connection, p.network, mint, pool);
        fresh = m;
        const no = marketRefusal(m, mint, Math.floor(Date.now() / 1000));
        if (no) throw new Error(no);
        const q = quoteSwap(m, side, amount, p.poolBurnBps);
        const slipNo = requoteRefusal(q, minOut, fmtOut, slippageBps);
        if (slipNo) { setMarket(m); throw new Error(slipNo); }
        const b = await readBalances(connection, owner, mint);
        const balNo = balanceRefusal(side, q.amountIn, b, { sol, tokens: tok, ticker: p.ticker });
        if (balNo) { setBalances(b); throw new Error(balNo); }
        // the minimum out stays the one shown to the visitor (quote less slippage); the fresh quote only has to clear it
        // sent at most once: the signed swap is held (swap/pending.ts) before the send, and any error after it leaves it pending
        return buildSwap(m, { owner, mint, side, amount, quotedOut: quote.amountOut, slippageBps }).ixs;
      } });
      show(out, false);
      if (out.kind === "confirmed") { const kept = fresh as Market | null, after = await readMarket(connection, p.network, mint, pool).catch(() => null); if (after ?? kept) setMarket((after ?? kept)!); }
    } catch (e) { setErr(String((e as Error).message ?? e)); }
    finally { setStep("idle"); }
  }

  const venue = market?.kind === "cpmm" ? SWAP_COPY.poolVenue : SWAP_COPY.curveVenue;
  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-baseline justify-between gap-2"><h2 className="text-sm font-medium">{SWAP_COPY.title}</h2><span className="text-neutral-500">{venue}</span></div>
      {p.network === "devnet" && <p className="text-amber-300">{SWAP_COPY.devnetNote}</p>}
      <div className="flex gap-1" role="group" aria-label="Direction">
        {(["sol-in", "tokens-in"] as const).map((s) => <button key={s} type="button" className={`rounded border px-2 py-1 ${side === s ? "border-amber-400" : "border-neutral-700"}`} aria-pressed={side === s} onClick={() => { setSide(s); setText(""); setErr(null); }} disabled={busy}>{s === "sol-in" ? SWAP_COPY.directionToTokens : SWAP_COPY.directionToSol}</button>)}
      </div>
      <label className="block">
        <span className="text-neutral-400">{side === "sol-in" ? SWAP_COPY.solIn : `${SWAP_COPY.tokensIn} ($${p.ticker})`}</span>
        <span className="mt-1 flex gap-1">
          <input className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono" inputMode="decimal" autoComplete="off" value={text} onChange={(e) => { setText(e.target.value); setErr(null); setDone(null); }} placeholder="0.0" disabled={busy} aria-label={side === "sol-in" ? SWAP_COPY.solIn : SWAP_COPY.tokensIn} />
          {side === "tokens-in" && balances && balances.tokens > BigInt(0) && <button type="button" className="rounded border border-neutral-700 px-2" onClick={() => setText(formatAmount(balances.tokens, decimals).replace(/,/g, ""))} disabled={busy}>{SWAP_COPY.max}</button>}
        </span>
      </label>
      <div className="flex items-center gap-1" role="group" aria-label={SWAP_COPY.slippage}>
        <span className="text-neutral-400">{SWAP_COPY.slippage}</span>
        {SLIPPAGE_CHOICES_BPS.map((b) => <button key={b} type="button" className={`rounded border px-2 py-0.5 ${slippageBps === b ? "border-amber-400" : "border-neutral-700"}`} aria-pressed={slippageBps === b} onClick={() => setSlippageBps(b)} disabled={busy}>{b / 100}%</button>)}
      </div>
      {quote && minOut !== null && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" data-swap-quote>
          <dt className="text-neutral-500">{side === "sol-in" ? SWAP_COPY.tokensOut : SWAP_COPY.solOut}</dt><dd className="font-mono">{fmtOut(quote.amountOut)}</dd>
          <dt className="text-neutral-500">{SWAP_COPY.minimumOut}</dt><dd className="font-mono">{fmtOut(minOut)}</dd>
          {fees && <><dt className="text-neutral-500">{SWAP_COPY.fee}</dt><dd data-swap-fee>{feeLine({ totalBps: fees.totalBps, burnPoolBps: fees.burnPoolBps ?? p.poolBurnBps, feeText: quote.feeUnit === "SOL" ? sol(quote.feeRaw) : tok(quote.feeRaw), burnPoolText: quote.feeUnit === "SOL" ? sol(quote.burnPoolRaw) : tok(quote.burnPoolRaw), unit: quote.feeUnit === "SOL" ? "SOL" : `$${p.ticker}`, rest: market?.kind === "curve" ? { raydiumBps: fees.raydiumBps, platformBps: fees.platformBps } : null })}</dd></>}
        </dl>
      )}
      {quote?.capped && <p className="text-neutral-300">{capLine(sol(quote.amountIn))}</p>}
      <p className="text-[11px] text-neutral-500">{SWAP_COPY.slippageNote}</p>
      {!wallet.connected ? <button type="button" className="bt-launch-btn block w-full text-center" onClick={() => modal.setVisible(true)}>{SWAP_COPY.connect}</button>
        : <button type="button" className="bt-launch-btn block w-full text-center disabled:opacity-50" disabled={!quote || !!blocked || busy} onClick={() => void go()} data-swap-button>{step !== "idle" ? STEP_TEXT[step] : SWAP_COPY.swapButton}</button>}
      {wallet.connected && balances && <p className="text-[11px] text-neutral-500">{holdsLine(sol(balances.lamports), tok(balances.tokens), p.ticker)}</p>}
      {(err ?? blocked) && <p className="text-neutral-200" role="alert" data-swap-refusal>{err ?? blocked}</p>}
      {pending && <div className="rounded border border-amber-500/60 p-2 text-amber-200" role="status" data-swap-pending>
        <p>{SWAP_COPY.pending} <a className="underline" href={explorerTxUrl(p.network, pending.signature)} rel="noopener" target="_blank">{SWAP_COPY.receiptLink}</a>.</p>
        <button type="button" className="mt-1 rounded border border-neutral-700 px-2 py-0.5 disabled:opacity-50" disabled={checking} onClick={() => void check(pending)}>{checking ? SWAP_COPY.checking : SWAP_COPY.checkAgain}</button>
      </div>}
      {done && <p className="text-emerald-300" data-swap-receipt>{done.earlier ? SWAP_COPY.earlierConfirmed : SWAP_COPY.confirmed} <a className="underline" href={explorerTxUrl(p.network, done.signature)} rel="noopener" target="_blank">{SWAP_COPY.receiptLink}</a>. {done.balance}</p>}
      <p className="text-[11px] text-neutral-500">{SWAP_COPY.noKeys}</p>
    </div>
  );
}
