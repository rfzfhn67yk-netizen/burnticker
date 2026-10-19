import type { Metadata } from "next";
import Link from "next/link";
import { RIVALRY_TEMPLATES, TEMPLATES, settingsLine } from "@/lib/burnticker/templates";
import { edgeCase } from "@/lib/burnticker/ruleEdgeCases";
import { endExplainer, leadSentence } from "@/lib/burnticker/describe";
import { hostCluster, siteLaunchState } from "@/lib/burnticker/launchAvailability";
import { graduationLines } from "@/lib/burnticker/launchReview";
import { GRADUATION_LABEL } from "@/lib/burnticker/guidedLaunch";
import { CreatorOnboarding } from "../_components/CreatorOnboarding";
import { CreatorBenefitsList } from "./CreatorBenefitsList";
import { ExampleTickets } from "./ExampleTickets";
import { withShareCard } from "@/lib/burnticker/pageMeta";

export const dynamic = "force-dynamic";

export const metadata: Metadata = withShareCard({ title: "Templates", description: "The twelve rule shapes a Burnticker coin can take, each with an example and a link that opens the create screen ready for it.", alternates: { canonical: "/burnticker/templates" } }); // audit 7 item 27: a canonical URL

/**
 * Walkthrough 13: the example's sentences after the first, for "How it settles", without the ones the card's pair line already says
 * (the matchup and two-candidate cards printed "After a draw…" and "If neither candidate wins…" twice).
 */
function settlesRest(t: { example: string; pairLine?: string | null }): string {
  const rest = t.example.slice(leadSentence(t.example).length).trim();
  if (!rest || !t.pairLine) return rest;
  return rest.split(/(?<=\.)\s+/).filter((s) => !t.pairLine!.includes(s)).join(" ");
}

