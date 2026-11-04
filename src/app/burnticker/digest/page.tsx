import type { Metadata } from "next";
import Link from "next/link";
import { platform } from "@/lib/burnticker/server";
import { buildDigest, digestDay, type Digest } from "@/lib/burnticker/digest";
import { coinCanonicalHref } from "@/lib/burnticker/coinKey";
import { checkReceiptHref } from "@/lib/burnticker/coinPage";
import { hostCluster } from "@/lib/burnticker/launchAvailability";
import { EmptyState } from "../_components/EmptyState";
import { DIGEST_EMPTY, DIGEST_INTRO, DIGEST_SECTIONS, DIGEST_TITLE, LEADERBOARD_TITLE, shiftDay } from "../_components/featureCopy";
import { withShareCard } from "@/lib/burnticker/pageMeta";

export const dynamic = "force-dynamic";
export const metadata: Metadata = withShareCard({ title: DIGEST_TITLE, description: "One day on Burnticker: the results read, the burns, the new coins and the graduations.", alternates: { canonical: "/burnticker/digest" } });

/**
 * /burnticker/digest (WEBSITE-26, WIRING-FEATURES item 8): one UTC day from the registry (digest.ts buildDigest; the same answer as
 * GET /api/burnticker/v1/digest?day=). The summary line, then results, burns (each with its receipt check), new coins and graduations,
 * the note, and the day before and after (?day=YYYY-MM-DD). A day that is not a calendar day says so and shows today's link.
 */
export default async function DigestPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const raw = typeof q.day === "string" ? q.day : null;
  const now = Date.now(), today = new Date(now).toISOString().slice(0, 10);
  const day = digestDay(raw, now);
  let d: Digest | null = null, err: string | null = null;
  if (day) { try { d = buildDigest(platform().registry, day, now, (t) => coinCanonicalHref(t.mint)); } catch (e) { err = String((e as Error).message ?? e); } }
  const cluster = hostCluster(process.env);
  const card = "min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 p-3";
  const at = (iso: string) => `${iso.slice(11, 16)} UTC`;
  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 text-sm">
      <header className="space-y-1">
        <p className="text-xs"><Link className="underline" href="/burnticker">← Coins</Link> <span className="text-neutral-500">·</span> <Link className="underline text-neutral-400" href="/burnticker/leaderboard">{LEADERBOARD_TITLE}</Link></p>
        <h1 className="text-2xl font-semibold">{DIGEST_TITLE}{day ? <span className="ml-2 font-mono text-lg text-neutral-400">{day}</span> : null}</h1>
        <p className="text-neutral-400">{DIGEST_INTRO}</p>
        {day && (
          <nav className="flex flex-wrap gap-4 text-xs" aria-label="Other days" data-digest-days>
            <Link className="underline" href={`/burnticker/digest?day=${shiftDay(day, -1)}`} data-digest-prev>← {shiftDay(day, -1)}</Link>
            {day < today && <Link className="underline" href={`/burnticker/digest?day=${shiftDay(day, 1)}`} data-digest-next>{shiftDay(day, 1)} →</Link>}
            {day !== today && <Link className="underline" href="/burnticker/digest">Today</Link>}
          </nav>
        )}
      </header>
      {!day && <p className={card + " text-amber-300"} role="alert" data-digest-bad-day>The day must be a calendar day written as YYYY-MM-DD, in UTC. <Link className="underline" href="/burnticker/digest">Show today</Link>.</p>}
      {err && <EmptyState kind="unavailable" body="The digest could not be read just now." details={err} />}
      {d && (
        <>
          <p className="text-base text-neutral-100" data-digest-summary>{d.lines[0]}</p>
          <section className={card} aria-labelledby="dg-readings" data-digest-section="readings">
            <h2 id="dg-readings" className="mb-2 font-medium">{DIGEST_SECTIONS.readings}</h2>
            {d.readings.length === 0 ? <p className="text-xs text-neutral-500">{DIGEST_EMPTY.readings}</p> : (
              <ul className="space-y-1 text-xs">{d.readings.map((r) => <li key={`${r.selectorKey}-${r.id}`} className="min-w-0 break-words"><span className="font-mono text-neutral-500">{at(r.at)}</span> {r.title ?? r.id}: <b className="font-mono uppercase">{r.result ?? r.value ?? "no value"}</b> <span className="text-neutral-400">({r.coins.join(", ")})</span></li>)}</ul>
            )}
          </section>
          <section className={card} aria-labelledby="dg-burns" data-digest-section="burns">
            <h2 id="dg-burns" className="mb-2 font-medium">{DIGEST_SECTIONS.burns}</h2>
            {d.burns.length === 0 ? <p className="text-xs text-neutral-500">{DIGEST_EMPTY.burns}</p> : (
              <ul className="space-y-1 text-xs">{d.burns.map((b) => { const href = checkReceiptHref(b.signature, cluster); return <li key={`${b.mint}-${b.eventId}`} className="min-w-0 break-words"><span className="font-mono text-neutral-500">{at(b.at)}</span> <Link className="font-mono underline" href={b.page}>${b.ticker}</Link> burned <span className="font-mono tabular-nums">{b.tokens}</span> tokens.{href && <> <a className="underline" href={href}>Check receipt</a></>}</li>; })}</ul>
            )}
          </section>
          <div className="grid gap-4 md:grid-cols-2">
            {(["newCoins", "graduations"] as const).map((k) => (
              <section key={k} className={card} aria-labelledby={`dg-${k}`} data-digest-section={k}>
                <h2 id={`dg-${k}`} className="mb-2 font-medium">{DIGEST_SECTIONS[k]}</h2>
                {d![k].length === 0 ? <p className="text-xs text-neutral-500">{DIGEST_EMPTY[k]}</p> : (
                  <ul className="space-y-1 text-xs">{d![k].map((c) => <li key={c.mint} className="min-w-0 break-words"><span className="font-mono text-neutral-500">{at(c.at)}</span> <Link className="font-mono underline" href={c.page}>${c.ticker}</Link> <span className="text-neutral-400">{c.name}</span></li>)}</ul>
                )}
              </section>
            ))}
          </div>
          <p className="text-xs text-neutral-500" data-digest-note>{d.note}</p>
        </>
      )}
    </main>
  );
}
