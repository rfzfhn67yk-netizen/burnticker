"use client";

import { utcDateTime } from "@/lib/burnticker/utcWords";
import { EmptyState } from "../../_components/EmptyState";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LEDGER_COPY } from "@/lib/burnticker/trustpack/copy";

/**
 * /burnticker/fees/ledger — THE DEVELOPER FEE LEDGER (trust pack, 2026-10-10). Rendered from GET /api/burnticker/v1/fees/ledger
 * (src/lib/burnticker/trustpack/ledger.ts): every balance change of the pinned developer fee wallet, read from chain, by UTC month;
 * the expenses the fee pays (config/burnticker/expenses.json, placeholders marked, never shown as zero).
 */
interface Ledger {
  generatedAt: string; cluster: string; wallet: string | null; source: "chain" | "unavailable"; note: string; served?: string;
  balanceLamports: string | null; totals: { inLamports: string; outLamports: string; transactions: number; complete: boolean };
  months: { month: string; inLamports: string; outLamports: string; txIn: number; txOut: number }[];
  entries: { signature: string; blockTime: string | null; deltaLamports: string; direction: "in" | "out"; counterparty: string | null; err: boolean }[];
  expenses: { whatTheFeePaysFor: string; items: { id: string; label: string; cadence: string; usd: number | null; placeholder: boolean; note: string }[] };
  /** LP locked forever (2026-10-10): the operator's 20 % of post-graduation LP fees, paid by claim_lock_fees to the operator treasury. */
  lpFees?: { title: string; treasury: string | null; treasuryPinned: boolean; split: { burnBps: number; operatorBps: number }; claims: number; solLamports: string; toOperatorLamports: string; toBurnPoolLamports: string; source: string; note: string };
}

const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
const sol = (l: string | null) => (l === null ? "—" : (Number(l) / 1e9).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 9 }));

