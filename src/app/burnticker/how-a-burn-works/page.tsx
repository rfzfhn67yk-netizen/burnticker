import type { Metadata } from "next";
import Link from "next/link";
import { burnWalkthrough, type Walkthrough } from "@/lib/burnticker/burnWalkthrough";
import { withShareCard } from "@/lib/burnticker/pageMeta";

const DESCRIPTION = "One real burn from the devnet rehearsal, step by step: the result published, the budget worked out, the tokens bought and burned, and the receipt.";
export const metadata: Metadata = withShareCard({ title: "Watch how a burn works", description: DESCRIPTION, alternates: { canonical: "/burnticker/how-a-burn-works" } });
export const dynamic = "force-dynamic";

/**
 * WATCH HOW A BURN WORKS (website-14, product idea 2): the existing devnet receipt in four steps and the receipt, every number from its
 * evidence file (src/lib/burnticker/burnWalkthrough.ts). Labelled devnet on every step. No new data.
 */
export default function HowABurnWorks() {
  let w: Walkthrough | null = null;
  try { w = burnWalkthrough(); } catch { w = null; }
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 space-y-5 text-sm">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Watch how a burn works</h1>
        <p className="text-neutral-300">This is one real burn from the practice run on devnet, taken apart step by step. Every number below is read from that burn&apos;s receipt.</p>
        <p className="rounded border border-dashed border-amber-700/60 p-2 text-xs text-amber-200" data-devnet-banner>Devnet is a practice network. Tokens there have no money value, and this coin was a rehearsal.</p>
      </header>
      {!w ? <p className="text-neutral-400">The rehearsal receipt could not be read just now. It can still be checked on the <Link className="underline" href="/burnticker/check?demo=1#verify">check page</Link>.</p> : <>
        <ol className="space-y-3" aria-label="Four steps">
          {w.steps.map((s) => (
            <li key={s.n} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3" data-step={s.n}>
              <p className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">Step {s.n} of {w!.steps.length}, on devnet</p>
              <h2 className="mt-1 text-base font-medium">{s.title}</h2>
              {s.body.map((b) => <p key={b} className="mt-1 text-neutral-300">{b}</p>)}
              {s.link && <p className="mt-1 text-xs"><a className="underline" href={s.link.href} rel="noopener" target="_blank">{s.link.label}</a></p>}
            </li>
          ))}
        </ol>
        <section className="rounded-lg border border-neutral-700 bg-neutral-900 p-3" aria-labelledby="walk-receipt">
          <p className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">The receipt, on devnet</p>
          <h2 id="walk-receipt" className="mt-1 text-base font-medium">The transaction is the receipt</h2>
          <p className="mt-1 text-neutral-300">The burn&apos;s transaction carries a note that records the day, both debt figures, the units, the burn pool, what was spent and what was burned. Anyone can read it and check it against the source.</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-neutral-950 p-2 text-xs">{w.receipt.memo}</pre>
          <p className="mt-2 flex flex-wrap gap-3"><Link className="inline-block rounded bg-amber-400 px-3 py-1.5 font-semibold text-neutral-950" href={w.receipt.checkHref}>Check this receipt in your browser</Link><a className="text-xs underline self-center" href={w.receipt.explorerUrl} rel="noopener" target="_blank">The transaction on the devnet explorer</a></p>
        </section>
        <p className="text-xs text-neutral-500">{w.note}</p>
      </>}
      <p className="text-xs"><Link className="underline" href="/burnticker/about">How Burnticker works</Link>. <Link className="underline" href="/burnticker/upcoming">Next results</Link>. <Link className="underline" href="/burnticker">All coins</Link>.</p>
    </main>
  );
}
