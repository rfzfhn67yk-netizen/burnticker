"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { abandonedSentence, browserPlanStorage, pinReadProblems, withPlanLock, PLAN_LOCKED_SENTENCE, SESSION_SCOPE_LINE, confirmPlan, failureSentence, loadPlanRecord, markRecorded, planAbandoned, planConfirmations, planProblems, planStepStates, planStorageKey, recordFailureSentence, sentRecoverySentence, signAndSendPlan, simulationFailureText, stepStatusText, type SendResult, type SignPlan } from "@/lib/burnticker/signPlan";
import { lookupTablePinProblems, planNetwork, planSizeProblems, verifiedLookupTable } from "@/lib/burnticker/lookupTable";
import type { LookupTablePin, Network } from "@/lib/burnticker/networks";
import { NO_OPENING_PURCHASE_SENTENCE } from "@/lib/burnticker/hostedLaunch";
import { launchedErrorMessage } from "@/lib/burnticker/pairLaunchClient";
import { archivePlanRecord, chainReadDeps } from "@/lib/burnticker/launchRecovery";
import { resumeReviewHref } from "@/lib/burnticker/launchDraftStore";
import { matchesSuffix } from "@/lib/burnticker/vanityMint";
import { MINT_ADDRESS_NOTE } from "@/lib/burnticker/mintAddressCopy";
import { LaunchedTrade } from "../_components/TradeLinks";

/**
 * THE SIGNING CARD (2026-10-11): the one component that signs every launch — a single LaunchLab coin, two coins, a pair-curve set — from
 * the plan signPlan.ts builds, so single coins and pairs cannot behave differently. After the review card's Launch (the
 * acknowledgement) the bundle arrives here: each step is signed by the key it names, then by the wallet, sent and confirmed, with
 * progress per step; then each draft is confirmed with the launch route (`action: "launched"`, the transaction its mint signed; a 404
 * retried ~5 × 4 s; 409 / 422 / 429 / 503 a plain sentence); then the coin page. A failure stops the run and a second press resumes at
 * the failed step. Nothing is sent before the creator presses the button; nothing about odds or prices is shown.
 *
 * Review-2 F4: every signed transaction is written to sessionStorage (signPlan.ts PlanRecord) before it is sent. A step whose
 * confirmation was lost shows "Sent; confirmation unavailable — signature …" (never "Nothing was sent"), and the next press looks that
 * signature up on chain before anything new is built. On mount the card reads the stored record for these drafts and shows it.
 *
 * Re-check 2026-10-11: every step is a version-0 transaction compiled against the network's lookup table, which is fetched and verified
 * (lookupTable.ts) before anything is signed. A plan that put something on chain but lost a mint key on reload is abandoned: each step
 * shows confirmed / sent / abandoned, the sentence gives the fee already spent, and the only action is a new plan.
 *
 * launch-10 (2026-10-12): the table's address is read from the host at runtime (GET /api/burnticker/launch; networks.ts lookupTablePin),
 * so pinning a table needs no code release; until that answer arrives, or if it fails, nothing can be signed. The plan never carries an
 * opening purchase (hostedLaunch.ts): the creator trades on the curve after the create like anyone else.
 */
