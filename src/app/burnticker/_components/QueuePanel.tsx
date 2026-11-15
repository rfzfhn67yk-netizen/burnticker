import type { DeficitQueue } from "@/lib/burnticker/deficitQueue";

/**
 * THE QUEUED-UNITS COUNTER (website-14, LAUNCHPAD-PATH §73) on the $DEFICIT coin page's readiness panel: the debt's rise since launch,
 * the units queued on chain, and what share of the burn pool they spend once the pool opens, with the reading date and freshness. Every
 * word comes from deficitQueueCore.mjs; an unread file prints its "unavailable" sentence, never a placeholder number.
 */
export function QueuePanel({ q }: { q: DeficitQueue }) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm" aria-label="Queued units" data-queue={q.state}>
      <p className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">Readings waiting for the pool</p>
      <p className="mt-1 font-medium text-neutral-100">{q.headline}</p>
      {q.lines.map((l) => <p key={l} className={`mt-1 text-xs ${/out of date/.test(l) ? "text-amber-300" : "text-neutral-300"}`}>{l}</p>)}
    </section>
  );
}
