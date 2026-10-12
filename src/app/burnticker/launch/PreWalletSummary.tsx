"use client";

import type { LaunchReview } from "@/lib/burnticker/launchReview";

/**
 * THE PRE-WALLET SUMMARY (ChatGPT launch audit 5, L06 / site audit #4, 2026-10-11): what the creator sees on the review card BEFORE the
 * wallet opens — from the read-only review payload (POST /api/burnticker/v1/launch/review, launchReview.ts), so the numbers are the
 * server's, not the page's: the network, how many transactions and who signs each, estimated SOL, what connecting does and what signing
 * does, what happens after a rejected or uncertain send, the canonical rule and its hash, the fee split per 1 SOL, the allocation, the
 * prerequisites before any burn, who can change what, the operator. Read-only: no control here launches anything.
 */
const n = (s: string) => Number(s).toLocaleString("en-US");

export function PreWalletSummary({ review, loading, error }: { review: LaunchReview | null; loading: boolean; error: string | null }) {
  if (!review) return (
    <div className="rounded-lg border border-neutral-800 p-3 text-xs text-neutral-400" data-prewallet aria-live="polite">
      {loading ? "Reading the launch summary. It lists the network, the transactions and the estimated cost." : error ? <>The launch summary could not be read just now. {error}</> : null}
    </div>
  );
  const net = review.network === "mainnet" ? "This launch runs on Solana mainnet and uses real SOL." : review.network === "devnet" ? "This launch runs on Solana devnet, a test network with no real money." : `This launch runs on Solana ${review.network}.`;
  const count = review.transactions.count;
  return (
    <section className="min-w-0 space-y-2 rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300" aria-label="Before you connect a wallet" data-prewallet>
      <h3 className="text-sm font-medium text-neutral-100">Before you connect a wallet</h3>
      <p className="break-words" data-network>{net}</p>
      <div data-tx-count>
        <p className="break-words">You sign {count === 1 ? "one transaction" : `${count} transactions`}.</p>
        <ul className="mt-0.5 list-disc space-y-0.5 pl-5">{review.transactions.steps.map((s) => <li key={s.label} className="break-words">{s.label}. It is signed by {s.signers.join(" and ")}.</li>)}</ul>
      </div>
      <div data-estimate>
        <p className="break-words">The estimated cost is about {review.costs.totalSol} SOL.</p>
        <ul className="mt-0.5 list-disc space-y-0.5 pl-5">{review.costs.lines.map((l) => <li key={l.label} className="break-words">{l.sol} SOL. {l.label}</li>)}</ul>
        <p className="mt-0.5 break-words text-neutral-400">{review.costs.note}</p>
      </div>
      <p className="break-words">Connecting a wallet only shares its public address with this page. Nothing is signed or sent when you connect.</p>
      <p className="break-words">{review.transactions.note}</p>
      <p className="break-words">If you reject the request in your wallet, nothing is sent and nothing is charged. The draft is kept for 24 hours, so you can press the button again.</p>
      <p className="break-words">If a send is uncertain, this tab keeps the signature. It checks the chain before anything is sent again. After a reload, the unfinished launch is listed at the top of this page.</p>
      <p className="break-words">Each burn spends {review.rule.share} of the burn pool. {review.rule.presets} {review.rule.endsLine}</p>
      <p className="break-words" data-authority>{review.authority}</p>
      <p className="break-words text-neutral-400">{review.operator}</p>
      <details className="min-w-0">
        <summary className="cursor-pointer text-neutral-400">What must happen before any burn, and where the fees go</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">{review.prerequisites.map((x) => <li key={x}>{x}</li>)}</ul>
        {review.feesPerSol.map((f) => <p key={f.phase} className="mt-1 break-words">{f.phase === "curve" ? "On the bonding curve" : "After the coin moves to its Raydium pool"}, each 1 SOL traded pays {f.totalSol} SOL in fees. {f.legs.map((l) => `${l.sol} SOL goes to ${l.label}`).join(". ")}.</p>)}
        <p className="mt-1 break-words">The supply is {n(review.allocation.supply)} coins. Of these, {n(review.allocation.curve)} are sold on the curve and {n(review.allocation.reserve)} are kept for the move to the Raydium pool. There is no team allocation. The pool&apos;s liquidity is {review.allocation.lpLockedPct}% locked.</p>
      </details>
      <details className="min-w-0">
        <summary className="cursor-pointer text-neutral-400">The exact rule text and its fingerprint</summary>
        <p className="mt-1 break-all font-mono text-[11px]" data-sha256>sha256 {review.rule.sha256}</p>
        <pre className="mt-1 max-h-48 max-w-full overflow-auto whitespace-pre-wrap break-all rounded bg-neutral-900 p-2 font-mono text-[11px]">{review.rule.text}</pre>
      </details>
    </section>
  );
}
