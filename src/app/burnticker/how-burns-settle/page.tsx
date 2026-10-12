import type { Metadata } from "next";
import Link from "next/link";
import { settlementFacts } from "@/lib/burnticker/settlement";
import { SETTLEMENT_DESCRIPTION, SETTLEMENT_PATH, SETTLEMENT_TITLE, settlementSections } from "@/lib/burnticker/settlementCopy";
import type { SettlementFacts } from "@/lib/burnticker/settlementCopy";
import { EmptyState } from "../_components/EmptyState";
import { Page, PageHeader, Panel } from "../_components/Panel";

export const metadata: Metadata = { title: SETTLEMENT_TITLE, description: SETTLEMENT_DESCRIPTION, alternates: { canonical: SETTLEMENT_PATH } };
export const dynamic = "force-dynamic";

/**
 * /burnticker/how-burns-settle (owner, 2026-10-12): how often each source is read, when a result counts, how the burn runs, typical
 * times and where the receipt appears. Every number is derived from the code (settlement.ts); the words are settlementCopy.ts.
 */
export default function HowBurnsSettlePage() {
  let f: SettlementFacts | null = null;
  try { f = settlementFacts(); } catch { f = null; }
  const c = f ? settlementSections(f) : null;
  return (
    <Page>
      <PageHeader title={SETTLEMENT_TITLE} intro={c?.intro} />
      {!c ? <EmptyState kind="unavailable" /> : c.sections.map((s) => (
        <Panel key={s.id} id={s.id} title={s.heading}>
          {s.paragraphs.map((p) => <p key={p} className="bt-body-text">{p}</p>)}
        </Panel>
      ))}
      <p className="bt-meta"><Link className="underline" href="/burnticker/how-a-burn-works">Watch how a burn works</Link>. <Link className="underline" href="/burnticker/verify-yourself">Verify a receipt yourself</Link>.</p>
    </Page>
  );
}
