"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * VERIFY A MINT (growth batch 2026-10-10; src/lib/burnticker/verifyMint.ts): paste any Solana mint and get one plain answer — "Burnticker
 * coin: yes" with the rule sha, creator, launch date, receipts and the coin page; or "NOT registered with the burn_receipts program".
 * Reads GET /api/burnticker/v1/verify-mint/<mint> (the program's TokenConfig and the registry, compared; cached 60 s). `?mint=` prefills.
 */
interface Check { id: string; ok: boolean | null; detail: string }
interface V { verdict: string; headline: string; summary: string; mint: string; cluster: string; programId: string; program: { read: boolean; config: string | null; rulesSha256: string | null }; coin: { ticker: string; name: string; status: string; creator: string; launchedAt: string | null; rulesSha256: string; receipts: number; pageUrl: string; rulesMatch: boolean | null } | null; checks: Check[]; links: { verifier: string; page: string | null } }

export default function VerifyMintPage() {
  const [mint, setMint] = useState("");
  const [v, setV] = useState<V | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (m: string) => {
    const x = m.trim();
    if (!x) return;
    setBusy(true); setErr(null);
    try { const r = await fetch(`/api/burnticker/v1/verify-mint/${encodeURIComponent(x)}`); const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setV(j); window.history.replaceState(null, "", `?mint=${encodeURIComponent(x)}`); }
    catch (e) { setErr(String((e as Error).message ?? e)); } finally { setBusy(false); }
  };
  useEffect(() => { const m = new URLSearchParams(window.location.search).get("mint"); if (m) { setMint(m); void run(m); } }, []);
  const good = v?.verdict === "burnticker";
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 space-y-5 text-sm">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Verify a mint</h1>
        <p className="text-neutral-400">Paste any Solana token address. The answer comes from the burn_receipts program&apos;s on-chain TokenConfig and Burnticker&apos;s registry, compared. A coin that only looks like a Burnticker coin is listed on <Link className="underline" href="/burnticker/not-burnticker">Not Burnticker</Link>.</p>
      </header>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(mint); }}>
        <label htmlFor="mint" className="sr-only">Mint address</label>
        <input id="mint" value={mint} onChange={(e) => setMint(e.target.value)} placeholder="mint address (base58)" className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs" autoComplete="off" spellCheck={false} />
        <button type="submit" className="bt-launch-btn" disabled={busy}>{busy ? "checking…" : "Check"}</button>
      </form>
      {err && <p className="text-red-400 text-xs">{err}</p>}
      {v && (
        <section className={`rounded-lg border p-4 space-y-2 ${good ? "border-emerald-700" : "border-neutral-700"} bg-neutral-900`} aria-live="polite">
          <h2 className={`text-lg font-semibold ${good ? "text-emerald-400" : ""}`}>{v.headline}</h2>
          <p>{v.summary}</p>
          {v.coin && <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            <div><dt className="text-neutral-500">coin</dt><dd className="font-mono">${v.coin.ticker} · {v.coin.status}</dd></div>
            <div><dt className="text-neutral-500">launched</dt><dd className="font-mono">{v.coin.launchedAt ? v.coin.launchedAt.slice(0, 10) : "—"}</dd></div>
            <div><dt className="text-neutral-500">receipts</dt><dd className="font-mono">{v.coin.receipts}</dd></div>
            <div className="col-span-2 sm:col-span-3"><dt className="text-neutral-500">creator</dt><dd className="font-mono break-all">{v.coin.creator}</dd></div>
            <div className="col-span-2 sm:col-span-3"><dt className="text-neutral-500">rules sha256</dt><dd className="font-mono break-all">{v.coin.rulesSha256}</dd></div>
          </dl>}
          <ul className="space-y-1 text-xs">{v.checks.map((c) => <li key={c.id}><span className={c.ok === true ? "text-emerald-400" : c.ok === false ? "text-red-400" : "text-neutral-500"}>{c.ok === true ? "✓" : c.ok === false ? "✗" : "–"}</span> {c.detail}</li>)}</ul>
          <p className="text-xs text-neutral-500 break-all">mint {v.mint} · {v.cluster} · program {v.programId}</p>
          <p className="text-xs">{v.links.page && <><Link className="underline" href={v.links.page}>coin page →</Link> · </>}<Link className="underline" href={v.links.verifier}>verify a receipt transaction →</Link></p>
        </section>
      )}
      <p className="text-xs text-neutral-500">The same answer as JSON: <code>/api/burnticker/v1/verify-mint/&lt;mint&gt;</code>. Not affiliated with any team, league, candidate, agency or market.</p>
    </main>
  );
}
