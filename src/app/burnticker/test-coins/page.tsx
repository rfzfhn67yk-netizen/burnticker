import type { Metadata } from "next";
import Link from "next/link";
import { platform } from "@/lib/burnticker/server";
import { testCoins, type TestCoin } from "@/lib/burnticker/testCoins";
import { TEST_COINS_COPY, TEST_COINS_HREF } from "@/lib/burnticker/testCoinsCopy";
import { solscanTokenUrl } from "@/lib/burnticker/tradeLinks";
import { EmptyState } from "../_components/EmptyState";
import { Page, PageHeader, Panel } from "../_components/Panel";

export const metadata: Metadata = { title: TEST_COINS_COPY.title, description: TEST_COINS_COPY.description, alternates: { canonical: TEST_COINS_HREF }, robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * /burnticker/test-coins (owner, 2026-10-14: "hide the test coins, should only be the Eagles coin and $DEFICIT on the website"): the one
 * place the coins marked test (src/lib/burnticker/testCoins.ts) stay listed once the browse surfaces leave them out. Linked only from the
 * Trust page, and not in the sitemap. Each coin shows its mint, its explorer page and its own page here. No trade link is offered.
 */
export default function TestCoinsPage() {
  let coins: TestCoin[] | null = null;
  try {
    let reg = null;
    try { reg = platform().registry; } catch { reg = null; }
    coins = testCoins(process.cwd(), reg);
  } catch { coins = null; }
  return (
    <Page>
      <PageHeader title={TEST_COINS_COPY.heading} intro={TEST_COINS_COPY.intro} />
      {!coins ? <EmptyState kind="unavailable" body={TEST_COINS_COPY.unavailable} compact /> : coins.length === 0 ? <EmptyState kind="no-activity" body={TEST_COINS_COPY.none} compact /> : (
        <ul className="bt-list" data-test-coins={coins.length}>
          {coins.map((c) => (
            <li key={`${c.ticker}-${c.mint ?? ""}`} data-test-coin={c.ticker}>
              <Panel title={c.ticker ? `$${c.ticker}` : TEST_COINS_COPY.title} id={`test-${(c.ticker || c.mint || "coin").toLowerCase()}`}>
                <p className="bt-body-text">{c.source === "operator" ? TEST_COINS_COPY.operatorSource : TEST_COINS_COPY.registrySource} {c.text}</p>
                {c.mint && <p className="bt-body-text break-all">{TEST_COINS_COPY.mint}: <code>{c.mint}</code></p>}
                <p className="bt-body-text">
                  {c.mint && <a className="underline" href={solscanTokenUrl(c.mint)} target="_blank" rel="noreferrer">{TEST_COINS_COPY.explorer}</a>}
                  {c.mint && " "}
                  <Link className="underline" href={c.pageHref}>{TEST_COINS_COPY.page}</Link>
                </p>
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
