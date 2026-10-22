"use client";
import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import type { PairSeed } from "@/lib/burnticker/pairPageMeta";

/**
 * The pair's registry facts, handed from the server layout to the client page (owner's UX walkthrough, 2026-10-18), so the matchup
 * heading is in the first HTML and stays on screen while the slow reads load, instead of a bare "Loading".
 */
const Ctx = createContext<PairSeed | null>(null);
export function PairSeedProvider({ seed, children }: { seed: PairSeed | null; children: ReactNode }) { return <Ctx.Provider value={seed}>{children}</Ctx.Provider>; }
export const usePairSeed = (): PairSeed | null => useContext(Ctx);

/** The heading the page shows before its data arrives: both tickers, linked to their own coin pages, and the matchup in words. */
export function PairSeedHeading({ seed }: { seed: PairSeed }) {
  return (
    <header data-pair-seed>
      <p className="text-xs"><Link className="underline" href="/burnticker">All coins</Link></p>
      <h1 className="text-2xl font-semibold"><Link className="underline" href={seed.a.href}>${seed.a.ticker}</Link> <span className="text-neutral-500">vs</span> <Link className="underline" href={seed.b.href}>${seed.b.ticker}</Link></h1>
      <p className="mt-1 text-neutral-400" data-pair-matchup>{seed.matchup}</p>
    </header>
  );
}
