import { utcDay } from "@/lib/burnticker/utcWords";
import type { Metadata } from "next";
import Link from "next/link";
import { deficitPrelaunch, type DeficitPrelaunch } from "@/lib/burnticker/deficitPrelaunch";
import { leagueIndex } from "@/lib/burnticker/leagues";
import { GLOSSARY } from "@/lib/burnticker/glossary";
import { siteLaunchState } from "@/lib/burnticker/launchAvailability";
import { prerequisiteLineFor, PREREQUISITE_STATES } from "@/lib/burnticker/launchReview";
import { SHARE_PRESETS, pctLabel } from "@/lib/burnticker/launchPresets";
import { EXPLORE_VERIFIED_BURN } from "@/lib/burnticker/currentStatusLinks";
import { DEFICIT_SITE } from "@/lib/burnticker/creatorLaunches";
import { HOW_IT_WORKS } from "@/lib/burnticker/siteNav.mjs";
import { SEASONS_LINKS } from "../_components/nav";
import { WHY_CREATE } from "@/lib/burnticker/creatorCopy";
import { RAISE_PRESETS_SOL } from "@/lib/burnticker/launchPresets";
import { endExplainer } from "@/lib/burnticker/describe";
import { shareLimitsText } from "@/lib/burnticker/rules";
import { MISSION_STATEMENT } from "@/lib/burnticker/mission";

const DESCRIPTION = "How Burnticker works: one locked rule per coin, a public result that settles it, a program that burns what the coin's own fees bought back, and a receipt anyone can check.";
export const metadata: Metadata = {
  title: "How it works", description: DESCRIPTION, alternates: { canonical: "/burnticker/about" },
  openGraph: { type: "website", siteName: "Burnticker", title: "How Burnticker works", description: DESCRIPTION, url: "/burnticker/about", images: [{ url: "https://burnticker.com/burnticker/brand/og-544200bcce.jpg", width: 1200, height: 630, alt: "Burnticker — a thermal receipt with the burned amount scorched out of it" }] },
};
export const dynamic = "force-dynamic";

/**
 * HOW IT WORKS (website-10, 2026-10-12; the owner's review item 1: the explainer moves off the home page, which is now the coin list).
 * What the old landing page explained, in the same plain words: the three steps, the one-line definition, the real devnet receipt (read
 * from config/burnticker/current-status.json through deficitPrelaunch, never typed here), how launching works, Seasons, $DEFICIT and the
 * precise terms the home page no longer puts in its headlines (review items 7 and 10). The disclaimers live once, in the footer.
 */
