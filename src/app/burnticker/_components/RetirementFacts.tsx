import { RETIREMENT_HEADING, retirementFacts } from "@/lib/burnticker/retirementCopy";

/** The retirement facts beside an end date (website-14, product idea 8). Every word is retirementCopy.ts, the one place it is written. */
export function RetirementFacts({ className = "", open = false, leftover = null }: { className?: string; /** website-15: already inside a collapsed block, so print the facts without a second disclosure */ open?: boolean; /** launch wizard audit F9: the leftover answer for this page (retirementCopy.ts LEFTOVER_SEE_END under the coin's own end) */ leftover?: string | null }) {
  const facts = <dl className="mt-1 space-y-1">{retirementFacts(leftover).map((f) => <div key={f.q}><dt className="font-medium text-neutral-200">{f.q}</dt><dd className="text-neutral-400">{f.a}</dd></div>)}</dl>;
  if (open) return <div className={`text-xs ${className}`} data-retirement>{facts}</div>;
  return (
    <details className={`text-xs ${className}`} data-retirement>
      <summary className="cursor-pointer text-neutral-300">{RETIREMENT_HEADING}</summary>
      {facts}
    </details>
  );
}