export default function FeeLedgerPage() {
  const [l, setL] = useState<Ledger | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetch("/api/burnticker/v1/fees/ledger").then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setL(j); }).catch((e) => setErr(String(e.message ?? e))); }, []);
  const explorer = (k: string, kind: "tx" | "address") => `https://explorer.solana.com/${kind}/${k}${l?.cluster === "devnet" ? "?cluster=devnet" : ""}`;
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-6 text-sm">
      <header>
        <p className="text-xs"><Link className="underline" href="/burnticker/trust">← Trust</Link></p>
        <h1 className="text-2xl font-semibold">{LEDGER_COPY.title}</h1>
        <p className="text-neutral-300">{LEDGER_COPY.intro}</p>
      </header>
      {err && <p className="text-red-400">{err}</p>}
      {!l && !err && <EmptyState kind="loading" body="Loading the fee ledger." />}
      {l && <>
        <section className={card}>
          <p className="text-xs">{LEDGER_COPY.walletLine} {l.wallet ? <><a className="underline break-all" href={explorer(l.wallet, "address")}><code>{l.wallet}</code></a>.</> : <span className="text-amber-400">not set yet.</span>} It is on {l.cluster}. {l.balanceLamports === null ? "Its balance could not be read." : `Its balance now is ${sol(l.balanceLamports)} SOL.`}</p>
          {l.cluster === "devnet" && <p className="text-xs text-amber-300 mt-1">{LEDGER_COPY.devnetNote}</p>}
          <p className="text-xs text-neutral-500 mt-1">{l.note}{/[.!?]$/.test(l.note) ? "" : "."} This copy was generated on {utcDateTime(l.generatedAt)}.{l.served ? ` ${l.served}` : ""}</p>
          {l.source === "unavailable" && <p className="text-xs text-amber-400 mt-1">{LEDGER_COPY.unavailable}</p>}
        </section>
        <section className={card}>
          <h2 className="font-medium">{LEDGER_COPY.incomeTitle}</h2>
          {l.months.length === 0 ? <p className="text-xs text-neutral-500">The wallet has no transactions yet.</p> : <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="text-neutral-400 text-left"><tr><th className="p-2">Month (UTC)</th><th className="p-2 text-right">Received SOL</th><th className="p-2 text-right">Sent SOL</th><th className="p-2 text-right">Transactions in / out</th></tr></thead>
            <tbody>{l.months.map((m) => <tr key={m.month} className="border-t border-neutral-800"><td className="p-2">{m.month}</td><td className="p-2 text-right tabular-nums">{sol(m.inLamports)}</td><td className="p-2 text-right tabular-nums">{sol(m.outLamports)}</td><td className="p-2 text-right">{m.txIn} / {m.txOut}</td></tr>)}
              <tr className="border-t border-neutral-700 font-medium"><td className="p-2">total</td><td className="p-2 text-right tabular-nums">{sol(l.totals.inLamports)}</td><td className="p-2 text-right tabular-nums">{sol(l.totals.outLamports)}</td><td className="p-2 text-right">{l.totals.transactions}{l.totals.complete ? "" : " (partial)"}</td></tr></tbody></table></div>}
        </section>
        {l.lpFees && <section className={card} aria-label="Operator LP-fee line">
          <h2 className="font-medium">{l.lpFees.title}</h2>
          <p className="text-xs text-neutral-300">{l.lpFees.note}</p>
          <p className="text-xs mt-1">The operator treasury {l.lpFees.treasury ? <>is <a className="underline break-all" href={explorer(l.lpFees.treasury, "address")}><code>{l.lpFees.treasury}</code></a>.</> : <span className="text-amber-400">is not set on this network yet.</span>} There {l.lpFees.claims === 1 ? "has been 1 claim" : `have been ${l.lpFees.claims} claims`}, for {sol(l.lpFees.solLamports)} SOL of liquidity-pool fees. Of that, {sol(l.lpFees.toOperatorLamports)} SOL ({l.lpFees.split.operatorBps / 100}%) went to the operator and {sol(l.lpFees.toBurnPoolLamports)} SOL ({l.lpFees.split.burnBps / 100}%) went to burn pools. {l.lpFees.source === "keeper records" ? "These figures come from the keeper's records." : "No claim records are available yet."}</p>
        </section>}
        <section className={card}>
          <h2 className="font-medium">{LEDGER_COPY.expensesTitle}</h2>
          <p className="text-xs text-neutral-300">{l.expenses.whatTheFeePaysFor}</p>
          <p className="text-xs text-neutral-500">{LEDGER_COPY.expensesSource}</p>
          <div className="overflow-x-auto mt-2"><table className="w-full text-xs"><thead className="text-neutral-400 text-left"><tr><th className="p-2">Item</th><th className="p-2">Cadence</th><th className="p-2 text-right">USD</th><th className="p-2">Note</th></tr></thead>
            <tbody>{l.expenses.items.map((e) => <tr key={e.id} className="border-t border-neutral-800 align-top"><td className="p-2">{e.label}</td><td className="p-2">{e.cadence}</td><td className="p-2 text-right tabular-nums">{e.usd === null ? <span className="text-amber-400">{LEDGER_COPY.placeholder}</span> : `$${e.usd.toLocaleString("en-US")}`}</td><td className="p-2 text-neutral-400">{e.note}</td></tr>)}</tbody></table></div>
        </section>
        {l.entries.length > 0 && <section className={card}>
          <h2 className="font-medium">{LEDGER_COPY.entriesTitle}</h2>
          <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="text-neutral-400 text-left"><tr><th className="p-2">Time (UTC)</th><th className="p-2">Direction</th><th className="p-2 text-right">SOL</th><th className="p-2">Counterparty</th><th className="p-2">Transaction</th></tr></thead>
            <tbody>{l.entries.map((e) => <tr key={e.signature} className="border-t border-neutral-800"><td className="p-2">{e.blockTime ?? "—"}</td><td className="p-2">{e.direction}{e.err ? " (the transaction failed, so only the fee moved)" : ""}</td><td className="p-2 text-right tabular-nums">{sol(e.deltaLamports.replace("-", ""))}</td><td className="p-2 break-all"><code>{e.counterparty ?? "—"}</code></td><td className="p-2"><a className="underline" href={explorer(e.signature, "tx")}><code>{e.signature.slice(0, 12)}…</code></a></td></tr>)}</tbody></table></div>
        </section>}
        <p className="text-xs text-neutral-500">{LEDGER_COPY.regenerated} The same data is available as JSON at <code>/api/burnticker/v1/fees/ledger</code>.</p>
      </>}
    </main>
  );
}
