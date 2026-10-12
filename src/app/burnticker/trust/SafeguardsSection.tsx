import { ADMISSION_RULES, GUARDRAILS, GUARDRAIL_SUMMARY, SAFEGUARDS, WHO_GETS_WHAT } from "@/lib/burnticker/safeguards";

/**
 * GUARDRAILS AND SAFEGUARDS ON THE TRUST PAGE (site audit #7/#8, 2026-10-11): moved here from the homepage, rendered once, from static
 * copy (src/lib/burnticker/safeguards.ts) — no API read, so it is on the page even when the live trust data is unavailable. Current values
 * (signers, upgrade authority, time lock) stay in the current-status summary above and are not restated.
 */
export default function SafeguardsSection({ card }: { card: string }) {
  return (
    <section className={card} id="safeguards" aria-labelledby="safeguards-h">
      <h2 id="safeguards-h" className="font-medium">Guardrails and safeguards</h2>
      <p className="text-xs text-neutral-300">{GUARDRAIL_SUMMARY}</p>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono text-neutral-300" aria-label="The eleven guardrails" data-guardrails>{GUARDRAILS.map((g) => <li key={g}>✓ {g}</li>)}</ul>
      <details className="mt-3 text-xs"><summary className="cursor-pointer text-neutral-300">What protects a burn</summary>
        <dl className="mt-2 grid gap-3 md:grid-cols-2">{SAFEGUARDS.map((s) => <div key={s.id}><dt className="font-medium text-neutral-100">{s.title}</dt><dd className="text-neutral-300">{s.text}</dd></div>)}</dl>
      </details>
      <details className="mt-1 text-xs"><summary className="cursor-pointer text-neutral-300">Who gets what</summary>
        <dl className="mt-2 grid gap-3 md:grid-cols-3">{WHO_GETS_WHAT.map((w) => <div key={w.who}><dt className="font-medium text-neutral-100">{w.who}</dt><dd className="text-neutral-300">{w.text}</dd></div>)}</dl>
      </details>
      <details className="mt-1 text-xs"><summary className="cursor-pointer text-neutral-300">Which sources a rule may settle on</summary><p className="mt-2 text-neutral-300">{ADMISSION_RULES} The coverage table below lists what can be settled today and what cannot.</p></details>
    </section>
  );
}
