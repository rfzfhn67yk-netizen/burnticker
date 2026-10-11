"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { confirmPlan, planProblems, signAndSendPlan, type SignPlan } from "@/lib/burnticker/signPlan";
import { launchedErrorMessage } from "@/lib/burnticker/pairLaunchClient";

/**
 * THE SIGNING CARD (2026-10-11): the one component that signs every launch — a single LaunchLab coin, two coins, a pair-curve set — from
 * the plan signPlan.ts builds, so single coins and pairs cannot behave differently. After the review card's Launch (the
 * acknowledgement) the bundle arrives here: each step is signed by the key it names, then by the wallet, sent and confirmed, with
 * progress per step; then each draft is confirmed with the launch route (`action: "launched"`, the transaction its mint signed; a 404
 * retried ~5 × 4 s; 409 / 422 / 429 / 503 a plain sentence); then the coin page. A failure stops the run and a second press resumes at
 * the failed step. Nothing is sent before the creator presses the button; nothing about odds or prices is shown.
 */
export function SignCard({ plan, creator, title, notes = [], coinHref, autoStart = true }: { plan: SignPlan; creator: string | null; title: string; notes?: string[]; coinHref: (ticker: string) => string; /** the review card's Launch already was the decision: open the wallet's signature prompt at once (default) */ autoStart?: boolean }) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const [busy, setBusy] = useState(false), [done, setDone] = useState<string[]>([]), [err, setErr] = useState<string | null>(null), [confirmed, setConfirmed] = useState<string[]>([]);
  const walletKey = wallet.publicKey?.toBase58() ?? null;
  const problems = [...planProblems(plan, creator), ...(creator && walletKey && walletKey !== creator ? ["the connected wallet is not the creator of this launch: connect the creator's wallet"] : []), ...(!wallet.signTransaction && walletKey ? ["this wallet cannot sign transactions"] : [])];
  const allLive = plan.confirms.length > 0 && plan.confirms.every((c) => confirmed.includes(c.mint));
  const n = plan.steps.length;
  // a single coin goes to its page once it is live (a pair keeps the card with both links)
  useEffect(() => { if (allLive && plan.confirms.length === 1) { const t = setTimeout(() => window.location.assign(coinHref(plan.confirms[0].ticker)), 1500); return () => clearTimeout(t); } }, [allLive]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    if (!creator || !wallet.signTransaction || problems.length || busy) return;
    setBusy(true); setErr(null);
    const r = await signAndSendPlan(plan, creator, {
      latestBlockhash: () => connection.getLatestBlockhash("confirmed"),
      signTransaction: (tx) => wallet.signTransaction!(tx),
      sendRaw: (raw) => connection.sendRawTransaction(raw, { preflightCommitment: "confirmed" }),
      confirm: async (sig, bh) => (await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed")).value,
    }, (_i, sig) => setDone((d) => [...d, sig]), done);
    if (r.error) { setErr(`${r.error}. ${r.signatures.length ? "The steps before it are confirmed on chain; pressing the button again continues from the failed step." : "Nothing was sent."}`); setBusy(false); return; }
    const c = await confirmPlan((u, init) => fetch(u, init), plan, r.signatures, (st, b, ra) => launchedErrorMessage(st, b, ra), { already: confirmed });
    setConfirmed(c.confirmed);
    if (c.error) setErr(`All ${n} transaction${n === 1 ? " is" : "s are"} confirmed on chain. ${c.error}`);
    setBusy(false);
  };
  // Launch on the review card was the decision; the wallet's own prompt is the signature — no second button on the happy path
  const [started, setStarted] = useState(false);
  useEffect(() => { if (autoStart && !started && !problems.length && creator && wallet.signTransaction) { setStarted(true); void go(); } }, [autoStart, started, problems.length, creator, wallet.signTransaction]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Plain step names: "Create $RAYS26" for the transaction the mint signs; "Link the two coins" for a pair-curve set-up; else the bundle's. */
  const stepName = (t: SignPlan["steps"][number], i: number) => {
    const c = plan.confirms.find((x) => x.step === i);
    if (c) return `Create $${c.ticker} with its rule locked in${/first buy/i.test(t.label) ? ", and your opening purchase" : ""}`;
    if (/init_pair/.test(t.label)) return "Link the two coins as one pair";
    return t.label;
  };
  const signerName = (s: string) => (s === "creator" ? "your wallet" : plan.labels[s] ?? s);
  return (
    <div className="rounded-xl border border-amber-400/60 bg-neutral-900 p-4 space-y-3 text-sm" aria-label="Sign and send" data-sign-card>
      <h2 className="text-lg font-semibold">{title}</h2>
      <ol className="space-y-1 text-xs" aria-label="Steps">
        {plan.steps.map((t, i) => (
          <li key={`${i}-${t.label}`} className="flex flex-wrap items-baseline gap-2">
            <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${done[i] ? "border-emerald-400 text-emerald-400" : busy && i === done.length ? "border-amber-400 text-amber-300" : "border-neutral-600 text-neutral-400"}`}>{done[i] ? "✓" : i + 1}</span>
            <span className="text-neutral-200" title={t.label}>{stepName(t, i)}</span>
            <span className="text-neutral-500">signed by {t.signers.map(signerName).join(" + ")}</span>
            {done[i] && <span className="text-neutral-500">· confirmed <code>{done[i].slice(0, 10)}…</code></span>}
          </li>
        ))}
        {plan.confirms.map((c) => <li key={c.mint} className="text-neutral-500">{confirmed.includes(c.mint) ? "✓" : "·"} ${c.ticker} recorded as launched</li>)}
      </ol>
      {notes.length > 0 && <ul className="list-disc pl-5 text-xs text-neutral-500">{notes.map((x) => <li key={x}>{x}</li>)}</ul>}
      {allLive ? (
        <p className="text-emerald-400">{plan.confirms.length > 1 ? "Both coins are live." : "Your coin is live — opening its page…"} {plan.confirms.map((c) => <a key={c.mint} className="ml-2 underline" href={coinHref(c.ticker)}>${c.ticker} →</a>)}</p>
      ) : problems.length > 0 ? (
        <div className="text-amber-400 text-xs"><p>Not signable here yet:</p><ul className="list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
      ) : (
        <button type="button" data-decision="launch" className="rounded bg-amber-400 px-5 py-2 text-base font-semibold text-neutral-950 disabled:opacity-50" disabled={busy} onClick={go}>
          {busy ? `Signing step ${Math.min(done.length + 1, n)} of ${n}…` : done.length ? `Continue from step ${done.length + 1} of ${n}` : `Sign in your wallet (${n} step${n === 1 ? "" : "s"})`}
        </button>
      )}
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}
