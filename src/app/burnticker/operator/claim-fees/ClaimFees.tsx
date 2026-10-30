"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { simulationFailureText } from "@/lib/burnticker/signPlan";
import { chainReadDeps } from "@/lib/burnticker/launchRecovery";
import { withFlight } from "@/lib/burnticker/rpcProxy";
import { CLAIM_COPY, pollConfirm, claimSentSentence, claimExplorerUrl as explorerUrl, claimIxProblems, claimPlatformFees, claimWalletProblem, feeRatePercent, fundingProblem, solFromLamports, type PlatformFeesView } from "@/lib/burnticker/platformFeeClaimPlan";
import { WalletButton } from "../../_components/WalletButton";

/**
 * The claim page's client half (platformFeeClaimPlan.ts has the rules). The PIN is held in this component's state only, exactly as the
 * post queue holds it: never in storage or a cookie, and a reload forgets it. Without it nothing is read and nothing is shown but the PIN
 * box. With it, GET /api/burnticker/v1/ops/platform-fees (the operator's network and `x-action-pin`) returns the view and the unsigned
 * claim; the claim runs through signPlan.ts like a launch step (dry run first, wallet signs, the returned transaction checked, send,
 * confirm), over the wallet connection with the flight token, and the vault is read again after it lands.
 */
