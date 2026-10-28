import type { Metadata } from "next";
import { safeCreatorLink } from "@/lib/burnticker/creatorProfile";
import Link from "next/link";
import { Suspense } from "react";
import { creatorStream, type CreatorCoinView } from "@/lib/burnticker/creatorServe";
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

const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";

/** One coin's card: its registry facts while its page is being read ("still loading"), its full card once read. */
function CoinItem({ c, rankLine }: { c: CreatorCoinView; rankLine: string | null }) {
  return (
    <li className={card + " min-w-0 space-y-2"} data-creator-coin={c.ticker} data-available={c.available ? "yes" : c.loading ? "loading" : "no"}>
      <div className="flex gap-3">
        <Link href={c.page} tabIndex={-1} aria-label={`${c.name} $${c.ticker}, coin page`}><CoinThumb src={c.imageUrl} mirror={c.imageMirror ?? null} ticker={c.ticker} size={56} generated /></Link>
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
        <dt className="text-neutral-500">{c.nextLabel ?? CREATOR_PAGE.labels.next}</dt><dd data-next-line>{c.nextLine}</dd>
        {/* audit 7 F08: the keeper's next read of the source is not a result; it has its own row, and none once a one-shot is decided */}
        {c.nextCheckLine && <><dt className="text-neutral-500">{CREATOR_PAGE.labels.check}</dt><dd data-next-check>{c.nextCheckLine}</dd></>}
        {(rankLine !== null || !c.rank) && <><dt className="text-neutral-500" title={RANK_MEANING}>{CREATOR_PAGE.labels.rank}</dt><dd data-rank>{rankLine ?? CREATOR_PAGE.unavailable}</dd></>}
      </dl>
      <details className="text-xs"><summary className="cursor-pointer text-neutral-300">Share ${c.ticker}</summary><div className="mt-2"><ShareBlock ticker={c.ticker} id={c.key} /></div></details>
    </li>
  );
}

/** A coin's full card, rendered when its read resolves (creatorServe.ts creatorStream; its bound keeps the "still loading" card). */
async function ResolvedCoin({ view, rankLine }: { view: Promise<CreatorCoinView>; rankLine: string | null }) {
  return <CoinItem c={await view} rankLine={rankLine} />;
}

/**
 * The lines over the list once every coin has resolved: audit 7, a coin whose card could not be built is unavailable (the account never
 * looks empty because of it); sixth pass B-10, the coins still unread when their bound passed.
 */
async function ListLines({ views }: { views: Promise<CreatorCoinView>[] }) {
  const coins = await Promise.all(views);
  const d = { unavailable: coins.filter((c) => !c.available && !c.loading).length, loading: coins.filter((c) => c.loading).length };
  return (
    <>
      {d.unavailable > 0 && <p className={card + " text-amber-300"} role="status" data-creator-partial>{CREATOR_PAGE.partial(d.unavailable)}</p>}
      {d.loading > 0 && <p className={card + " text-neutral-300"} role="status" data-creator-loading>{CREATOR_PAGE.loading(d.loading)}</p>}
    </>
  );
}

export default async function CreatorPage({ params }: Params) {
  const { wallet } = await params;
  // audit 7 B-10 (2026-10-20): each coin streams in as its read finishes (creatorStream), never all or nothing
  const d = creatorStream(wallet);
  if (d.kind === "bad-wallet") return <main className="mx-auto max-w-5xl px-4 py-6 text-sm"><p className={card}>{CREATOR_PAGE.badWallet}</p></main>;
  // a coin's rank line comes from the registry (creatorServe.ts baseOf), the same in its loading card and its full card
  const ranks = rankLayout(d.kind === "ok" ? d.coins.map((c) => c.loading.rank?.line ?? null) : []);
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-5 text-sm">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{CREATOR_PAGE.title(shortAddress(d.wallet))}</h1>
        <p className="max-w-3xl text-neutral-400">{CREATOR_PAGE.intro}</p>
        <p className="text-xs text-neutral-500">Wallet <code className="break-all">{d.wallet}</code></p>
      </header>
      {d.kind === "unavailable" && <p className={card} role="alert">{CREATOR_PAGE.unavailable}</p>}
      {d.kind === "ok" && d.coins.length === 0 && <p className={card + " text-neutral-400"}>{CREATOR_PAGE.empty}</p>}
      {/* sixth pass B-10: a coin whose first read is still running is listed with its rule and receipts; its details follow on refresh */}
      {d.kind === "ok" && d.coins.length > 0 && <Suspense fallback={null}><ListLines views={d.coins.map((c) => c.view)} /></Suspense>}
      {/* coin card status 2026-10-18: the no-rank line every coin shares is said once above the list (cardView.ts rankLayout) */}
      {d.kind === "ok" && ranks.shared && <p className="text-xs text-neutral-400" data-rank-shared title={RANK_MEANING}>{ranks.shared}</p>}
      {d.kind === "ok" && d.coins.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2" aria-label="coins">
          {d.coins.map((c, i) => (
            <Suspense key={c.loading.mint} fallback={<CoinItem c={c.loading} rankLine={ranks.perCard[i]} />}>
              <ResolvedCoin view={c.view} rankLine={ranks.perCard[i]} />
            </Suspense>
          ))}
        </ul>
      )}
    </main>
  );
}
