"use client";

import type { LaunchReview } from "@/lib/burnticker/launchReview";
import { REVIEW_UPDATING } from "@/lib/burnticker/launchReviewSync";
import { pendingWords } from "@/lib/burnticker/preparedRules";
import { walletPromptsLine } from "@/lib/burnticker/walletProof";

/**
 * THE PRE-WALLET SUMMARY (ChatGPT launch audit 5, L06 / site audit #4, 2026-10-11): what the creator sees on the review card BEFORE the
 * wallet opens — from the read-only review payload (POST /api/burnticker/v1/launch/review, launchReview.ts), so the numbers are the
 * server's, not the page's: the network, how many transactions and who signs each, estimated SOL, what connecting does and what signing
 * does, what happens after a rejected or uncertain send, the canonical rule and its hash, the fee split per 1 SOL, the allocation, the
 * prerequisites before any burn, who can change what, the operator. Read-only: no control here launches anything.
 */
const n = (s: string) => Number(s).toLocaleString("en-US");

export function PreWalletSummary({ review, loading, error, updating = false, proof }: { review: LaunchReview | null; loading: boolean; error: string | null; /** A6: the summary on file was built for another draft */ updating?: boolean; /** HB-92: whether the wallet is asked for the proof, the same flag the button's count uses */ proof?: boolean }) {
  if (!review) return (
    <div className="rounded-lg border border-neutral-800 p-3 text-xs text-neutral-400" data-prewallet data-prewallet-state={updating ? "updating" : loading ? "loading" : error ? "error" : "empty"} aria-live="polite">
      {updating ? REVIEW_UPDATING : loading ? "Reading the launch summary. It lists the network, the transactions and the estimated cost." : error ? <>The launch summary could not be read just now. {error}</> : null}
    </div>
  );
  const net = review.network === "mainnet" ? "This launch runs on Solana mainnet and uses real SOL." : review.network === "devnet" ? "This launch runs on Solana devnet, a test network with no real money." : `This launch runs on Solana ${review.network}.`;
  const count = review.transactions.count;
  // older servers (before website-12) send no venue fields: fall back to the lists they do send
  const prereqLine = review.prerequisiteLine ?? review.prerequisites[0];
  // HB-92 (hourly run 7): the prompt count here is the button's (walletProof.ts walletPromptCount, the same proof flag)
  const recoveryLines = review.recovery && count > 1 && proof !== undefined ? [walletPromptsLine(count, proof), ...review.recovery.slice(1)] : review.recovery;
  return (
    <>
    {/* website-15 item 12: collapsed below the launch button; "Who controls what today" is its own block, and the end of the rule is said once, above */}
    <details className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300" aria-label="Before you connect a wallet" data-prewallet>
      <summary className="cursor-pointer text-sm font-medium text-neutral-100">Before you connect a wallet</summary>
      <div className="mt-2 space-y-2">
      <p className="break-words" data-network>{net}</p>
      {review.budget && <p className="break-words" data-budget>{review.budget}</p>}
      <p className="break-words text-amber-200" data-prerequisite>{prereqLine}</p>
      <div data-tx-count>
        <p className="break-words">You sign {count === 1 ? "one transaction" : `${count} transactions`}.</p>
        <ol className="mt-0.5 list-decimal space-y-0.5 pl-5">{review.transactions.steps.map((s) => <li key={s.label} className="break-words">{s.label}. It is signed by {s.signers.join(" and ")}.</li>)}</ol>
      </div>
      <div data-estimate>
        <p className="break-words">The estimated cost is about {review.costs.totalSol} SOL.</p>
        <ul className="mt-0.5 list-disc space-y-0.5 pl-5">{review.costs.lines.map((l) => <li key={l.label} className="break-words">{l.sol} SOL. {l.label}</li>)}</ul>
        <p className="mt-0.5 break-words text-neutral-400">{review.costs.note}</p>
      </div>
      <p className="break-words">Connecting a wallet only shares its public address with this page. Nothing is signed or sent when you connect.</p>
      <p className="break-words">{review.transactions.note}</p>
      <ul className="list-disc space-y-0.5 pl-5" data-recovery>{(recoveryLines ?? ["If you reject the request in your wallet, nothing is sent and nothing is charged. The draft is kept for 24 hours, so you can press the button again."]).map((x) => <li key={x} className="break-words">{x}</li>)}</ul>
      <p className="break-words">{review.rule.presets}</p>
      <p className="break-words" data-authority>{review.authority}</p>
      <p className="break-words text-neutral-400">{review.operator}</p>
      <details className="min-w-0">
        <summary className="cursor-pointer text-neutral-400">The other conditions on a burn, and where the fees go</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">{review.prerequisites.filter((x) => x !== prereqLine).map((x) => <li key={x}>{x}</li>)}</ul>
        {review.prerequisiteStates && <><p className="mt-1">A result that qualifies does not always burn at once. A burn can be in one of these states.</p><ul className="mt-0.5 list-disc space-y-0.5 pl-5">{review.prerequisiteStates.map((x) => <li key={x}>{x}</li>)}</ul></>}
        {review.feesPerSol.map((f) => <p key={f.phase} className="mt-1 break-words">{f.phase === "curve" ? "On the bonding curve" : "After the coin moves to its Raydium pool"}, each 1 SOL traded pays {f.totalSol} SOL in fees in total. {f.legs.map((l) => `${l.sol} SOL goes to ${l.label}`).join(". ")}.</p>)}
        <p className="mt-1 break-words">The supply is {n(review.allocation.supply)} coins. Of these, {n(review.allocation.curve)} are sold on the curve and {n(review.allocation.reserve)} are kept for the move to the Raydium pool. There is no team allocation. The pool&apos;s liquidity is {review.allocation.lpLockedPct}% locked.</p>
      </details>
      <details className="min-w-0">
        <summary className="cursor-pointer text-neutral-400">{(review.rules?.length ?? 1) > 1 ? "The exact rule of each coin and its fingerprint" : "The exact rule text and its fingerprint"}</summary>
        {/* website-19 (intent audit item 8): every rule the creator signs, labelled with its coin and its transaction number */}
        {(review.rules && review.rules.length ? review.rules : [{ side: "A" as const, ticker: review.coins[0]?.ticker ?? "", name: review.coins[0]?.name ?? "", step: 1, text: review.rule.text, sha256: review.rule.sha256, derived: false, label: null, pending: [] as string[] }]).map((r) => (
          <div key={r.side} className="mt-2 min-w-0" data-rule-side={r.side}>
            {(review.rules?.length ?? 1) > 1 && <p className="break-words text-neutral-300">Coin {r.side}, ${r.ticker || "TICKER"} ({r.name || "no name yet"}), signed in transaction {r.step}.</p>}
            {r.derived ? <p className="break-words text-neutral-400">This coin&apos;s rule is built from coin A&apos;s with the result swapped, when the launch is prepared. Its exact text and fingerprint are on the coin&apos;s page once it is registered.</p> : <>
              {/* WIRING-AUDIT12 P1-2: each text says whether it is the final rule the wallet signs, or a draft with fields still to fill */}
              {r.label && <p className="mt-1 break-words text-neutral-300" data-rule-label={r.label}>{r.label === "final" ? "Final rule: this is exactly what your wallet signs." : "Draft rule: these parts are filled in when the launch is prepared, and everything else is exactly what your wallet signs."}</p>}
              {r.label === "draft" && r.pending?.length > 0 && <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-neutral-400" data-rule-pending>{pendingWords(r.pending).map((x) => <li key={x}>{x}</li>)}</ul>}
              <p className="mt-1 break-all font-mono text-[11px]" data-sha256>sha256 {r.sha256}</p>
              <pre className="mt-1 max-h-48 max-w-full overflow-auto whitespace-pre-wrap break-all rounded bg-neutral-900 p-2 font-mono text-[11px]">{r.text}</pre>
            </>}
          </div>
        ))}
        {review.prepared?.note && <p className="mt-2 break-words text-neutral-400" data-prepared-note>{review.prepared.note}</p>}
      </details>
      </div>
    </details>
    {review.governance && review.governance.length > 0 && (
      <details className="min-w-0 text-xs text-neutral-300" data-governance>
        <summary className="cursor-pointer text-neutral-300">Who controls what today</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">{review.governance.map((g) => <li key={g} className="break-words">{g}</li>)}</ul>
      </details>
    )}
    </>
  );
}