export function ClaimFees() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const [pin, setPin] = useState(""), [activePin, setActivePin] = useState("");
  const [v, setV] = useState<PlatformFeesView | null>(null), [err, setErr] = useState<string | null>(null), [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<string | null>(null), [claimErr, setClaimErr] = useState<string | null>(null), [sig, setSig] = useState<string | null>(null);
  const load = useCallback(async (p: string) => {
    if (!p) return;
    setReading(true); setErr(null);
    try {
      const r = await fetch("/api/burnticker/v1/ops/platform-fees", { headers: { "x-action-pin": p }, cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      setV(j as PlatformFeesView);
    } catch (e) { setV(null); setErr(String((e as Error).message ?? e)); } finally { setReading(false); }
  }, []);
  useEffect(() => { void load(activePin); }, [activePin, load]);
  const unlock = (e: FormEvent) => { e.preventDefault(); if (!pin.trim()) return; setActivePin(pin.trim()); setPin(""); };

  const connected = wallet.publicKey?.toBase58() ?? null;
  const notClaimWallet = v ? claimWalletProblem(connected, v.claimWallet) : null;
  const built = v ? claimIxProblems(v) : [];
  const funding = v ? fundingProblem(v) : null;
  const empty = !!v && v.vaultLamports !== null && BigInt(v.vaultLamports) <= BigInt(0);
  const canClaim = !!v && !!connected && !notClaimWallet && !built.length && !funding && !empty && !!wallet.signTransaction && !busy;

  const claim = async () => {
    if (!v || !connected || !wallet.signTransaction || busy) return;
    setBusy(true); setClaimErr(null); setNotice(null); setSig(null);
    try {
      const r = await withFlight(() => claimPlatformFees(v, connected, {
        latestBlockhash: () => connection.getLatestBlockhash("confirmed"),
        signTransaction: (tx) => wallet.signTransaction!(tx),
        // Phantom ticket 438485: the dry run comes before the wallet is asked; an unavailable one stops the claim (signPlan.ts)
        simulate: async (tx) => { const s = (await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" })).value; return s.err ? simulationFailureText(s.err, s.logs) : null; },
        lookupTable: async () => null,
        onRefused: (info) => { console.warn("[burnticker claim] the wallet's transaction was refused", info.why, "\nhanded:", info.handed, "\nreturned:", info.returned); },
        sendRaw: (raw) => connection.sendRawTransaction(raw, { preflightCommitment: "confirmed" }),
        // polled like the swap panel's (swap/chain.ts), so the page opens no websocket subscription
        confirm: (s, bh) => pollConfirm({ status: async (x) => (await connection.getSignatureStatuses([x])).value[0] ?? null, blockHeight: () => connection.getBlockHeight("confirmed") }, s, bh.lastValidBlockHeight),
        isBlockhashValid: async (b) => (await connection.isBlockhashValid(b, { commitment: "confirmed" })).value,
        onNotice: (t) => setNotice(t),
        ...chainReadDeps(connection),
        storage: null,
      }));
      if (r.signatures[0]) setSig(r.signatures[0]);
      // no plan storage here: a claim whose confirmation was lost is checked by hand on the explorer, never resent blindly
      if (r.error) setClaimErr(r.state === "sent" && r.signature ? claimSentSentence(r.signature) : r.error);
    } catch (e) {
      setClaimErr(`Something went wrong before the result could be read (${String((e as Error)?.message ?? e).slice(0, 160)}). Check the claim wallet on the explorer before trying again.`);
    } finally {
      setBusy(false);
      await load(activePin); // the vault, read again after the claim
    }
  };

  const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
  const addr = (k: string) => <a className="underline break-all" href={explorerUrl(v?.cluster ?? "mainnet", k, "address")}><code>{k}</code></a>;
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 text-sm">
      <header className="space-y-1">
        <p className="text-xs"><Link className="underline" href="/burnticker/operator">← Operator</Link></p>
        <h1 className="text-2xl font-semibold">{CLAIM_COPY.title}</h1>
        <p className="text-neutral-400">{CLAIM_COPY.intro}</p>
      </header>
      {!activePin ? (
        <form className={card + " flex flex-wrap items-end gap-2"} onSubmit={unlock} data-claim-pin>
          <label className="text-xs text-neutral-400">{CLAIM_COPY.pin}<input type="password" autoComplete="off" className="mt-1 block w-40 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm" value={pin} onChange={(e) => setPin(e.target.value)} aria-label={CLAIM_COPY.pin} /></label>
          <button type="submit" className="rounded border border-neutral-700 px-3 py-1 hover:border-amber-400">{CLAIM_COPY.open}</button>
          <p className="w-full text-xs text-neutral-500">{CLAIM_COPY.pinNote}</p>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="text-xs underline text-neutral-400" onClick={() => { setActivePin(""); setV(null); setSig(null); setClaimErr(null); }}>Forget the PIN</button>
          {reading && <span className="text-xs text-neutral-500" role="status">Reading the vault.</span>}
        </div>
      )}
      {err && <p className="text-xs text-amber-300" role="alert" data-claim-error>{err}</p>}
      {v && (
        <>
          <section className={card} data-claim-view>
            <table className="w-full text-xs"><tbody>
              <tr className="align-top"><td className="p-1 text-neutral-400">Platform</td><td className="p-1">{addr(v.platformId)}</td></tr>
              <tr className="align-top"><td className="p-1 text-neutral-400">Claim wallet</td><td className="p-1">{addr(v.claimWallet)}{v.claimWalletIsTreasury ? <span className="text-neutral-500"> (the operator treasury)</span> : <span className="text-amber-300"> (not the operator treasury built into this site)</span>}</td></tr>
              <tr className="align-top"><td className="p-1 text-neutral-400">Fee vault</td><td className="p-1">{addr(v.vault)}</td></tr>
              <tr className="align-top"><td className="p-1 text-neutral-400">In the vault</td><td className="p-1 tabular-nums" data-vault-sol>{v.vaultLamports === null ? "could not be read" : `${solFromLamports(v.vaultLamports)} SOL (wrapped)`}</td></tr>
              <tr className="align-top"><td className="p-1 text-neutral-400">Fee rate</td><td className="p-1">{feeRatePercent(v.feeRatePpm)} of each curve trade ({v.feeRatePpm} parts per million)</td></tr>
              <tr className="align-top"><td className="p-1 text-neutral-400">Claim wallet SOL</td><td className="p-1 tabular-nums">{v.claimWalletLamports === null ? "could not be read" : `${solFromLamports(v.claimWalletLamports)} SOL`}</td></tr>
              <tr className="align-top"><td className="p-1 text-neutral-400">Connected wallet</td><td className="p-1">{connected ? <code className="break-all">{connected}</code> : "none"}</td></tr>
            </tbody></table>
            <p className="mt-2 text-xs text-neutral-500">Read at {v.readAt.slice(0, 19).replace("T", " ")} UTC.</p>
          </section>
          <section className={card + " space-y-2"} data-claim-action>
            <p className="text-xs text-neutral-300">{CLAIM_COPY.lands}</p>
            {!connected ? <div className="space-y-2"><p className="text-xs">{CLAIM_COPY.connect}</p><WalletButton variant="menu" /></div>
              : notClaimWallet ? <p className="text-xs text-amber-300" data-claim-wrong-wallet>{notClaimWallet}</p>
              : (
                <>
                  {built.length > 0 && <p className="text-xs text-red-400" role="alert">The claim was not built as expected, so it is not offered: {built.join("; ")}.</p>}
                  {funding && <p className="text-xs text-amber-300" data-claim-funding>{funding}</p>}
                  {empty && <p className="text-xs text-neutral-400">{CLAIM_COPY.empty}</p>}
                  <button type="button" disabled={!canClaim} onClick={() => void claim()} className="rounded border border-amber-400 px-4 py-1 disabled:opacity-40" data-claim-button>{busy ? CLAIM_COPY.busy : CLAIM_COPY.button}</button>
                </>
              )}
            {notice && <p className="text-xs text-neutral-300" role="status">{notice}</p>}
            {claimErr && <p className="text-xs text-amber-300" role="alert" data-claim-failed>{claimErr}</p>}
            {sig && !claimErr && <p className="text-xs text-emerald-400" data-claim-done>{CLAIM_COPY.done} <a className="underline break-all" href={explorerUrl(v.cluster, sig)}><code>{sig}</code></a>. {CLAIM_COPY.ledger}</p>}
          </section>
        </>
      )}
    </main>
  );
}
