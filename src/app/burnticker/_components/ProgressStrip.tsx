import { PROGRESS_STEPS, progressSummary, type ProgressView } from "@/lib/burnticker/progress";

/**
 * THE PROGRESS STRIP (website-14, product idea 4): the six steps from creation to the first burn, with the next unmet condition in one
 * sentence. progress.ts maps readiness.ts's states onto the steps; this only draws them. `compact` is the card's version (dots and the
 * current step's name); the coin page shows every step's name.
 */
export function ProgressStrip({ p, compact = false }: { p: ProgressView; compact?: boolean }) {
  const current = p.done < PROGRESS_STEPS.length ? PROGRESS_STEPS[p.done] : "Burned";
  return (
    <div className={`bt-progress${compact ? " is-compact" : ""}`} data-progress={p.from}>
      <ol className="bt-progress-steps" aria-label={progressSummary(p)}>
        {p.steps.map((s) => <li key={s.label} className={`bt-progress-step is-${s.state}`} aria-current={s.state === "current" ? "step" : undefined}><span className="bt-progress-dot" aria-hidden="true" />{!compact && <span className="bt-progress-label">{s.label}</span>}</li>)}
      </ol>
      {compact && <span className="bt-progress-now">{p.done >= PROGRESS_STEPS.length ? "Burned" : `Now: ${current.toLowerCase()}`}</span>}
      <p className="bt-progress-next">{p.next}</p>
    </div>
  );
}