/** "October 6, 2026" from "2026-10-06". */
const longDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export default function AboutPage() {
  let d: DeficitPrelaunch | null = null;
  try { d = deficitPrelaunch(); } catch { d = null; }
  const ix = leagueIndex([], Date.now());
  const sports = [...ix.sports].map((s) => s.label.toLowerCase()).sort();
  const sportList = sports.length > 1 ? `${sports.slice(0, -1).join(", ")} and ${sports[sports.length - 1]}` : sports.join("");
  const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-4 space-y-2";
  const launch = siteLaunchState(process.env);
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 space-y-6 text-sm">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">How Burnticker works</h1>
        {/* the owner-approved mission statement (2026-10-18), one constant for every surface */}
        <p className="text-neutral-100" data-mission>{MISSION_STATEMENT}</p>
        <p className="text-neutral-300">Burnticker is a launchpad for Solana memecoins. Each coin has one locked rule. When the rule&apos;s result settles, the coin&apos;s own trading fees buy it back on its own pool, and a program burns what they bought. The transaction is the receipt.</p>
      </header>

      <section className={card} aria-labelledby="about-steps">
        <h2 id="about-steps" className="text-lg font-medium">Three steps</h2>
        <ol className="list-decimal pl-5 space-y-2 text-neutral-200">
          {HOW_IT_WORKS.map((h) => <li key={h.title}><b>{h.title}.</b> {h.text}</li>)}
        </ol>
        <p className="text-amber-200" data-prerequisite>{prerequisiteLineFor("launchlab")}</p>
        <details className="text-neutral-400"><summary className="cursor-pointer">A result that qualifies does not always burn at once</summary><ul className="mt-1 list-disc space-y-0.5 pl-5">{PREREQUISITE_STATES.map((x) => <li key={x}>{x}</li>)}</ul></details>
        <p className="text-neutral-400">A key signs each result on chain before anything burns. The signature proves who signed the reading. It does not prove the reading is true, which is why every receipt also names its source, so anyone can compare the two.</p>
      </section>

      <section className={card} aria-labelledby="about-receipt">
        <h2 id="about-receipt" className="text-lg font-medium">A real receipt</h2>
        {d ? <>
          <p className="text-neutral-300">This is a real burn from the devnet rehearsal on {longDay(d.rehearsal.demo.recordDate)}. Devnet is a practice network, and nothing on it has money value.</p>
          <p className="text-neutral-200">{d.rehearsal.demo.summary}</p>
        </> : <p className="text-neutral-400">The rehearsal&apos;s summary could not be read just now. The receipt itself can still be checked.</p>}
        <p><Link className="bt-launch-btn" href={EXPLORE_VERIFIED_BURN.href}>{EXPLORE_VERIFIED_BURN.label}</Link></p>
        <p className="text-xs text-neutral-500">The check runs in your browser. It reads the devnet chain and the Treasury&apos;s own data.</p>
        <p><Link className="underline" href="/burnticker/how-a-burn-works">Watch how a burn works</Link>, step by step, with this same receipt.</p>
      </section>

      <section className={card} aria-labelledby="about-launch">
        <h2 id="about-launch" className="text-lg font-medium">Launching a coin</h2>
        <ol className="list-decimal pl-5 space-y-2 text-neutral-200">
          <li>Describe the result, or browse by category. Each suggestion says where the result comes from, who checks it and when it settles.</li>
          <li>Choose what triggers a burn. It can be a yes-or-no result, or every full unit of a settled number. Then choose the burn budget per result: {SHARE_PRESETS.recurring.map(pctLabel).join(", ").replace(/, ([^,]+)$/, " or $1")} of the coin&apos;s burn budget each time for a rule that repeats, or {SHARE_PRESETS.oneShot.map(pctLabel).join(", ").replace(/, ([^,]+)$/, " or $1")} for a rule that resolves once. The tokens bought are burned, so the number burned varies. The API accepts other shares.</li>
          <li>Choose how much SOL the curve raises before the coin graduates to its own pool: {RAISE_PRESETS_SOL.slice(0, -1).join(", ")} or {RAISE_PRESETS_SOL[RAISE_PRESETS_SOL.length - 1]} SOL. A smaller raise means less trading before the first burn and a shallower pool afterwards. One burn run spends the rule&apos;s full share of the burn pool either way.</li>
          <li>Connect a wallet, then approve the launch in it. A single coin is two transactions: the first locks in its rule, and the second creates the coin on Raydium LaunchLab. The review lists every transaction before your wallet opens. You pay the venue&apos;s creation cost and the network fee. Creators receive no trading-fee revenue, because the creator&apos;s share of the fees goes to the coin&apos;s burn pool.</li>
        </ol>
        <p className="text-neutral-400">The rule is locked at launch. A different rule means a different coin.</p>
        <p className="text-neutral-400" data-share-limits>{shareLimitsText()}</p>
        <h3 className="pt-1 font-medium" id="when-a-rule-ends">When a rule ends</h3>
        {/* ChatGPT audit 6 item 3: the review, the coin text and this page read the same end text (describe.ts endText) */}
        <ul className="list-disc pl-5 space-y-1 text-neutral-200" data-end-explainer>{endExplainer().map((s) => <li key={s}>{s}</li>)}</ul>
        <h3 className="pt-1 font-medium" id="why-create">Why create a coin</h3>
        <p className="text-neutral-200" data-why-create>{WHY_CREATE}</p>
        <p className="text-neutral-200" data-launch-state>{launch.sentence}</p>
      </section>

      <section className={card} aria-labelledby="about-seasons">
        <h2 id="about-seasons" className="text-lg font-medium">Seasons</h2>
        <p className="text-neutral-200">Each league gets one scoreboard per season. A board ranks that league&apos;s team coins by their receipts. The {ix.totals.leagues} leagues cover {sportList}. Rivalries and the Burn Derby keep a running count of burns.</p>
        <p className="text-neutral-400">When a league&apos;s season ends, the coin with the most receipts is named its champion. The title is a line on the scoreboard and nothing more.</p>
        <p>{SEASONS_LINKS.map((l, i) => <span key={l.href}>{i > 0 && " · "}<Link className="underline" href={l.href}>{l.label}</Link></span>)}</p>
      </section>

      <section className={card} aria-labelledby="about-deficit">
        <h2 id="about-deficit" className="text-lg font-medium">The first coin, $DEFICIT</h2>
        <p className="text-neutral-200">{d ? d.oneSentence : "$DEFICIT burns when the U.S. national debt rises."} The devnet rehearsal coin ran the same rule text at 1% for each unit.</p>
        <p className="text-neutral-400">We replayed the rule over the real Treasury figures from January 2025 to October 8, 2026. It would have counted 235 burn days and 6,490 units. This is a look back, and it predicts nothing. The second publisher, FRED, reports this debt only once a quarter. It can confirm the quarter ends but not each daily reading.</p>
        {/* walkthrough 13: the create date from the status file once the coin exists (it was created on 2026-10-13), never "is created when" */}
        <p className="text-neutral-400">{d?.launch.date ? `Its rules were locked on chain before it was created on mainnet on ${utcDay(d.launch.date)}. Its card on the coin list says where it stands now.` : "Its rules are locked and its mint address is fixed. The coin is created when the operator runs the create, and its card on the coin list says which state it is in."}</p>
        <p><a className="underline" href={DEFICIT_SITE}>The $DEFICIT page</a></p>
      </section>

      <section className={card} aria-labelledby="about-terms">
        <h2 id="about-terms" className="text-lg font-medium">The precise terms</h2>
        <p className="text-neutral-400">The coin pages and the docs use these words. Each one is defined here once.</p>
        <dl className="space-y-2">{Object.values(GLOSSARY).map((g) => <div key={g.term}><dt className="font-medium text-neutral-100">{g.term.charAt(0).toUpperCase() + g.term.slice(1)}</dt><dd className="text-neutral-300">{g.short}</dd></div>)}</dl>
      </section>

      <p className="text-neutral-400">The <Link className="underline" href="/burnticker/trust">Trust page</Link> has the full status, the safeguards and limits, and every wallet. The <a className="underline" href="/whitepaper.html">whitepaper</a> has the design in detail.</p>
    </main>
  );
}
