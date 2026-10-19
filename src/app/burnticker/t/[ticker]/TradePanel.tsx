"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { balanceLine, capLine, DEFAULT_SLIPPAGE_BPS, feeLine, holdsLine, REFUSAL, SLIPPAGE_CHOICES_BPS, SWAP_COPY, SWAP_NOTICE } from "@/lib/burnticker/swap/copy";
import { formatAmount, parseAmount } from "@/lib/burnticker/swap/math";
import { balanceRefusal, buildSwap, coinRefusal, feeBps, marketRefusal, quoteSwap, requoteRefusal, walletRefusal, type Balances, type Market, type Network, type Quote, type Side } from "@/lib/burnticker/swap/plan";
import { connectionOn, explorerTxUrl, readBalances, readMarket } from "@/lib/burnticker/swap/chain";
import { browserSwapStore, loadPending, PendingWatch, reconcilePending, runSwap, saveOutcome, takeOutcome, type LastOutcome, type PendingSwap, type SwapOutcome } from "@/lib/burnticker/swap/pending";
import type { SwapGuard } from "@/lib/burnticker/swap/guard";
import { isBudgetRefusal, withFlight } from "@/lib/burnticker/rpcProxy";

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
/**
 * Prelaunch audit 2026-10-18 F03: the panel's first read (network, pool, balances) ran once; a failure blocked the Swap button until a
 * reload. A refusal the chain gave (another network, no pool, a paused pool) is still final; anything else is a read that failed, so the
 * panel retries it in the background (RETRY_FIRST_MS, doubling, at most RETRY_MAX_MS apart, RETRY_ATTEMPTS times) and offers Try again,
 * which re-reads once more inside a bounded flight when the ordinary lane fails (rpcProxy.ts withFlight).
 * Review follow-up: a flight read costs 4 or 5 of the token's 24 calls, which the swap itself needs, so Try again uses the flight only
 * when the ordinary lane refused for its spent budget (rpcProxy.ts isBudgetRefusal), at most once per FLIGHT_READ_EVERY_MS per mount,
 * and the background retry never reads while a Try again is running (withFlight is page-wide, so its read would ride the token).
 */
