import { progressSummary, type ProgressView } from "@/lib/burnticker/progress";

/**
 * THE PROGRESS STRIP (website-14, product idea 4): the six steps from creation to the first burn, with the next unmet condition in one
 * sentence. progress.ts maps readiness.ts's states onto the steps; this only draws them. The heading is p.now: "Not created", the next
 * unmet milestone as "Next: ...", or "Burned" (website-15 item 6). `compact` is the card's version (dots and the
 * current step's name); the coin page shows every step's name.
 */
export function ProgressStrip({ p, compact = false }: { p: ProgressView; compact?: boolean }) {
  return (
    <div className={`bt-progress${compact ? " is-compact" : ""}`} data-progress={p.from}>
      <ol className="bt-progress-steps" aria-label={progressSummary(p)}>
        {p.steps.map((s) => <li key={s.label} className={`bt-progress-step is-${s.state}`} aria-current={s.state === "current" ? "step" : undefined}><span className="bt-progress-dot" aria-hidden="true" />{!compact && <span className="bt-progress-label">{s.label}{s.state === "na" && <span className="bt-progress-na">, not applicable</span>}</span>}</li>)}
      </ol>
      {compact && <span className="bt-progress-now">{p.now}</span>}
      <p className="bt-progress-next">{p.next}</p>
    </div>
  );
}
