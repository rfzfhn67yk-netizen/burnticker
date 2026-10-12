"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

/**
 * THE CREATOR DASHBOARD (2026-10-10): connect a wallet (read-only: nothing is signed) or paste its address, and see every coin and pair
 * it created (GET /api/burnticker/v1/creators/{wallet}): state, queued units, next settlement, last reading and how many independent
 * reads confirmed it, receipts, the wind-down, the coin page, and "copy today's post" — the lint-checked text from the post generator,
 * copied to the clipboard; nothing is posted for you.
 */
interface Coin { ticker: string; name: string; mint: string; page: string; state: string; badge: string | null; queuedUnits: number; nextSettlementAt: string | null; lastReading: { id: string | null; value: string | null; at: string | null } | null; agreement: { reads: number; methods: string | null; held: string | null }; receipts: number; windDown: string | null; pairId: string | null; todayPost: { text: string; lintOk: boolean; hits: string[] } }
interface Data { wallet: string; coins: Coin[]; pairs: { pairId: string; page: string; sides: string[]; voided: boolean }[] }
const PUB = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const denver = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "—");

export default function CreatorDashboard() {
  const wallet = useWallet();
  const [pasted, setPasted] = useState("");
  const who = wallet.publicKey?.toBase58() ?? (PUB.test(pasted.trim()) ? pasted.trim() : "");
  const [d, setD] = useState<Data | null>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false), [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!who) { setD(null); return; }
    setBusy(true); setErr(null);
    fetch(`/api/burnticker/v1/creators/${who}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setD(j); }).catch((e) => setErr(String((e as Error).message))).finally(() => setBusy(false));
  }, [who]);
  const copy = async (c: Coin) => { try { await navigator.clipboard.writeText(c.todayPost.text); setCopied(c.ticker); setTimeout(() => setCopied(null), 2000); } catch { setCopied(null); } };
  const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-5 text-sm">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Your coins</h1>
        <p className="text-neutral-400">Connect a wallet to see the coins and pairs it created. This page only reads. It never asks you to sign anything, and it never posts for you.</p>
        <div className="flex flex-wrap items-center gap-2"><WalletMultiButton /><input className="w-80 rounded border border-neutral-700 bg-neutral-950 px-2 py-1" placeholder="or paste a creator wallet address" value={pasted} onChange={(e) => setPasted(e.target.value)} aria-label="creator wallet address" /></div>
      </header>
      {busy && <p className="text-neutral-500">Reading the registry…</p>}
      {err && <p className="text-red-400">{err}</p>}
      {d && d.coins.length === 0 && <p className={card + " text-neutral-400"}>No coins were created by <span className="font-mono">{d.wallet.slice(0, 6)}…{d.wallet.slice(-4)}</span> yet. <Link className="underline" href="/burnticker/templates">Start from a template</Link>.</p>}
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