const FLIGHT_READ_EVERY_MS = 10 * 60_000;
const RETRY_FIRST_MS = 3_000, RETRY_MAX_MS = 60_000, RETRY_ATTEMPTS = 8;
const retryDelayMs = (attempt: number): number => Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** attempt);
const FINAL_REFUSALS: ReadonlySet<string> = new Set((Object.values(REFUSAL) as unknown[]).filter((v): v is string => typeof v === "string" && v !== REFUSAL.networkUnreadable && v !== REFUSAL.readFailed && v !== REFUSAL.networkUnreadableManual && v !== REFUSAL.readFailedManual));
type ReadResult = "ok" | "final" | "retry" | "budget" | "stale";
const failedRead = (r: ReadResult): boolean => r === "retry" || r === "budget";
/** F04: the context a read belongs to (network, coin, wallet), and a value kept under it, shown only while the key is current. */
const contextKey = (network: string, mint: string, owner: string | null): string => `${network}|${mint}|${owner ?? ""}`;
type Keyed<T> = { key: string; v: T } | null;
const keyed = <T,>(box: Keyed<T>, key: string): T | null => (box && box.key === key ? box.v : null);

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
  // prelaunch audit 2026-10-18 F04: every read's result belongs to the network, coin and wallet it was started for. State is kept with
  // that key and shown only while it matches; a read whose key or generation is no longer current writes nothing, so wallet A's late
  // balance (or A's swap or status result) can never land on wallet B's panel, and a switch clears A's balance and messages at once.
  const ownerKey = wallet.publicKey?.toBase58() ?? null;
  const ctxKey = contextKey(p.network, p.mint, ownerKey);
  const mKey = `${p.network}|${p.mint}|${p.graduatedPool ?? ""}`;
  const live = useRef(ctxKey);
  useEffect(() => { live.current = ctxKey; }, [ctxKey]);
  const gen = useRef(0);
  const [marketBox, setMarketBox] = useState<Keyed<Market>>(null);
  const [marketErrBox, setMarketErrBox] = useState<Keyed<string>>(null);
  // F03: a read that failed (recoverable), kept apart from the chain's refusals so a success clears it
  const [readErrBox, setReadErrBox] = useState<Keyed<string>>(null);
  const [retrying, setRetrying] = useState(false);
  const manual = useRef(false), lastFlightRead = useRef(-Infinity), passive = useRef(new Set<Promise<void>>()), restartNext = useRef(false);
  const kept = useRef(new Map<string, LastOutcome>());
  const [auto, setAuto] = useState(true), [schedule, setSchedule] = useState(0);
  const [balBox, setBalBox] = useState<Keyed<Balances>>(null);
  const [side, setSide] = useState<Side>("sol-in");
  const [text, setText] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(DEFAULT_SLIPPAGE_BPS);
  const [step, setStep] = useState<Step>("idle");
  const [errBox, setErrBox] = useState<Keyed<string>>(null);
  const [doneBox, setDoneBox] = useState<Keyed<{ signature: string; balance: string; earlier?: boolean }>>(null);
  // audit 2026-10-15 F2: a signed swap this tab has not seen settle (swap/pending.ts). While it is held nothing else is sent.
  const [pendingBox, setPendingBox] = useState<Keyed<PendingSwap>>(null);
  const [checkingKey, setCheckingKey] = useState<string | null>(null);
  const store = useMemo(() => browserSwapStore(), []);
  // review 3d: one status read at a time, and a late answer never re-holds a settled swap
  const watch = useRef(new PendingWatch());
  const market = keyed(marketBox, mKey), marketErr = keyed(marketErrBox, mKey), readErrRaw = keyed(readErrBox, ctxKey), balances = keyed(balBox, ctxKey);
  // review follow-up: once the background retries have run out, the sentence no longer says the panel tries again on its own
  const readErr = readErrRaw && !auto ? (readErrRaw === REFUSAL.networkUnreadable ? REFUSAL.networkUnreadableManual : REFUSAL.readFailedManual) : readErrRaw;
  const err = keyed(errBox, ctxKey), done = keyed(doneBox, ctxKey), pending = keyed(pendingBox, ctxKey), checking = checkingKey === ctxKey;
  const setErr = (m: string | null) => setErrBox(m === null ? null : { key: ctxKey, v: m });

  const decimals = market ? (market.kind === "curve" ? market.pool.decimalsA : 6) : 6;
  const sol = (x: bigint) => formatAmount(x, SOL_DECIMALS, 6);
  const tok = (x: bigint) => formatAmount(x, decimals, decimals);
  const inDecimals = side === "sol-in" ? SOL_DECIMALS : decimals;
  const fmtOut = (x: bigint) => (side === "sol-in" ? `${tok(x)} $${p.ticker}` : `${sol(x)} SOL`);

  const refresh = useCallback(async (o: { flight?: boolean } = {}): Promise<ReadResult> => {
    const owner = wallet.publicKey, key = contextKey(p.network, p.mint, owner?.toBase58() ?? null), mk = `${p.network}|${p.mint}|${p.graduatedPool ?? ""}`;
    const g = ++gen.current;
    const current = () => g === gen.current && live.current === key;
    // a passive read in progress is counted, so a Try again flight waits for it to end first (it would otherwise ride the token)
    let release = () => {};
    if (!o.flight) { const mark = new Promise<void>((r) => { release = () => { passive.current.delete(mark); r(); }; }); passive.current.add(mark); }
    setStep((s) => (s === "idle" ? "quoting" : s));
    const run = async () => {
      if (!(await connectionOn(connection, p.network))) throw new Error(REFUSAL.wrongNetwork);
      const m = await readMarket(connection, p.network, mint, pool);
      if (!current()) return;
      setMarketBox({ key: mk, v: m });
      const no = marketRefusal(m, mint, Math.floor(Date.now() / 1000));
      setMarketErrBox(no ? { key: mk, v: no } : null);
      if (owner) { const b = await readBalances(connection, owner, mint); if (current()) setBalBox({ key, v: b }); }
    };
    try {
      await (o.flight ? withFlight(run) : run());
      if (!current()) return "stale";
      setReadErrBox(null);
      return "ok";
    } catch (e) {
      if (!current()) return "stale";
      const msg = String((e as Error).message ?? e);
      if (FINAL_REFUSALS.has(msg)) { setMarketErrBox({ key: mk, v: msg }); setReadErrBox(null); return "final"; }
      setReadErrBox({ key, v: msg === REFUSAL.networkUnreadable ? msg : REFUSAL.readFailed });
      return isBudgetRefusal(e) ? "budget" : "retry";
    } finally { release(); setStep((s) => (s === "quoting" ? "idle" : s)); }
  }, [connection, p.network, p.mint, p.graduatedPool, mint, pool, wallet.publicKey]);
  // the first read, then (F03) background retries with backoff while it keeps failing; passive reads stay in the ordinary lane
  // review follow-up: a retry that comes due while the tab is hidden waits until it is shown; when the retries run out `auto` turns off
  // (the sentence then says to press Try again); a Try again that fails starts the schedule over (`schedule`), so a press never ends it
  useEffect(() => {
    const restarted = restartNext.current; restartNext.current = false;
    let alive = true, attempt = 0, t: ReturnType<typeof setTimeout> | undefined, unlisten = () => {};
    const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
    const later = (ms: number) => { t = setTimeout(() => void tick(true), ms); };
    const tick = async (isRetry: boolean): Promise<void> => {
      if (!alive) return;
      if (isRetry && hidden()) {
        const shown = () => { if (hidden()) return; unlisten(); unlisten = () => {}; void tick(true); };
        document.addEventListener("visibilitychange", shown);
        unlisten = () => document.removeEventListener("visibilitychange", shown);
        return;
      }
      // a Try again is running: wait for it rather than read alongside (its flight would carry this read too)
      if (manual.current) { later(RETRY_FIRST_MS); return; }
      const r = await refresh();
      if (!alive || !failedRead(r)) return;
      if (attempt < RETRY_ATTEMPTS) { setAuto(true); later(retryDelayMs(attempt++)); } else setAuto(false);
    };
    if (restarted) later(RETRY_FIRST_MS); else t = setTimeout(() => void tick(false), 0);
    return () => { alive = false; clearTimeout(t); unlisten(); };
  }, [refresh, schedule]);
  // Try again: the same read now, and once more inside a bounded flight when the ordinary lane failed (spent for the day, or refusing)
  const retryNow = async () => {
    if (retrying || manual.current) return;
    manual.current = true; setRetrying(true);
    let r: ReadResult = "retry";
    try {
      r = await refresh();
      const now = Date.now();
      if (r === "budget" && now - lastFlightRead.current >= FLIGHT_READ_EVERY_MS) { lastFlightRead.current = now; await Promise.all([...passive.current]); r = await refresh({ flight: true }); }
    } finally {
      manual.current = false; setRetrying(false);
      if (failedRead(r) || r === "stale") { restartNext.current = true; setAuto(true); setSchedule((n) => n + 1); }
    }
  };

  const amount = parseAmount(text, inDecimals);
  // a plain computation (cheap): the keyed market above is derived per render, so a manual memo here could not be kept by the compiler
  const quote: Quote | null = (() => {
    if (!market || marketErr || amount === null || amount <= BigInt(0)) return null;
    try { return quoteSwap(market, side, amount, p.poolBurnBps); } catch { return null; }
  })();
  const minOut = quote ? (quote.amountOut * BigInt(10_000 - slippageBps)) / BigInt(10_000) : null;
  const fees = market ? feeBps(market) : null;
  const who = wallet.publicKey?.toBase58() ?? null;
  const walletNo = who ? walletRefusal(who, p.operatorWallets) : null;
  const inputNo = text.trim() === "" ? null : amount === null ? REFUSAL.amountFormat(inDecimals) : amount <= BigInt(0) ? REFUSAL.amount : quote && quote.amountOut <= BigInt(0) ? REFUSAL.noOutput : null;
  const balanceNo = quote && balances ? balanceRefusal(side, quote.amountIn, balances, { sol, tokens: tok, ticker: p.ticker }) : null;
  const blocked = walletNo ?? readErr ?? marketErr ?? inputNo ?? balanceNo;
  const busy = step !== "idle" || pending !== null || checking;

  const ctx = useCallback(() => ({ conn: connection, store, network: p.network, mint, owner: wallet.publicKey as PublicKey }), [connection, store, p.network, mint, wallet.publicKey]);
  // F04: an outcome is shown only for the context (`key`) its swap or status read was started for, and only while that is still current
  const show = useCallback((o: SwapOutcome, earlier: boolean, key: string) => {
    if (key !== live.current) {
      // review follow-up: the outcome of another wallet's swap is kept for it (swap/pending.ts saveOutcome) and shown when it is back
      if (o.kind === "pending") return;   // its held record is already in storage and is loaded again with the wallet
      const [network, coin, owner] = key.split("|") as [Network, string, string];
      const rec: LastOutcome = o.kind === "confirmed"
        ? { v: 1, signature: o.signature, done: { balance: o.balances ? balanceLine(tok(o.balances.tokens), p.ticker) : SWAP_COPY.balanceUnread, earlier } }
        : { v: 1, signature: o.signature, err: o.kind === "failed" ? REFUSAL.failed(o.error) : o.kind === "unconfirmed" ? SWAP_COPY.unconfirmed : SWAP_COPY.expired };
      if (owner) { kept.current.set(key, rec); saveOutcome(store, network, coin, owner, rec); }
      return;
    }
    if (o.kind === "pending") { watch.current.hold(o.pending); setPendingBox({ key, v: o.pending }); return; }
    watch.current.hold(null); setPendingBox(null);
    if (o.kind === "confirmed") {
      if (o.balances) setBalBox({ key, v: o.balances });
      setDoneBox({ key, v: { signature: o.signature, balance: o.balances ? balanceLine(tok(o.balances.tokens), p.ticker) : SWAP_COPY.balanceUnread, earlier } });
      if (!earlier) setText("");
    } else setErrBox({ key, v: o.kind === "failed" ? REFUSAL.failed(o.error) : o.kind === "unconfirmed" ? SWAP_COPY.unconfirmed : SWAP_COPY.expired });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.ticker, decimals, store]);
  // a swap held from before a reload (or an error) is settled before anything else can be sent
  const check = useCallback(async (rec: PendingSwap) => {
    if (watch.current.checking) return;
    const key = contextKey(rec.network, rec.mint, rec.owner);
    setCheckingKey(key);
    try {
      let read: SwapOutcome | null = null;
      const out = await watch.current.check(rec, async (r) => (read = await reconcilePending(ctx(), r)));
      if (out) show(out, true, key);
      // the watch moved on to another wallet while this read ran: a final answer (its record is now cleared) is kept for this wallet
      else if (read && (read as SwapOutcome).kind !== "pending" && key !== live.current) show(read, true, key);
    } finally { setCheckingKey((k) => (k === key ? null : k)); }
  }, [ctx, show]);
  // the connected wallet's own held swap (review 3c): another wallet's record never shows here or blocks this one
  // (review follow-up) with it, the wallet's kept last outcome from while another wallet was connected, shown once
  useEffect(() => {
    const rec = loadPending(store, p.network, p.mint, ownerKey); const key = contextKey(p.network, p.mint, ownerKey);
    const t = setTimeout(() => {
      watch.current.hold(rec); setPendingBox(rec ? { key, v: rec } : null); if (rec) void check(rec);
      // messages of the wallet before are cleared, not just hidden (they come back only through its kept outcome)
      setDoneBox((b) => (b && b.key === key ? b : null)); setErrBox((b) => (b && b.key === key ? b : null));
      const memo = kept.current.get(key); kept.current.delete(key);
      const last = takeOutcome(store, p.network, p.mint, ownerKey) ?? memo ?? null;
      if (last?.done) setDoneBox({ key, v: { signature: last.signature, balance: last.done.balance, earlier: last.done.earlier } });
      else if (last?.err) setErrBox({ key, v: last.err });
    }, 0);
    return () => clearTimeout(t);
  }, [store, p.network, p.mint, ownerKey, check]);
  // review follow-up 2: the check backs off after repeated read errors (PendingWatch.delayMs), instead of every 5 seconds forever
  useEffect(() => { if (!pending) return; let t: ReturnType<typeof setTimeout>, alive = true; const tick = async () => { await check(pending); if (alive) t = setTimeout(tick, watch.current.delayMs()); }; t = setTimeout(tick, watch.current.delayMs()); return () => { alive = false; clearTimeout(t); }; }, [pending, check]);

  async function go() {
    if (!wallet.publicKey || !quote || minOut === null || blocked || busy || amount === null || pending) return;
    if (!wallet.signTransaction) { setErr(REFUSAL.cannotSign); return; }
    // F04: this swap belongs to the context it was started in; its results are written under that key and dropped if it is not current
    const key = ctxKey, mk = mKey, mine = () => live.current === key;
    setErrBox(null); setDoneBox(null);
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
        if (slipNo) { setMarketBox({ key: mk, v: m }); throw new Error(slipNo); }
        const b = await readBalances(connection, owner, mint);
        const balNo = balanceRefusal(side, q.amountIn, b, { sol, tokens: tok, ticker: p.ticker });
        if (balNo) { if (mine()) setBalBox({ key, v: b }); throw new Error(balNo); }
        // the minimum out stays the one shown to the visitor (quote less slippage); the fresh quote only has to clear it
        // sent at most once: the signed swap is held (swap/pending.ts) before the send, and any error after it leaves it pending
        return buildSwap(m, { owner, mint, side, amount, quotedOut: quote.amountOut, slippageBps }).ixs;
      } });
      show(out, false, key);
      if (out.kind === "confirmed") { const kept = fresh as Market | null, after = await readMarket(connection, p.network, mint, pool).catch(() => null); if (after ?? kept) setMarketBox({ key: mk, v: (after ?? kept)! }); }
    } catch (e) { if (mine()) setErrBox({ key, v: String((e as Error).message ?? e) }); }
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
          <input className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono" inputMode="decimal" autoComplete="off" value={text} onChange={(e) => { setText(e.target.value); setErr(null); setDoneBox(null); }} placeholder="0.0" disabled={busy} aria-label={side === "sol-in" ? SWAP_COPY.solIn : SWAP_COPY.tokensIn} />
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
      {readErr && <button type="button" className="rounded border border-neutral-700 px-2 py-0.5 disabled:opacity-50" disabled={retrying} onClick={() => void retryNow()} data-swap-retry>{retrying ? SWAP_COPY.retrying : SWAP_COPY.tryAgain}</button>}
      {pending && <div className="rounded border border-amber-500/60 p-2 text-amber-200" role="status" data-swap-pending>
        <p>{SWAP_COPY.pending} <a className="underline" href={explorerTxUrl(p.network, pending.signature)} rel="noopener" target="_blank">{SWAP_COPY.receiptLink}</a>.</p>
        <button type="button" className="mt-1 rounded border border-neutral-700 px-2 py-0.5 disabled:opacity-50" disabled={checking} onClick={() => void check(pending)}>{checking ? SWAP_COPY.checking : SWAP_COPY.checkAgain}</button>
      </div>}
      {done && <p className="text-emerald-300" data-swap-receipt>{done.earlier ? SWAP_COPY.earlierConfirmed : SWAP_COPY.confirmed} <a className="underline" href={explorerTxUrl(p.network, done.signature)} rel="noopener" target="_blank">{SWAP_COPY.receiptLink}</a>. {done.balance}</p>}
      <p className="text-[11px] text-neutral-500">{SWAP_COPY.noKeys}</p>
    </div>
  );
}
