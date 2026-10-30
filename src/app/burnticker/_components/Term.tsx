import type { ReactNode } from "react";
import { GLOSSARY, type TermId } from "@/lib/burnticker/glossary";

/** A term at its first use: dotted underline, the glossary sentence as its tooltip (and for screen readers). */
export function Term({ id, children }: { id: TermId; children?: ReactNode }) {
  const g = GLOSSARY[id];
  return <abbr className="bt-term cursor-help underline decoration-dotted underline-offset-2" title={g.short} aria-description={g.short}>{children ?? g.term}</abbr>;
}

/** A one-line note of several terms (smaller than body text; one line per term on a narrow screen). */
export function TermNote({ ids, label = "Words on this page" }: { ids: TermId[]; label?: string }) {
  return (
    <dl className="text-xs text-neutral-500 space-y-0.5" aria-label={label} data-glossary>
      {ids.map((id) => <div key={id}><dt className="inline font-medium text-neutral-400">{GLOSSARY[id].term}</dt> <dd className="inline">— {GLOSSARY[id].short}</dd></div>)}
    </dl>
  );
}
