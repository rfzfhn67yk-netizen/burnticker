"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { PairCurveLaunchBundle } from "@/lib/burnticker/pairCurveLaunch";
import { confirmLaunched, pairCurveSignProblems, PAIR_CURVE_REVIEW_LINE, signAndSendPairCurve } from "@/lib/burnticker/pairLaunchClient";

/**
 * THE PAIR-CURVE LAUNCH CARD (review N6, 2026-10-10): one transaction set for both coins — create mint A, create mint B, init_pair —
 * signed in that order (each mint transaction by its mint key, then the creator's wallet) and confirmed one by one. Then each draft is
 * confirmed with the launch route (`action: "launched"`: tx 1 for A, tx 2 for B; the server reads each from the chain and retries a
 * not-yet-visible one a few times). Used by the
 * Matchup flow and the Coin vs Coin tile. Nothing is sent before the creator presses the button.
 */
export function PairCurveSign({ pc, mintKeys, creator, tickers, notes }: { pc: PairCurveLaunchBundle; mintKeys: { a: string; b: string } | null; creator: string | null; tickers: { a: string; b: string }; notes: string[] }) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const [busy, setBusy] = useState(false), [done, setDone] = useState<string[]>([]), [err, setErr] = useState<string | null>(null), [confirmed, setConfirmed] = useState<string[]>([])
  const walletKey = wallet.publicKey?.toBase58() ?? null;
  const problems = [...pairCurveSignProblems(pc, creator, mintKeys), ...(creator && walletKey !== creator ? ["connect the creator's wallet in this browser to sign (a pasted address cannot sign)"] : []), ...(!wallet.signTransaction && walletKey ? ["this wallet cannot sign transactions"] : [])];
  const go = async () => {
    if (!creator || !wallet.signTransaction || problems.length) return;
    setBusy(true); setErr(null);
    const r = await signAndSendPairCurve(pc, creator, mintKeys, {
      latestBlockhash: () => connection.getLatestBlockhash("confirmed"),
      signTransaction: (tx) => wallet.signTransaction!(tx),
      sendRaw: (raw) => connection.sendRawTransaction(raw, { preflightCommitment: "confirmed" }),
      confirm: async (sig, bh) => (await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed")).value,
    }, (_i, sig) => setDone((d) => [...d, sig]), done);
    if (r.error) { setErr(`${r.error}. ${r.signatures.length ? "The steps before it are confirmed on chain; pressing the button again continues from the failed step." : "Nothing was sent."}`); setBusy(false); return; }
    const c = await confirmLaunched((u, init) => fetch(u, init), pc, r.signatures, { already: confirmed });
    setConfirmed(c.confirmed); if (c.error) setErr(`All ${pc.transactions.length} transactions are confirmed on chain. ${c.error}`); setBusy(false);
  };
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 space-y-2 text-sm" data-venue="pair-curve">
      <h2 className="font-medium">${tickers.a} + ${tickers.b} · {PAIR_CURVE_REVIEW_LINE}</h2>
      <p className="text-xs text-neutral-400">{pc.badge.text}</p>
      <p className="text-xs">Pair <code>{pc.pair}</code> · vault <code>{pc.vault}</code> · mint A <code>{pc.mints.a}</code> · mint B <code>{pc.mints.b}</code></p>
      <ol className="list-decimal pl-5 text-xs text-neutral-400">{pc.transactions.map((t, i) => <li key={t.label}>{t.label} · signers {t.signers.map((s) => (s === "creator" ? "your wallet" : s === "mintA" ? "mint A key" : "mint B key")).join(" + ")}{done[i] ? <> · sent <code>{done[i].slice(0, 10)}…</code></> : null}</li>)}</ol>
      <p className="text-xs text-neutral-500">{pc.fees}</p>
      <ul className="list-disc pl-5 text-xs text-neutral-500">{[...pc.notes, ...notes.filter((n) => !pc.notes.includes(n))].map((n) => <li key={n}>{n}</li>)}</ul>
      {problems.length > 0 ? <div className="text-amber-400 text-xs"><p>Not signable here yet:</p><ul className="list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
        : confirmed.length === 2 ? <p className="text-emerald-400">Both coins are live on the pair curve.</p>
        : <button className="rounded bg-amber-400 px-4 py-2 text-sm font-semibold text-neutral-950 disabled:opacity-50" disabled={busy} onClick={go}>{busy ? `signing ${done.length + 1} of ${pc.transactions.length}…` : `Sign and send the ${pc.transactions.length} transactions`}</button>}
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}
