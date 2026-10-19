"use client";

import { useJsonRead, ReadFailurePanel } from "../_components/useJsonRead";
import Link from "next/link";
import { TRUSTPACK_SECTION_COPY } from "@/lib/burnticker/trustpack/copy";
import { denverTime } from "@/lib/burnticker/denverTime";

/**
 * THE TRUST PAGE'S "CHECK IT YOURSELF" SECTION (trust pack, 2026-10-10): links to /burnticker/check, /burnticker/fees/ledger and
 * /burnticker/operator, the never-buys monitor's status line (GET /api/burnticker/v1/operator), and the bounty wallet with its live
 * balance once it exists (GET /api/burnticker/v1/bounty; TODO_BOUNTY_WALLET until then), with the decided reports.
 */
interface Bounty { wallet: string | null; walletTodo: string | null; balanceLamports: string | null; error: string | null; recordedFunding?: { sol: number; date: string; transaction: string | null; source?: string; transactions?: { signature: string; lamports: string; blockTime: string | null; explorerUrl: string }[] } | null; balanceReadAt?: string; reconciliation?: { line: string; differenceLamports: string | null } | null; rangeSol: number[]; status: string; reports: { paid: { date: string; title: string; severity: string; sol: number; tx: string }[]; rejected: { date: string; title: string; reason: string }[]; note: string } }
interface Op { cluster: string; neverBuys: { line: string; status: string; /** ACC-02: what was checked and what could not be read */ scopeLine?: string | null; report?: { ranAt: string } | null } }

const PAGES = [
  { href: "/burnticker/check", title: "Check this yourself", what: "It shows where money can go, who can do what, what is locked and what is not done. It also lists the build hashes and has a receipt checker that runs in your browser." },
  { href: "/burnticker/fees/ledger", title: "Fee ledger", what: "It lists every lamport the developer fee wallet received, read from the chain and grouped by month. It also shows what the fee pays for." },
  { href: "/burnticker/operator", title: "Who runs this", what: "It names the operator and lists every operator wallet, the signed statement and the monitor that watches those wallets for platform coins." },
];

export default function TrustPackSection({ card }: { card: string }) {
  // audit R01: both reads go through readJson — a failed one says so with a Retry instead of a silent "Loading…" forever
  const bounty = useJsonRead<Bounty>("/api/burnticker/v1/bounty");
  const b = bounty.data, op = useJsonRead<Op>("/api/burnticker/v1/operator").data;
  const tone = op?.neverBuys.status === "red" ? "text-red-400" : op?.neverBuys.status === "clear" ? "text-emerald-400" : "text-amber-300";
  return (
    <section className={card} id="check-it-yourself">
      <h2 className="font-medium">{TRUSTPACK_SECTION_COPY.title}</h2>
      <p className="text-xs text-neutral-300">{TRUSTPACK_SECTION_COPY.intro}</p>
      <ul className="text-xs list-disc pl-5 mt-1">{PAGES.map((p) => <li key={p.href}><Link className="underline" href={p.href}>{p.title}</Link>. {p.what}</li>)}</ul>
      {op && <p className={`text-xs mt-2 ${tone}`} data-never-buys>On {op.cluster}, a monitor checks that the operator never buys a platform coin. {op.neverBuys.line}</p>}
      {/* continuous audit 2026-10-19 ACC-02: the scope of the check (recent history only), what could not be read, the named exception */}
      {op?.neverBuys.scopeLine && <p className="text-xs text-neutral-400" data-never-buys-scope>{op.neverBuys.scopeLine}{op.neverBuys.report?.ranAt ? ` It last ran at ${denverTime(op.neverBuys.report.ranAt)}.` : ""} <Link className="underline" href="/burnticker/operator">The full report</Link> lists every wallet, holding and read error.</p>}
      <h3 className="text-xs font-medium mt-3">{TRUSTPACK_SECTION_COPY.bountyTitle}</h3>
      {!b ? (bounty.failure ? <ReadFailurePanel what="The bounty wallet" failure={bounty.failure} triedAt={bounty.triedAt} loading={bounty.loading} retry={bounty.retry} /> : <p className="text-xs text-neutral-500">Loading…</p>) : b.wallet
        ? <ul className="text-xs space-y-0.5" data-bounty><li><code className="break-all">{b.wallet}</code> (mainnet)</li>
            {/* UX report 3 item 5: the recorded funding and the live read are two separate facts; neither stands in for the other */}
            <li>recorded funding (owner statement): {b.recordedFunding ? `${b.recordedFunding.sol} SOL on ${b.recordedFunding.date}` : "none recorded"}</li>
            <li>funding transaction: {b.recordedFunding?.transactions?.length ? b.recordedFunding.transactions.map((x) => <a key={x.signature} className="underline mr-2" href={x.explorerUrl} target="_blank" rel="noreferrer"><code>{x.signature.slice(0, 12)}…</code> ({(Number(x.lamports) / 1e9).toFixed(4)} SOL{x.blockTime ? `, ${denverTime(x.blockTime)}` : ""})</a>) : "none found"}</li>
            <li>live balance: {b.balanceLamports !== null ? `${(Number(b.balanceLamports) / 1e9).toFixed(4)} SOL (read from a mainnet node${b.balanceReadAt ? ` at ${denverTime(b.balanceReadAt)}` : ""})` : `unavailable${b.error ? ` (${b.error})` : ""}`}</li>
            {b.reconciliation && <li className={b.reconciliation.differenceLamports !== null && b.reconciliation.differenceLamports !== "0" ? "text-amber-300" : "text-neutral-400"}>{b.reconciliation.line}</li>}</ul>
        : <p className="text-xs text-amber-400">{TRUSTPACK_SECTION_COPY.bountyTodo}</p>}
      {b && (b.reports.paid.length + b.reports.rejected.length === 0
        ? <p className="text-xs text-neutral-500">{TRUSTPACK_SECTION_COPY.bountyReports}</p>
        : <ul className="text-xs mt-1">{b.reports.paid.map((r) => <li key={r.tx}>{r.date}: {r.title} ({r.severity}). Paid {r.sol} SOL in <code>{r.tx.slice(0, 12)}…</code>.</li>)}{b.reports.rejected.map((r) => <li key={r.date + r.title}>{r.date}: {r.title}. Rejected. {r.reason}</li>)}</ul>)}
    </section>
  );
}
