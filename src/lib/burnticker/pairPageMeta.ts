import type { PairRow } from "@/lib/burnticker/registry";
import { pairSideHrefs } from "@/lib/burnticker/publicPairs";

/**
 * WHAT A PAIR PAGE KNOWS BEFORE ITS DATA LOADS (owner's UX walkthrough, 2026-10-18). Pair pages opened titled "Burnticker", with no
 * canonical address, and showed "Loading" for about three seconds. Everything here comes from the registry rows alone (no chain read,
 * no source read), so the server layout can give the page its title, description and canonical address and print the matchup
 * heading at once; the slow reads (curves, receipts, the scoreboard) stay in the browser. Pure apart from the registry reads.
 */
export interface PairSide { ticker: string; name: string; href: string }
export interface PairSeed { pairId: string; a: PairSide; b: PairSide; matchup: string; title: string; description: string; canonical: string; /** OP6-11: the launched coin whose receipt card is the pair's share image (side A first); null = the site card */ imageMint?: string | null }

type Tok = { ticker: string; name: string; mint: string; status: string; description?: string } | null;

/**
 * Continuous audit run 4, HB-47: a one-game pair's coins are named "Seahawks Wins vs Broncos" and "Broncos Wins vs Seahawks", so joining the
 * two names read "Seahawks Wins vs Broncos against Broncos Wins vs Seahawks". The matchup is said once ("Seahawks vs Broncos"), with the
 * game day when the coin's own description states it ("on Oct 15, 2026").
 */
export function pairMatchupWords(aName: string, bName: string, description: string | null = null): string {
  const m = /^(.+?) Wins? vs (.+)$/i.exec(aName.trim());
  const day = /\bon ([A-Z][a-z]{2} \d{1,2}), \d{4}\b/.exec(description ?? "")?.[1] ?? null;
  const words = m ? `${m[1]} vs ${m[2]}` : `${aName} against ${bName}`;
  return m && day ? `${words}, ${day}` : words;
}
interface Source { pair(pairId: string): PairRow | null; token(mint: string): Tok; tokens(): { ticker: string; mint: string; status: string }[]; pairs(): PairRow[] }

export const pairCanonical = (pairId: string): string => `/burnticker/p/${encodeURIComponent(pairId)}`;

/** The page's words for one pair; null when the registry has no such pair. */
export function pairSeed(registry: Source, pairId: string): PairSeed | null {
  const pr = registry.pair(pairId);
  if (!pr) return null;
  const ta = registry.token(pr.mintA), tb = registry.token(pr.mintB);
  const hrefs = pairSideHrefs(registry as never, pr);
  const side = (t: Tok, mint: string, href: string): PairSide => ({ ticker: t?.ticker ?? mint.slice(0, 6), name: (t?.name ?? "").trim() || (t?.ticker ?? mint.slice(0, 6)), href });
  const a = side(ta, pr.mintA, hrefs.a), b = side(tb, pr.mintB, hrefs.b);
  const matchup = pairMatchupWords(a.name, b.name, ta?.description ?? null);
  const oneGame = matchup !== `${a.name} against ${b.name}`;
  return {
    pairId, a, b, matchup,
    title: oneGame ? `$${a.ticker} vs $${b.ticker}: ${matchup}` : `$${a.ticker} vs $${b.ticker}`,
    description: `$${a.ticker} (${a.name}) and $${b.ticker} (${b.name}) are a rivalry pair on Burnticker. Each coin has its own locked rule, and this page shows both coins' burns, their receipts and the running score.`,
    canonical: pairCanonical(pairId),
    imageMint: ta && ta.status === "live" ? pr.mintA : tb && tb.status === "live" ? pr.mintB : null,
  };
}
