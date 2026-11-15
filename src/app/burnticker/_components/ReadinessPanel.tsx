import type { Readiness } from "@/lib/burnticker/readiness";
import { PROGRESS_STEPS, progressOf } from "@/lib/burnticker/progress";

/**
 * ONE readiness state (readiness.ts) in words, numbered on the same six steps as the progress strip beside it (website-15 item 6,
 * ChatGPT repair 2): both are progress.ts's view of the one readiness state, so the panel never says "step 1 of 7" next to a six-step
 * strip. The full prerequisite chain is docs/burnticker/FIRST-BURN-PATH.md.
 */
export function ReadinessPanel({ r, firstBurnPathUrl }: { r: Readiness; firstBurnPathUrl: string }) {
  const tone = r.ok === false ? "border-red-700/60" : r.state === "burned" && r.ok ? "border-emerald-700/60" : "border-neutral-700";
  const p = progressOf(r);
  return (
    <section className={`rounded-lg border ${tone} bg-neutral-900 p-3 text-sm`} aria-label="Where this coin stands" data-readiness={r.state}>
      <p className="font-mono text-[11px] uppercase tracking-widest text-neutral-500" data-readiness-step={p.done}>Where this coin stands: step {p.done} of {PROGRESS_STEPS.length}. {p.now}</p>
      <p className="mt-1 font-medium text-neutral-100">{r.label}</p>
      <p className="mt-1 text-xs text-neutral-300">{r.detail}</p>
      <p className="mt-2 text-[11px] text-neutral-500"><a className="underline" href={firstBurnPathUrl}>The full path to a first burn</a> lists every step that has to happen first and the check that enforces each one.</p>
    </section>
  );
}
