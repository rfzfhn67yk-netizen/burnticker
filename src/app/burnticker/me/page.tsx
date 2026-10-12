"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletButton, useOpenWalletList } from "../_components/WalletButton";
import { WALLET_COPY, meState, shortAddress, wantsConnect } from "@/lib/burnticker/walletShell";

/**
 * THE CREATOR DASHBOARD (2026-10-10; gated by the shell's wallet since website-13, 2026-10-12): "Your coins" is the one page a connected
 * wallet opens. Disconnected, it shows the connect prompt (walletShell.ts meState), never an empty list; the static pages' "Connect
 * wallet" arrives with ?connect=1 and the wallet list opens. Connect a wallet (read-only: nothing is signed) or look up an address, and see every coin and pair
 * it created (GET /api/burnticker/v1/creators/{wallet}): state, queued units, next settlement, last reading and how many independent
 * reads confirmed it, receipts, the wind-down, the coin page, and "copy today's post" — the lint-checked text from the post generator,
 * copied to the clipboard; nothing is posted for you.
 */
interface Coin { ticker: string; name: string; mint: string; page: string; state: string; badge: string | null; queuedUnits: number; nextSettlementAt: string | null; lastReading: { id: string | null; value: string | null; at: string | null } | null; agreement: { reads: number; methods: string | null; held: string | null }; receipts: number; windDown: string | null; pairId: string | null; todayPost: { text: string; lintOk: boolean; hits: string[] } }
interface Data { wallet: string; coins: Coin[]; pairs: { pairId: string; page: string; sides: string[]; voided: boolean }[] }
const denver = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "—");

export default function CreatorDashboard() {
  const wallet = useWallet();
  const openList = useOpenWalletList();
  const [pasted, setPasted] = useState("");
  // the static pages' "Connect wallet" deep link: open the wallet list on arrival (once), unless a wallet is already connected
  useEffect(() => { if (wantsConnect(window.location.search) && !wallet.connected) openList(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const connectedKey = wallet.connected ? wallet.publicKey?.toBase58() ?? null : null;
  const [d, setD] = useState<Data | null>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false), [copied, setCopied] = useState<string | null>(null);
  const st = meState({ connected: wallet.connected, connecting: wallet.connecting, publicKey: connectedKey, pasted, busy, error: err, data: d });
  const who = st.kind === "prompt" || st.kind === "connecting" ? "" : st.wallet;
  useEffect(() => {
    if (!who) { setD(null); setErr(null); return; }
    setBusy(true); setErr(null);
    fetch(`/api/burnticker/v1/creators/${who}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setD(j); }).catch((e) => setErr(String((e as Error).message))).finally(() => setBusy(false));
  }, [who]);
  const copy = async (c: Coin) => { try { await navigator.clipboard.writeText(c.todayPost.text); setCopied(c.ticker); setTimeout(() => setCopied(null), 2000); } catch { setCopied(null); } };
  const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-5 text-sm">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Your coins</h1>
        {st.kind === "prompt" || st.kind === "connecting"
          ? <div className={card + " space-y-2"} data-me-state={st.kind}><p className="text-neutral-300">{WALLET_COPY.prompt}</p><WalletButton variant="menu" /></div>
          : <p className="text-neutral-400" data-me-state={st.kind}>{st.source === "connected" ? <>Showing the coins created by your connected wallet, <span className="font-mono">{shortAddress(st.wallet)}</span>.</> : <>Showing the coins created by <span className="font-mono">{shortAddress(st.wallet)}</span>. No wallet is connected.</>}</p>}
        <details className="text-xs"><summary className="cursor-pointer text-neutral-400">{WALLET_COPY.lookup}</summary><input className="mt-2 w-full max-w-md rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm" placeholder="A creator's wallet address" value={pasted} onChange={(e) => setPasted(e.target.value)} aria-label="Creator wallet address" /></details>
      </header>
      {st.kind === "loading" && <p className="text-neutral-500" role="status">Reading the coin registry.</p>}
      {st.kind === "error" && <p className="text-red-400" role="alert">The coins for this wallet could not be read just now. {st.message}</p>}
      {d && st.kind === "empty" && <p className={card + " text-neutral-400"}>No coins were created by <span className="font-mono">{shortAddress(d.wallet)}</span> yet. <Link className="underline" href="/burnticker/templates">Start from a template</Link>.</p>}
      {d && d.pairs.length > 0 && <section className="space-y-1"><h2 className="font-medium">Pairs</h2><ul className="flex flex-wrap gap-2">{d.pairs.map((p) => <li key={p.pairId}><Link className="underline font-mono" href={p.page}>{p.sides.map((s) => `$${s}`).join(" vs ")}</Link>{p.voided && <span className="ml-1 text-xs text-amber-300">voided</span>}</li>)}</ul></section>}
      {d && d.coins.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2" aria-label="your coins">
          {d.coins.map((c) => (
            <li key={c.mint} className={card + " space-y-2"}>
              <div className="flex flex-wrap items-center gap-2"><Link className="font-mono text-base underline" href={c.page}>${c.ticker}</Link><span className="text-neutral-400">{c.name}</span><span className="bt-chip">{c.state}</span>{c.badge && <span className="bt-chip bt-chip-window">{c.badge}</span>}</div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-neutral-500">queued units</dt><dd>{c.queuedUnits}</dd>
                <dt className="text-neutral-500">next settlement</dt><dd>{c.nextSettlementAt ? `${denver(c.nextSettlementAt)} (Denver)` : "none scheduled"}</dd>
                <dt className="text-neutral-500">last reading</dt><dd>{c.lastReading ? `${c.lastReading.id ?? "—"}: ${c.lastReading.value ?? "—"}` : "none yet"}</dd>
                <dt className="text-neutral-500">confirmed by</dt><dd>{c.agreement.held ? <span className="text-amber-300">held: {c.agreement.held}</span> : c.agreement.reads >= 2 ? `${c.agreement.reads} independent reads (${c.agreement.methods})` : c.agreement.reads === 1 ? "one read" : "—"}</dd>
                <dt className="text-neutral-500">receipts</dt><dd>{c.receipts}</dd>
                <dt className="text-neutral-500">wind-down</dt><dd>{c.windDown ?? "—"}</dd>
              </dl>
              <details className="text-xs"><summary className="cursor-pointer text-neutral-300">Today&apos;s post {c.todayPost.lintOk ? "passes the wording check." : <span className="text-red-400">fails the wording check because of {c.todayPost.hits.join(", ")}.</span>}</summary><pre className="mt-1 whitespace-pre-wrap rounded bg-neutral-950 p-2 text-neutral-300">{c.todayPost.text}</pre></details>
              <button className="rounded border border-neutral-700 px-2 py-1 text-xs hover:border-amber-400 disabled:opacity-40" disabled={!c.todayPost.lintOk} onClick={() => void copy(c)}>{copied === c.ticker ? "copied ✓" : "copy today's post"}</button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
