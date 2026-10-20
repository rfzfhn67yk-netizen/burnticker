import type { Metadata } from "next";
import { safeCreatorLink } from "@/lib/burnticker/creatorProfile";
import Link from "next/link";
import { creatorData } from "@/lib/burnticker/creatorServe";
import { CREATOR_PAGE } from "@/lib/burnticker/creatorBenefits";
import { RANK_MEANING, longDay, rankLayout } from "@/lib/burnticker/cardView";
import { shortAddress } from "@/lib/burnticker/walletShell";
import { CoinThumb } from "../../_components/CoinCard";
import { ShareBlock } from "../ShareBlock";
import { safeParam } from "@/lib/burnticker/safeParam";
import { withShareCard } from "@/lib/burnticker/pageMeta";

export const dynamic = "force-dynamic";

/**
 * THE CREATOR PAGE (website-17, creator benefits item 1, 2026-10-12): every coin one wallet created, read from the registry, each with
 * its rule in one line, the creator's own image, text and links from the coin's metadata under the rule, its receipts, its last burn,
 * its next result and its line on the scoreboard, plus the share block. A plain header with the short address; no name and no bio
 * beyond what each coin's metadata carries. Data: creatorServe.ts; words: creatorBenefits.ts.
 */
type Params = { params: Promise<{ wallet: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { wallet } = await params;
  const w = safeParam(wallet);
  return withShareCard({ title: CREATOR_PAGE.title(shortAddress(w)), description: CREATOR_PAGE.description, alternates: { canonical: `/burnticker/creator/${encodeURIComponent(w)}` } });
}

export default async function CreatorPage({ params }: Params) {
  const { wallet } = await params;
  const d = await creatorData(wallet);
  const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
  if (d.kind === "bad-wallet") return <main className="mx-auto max-w-5xl px-4 py-6 text-sm"><p className={card}>{CREATOR_PAGE.badWallet}</p></main>;
  const ranks = rankLayout(d.kind === "ok" ? d.coins.map((c) => c.rank?.line ?? null) : []);
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-5 text-sm">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{CREATOR_PAGE.title(shortAddress(d.wallet))}</h1>
        <p className="max-w-3xl text-neutral-400">{CREATOR_PAGE.intro}</p>
        <p className="text-xs text-neutral-500">Wallet <code className="break-all">{d.wallet}</code></p>
      </header>
      {d.kind === "unavailable" && <p className={card} role="alert">{CREATOR_PAGE.unavailable}</p>}
      {d.kind === "ok" && d.coins.length === 0 && <p className={card + " text-neutral-400"}>{CREATOR_PAGE.empty}</p>}
      {/* audit 7: a coin whose page could not be read is listed as unavailable; the account never looks empty because of it */}
      {d.kind === "ok" && d.unavailable > 0 && <p className={card + " text-amber-300"} role="status" data-creator-partial>{CREATOR_PAGE.partial(d.unavailable)}</p>}
      {/* sixth pass B-10: a coin whose first read is still running is listed with its rule and receipts; its details follow on refresh */}
      {d.kind === "ok" && d.loading > 0 && <p className={card + " text-neutral-300"} role="status" data-creator-loading>{CREATOR_PAGE.loading(d.loading)}</p>}
      {/* coin card status 2026-10-18: the no-rank line every coin shares is said once above the list (cardView.ts rankLayout) */}
      {d.kind === "ok" && ranks.shared && <p className="text-xs text-neutral-400" data-rank-shared title={RANK_MEANING}>{ranks.shared}</p>}
      {d.kind === "ok" && d.coins.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2" aria-label="coins">
          {d.coins.map((c, i) => (
            <li key={c.mint} className={card + " min-w-0 space-y-2"} data-creator-coin={c.ticker} data-available={c.available ? "yes" : c.loading ? "loading" : "no"}>
              <div className="flex gap-3">
                <Link href={c.page} tabIndex={-1} aria-label={`${c.name} $${c.ticker}, coin page`}><CoinThumb src={c.imageUrl} ticker={c.ticker} size={56} generated /></Link>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold leading-tight"><Link className="underline" href={c.page}>{c.name} <span className="font-mono text-sm text-neutral-400">${c.ticker}</span></Link></h2>
                  <p className="mt-1 text-neutral-200" data-rule>{c.rule}</p>
                </div>
              </div>
              {(c.creatorText || c.links.length > 0) && (
                <div className="rounded border border-neutral-800 p-2 text-xs" data-creator-text>
                  <div className="text-[10px] uppercase tracking-wider text-neutral-500">{CREATOR_PAGE.creatorText}</div>
                  {c.creatorText && <p className="mt-1 text-neutral-300">{c.creatorText}</p>}
                  {c.links.length > 0 && <p className="mt-1 flex flex-wrap gap-2">{c.links.filter(safeCreatorLink).map((l) => <a key={l.url} className="underline" href={l.url} rel="noopener noreferrer nofollow ugc" target="_blank">{l.label}</a>)}</p>}
                </div>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-neutral-500">{CREATOR_PAGE.labels.receipts}</dt><dd>{c.receipts}</dd>
                <dt className="text-neutral-500">{CREATOR_PAGE.labels.lastBurn}</dt><dd>{longDay(c.lastBurnAt) ?? CREATOR_PAGE.noBurn}</dd>
                <dt className="text-neutral-500">{CREATOR_PAGE.labels.next}</dt><dd data-next-line>{c.nextLine}</dd>
                {/* audit 7 F08: the keeper's next read of the source is not a result; it has its own row, and none once a one-shot is decided */}
                {c.nextCheckLine && <><dt className="text-neutral-500">{CREATOR_PAGE.labels.check}</dt><dd data-next-check>{c.nextCheckLine}</dd></>}
                {(ranks.perCard[i] !== null || !c.rank) && <><dt className="text-neutral-500" title={RANK_MEANING}>{CREATOR_PAGE.labels.rank}</dt><dd data-rank>{ranks.perCard[i] ?? CREATOR_PAGE.unavailable}</dd></>}
              </dl>
              <details className="text-xs"><summary className="cursor-pointer text-neutral-300">Share ${c.ticker}</summary><div className="mt-2"><ShareBlock ticker={c.ticker} id={c.key} /></div></details>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
