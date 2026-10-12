import type { Metadata } from "next";
import Link from "next/link";
import { platform } from "@/lib/burnticker/server";
import { DEVNET_COPY, DEVNET_HREF, devnetPageData, type DevnetPageData } from "@/lib/burnticker/devnetHide";
import { EmptyState } from "../_components/EmptyState";
import { Page, PageHeader, Panel } from "../_components/Panel";

export const metadata: Metadata = { title: DEVNET_COPY.title, description: DEVNET_COPY.description, alternates: { canonical: DEVNET_HREF } };
export const dynamic = "force-dynamic";

/**
 * /burnticker/devnet (owner decision, 2026-10-12): the one place the devnet practice coins and their burns stay listed once a mainnet
 * host hides them from the home, the coins grid, the activity strip and next results (src/lib/burnticker/devnetHide.ts). Linked only from
 * the Trust page and the History page. Each coin links its mint on the explorer and its own page when it is registered here; each burn
 * links its receipt check and its transaction.
 */
export default function DevnetPage() {
  let data: DevnetPageData | null = null;
  try {
    let rows: { ticker: string; mint: string; cluster: string; status: string }[] | null = null;
    try { rows = platform().registry.tokens(); } catch { rows = null; }
    data = devnetPageData(process.cwd(), rows);
  } catch { data = null; }
  return (
    <Page>
      <PageHeader title={DEVNET_COPY.heading} intro={DEVNET_COPY.intro} />
      {!data ? <EmptyState kind="unavailable" body={DEVNET_COPY.unavailable} compact /> : data.coins.length === 0 ? <EmptyState kind="no-activity" body={DEVNET_COPY.none} compact /> : (
        <ul className="bt-list" data-devnet-coins={data.coins.length}>
          {data.coins.map((c) => (
            <li key={`${c.ticker}-${c.mint ?? ""}`}>
              <Panel title={`$${c.ticker}`} id={`devnet-${c.ticker.toLowerCase()}`}>
                <p className="bt-body-text">
                  {c.mintHref && <a className="underline" href={c.mintHref} target="_blank" rel="noreferrer">{DEVNET_COPY.mint}</a>}
                  {c.mintHref && c.pageHref && " "}
                  {c.pageHref && <Link className="underline" href={c.pageHref}>{DEVNET_COPY.page}</Link>}
                </p>
                <h3 className="font-medium text-sm mt-2">{DEVNET_COPY.burnsTitle}</h3>
                {c.burns.length === 0 ? <p className="bt-body-text">{DEVNET_COPY.noBurns}</p> : (
                  <ul className="text-sm space-y-1">
                    {c.burns.map((b) => (
                      <li key={b.signature}><time dateTime={b.date}>{b.date}</time>: {b.text} <a className="underline" href={b.checkHref}>{DEVNET_COPY.check}</a> <a className="underline" href={b.explorerHref} target="_blank" rel="noreferrer">{DEVNET_COPY.explorer}</a></li>
                    ))}
                  </ul>
                )}
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
