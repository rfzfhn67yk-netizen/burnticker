import type { Metadata } from "next";
import CoinsIndex, { type SeasonsPreview } from "./CoinsIndex";
import { platform } from "@/lib/burnticker/server";
import { leagueIndex } from "@/lib/burnticker/leagues";
import { leagueData } from "@/lib/burnticker/leaguesServe";

// site audit #12 (2026-10-11): the coins index is titled like every other app page ("Coins · Burnticker"); the page itself is the client
// component in ./CoinsIndex.tsx, so this server file can carry the metadata. Since 2026-10-12 it is also the home (list first) and reads
// the "Follow the season" preview here, on the server, from the same leagues index /burnticker/leagues serves.
export const metadata: Metadata = { title: "Coins", alternates: { canonical: "/burnticker" } };
export const dynamic = "force-dynamic";

function seasonsPreview(): SeasonsPreview | null {
  try {
    const ix = leagueIndex(leagueData(platform()).coins, Date.now());
    return {
      leagues: ix.totals.leagues, teamCoins: ix.totals.teamCoins,
      sports: ix.sports.map((s) => ({ id: s.id, label: s.label, leagues: s.leagues.map((l) => ({ id: l.id, label: l.label, href: l.current.href, coins: l.coinsThisSeason })) })),
    };
  } catch { return null; }
}

export default function Page() {
  return <CoinsIndex seasons={seasonsPreview()} />;
}
