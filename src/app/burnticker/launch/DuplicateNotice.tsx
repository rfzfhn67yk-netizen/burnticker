import Link from "next/link";
import { DUPLICATE_LINES, type ExistingCoin } from "@/lib/burnticker/duplicateRule";

/** "View existing coins" (website-14, product idea 6): the coins already registered with this rule, and the plain facts about a separate coin. */
export function DuplicateNotice({ existing }: { existing: ExistingCoin[] }) {
  if (!existing.length) return null;
  return (
    <div className="mt-2 rounded border border-amber-700/50 p-2 text-xs text-neutral-300" data-duplicate-rule>
      <p className="text-amber-200">{DUPLICATE_LINES.head(existing.length)}</p>
      <details className="mt-1"><summary className="cursor-pointer underline">{DUPLICATE_LINES.view}</summary>
        <ul className="mt-1 space-y-0.5">{existing.map((e) => <li key={e.mint}><Link className="underline" href={e.href}>{e.name} <span className="font-mono">${e.ticker}</span></Link>{e.sameRule ? " has the identical rule." : " reads the same source with a different share or filter."} <span className="break-all font-mono text-neutral-500">Mint {e.mint}</span></li>)}</ul>
      </details>
      <p className="mt-1">{DUPLICATE_LINES.separate} {DUPLICATE_LINES.ticker}</p>
    </div>
  );
}