/** THE TEMPLATES GALLERY (2026-10-10): the twelve canonical rule shapes (src/lib/burnticker/templates.ts), each with its example and "Start from this". */
export default function TemplatesPage() {
  const shapeLabel = { recurring: "recurring", "one-shot": "one-shot", pair: "two coins" } as const;
  // review 2 §2 / website-12: the Start links appear only while the wizard is open on this host, and only for a kind of coin this host
  // takes; a pair template (shape "pair") greys out with the one pair line while pairs are unavailable (launchAvailability.ts siteLaunchState)
  const site = siteLaunchState(process.env);
  const launch = { open: site.wizard };
  const isPair = (t: (typeof TEMPLATES)[number]) => t.shape === "pair" || t.type === "derby" || t.type === "pairs";
  const unavailable = (t: (typeof TEMPLATES)[number]): string | null => (isPair(t) && !site.pairs.available ? site.pairs.line : t.type && !site.types[t.type].available ? `${site.types[t.type].label} launches are not available on this site.` : null);
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Templates</h1>
        <p className="max-w-3xl text-sm text-neutral-400">A coin&apos;s rule can take one of twelve shapes.{launch.open ? <> Pick one to open the launch page at the step it names. Each card says what you can still change. On any coin or pair page, &ldquo;Launch one like this&rdquo; starts from that coin&apos;s own shape.</> : <> The shapes are shown so you can read what each kind of rule does.</>}</p>
        <p className="max-w-3xl text-sm text-neutral-300" data-launch-state>{site.sentence}</p>
        {/* WIRING-SEMANTICS item 64: dated examples are illustrations; a dated template opens a search of open markets only */}
        <p className="max-w-3xl text-xs text-neutral-500" data-dated-examples>{edgeCase(64)}</p>
      </header>
      <CreatorOnboarding />
      {/* website-17 item 6: the benefits list right after the no-fee-revenue line */}
      <CreatorBenefitsList />
      {/* website-19 (owner, 2026-10-12): what graduation means, once, with the numbers from the launch constants */}
      <details className="max-w-3xl rounded-lg border border-neutral-800 p-3 text-sm text-neutral-300" data-graduation>
        <summary className="cursor-pointer">{GRADUATION_LABEL}</summary>
        {graduationLines(hostCluster(process.env)).map((x) => <p key={x} className="mt-1">{x}</p>)}
        <p className="mt-1"><Link className="underline" href="/burnticker/how-burns-settle">How burns are settled</Link></p>
      </details>
      {/* ChatGPT audit 6 item 3: how a rule ends, from the same end text the review and the coin description use (describe.ts endText) */}
      <details className="max-w-3xl rounded-lg border border-neutral-800 p-3 text-sm text-neutral-300" data-end-explainer>
        <summary className="cursor-pointer">When a rule ends</summary>
        {endExplainer().map((x) => <p key={x} className="mt-1">{x}</p>)}
      </details>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="templates">
        {TEMPLATES.map((t) => { const launch = { open: site.wizard && !unavailable(t) }; return (
          <li key={t.id} className={`flex flex-col rounded-lg border border-neutral-800 bg-neutral-900 p-4${unavailable(t) ? " border-dashed" : ""}`} data-unavailable={unavailable(t) ? "" : undefined}>
            <div className="flex items-center gap-2"><h2 className="font-medium">{t.title}</h2><span className="bt-chip">{shapeLabel[t.shape]}</span></div>
            {/* website-18 (the owner: "be more brief"): the example's first sentence on the card; the settlement source one tap away */}
            <p className="mt-2 text-sm text-neutral-200" data-template-example>{leadSentence(t.example)}</p>
            {t.pairLine && <p className="mt-1 text-xs text-amber-200" aria-label="pair rule">{t.pairLine}</p>}
            <details className="mt-2 text-xs text-neutral-500" data-template-settles><summary className="cursor-pointer">How it settles</summary><p className="mt-1">{settlesRest(t)}{settlesRest(t) ? " " : ""}It settles on {t.settles}.</p></details>
            {/* launch audit 5 L10: what "Start from this" opens, said before the click */}
            <p className="mt-1 text-xs text-neutral-400" data-template-lands={t.lands}>{t.operatorOnly ? `${t.operatorOnly} ` : ""}{t.lands === "review" ? "This opens step 3, how it burns, with exactly this example filled in." : `This opens the launch page so you can ${t.choices}.`} <span data-template-settings>{settingsLine(t)}</span></p>
            {unavailable(t) ? <details className="mt-auto pt-3 text-xs text-amber-300" data-pairs-blocked={isPair(t) ? "" : undefined}><summary className="cursor-pointer">{unavailable(t)}</summary><p className="mt-1 text-neutral-300">{isPair(t) ? site.pairs.detail : site.types[t.type].reason}</p></details>
 : null}
            {launch.open && <Link className="mt-auto pt-3 text-sm font-medium text-amber-300 underline" href={t.href}>{t.cta} →</Link>}
          </li>
        ); })}
      </ul>
      {/* website-26 (WIRING-FEATURES item 13): three Coin vs Coin pairs with both reference coins already picked; the link opens the Name step */}
      <section className="space-y-2" aria-labelledby="rivalries-h" data-rivalry-templates>
        <h2 id="rivalries-h" className="text-lg font-semibold">Ready-made rivalries</h2>
        <p className="max-w-3xl text-sm text-neutral-400">Both reference coins are already picked. The link opens the step where you name the two new coins.</p>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="ready-made rivalries">
          {RIVALRY_TEMPLATES.map((r) => { const blocked = !site.pairs.available ? site.pairs.line : !site.types.derby.available ? `${site.types.derby.label} launches are not available on this site.` : null; return (
            <li key={r.id} className={`flex flex-col rounded-lg border border-neutral-800 bg-neutral-900 p-4${blocked ? " border-dashed" : ""}`} data-rivalry={r.id}>
              <h3 className="font-medium">{r.title}</h3>
              <p className="mt-2 text-sm text-neutral-200">{leadSentence(r.example)}</p>
              <details className="mt-2 text-xs text-neutral-500"><summary className="cursor-pointer">How it runs</summary><p className="mt-1">{r.example.slice(leadSentence(r.example).length).trim()}</p></details>
              {blocked ? <p className="mt-auto pt-3 text-xs text-amber-300">{blocked}</p> : site.wizard && <Link className="mt-auto pt-3 text-sm font-medium text-amber-300 underline" href={r.href} data-rivalry-link>{r.cta} →</Link>}
            </li>
          ); })}
        </ul>
      </section>
      {/* website-17 item 7: the example tickets, after the real templates */}
      <ExampleTickets site={site} />
    </main>
  );
}
