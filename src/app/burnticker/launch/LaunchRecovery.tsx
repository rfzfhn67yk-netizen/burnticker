"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { browserPlanStorage, listStoredLaunches, recordFailureSentence, recoverStoredLaunch, storedLaunchSentence, withPlanLock, PLAN_LOCKED_SENTENCE, type StoredLaunch } from "@/lib/burnticker/signPlan";
import { launchedErrorMessage } from "@/lib/burnticker/pairLaunchClient";
import { resumeReviewHref } from "@/lib/burnticker/launchDraftStore";
import { afterRecoveryCheck, archivePlanRecord, chainReadDeps, readLaunchHistory, recoveryErrorSentence, storedLaunchAction, RECOVERY_BUTTON, START_NEW_LINE, type LaunchHistoryEntry, type RecoveryView } from "@/lib/burnticker/launchRecovery";

/**
 * AFTER A RELOAD (review-2 F4): a launch whose signing card is gone — the page reloaded mid-run — is still in this tab's storage
 * (signPlan.ts PlanRecord). This notice lists it with its last known state ("Sent; confirmation unavailable — signature …") and, on a
 * press, looks the sent transaction up on chain, adopts it when it landed (nothing is sent again), and records the drafts once every
 * step is confirmed. It never signs or sends: a step that did not take effect is started again from the review.
 *
 * Launch audit 2026-10-12 (launchRecovery.ts): each entry's button is its real next step (228–233): check a sent step, record a fully
 * confirmed launch, or, when the mint keys are gone and steps are left, start a new launch (the entry moves to the read-only history,
 * 234). A launch the check records stays on the notice as finished, with a link to each coin and when it was checked. A check that throws
 * says "nothing changed" only when the stored record did not change (237). The plan lock keeps a check and a signing run apart (250).
 */
export function LaunchRecovery() {
  const { connection } = useConnection();
  const [storage] = useState(() => browserPlanStorage());
  // read after mount (the server render has no sessionStorage; reading it in the initial state would not match the server's HTML)
  const [view, setView] = useState<RecoveryView>({ items: [], finished: [] });
  const [history, setHistory] = useState<LaunchHistoryEntry[]>([]);
  useEffect(() => { setView({ items: listStoredLaunches(storage), finished: [] }); setHistory(readLaunchHistory(storage)); }, [storage]);
  const [text, setText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!view.items.length && !view.finished.length && !history.length) return null;
  const check = async (s: StoredLaunch) => {
    setBusy(s.key);
    const before = storage.get(s.key);
    try {
      const locked = await withPlanLock(s.key, () => recoverStoredLaunch(storage, s, chainReadDeps(connection), (u, init) => fetch(u, init), (st, b, ra) => recordFailureSentence(st, b, ra, launchedErrorMessage)));
      if (!locked.ran) { setText((t) => ({ ...t, [s.key]: PLAN_LOCKED_SENTENCE })); return; }
      const r = locked.value;
      setText((t) => ({ ...t, [s.key]: r.text }));
      setView((v) => afterRecoveryCheck(v, s, r, listStoredLaunches(storage), Date.now()));
    } catch (e) {
      const changed = storage.get(s.key) !== before;
      setText((t) => ({ ...t, [s.key]: recoveryErrorSentence(changed, e) }));
      if (changed) setView((v) => ({ ...v, items: listStoredLaunches(storage) }));
    } finally { setBusy(null); }
  };
  /** the one real next step for an entry whose keys are gone: keep it in the history and go back to the review */
  const startNew = (s: StoredLaunch) => { archivePlanRecord(storage, s.key); window.location.assign(resumeReviewHref(window.location.pathname)); };
  const open = view.items.length > 0;
  return (
    <section className={`rounded-lg border p-3 text-sm space-y-2 ${open ? "border-amber-500/40 bg-amber-500/5" : "border-neutral-800"}`} aria-label={open ? "Unfinished launch from this tab" : "Launches from this tab"} data-launch-recovery>
      {open && <h2 className="font-medium">A launch from this tab is unfinished</h2>}
      {view.items.map((s) => (
        <div key={s.key} className="space-y-1">
          <p className="text-xs break-all">{text[s.key] ?? storedLaunchSentence(s)}</p>
          {storedLaunchAction(s) === "start-new" ? (
            <>
              <button type="button" data-decision="new-plan" className="rounded border border-neutral-600 px-2 py-1 text-xs" onClick={() => startNew(s)}>{RECOVERY_BUTTON["start-new"]}</button>
              <p className="text-xs text-neutral-500">{START_NEW_LINE}</p>
            </>
          ) : (
            <button type="button" className="rounded border border-neutral-600 px-2 py-1 text-xs disabled:opacity-50" disabled={busy !== null} onClick={() => void check(s)}>{busy === s.key ? "Checking…" : RECOVERY_BUTTON[storedLaunchAction(s)]}</button>
          )}
        </div>
      ))}
      {view.finished.map((f) => (
        <div key={f.key} className="space-y-1" data-launch-finished>
          <p className="text-xs text-emerald-400">{f.text} <span className="text-neutral-500">{f.checked}</span></p>
          <p className="flex flex-wrap gap-2">{f.coins.map((c) => <a key={c.ticker} className="rounded bg-amber-400 px-3 py-1 text-xs font-semibold text-neutral-950" href={c.href}>Open ${c.ticker}</a>)}</p>
        </div>
      ))}
      {history.length > 0 && (
        <details className="text-xs text-neutral-400" data-launch-history>
          <summary className="cursor-pointer">Earlier launches from this tab</summary>
          <ul className="mt-1 space-y-2">
            {history.map((h) => (
              <li key={`${h.archivedAt}-${h.coins.map((c) => c.mint).join("+")}`} className="break-all">
                <p>{h.coins.map((c) => `$${c.ticker} (mint ${c.mint})`).join(" and ") || "A launch"}, replaced by a new plan.</p>
                {h.signatures.map((g) => <p key={g.signature}>Step {g.step + 1} of {h.steps}, {g.state === "confirmed" ? "confirmed" : g.state === "sent" ? "sent with its outcome unknown" : "did not take effect"}: signature {g.signature}</p>)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
