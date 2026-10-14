import type { Metadata } from "next";
import Link from "next/link";
import { platform } from "@/lib/burnticker/server";
import { leaderboard, type Leaderboard } from "@/lib/burnticker/leaderboard";
import { coinCanonicalHref } from "@/lib/burnticker/coinKey";
import { EmptyState } from "../_components/EmptyState";
import { DIGEST_TITLE, LEADERBOARD_EMPTY, LEADERBOARD_INTRO, LEADERBOARD_TITLE } from "../_components/featureCopy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: LEADERBOARD_TITLE, description: "The coins on Burnticker by tokens burned, the biggest single burn, the longest streak and the newest receipt.", alternates: { canonical: "/burnticker/leaderboard" } };

/**
 * /burnticker/leaderboard (WEBSITE-26, WIRING-FEATURES item 3): four lists under Coins, read on the server from the registry's receipts
 * (leaderboard.ts, memoised per minute; the same answer as GET /api/burnticker/v1/leaderboard). Each row: rank, $ticker linking to the
 * coin's page, the value and its detail; the note under the lists. Not linked from the home page.
 */
export default function LeaderboardPage() {
  let b: Leaderboard | null = null, err: string | null = null;
  try { b = leaderboard(platform().registry, Date.now(), (t) => coinCanonicalHref(t.mint)); } catch (e) { err = String((e as Error).message ?? e); }
  const lists = ["mostBurned", "biggestBurn", "longestStreak", "newestReceipt"] as const;
  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 text-sm">
      <header className="space-y-1">
        <p className="text-xs"><Link className="underline" href="/burnticker">← Coins</Link></p>
        <h1 className="text-2xl font-semibold">{LEADERBOARD_TITLE}</h1>
        <p className="text-neutral-400">{LEADERBOARD_INTRO} <Link className="underline" href="/burnticker/digest">{DIGEST_TITLE}</Link></p>
      </header>
      {err && <EmptyState kind="unavailable" body="The leaderboard could not be read just now." details={err} />}
      {b && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {lists.map((k) => (
              <section key={k} className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 p-3" aria-labelledby={`lb-${k}`} data-leaderboard={k}>
                <h2 id={`lb-${k}`} className="mb-2 font-medium">{b!.labels[k]}</h2>
                {b![k].length === 0 ? <p className="text-xs text-neutral-500" data-leaderboard-empty>{LEADERBOARD_EMPTY}</p> : (
                  <ol className="space-y-1.5">
                    {b![k].map((r) => (
                      <li key={`${r.mint}-${r.rank}-${r.at ?? ""}`} className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)_auto] items-baseline gap-x-2 text-xs">
                        <span className="font-mono text-neutral-500">{r.rank}.</span>
                        <span className="min-w-0"><Link className="font-mono underline" href={r.page}>${r.ticker}</Link> <span className="text-neutral-500">{r.name}</span><span className="block break-words text-[11px] text-neutral-500">{r.detail}</span></span>
                        <span className="text-right font-mono tabular-nums text-neutral-100">{r.value}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            ))}
          </div>
          <p className="text-xs text-neutral-500" data-leaderboard-note>{b.note}</p>
        </>
      )}
    </main>
  );
}
