import { READINESS_ORDER, type Readiness } from "@/lib/burnticker/readiness";

const STEP_LABEL: Record<string, string> = { "not-launched": "launch", "on-curve": "curve", "awaiting-registration": "pool", "awaiting-event": "reading", "below-floor": "spend floor", deferred: "execution", burned: "burn" };

/** ONE readiness state (readiness.ts), with the step strip; the full prerequisite chain is docs/burnticker/FIRST-BURN-PATH.md. */
export function ReadinessPanel({ r, firstBurnPathUrl }: { r: Readiness; firstBurnPathUrl: string }) {
  const tone = r.ok === false ? "border-red-700/60" : r.state === "burned" && r.ok ? "border-emerald-700/60" : "border-neutral-700";
  return (
    <section className={`rounded-lg border ${tone} bg-neutral-900 p-3 text-sm`} aria-label="Where this coin stands" data-readiness={r.state}>
      <p className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">Where this coin stands: step {r.step} of {READINESS_ORDER.length}</p>
      <p className="mt-1 font-medium text-neutral-100">{r.label}</p>
      <p className="mt-1 text-xs text-neutral-300">{r.detail}</p>
      <ol className="mt-2 flex flex-wrap gap-1 text-[10px] font-mono uppercase" aria-label="Steps">{READINESS_ORDER.map((s, k) => <li key={s} className={`rounded px-1.5 py-0.5 ${k + 1 < r.step ? "bg-neutral-800 text-neutral-400" : k + 1 === r.step ? "bg-amber-400 text-neutral-950" : "border border-neutral-800 text-neutral-600"}`}>{STEP_LABEL[s]}</li>)}</ol>
      <p className="mt-2 text-[11px] text-neutral-500"><a className="underline" href={firstBurnPathUrl}>The full path to a first burn</a> lists every step that has to happen first and the check that enforces each one.</p>
    </section>
  );
}
