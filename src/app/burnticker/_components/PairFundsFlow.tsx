import { pairFundsFlow, type PairRuleVersion } from "@/lib/burnticker/pairFundsFlow";

/** The plain-language funds flow for a pair (pairFundsFlow.ts): one line open, the steps and every outcome behind a disclosure. */
export function PairFundsFlow({ version, tickers, open = false }: { version: PairRuleVersion; tickers?: { a: string; b: string }; open?: boolean }) {
  const f = pairFundsFlow(version, tickers);
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-xs" aria-label="Where the money goes" data-pair-funds-flow={f.version}>
      <p className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">{f.versionLabel}</p>
      <p className="mt-1 text-sm text-neutral-100">{f.oneLiner}</p>
      <details className="mt-2" open={open}><summary className="cursor-pointer text-neutral-300">Where the money goes, and what happens on a draw, a missing result or a time-out</summary>
        <dl className="mt-2 space-y-1">{f.steps.map((s) => <div key={s.title}><dt className="inline font-medium text-neutral-200">{s.title}: </dt><dd className="inline text-neutral-300">{s.text}</dd></div>)}</dl>
        <ul className="mt-2 list-disc pl-5 space-y-1 text-neutral-300">{f.outcomes.map((o) => <li key={o.when}><b className="text-neutral-200">{o.when}:</b> {o.then}</li>)}</ul>
        <p className="mt-2 text-neutral-400">{f.never}</p>
      </details>
    </section>
  );
}
