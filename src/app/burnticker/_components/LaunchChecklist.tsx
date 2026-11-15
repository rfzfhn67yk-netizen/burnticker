"use client";

import { useEffect, useState } from "react";
import { checklistNextLine } from "@/lib/burnticker/checklist";

/** The checklist's heading and the words for a step this site could not read (never ticked). */
export const CHECKLIST_HEADING = "After launch";
export const CHECKLIST_NOT_READ = "not read";

interface Step { id: string; label: string; done: boolean | null; detail: string }
interface Answer { steps: Step[]; next: { action: string; who: string } | null; line: string }

/** "Next: <action> This step is up to <who>." (checklist.ts checklistNextLine; the who is never glued onto the action's last sentence). */
export { checklistNextLine };

/**
 * WEBSITE-26 (WIRING-FEATURES item 10): a coin's post-launch checklist, from GET /api/burnticker/v1/coins/<MINT>/checklist. Six ticks in
 * order (created, trading, graduated, pool verified, first reading, first burn); a step this site could not read says "not read" and is
 * never ticked. Then "Next: <action> (<who>)", or the checklist's own line. Nothing is shown while it is read; a failed read says so once.
 */
export function LaunchChecklist({ mint, compact = false }: { mint: string; compact?: boolean }) {
  const [a, setA] = useState<Answer | null>(null), [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/burnticker/v1/coins/${encodeURIComponent(mint)}/checklist`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((j: Answer) => { if (live) { setA(j); setErr(false); } }).catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, [mint]);
  if (err) return <p className="text-xs text-neutral-500" data-checklist-unread>The checklist could not be read just now.</p>;
  if (!a) return null;
  return (
    <div className="min-w-0 space-y-1 text-xs" data-checklist>
      {!compact && <h3 className="font-medium text-neutral-300">{CHECKLIST_HEADING}</h3>}
      <ol className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
        {a.steps.map((s) => (
          <li key={s.id} className="min-w-0" title={s.detail} data-step={s.id} data-done={s.done === null ? "unknown" : String(s.done)}>
            <span aria-hidden="true" className={s.done === true ? "text-emerald-400" : "text-neutral-500"}>{s.done === true ? "✓" : "○"}</span>{" "}
            <span className={s.done === true ? "text-neutral-200" : "text-neutral-400"}>{s.label}</span>
            {s.done === null && <span className="text-neutral-500">, {CHECKLIST_NOT_READ}</span>}
            <span className="sr-only">{s.done === true ? ", done" : s.done === false ? ", not yet" : ""}</span>
          </li>
        ))}
      </ol>
      <p className="break-words text-neutral-300" data-checklist-next>{checklistNextLine(a)}</p>
    </div>
  );
}
