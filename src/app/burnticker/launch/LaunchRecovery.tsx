"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { browserPlanStorage, listStoredLaunches, recordFailureSentence, recoverStoredLaunch, storedLaunchSentence, type StoredLaunch } from "@/lib/burnticker/signPlan";
import { launchedErrorMessage } from "@/lib/burnticker/pairLaunchClient";

/**
 * AFTER A RELOAD (review-2 F4): a launch whose signing card is gone — the page reloaded mid-run — is still in this tab's storage
 * (signPlan.ts PlanRecord). This notice lists it with its last known state ("Sent; confirmation unavailable — signature …") and, on a
 * press, looks the sent transaction up on chain, adopts it when it landed (nothing is sent again), and records the drafts once every
 * step is confirmed. It never signs or sends: a step that did not take effect is started again from the review.
 */
export function LaunchRecovery() {
  const { connection } = useConnection();
  const [storage] = useState(() => browserPlanStorage());
  // read after mount (the server render has no sessionStorage; reading it in the initial state would not match the server's HTML)
  const [items, setItems] = useState<StoredLaunch[]>([]);
  useEffect(() => { setItems(listStoredLaunches(storage)); }, [storage]);
  const [text, setText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!items.length) return null;
  const check = async (s: StoredLaunch) => {
    setBusy(s.key);
    try {
      const r = await recoverStoredLaunch(storage, s, {
        getSignatureStatus: async (sig) => (await connection.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0] ?? null,
        getBlockHeight: () => connection.getBlockHeight("confirmed"),
      }, (u, init) => fetch(u, init), (st, b, ra) => recordFailureSentence(st, b, ra, launchedErrorMessage));
      setText((t) => ({ ...t, [s.key]: r.text }));
      // a finished record is gone from storage; an unfinished one shows its new state (the sentence above) until it is finished
      setItems(r.done ? listStoredLaunches(storage) : (xs) => xs.map((x) => (x.key === s.key ? { key: s.key, rec: r.rec } : x)));
    } catch (e) {
      setText((t) => ({ ...t, [s.key]: `The chain could not be read just now (${String((e as Error)?.message ?? e).slice(0, 100)}); nothing changed. Try again.` }));
    } finally { setBusy(null); }
  };
  return (
    <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm space-y-2" aria-label="Unfinished launch from this tab" data-launch-recovery>
      <h2 className="font-medium">A launch from this tab is unfinished</h2>
      {items.map((s) => (
        <div key={s.key} className="space-y-1">
          <p className="text-xs break-all">{text[s.key] ?? storedLaunchSentence(s)}</p>
          <button type="button" className="rounded border border-neutral-600 px-2 py-1 text-xs disabled:opacity-50" disabled={busy !== null} onClick={() => void check(s)}>{busy === s.key ? "Checking…" : "Check on chain and record"}</button>
        </div>
      ))}
    </section>
  );
}
