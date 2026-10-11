"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TRUSTPACK_SECTION_COPY } from "@/lib/burnticker/trustpack/copy";

/**
 * THE TRUST PAGE'S "CHECK IT YOURSELF" SECTION (trust pack, 2026-10-10): links to /burnticker/check, /burnticker/fees/ledger and
 * /burnticker/operator, the never-buys monitor's status line (GET /api/burnticker/v1/operator), and the bounty wallet with its live
 * balance once it exists (GET /api/burnticker/v1/bounty; TODO_BOUNTY_WALLET until then), with the decided reports.
 */
interface Bounty { wallet: string | null; walletTodo: string | null; balanceLamports: string | null; error: string | null; rangeSol: number[]; status: string; reports: { paid: { date: string; title: string; severity: string; sol: number; tx: string }[]; rejected: { date: string; title: string; reason: string }[]; note: string } }
interface Op { cluster: string; neverBuys: { line: string; status: string } }

const PAGES = [
  { href: "/burnticker/check", title: "Check this yourself", what: "where money can go, who can do what, what is locked, what is not done, the build hashes, and a receipt verifier that runs in your browser" },
  { href: "/burnticker/fees/ledger", title: "Fee ledger", what: "every lamport the developer fee wallet received, from chain, by month, and what the fee pays for" },
  { href: "/burnticker/operator", title: "Operator", what: "who runs this, every operator wallet, the signed statement and the never-buys monitor" },
];

export default function TrustPackSection({ card }: { card: string }) {
  const [b, setB] = useState<Bounty | null>(null);
  const [op, setOp] = useState<Op | null>(null);
  useEffect(() => {
    fetch("/api/burnticker/v1/bounty").then((r) => r.json()).then(setB).catch(() => setB(null));
    fetch("/api/burnticker/v1/operator").then((r) => r.json()).then(setOp).catch(() => setOp(null));
  }, []);
  const tone = op?.neverBuys.status === "red" ? "text-red-400" : op?.neverBuys.status === "clear" ? "text-emerald-400" : "text-amber-300";
  return (
    <section className={card} id="check-it-yourself">
      <h2 className="font-medium">{TRUSTPACK_SECTION_COPY.title}</h2>
      <p className="text-xs text-neutral-300">{TRUSTPACK_SECTION_COPY.intro}</p>
      <ul className="text-xs list-disc pl-5 mt-1">{PAGES.map((p) => <li key={p.href}><Link className="underline" href={p.href}>{p.title}</Link> — {p.what}</li>)}</ul>
      {op && <p className={`text-xs mt-2 ${tone}`}>Never buys a platform coin ({op.cluster}): {op.neverBuys.line}</p>}
      <h3 className="text-xs font-medium mt-3">{TRUSTPACK_SECTION_COPY.bountyTitle}</h3>
      {!b ? <p className="text-xs text-neutral-500">Loading…</p> : b.wallet
        ? <p className="text-xs"><code className="break-all">{b.wallet}</code> · balance {b.balanceLamports !== null ? `${(Number(b.balanceLamports) / 1e9).toFixed(4)} SOL (live, mainnet)` : `unavailable${b.error ? `: ${b.error}` : ""}`} · {b.status}</p>
        : <p className="text-xs text-amber-400">{TRUSTPACK_SECTION_COPY.bountyTodo}</p>}
      {b && (b.reports.paid.length + b.reports.rejected.length === 0
        ? <p className="text-xs text-neutral-500">{TRUSTPACK_SECTION_COPY.bountyReports}</p>
        : <ul className="text-xs mt-1">{b.reports.paid.map((r) => <li key={r.tx}>{r.date} · {r.title} · {r.severity} · {r.sol} SOL · <code>{r.tx.slice(0, 12)}…</code></li>)}{b.reports.rejected.map((r) => <li key={r.date + r.title}>{r.date} · {r.title} · rejected: {r.reason}</li>)}</ul>)}
    </section>
  );
}
