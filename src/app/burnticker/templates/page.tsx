import type { Metadata } from "next";
import Link from "next/link";
import { TEMPLATES } from "@/lib/burnticker/templates";
import { launchAvailability } from "@/lib/burnticker/creatorLaunches";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Templates", description: "The twelve rule shapes a Burnticker coin can take, each with an example and a link that opens the create screen ready for it." };

/** THE TEMPLATES GALLERY (2026-10-10): the twelve canonical rule shapes (src/lib/burnticker/templates.ts), each with its example and "Start from this". */
export default function TemplatesPage() {
  const shapeLabel = { recurring: "recurring", "one-shot": "one-shot", pair: "two coins" } as const;
  // review 2 §2: the Start links appear only while creator launches are open on this host (creatorLaunches.ts)
  const launch = launchAvailability(process.env);
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Templates</h1>
        <p className="max-w-3xl text-sm text-neutral-400">Twelve shapes a coin&apos;s rule can take.{launch.open ? <> Pick one to open the create screen ready for it; every dial stays editable until launch. On any coin or pair page, &ldquo;Launch one like this&rdquo; starts from that coin&apos;s own shape.</> : <> {launch.closedLine} The shapes are shown so you can read what each kind of rule does.</>}</p>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="templates">
        {TEMPLATES.map((t) => (
          <li key={t.id} className="flex flex-col rounded-lg border border-neutral-800 bg-neutral-900 p-4">
            <div className="flex items-center gap-2"><h2 className="font-medium">{t.title}</h2><span className="bt-chip">{shapeLabel[t.shape]}</span></div>
            <p className="mt-2 text-sm text-neutral-200">{t.example}</p>
            {t.pairLine && <p className="mt-1 text-xs text-amber-200" aria-label="pair rule">{t.pairLine}</p>}
            <p className="mt-2 text-xs text-neutral-500">Settled on: {t.settles}</p>
            {launch.open && <Link className="mt-auto pt-3 text-sm font-medium text-amber-300 underline" href={t.href}>Start from this →</Link>}
          </li>
        ))}
      </ul>
      <p className="text-xs text-neutral-500">Memecoins: each rule says what its supply does, not what a price does. Not affiliated with any team, league, candidate, agency or market.</p>
    </main>
  );
}