export function SignCard({ plan, creator, title, notes = [], coinHref, autoStart = true, onLive }: { plan: SignPlan; creator: string | null; title: string; notes?: string[]; coinHref: (ticker: string) => string; /** launch night 2026-10-13: every coin is live and recorded (the page drops its saved draft) */ onLive?: () => void; /** the review card's Launch already was the decision: open the wallet's signature prompt at once (default) */ autoStart?: boolean }) {
  const wallet = useWallet();
  const { connection } = useConnection();
  // recovery: what an earlier run (this tab, before a reload) left in storage for these drafts. Read in the initial state — the card
  // only ever renders in the browser, after the bundle request — so the first paint already shows a sent step and its signature.
  const [storage] = useState(() => browserPlanStorage());
  const [stored] = useState(() => loadPlanRecord(storage, plan));
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [done, setDone] = useState<string[]>(() => stored?.confirmed ?? []), [confirmed, setConfirmed] = useState<string[]>(() => stored?.recorded ?? []);
  const abandonedAtMount = planAbandoned(plan, stored) && (stored?.confirmed.length ?? 0) < plan.steps.length;
  const [err, setErr] = useState<string | null>(() => (stored?.pending ? sentRecoverySentence(stored.pending, plan.steps.length, stored.confirmed) : stored && abandonedAtMount ? abandonedSentence({ ...stored, confirms: plan.confirms, steps: plan.steps.length }) : null));
  /** the step a run stopped at: its state ("sent" = outcome unknown; "abandoned" = a mint key lost on reload) and signature */
  const [stopped, setStopped] = useState<Pick<SendResult, "failedAt" | "state" | "signature"> | null>(() => (stored?.pending ? { failedAt: stored.pending.step, state: "sent", signature: stored.pending.signature } : stored && abandonedAtMount ? { failedAt: stored.confirmed.length, state: "abandoned" } : null));
  const walletKey = wallet.publicKey?.toBase58() ?? null;
  const network = planNetwork(plan.steps.map((st) => st.instructions));
  // the lookup-table pin from the host (undefined = still reading, null = the read failed)
  // launch audit 231: a failed read is retried in place (Read the setting again); a reload would drop the mint keys held in memory
  const [pins, setPins] = useState<Record<Network, LookupTablePin> | null | undefined>(undefined), [pinTry, setPinTry] = useState(0);
  useEffect(() => {
    let live = true;
    setPins(undefined);
    fetch("/api/burnticker/launch", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (live) setPins(j?.lookupTables ?? null); }).catch(() => { if (live) setPins(null); });
    return () => { live = false; };
  }, [pinTry]);
  const pin = network && pins ? pins[network] ?? null : null;
  const pinProblems = pins === undefined || pins === null ? pinReadProblems(pins) : lookupTablePinProblems(network, pin);
  const v0 = wallet.wallet?.adapter.supportedTransactionVersions;
  const problems = [...planProblems(plan, creator), ...pinProblems, ...planSizeProblems(plan.steps, creator, network), ...(creator && walletKey && walletKey !== creator ? ["the connected wallet is not the creator of this launch: connect the creator's wallet"] : []), ...(!wallet.signTransaction && walletKey ? ["this wallet cannot sign transactions"] : []), ...(walletKey && wallet.wallet && !v0?.has(0) ? ["this wallet cannot sign version-0 transactions"] : [])];
  /** the one safe action for an abandoned plan: drop its record and go back to the review, which builds a new plan with fresh mint keys */
  // launch audit 234: the replaced plan's signatures and mints stay readable in this tab's history (never a key)
  const startNewPlan = () => { archivePlanRecord(storage, planStorageKey(plan)); window.location.assign(resumeReviewHref(window.location.pathname)); };
  const allLive = plan.confirms.length > 0 && plan.confirms.every((c) => confirmed.includes(c.mint));
  useEffect(() => { if (allLive) onLive?.(); }, [allLive]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = plan.steps.length;
  // launch audit 230: once live, the card stays as a completion card with an Open link per coin (no timed redirect)
  // launch audit 250: `busy` is React state, so two presses in one render, or a card mounted again mid-run, both read false; the plan
  // lock (signPlan.ts withPlanLock, shared with the recovery notice) lets one run at a time touch this plan in this tab
  const go = async () => {
    if (!creator || !wallet.signTransaction || problems.length || busy) return;
    const locked = await withPlanLock(planStorageKey(plan), run);
    if (!locked.ran) setErr(PLAN_LOCKED_SENTENCE);
  };
  const run = async () => {
    if (!creator || !wallet.signTransaction) return;
    setBusy(true); setErr(null); setNotice(null);
    try {
      const r = await signAndSendPlan(plan, creator, {
        latestBlockhash: () => connection.getLatestBlockhash("confirmed"),
        signTransaction: (tx) => wallet.signTransaction!(tx),
        // Phantom ticket 438485: dry-run each step before the wallet sees it (a transaction that fails on chain trips the wallet's warning)
        simulate: async (tx) => { const r = (await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" })).value; return r.err ? simulationFailureText(r.err, r.logs) : null; },
        lookupTable: () => verifiedLookupTable(connection, network, pin),
        onRefused: (info) => { console.warn("[burnticker launch] the wallet's transaction was refused", info.why, "\nhanded:", info.handed, "\nreturned:", info.returned); },
        sendRaw: (raw) => connection.sendRawTransaction(raw, { preflightCommitment: "confirmed" }),
        confirm: async (sig, bh) => (await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed")).value,
        // launch night 2026-10-13: a wallet slower than the blockhash's life gets the step rebuilt and is asked again (signPlan.ts)
        isBlockhashValid: async (b) => (await connection.isBlockhashValid(b, { commitment: "confirmed" })).value,
        onNotice: (t) => setNotice(t),
        // launch recovery 255: status, height, the transaction history and the accounts a step creates, before anything is called unlanded
        ...chainReadDeps(connection),
        storage,
      }, (i, sig) => setDone((d) => (d.length === i ? [...d, sig] : d)), done);
      setDone(r.signatures);
      if (r.error) {
        setStopped({ failedAt: r.failedAt, state: r.state, signature: r.signature }); setErr(failureSentence(r, n));
        // AUDIT A C1 (5): a coin whose own create landed before the stop is recorded now (a LaunchLab pair whose B create failed: A exists)
        if (planConfirmations(plan, r.signatures).some((l) => !confirmed.includes(l.mint))) {
          const c = await confirmPlan((u, init) => fetch(u, init), plan, r.signatures, (st, b, ra) => recordFailureSentence(st, b, ra, launchedErrorMessage), { already: confirmed });
          setConfirmed(c.confirmed); markRecorded(storage, plan, c.confirmed);
          // review (9): a failed record of the coin that landed is said too, beside why the run stopped
          if (c.error) setErr(`${failureSentence(r, n)} ${c.error}`);
        }
        return; }
      setStopped(null);
      const c = await confirmPlan((u, init) => fetch(u, init), plan, r.signatures, (st, b, ra) => recordFailureSentence(st, b, ra, launchedErrorMessage), { already: confirmed });
      setConfirmed(c.confirmed); markRecorded(storage, plan, c.confirmed);
      if (c.error) setErr(`All ${n} transaction${n === 1 ? " is" : "s are"} confirmed on chain. ${c.error}`);
    } catch (e) {
      setErr(`Something went wrong before the result could be read (${String((e as Error)?.message ?? e).slice(0, 120)}). The progress above is kept; pressing the button again checks the chain first.`);
    } finally {
      setBusy(false);
    }
  };
  // Launch on the review card was the decision; the wallet's own prompt is the signature — no second button on the happy path
  const [started, setStarted] = useState(false);
  useEffect(() => { if (autoStart && !started && !problems.length && creator && wallet.signTransaction) { setStarted(true); void go(); } }, [autoStart, started, problems.length, creator, wallet.signTransaction]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Plain step names: "Create $RAYS26" for the transaction the mint signs; "Link the two coins" for a pair-curve set-up; else the bundle's. */
  const stepName = (t: SignPlan["steps"][number], i: number) => {
    const c = plan.confirms.find((x) => x.step === i);
    if (c) return `Create $${c.ticker} with its rule locked in`;
    if (/init_pair/.test(t.label)) return "Link the two coins as one pair";
    return t.label;
  };
  const signerName = (s: string) => (s === "creator" ? "your wallet" : plan.labels[s] ?? s);
  const states = planStepStates(n, done, stopped);
  return (
    <div className="rounded-xl border border-amber-400/60 bg-neutral-900 p-4 space-y-3 text-sm" aria-label="Sign and send" data-sign-card>
      <h2 className="text-lg font-semibold">{title}</h2>
      <ol className="space-y-1 text-xs" aria-label="Steps">
        {plan.steps.map((t, i) => {
          const st = states[i], sig = st === "confirmed" ? done[i] : stopped?.failedAt === i ? stopped.signature : undefined;
          return (
            <li key={`${i}-${t.label}`} className="flex flex-wrap items-baseline gap-2" data-step-state={st}>
              <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${st === "confirmed" ? "border-emerald-400 text-emerald-400" : st === "sent" || (busy && i === done.length) ? "border-amber-400 text-amber-300" : st === "failed" || st === "abandoned" ? "border-red-400 text-red-400" : "border-neutral-600 text-neutral-400"}`}>{st === "confirmed" ? "✓" : i + 1}</span>
              <span className="text-neutral-200" title={t.label}>{stepName(t, i)}</span>
              <span className="text-neutral-500">signed by {t.signers.map(signerName).join(" + ")}</span>
              {st === "confirmed" && <span className="text-neutral-500">· {stepStatusText("confirmed", sig)}</span>}
              {st === "sent" && <span className="text-amber-300 break-all">· {stepStatusText("sent", sig)}</span>}
              {st === "failed" && <span className="text-red-400">· {stepStatusText("failed", sig)}</span>}
              {st === "not-sent" && stopped?.failedAt === i && <span className="text-neutral-500">· {stepStatusText("not-sent")}</span>}
              {st === "abandoned" && <span className="text-red-400">· {stepStatusText("abandoned")}</span>}
            </li>
          );
        })}
        {plan.confirms.map((c) => <li key={c.mint} className="text-neutral-500">{confirmed.includes(c.mint) ? "✓" : "·"} ${c.ticker} recorded as launched</li>)}
      </ol>
      {/* 2026-10-14 (owner): the address each coin gets, shown before anything is signed (prepared by the site, or found in this browser when none was ready; it ends in burn) */}
      <ul className="space-y-0.5 text-xs text-neutral-300" aria-label="Coin addresses" data-mint-addresses>{plan.confirms.map((c) => <li key={c.mint} className="break-all" data-mint-address={c.mint}>${c.ticker}&apos;s address is <code className="text-amber-200">{c.mint}</code></li>)}</ul>
      {plan.confirms.length > 0 && plan.confirms.every((c) => matchesSuffix(c.mint)) && <p className="text-xs text-neutral-500" data-mint-note>{MINT_ADDRESS_NOTE}</p>}
      <p className="text-xs text-neutral-500" data-no-opening-purchase>{NO_OPENING_PURCHASE_SENTENCE}</p>
      {notes.length > 0 && <ul className="list-disc pl-5 text-xs text-neutral-500">{notes.map((x) => <li key={x}>{x}</li>)}</ul>}
      {allLive ? (
        <div className="space-y-2" data-launch-complete>
          <p className="text-emerald-400">{plan.confirms.length > 1 ? "Both coins are live and recorded." : "Your coin is live and recorded."}</p>
          <p className="flex flex-wrap gap-2">{plan.confirms.map((c) => <a key={c.mint} className="rounded bg-amber-400 px-4 py-2 text-sm font-semibold text-neutral-950" href={coinHref(c.ticker)}>Open ${c.ticker}</a>)}</p>
          {/* the trade links on the success screen (find-and-trade, 2026-10-14) */}
          <LaunchedTrade coins={plan.confirms} />
        </div>
      ) : stopped?.state === "abandoned" ? (
        <button type="button" data-decision="new-plan" className="rounded border border-amber-400 px-5 py-2 text-base font-semibold text-amber-300" onClick={startNewPlan}>Start a new plan</button>
      ) : problems.length > 0 ? (
        <div className="text-amber-400 text-xs"><p>Not signable here yet:</p><ul className="list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>{pins === null && <button type="button" data-pin-retry className="mt-1 rounded border border-amber-400 px-2 py-1 text-amber-300" onClick={() => setPinTry((x) => x + 1)}>Read the setting again</button>}</div>
      ) : (
        <button type="button" data-decision="launch" className="rounded bg-amber-400 px-5 py-2 text-base font-semibold text-neutral-950 disabled:opacity-50" disabled={busy} onClick={go}>
          {busy ? `Signing step ${Math.min(done.length + 1, n)} of ${n}…` : stopped?.state === "sent" ? `Check step ${(stopped.failedAt ?? 0) + 1} on chain and continue` : done.length >= n ? "Record the launch again" : done.length ? `Continue from step ${done.length + 1} of ${n}` : `Sign in your wallet (${n} step${n === 1 ? "" : "s"})`}
        </button>
      )}
      {!allLive && <p className="text-xs text-neutral-500" data-session-scope>{SESSION_SCOPE_LINE}</p>}
      {notice && busy && <p className="text-xs text-amber-300" role="status" data-resign-notice>{notice}</p>}
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}
