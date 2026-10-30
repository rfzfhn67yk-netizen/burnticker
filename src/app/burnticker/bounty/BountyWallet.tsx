"use client";

import { utcDateTime, utcDay } from "@/lib/burnticker/utcWords";
import { BOUNTY_COPY } from "@/lib/burnticker/historyCopy";
import { useJsonRead, ReadFailurePanel } from "../_components/useJsonRead";
import { EmptyState } from "../_components/EmptyState";

interface Bounty {
  wallet: string | null; balanceLamports: string | null; balanceReadAt?: string; error: string | null;
  recordedFunding?: { sol: number; date: string; transactions?: { signature: string; lamports: string; explorerUrl: string }[] } | null;
  reports: { paid: { date: string; title: string; severity: string; sol: number; tx: string }[]; rejected: { date: string; title: string; reason: string }[] };
}

/** The bounty wallet's live balance and the decided reports, read from GET /api/burnticker/v1/bounty (the trust page's own read). */
export function BountyWallet() {
  const r = useJsonRead<Bounty>("/api/burnticker/v1/bounty");
  const b = r.data;
  if (!b) return r.failure ? <ReadFailurePanel what="The bounty wallet" failure={r.failure} triedAt={r.triedAt} loading={r.loading} retry={r.retry} /> : <EmptyState kind="loading" compact />;
  const sol = (l: string | number) => `${(Number(l) / 1e9).toFixed(4)} SOL`;
  return (
    <>
      <dl className="bt-dl" data-bounty-wallet>
        <div><dt>Address</dt><dd>{b.wallet ? <a className="underline" href={`https://explorer.solana.com/address/${b.wallet}`} target="_blank" rel="noreferrer"><code>{b.wallet}</code></a> : "Not set"}</dd></div>
        <div><dt>{BOUNTY_COPY.balance}</dt><dd>{b.balanceLamports !== null ? <>{sol(b.balanceLamports)}{b.balanceReadAt ? <span className="bt-meta"> on {utcDateTime(b.balanceReadAt)}</span> : null}</> : <span>{BOUNTY_COPY.balanceUnavailable}</span>}</dd></div>
        <div><dt>{BOUNTY_COPY.funding}</dt><dd>{b.recordedFunding ? <>{b.recordedFunding.sol} SOL on {utcDay(b.recordedFunding.date)}{b.recordedFunding.transactions?.[0] ? <> in <a className="underline" href={b.recordedFunding.transactions[0].explorerUrl} target="_blank" rel="noreferrer"><code>{b.recordedFunding.transactions[0].signature.slice(0, 12)}…</code></a></> : null}</> : "None recorded"}</dd></div>
      </dl>
      <h3 className="bt-h3" id="decided">{BOUNTY_COPY.historyTitle}</h3>
      {b.reports.paid.length + b.reports.rejected.length === 0
        ? <EmptyState kind="no-activity" body={<>{BOUNTY_COPY.none} {BOUNTY_COPY.noneMore}</>} compact />
        : <div className="bt-table-wrap"><table className="bt-table">
            <thead><tr><th>Date</th><th>Report</th><th>Severity</th><th>Decision</th><th>Transaction or reason</th></tr></thead>
            <tbody>
              {b.reports.paid.map((p) => <tr key={p.tx}><td>{p.date}</td><td>{p.title}</td><td>{p.severity}</td><td>Paid {p.sol} SOL</td><td><a className="underline" href={`https://explorer.solana.com/tx/${p.tx}`} target="_blank" rel="noreferrer"><code>{p.tx.slice(0, 12)}…</code></a></td></tr>)}
              {b.reports.rejected.map((p) => <tr key={p.date + p.title}><td>{p.date}</td><td>{p.title}</td><td></td><td>Rejected</td><td>{p.reason}</td></tr>)}
            </tbody>
          </table></div>}
    </>
  );
}
