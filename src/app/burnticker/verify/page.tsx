"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * VERIFY A MINT (growth batch 2026-10-10; src/lib/burnticker/verifyMint.ts): paste any Solana mint and get one plain answer — "Burnticker
 * coin: yes" with the rule sha, creator, launch date, receipts and the coin page; "NOT registered with the burn_receipts program" only when
 * every network answered; "Unable to verify" when a chain read failed (audit 4 BT-01). Registration (the program, on devnet and mainnet)
 * and catalogue membership (Burnticker's registry) are shown as two separate facts.
 * Reads GET /api/burnticker/v1/verify-mint/<mint> (cached 60 s). `?mint=` prefills.
 */
interface Check { id: string; ok: boolean | null; detail: string }
interface NetRead { network: string; programId: string; state: "registered" | "not-registered" | "unavailable"; config: string | null; rulesSha256: string | null; reason: string | null }
interface V { verdict: string; headline: string; summary: string; mint: string; cluster: string; programId: string; registration?: { state: string; networks: NetRead[] }; catalogue?: { state: string; network: string }; disclosed?: { label: string } | null; program: { read: boolean; config: string | null; rulesSha256: string | null }; coin: { ticker: string; name: string; status: string; creator: string; launchedAt: string | null; rulesSha256: string; receipts: number; pageUrl: string; rulesMatch: boolean | null } | null; flagship?: { ticker: string; network: string; rulesSha256: string; createdOn: string; createTx: string | null; page: string; rulesMatch: boolean | null } | null; checks: Check[]; links: { verifier: string; page: string | null } }

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
  const unknown = v?.verdict === "unavailable";
  const REG: Record<NetRead["state"], string> = { registered: "registered", "not-registered": "not registered", unavailable: "unable to verify" };
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 space-y-5 text-sm">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Verify a mint</h1>
        <p className="text-neutral-400">Paste any Solana token address. The answer compares two records: what the burn program has stored on chain for that token, and what Burnticker&apos;s own registry lists. A coin that only looks like a Burnticker coin is listed on <Link className="underline" href="/burnticker/not-burnticker">Not Burnticker</Link>.</p>
      </header>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(mint); }}>
        <label htmlFor="mint" className="sr-only">Mint address</label>
        <input id="mint" value={mint} onChange={(e) => setMint(e.target.value)} placeholder="mint address (base58)" className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs" autoComplete="off" spellCheck={false} />
        <button type="submit" className="bt-launch-btn" disabled={busy}>{busy ? "checking…" : "Check"}</button>
      </form>
      <p className="text-red-400 text-xs empty:hidden" aria-live="polite">{err ?? ""}</p>
      {v && (
        <section className={`rounded-lg border p-4 space-y-2 ${good ? "border-emerald-700" : unknown ? "border-amber-700" : "border-neutral-700"} bg-neutral-900`} aria-live="polite" data-verdict={v.verdict}>
          <h2 className={`text-lg font-semibold ${good ? "text-emerald-400" : unknown ? "text-amber-300" : ""}`}>{v.headline}</h2>
          <p>{v.summary}</p>
          {v.registration && v.catalogue && <dl className="grid gap-2 text-xs sm:grid-cols-2" data-separate-facts>
            <div className="rounded border border-neutral-800 p-2"><dt className="text-neutral-500">Registered with the burn program on chain</dt>{/* 2026-10-14 (owner): only the network this site shows; a "devnet: not registered" row under a mainnet coin was noise */}
              {v.registration.networks.filter((n) => n.network === v.catalogue!.network || n.state === "registered").map((n) => <dd key={n.network} className="mt-1"><span className={n.state === "registered" ? "text-emerald-400" : n.state === "unavailable" ? "text-amber-300" : "text-neutral-300"}>{n.network}: {REG[n.state]}</span> <span className="block break-all font-mono text-neutral-500">Program {n.programId}</span></dd>)}</div>
            <div className="rounded border border-neutral-800 p-2"><dt className="text-neutral-500">Listed in the Burnticker catalogue on {v.catalogue.network}, the network this site shows</dt><dd className="mt-1">{v.catalogue.state === "absent" ? (v.flagship ? "not listed: the flagship runs on its own keeper" : "not listed") : v.catalogue.state}</dd></div>
          </dl>}
          {v.flagship && <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3" data-flagship>
            <div><dt className="text-neutral-500">coin</dt><dd className="font-mono">${v.flagship.ticker}, flagship</dd></div>
            <div><dt className="text-neutral-500">created</dt><dd className="font-mono">{v.flagship.createdOn} on {v.flagship.network}</dd></div>
            <div className="col-span-2 sm:col-span-3"><dt className="text-neutral-500">rules file sha256</dt><dd className="font-mono break-all">{v.flagship.rulesSha256}</dd></div>
          </dl>}
          {v.coin && <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            <div><dt className="text-neutral-500">coin</dt><dd className="font-mono">${v.coin.ticker}, {v.coin.status}</dd></div>
            <div><dt className="text-neutral-500">launched</dt><dd className="font-mono">{v.coin.launchedAt ? v.coin.launchedAt.slice(0, 10) : "—"}</dd></div>
            <div><dt className="text-neutral-500">receipts</dt><dd className="font-mono">{v.coin.receipts}</dd></div>
            <div className="col-span-2 sm:col-span-3"><dt className="text-neutral-500">creator</dt><dd className="font-mono break-all">{v.coin.creator}</dd></div>
            <div className="col-span-2 sm:col-span-3"><dt className="text-neutral-500">rules sha256</dt><dd className="font-mono break-all">{v.coin.rulesSha256}</dd></div>
          </dl>}
          <ul className="space-y-1 text-xs">{v.checks.map((c) => <li key={c.id}><span className={c.ok === true ? "text-emerald-400" : c.ok === false ? "text-red-400" : "text-neutral-500"}>{c.ok === true ? "✓" : c.ok === false ? "✗" : "–"}</span> {c.detail}</li>)}</ul>
          <p className="text-xs text-neutral-500 break-all">Mint {v.mint}.{v.verdict === "invalid" ? "" : ` The catalogue was read on ${v.cluster}.`}</p>
          <p className="text-xs">{v.links.page && <>{v.links.page.startsWith("/burnticker") ? <Link className="underline" href={v.links.page}>Open the coin page</Link> : <a className="underline" href={v.links.page}>Open the coin page</a>} · </>}<Link className="underline" href={v.links.verifier}>Check a receipt transaction</Link></p>
        </section>
      )}
      <p className="text-xs text-neutral-500">The same answer is available as JSON at <code>/api/burnticker/v1/verify-mint/&lt;mint&gt;</code>.</p>
    </main>
  );
}
