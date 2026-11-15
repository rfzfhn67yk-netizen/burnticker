// The sample data behind the two @BurnTicker formats' filled examples in docs/launch/x-threads.md §2c (receipt + scoreboard).
// test/burntickerCopy.test.ts renders receiptPostText / scoreboardText on it and requires the doc's ```text blocks to equal the output.
// The same data is committed as a platform publish dir (SEASON_DIR: index.json + t/<ticker>/{status,receipts}.json) for the draft
// script's --template=receipt|scoreboard; the test pins those files equal to these objects.
export const SEASON_DIR = "test/fixtures/burnticker-season";
import type { PlatformIndexJson, ReceiptJson, TokenStatusJson } from "@/lib/burnticker/tokenPage";

export const COPY_SITE = "https://burnticker.com";

export const rc = (over: Partial<ReceiptJson>): ReceiptJson => ({
  eventId: "2026-10-09", settledAt: "2026-10-09", oracle: "catalogue", market: "2026-10-09", result: null, value: "1", title: "NYY 5 @ TB 2", method: "espn-final+mlb", sourceUrl: null, settlementSourceUrl: null,
  units: 1, kind: "increase", note: "", prevValue: null, carryIn: "0", mapping: { fractionOfPool: 0.01 }, pool: "0.4120", spent: "0.0041", got: "40973", burned: "40973", shortOut: null, status: "confirmed", skippedReason: null, memo: null,
  signature: "5QmRays", txUrl: "https://solscan.io/tx/5QmRays", execution: null, readingDate: null, lead: null, waitReason: null, partial: null, verify: { curl: "", formula: "", expected: "", checks: [], verified: true }, ...over,
});

/** $RAYS: a Rays-loss team coin with five receipts; the fifth is the 2026-10-09 final. */
export const RAYS_STATUS = { ticker: "RAYS", seriesTitle: "Tampa Bay Rays losses (MLB)", selectorKey: "catalogue:espn.team:mlb-TB-loss", supply: { initial: "1000000000", current: "975900000", source: "chain" }, burned: { total: "24100000", pctOfSupply: 2.41, count: 5, last30d: "24100000", lastAt: "2026-10-09" } } as unknown as TokenStatusJson;
export const RAYS_RECEIPTS: ReceiptJson[] = [
  rc({ eventId: "2026-09-27", settledAt: "2026-09-27", title: "TB 1 @ BAL 3" }), rc({ eventId: "2026-09-30", settledAt: "2026-09-30", title: "TB 2 @ TOR 6" }),
  rc({ eventId: "2026-10-03", settledAt: "2026-10-03", title: "BOS 4 @ TB 3" }), rc({ eventId: "2026-10-06", settledAt: "2026-10-06", title: "NYY 7 @ TB 1" }), rc({}),
];

type Tok = PlatformIndexJson["tokens"][number];
const tok = (ticker: string, selectorKey: string, burns: number, pct: number, status: Tok["status"] = "live"): Tok => ({
  ticker, name: ticker, mint: `${ticker}Mint`, oracle: "catalogue", selectorKey, seriesTitle: null, mode: "buyback", status, launchedAt: "2026-09-01T00:00:00Z", burned: "0", burns, pctOfSupply: pct, impliedChance: null, nextCheckAt: null, pairId: null,
  imageUrl: null, oneLiner: "", lastBurnAt: null, nextMarket: null, nextCloseTime: null, oneShot: false, phase: null, progressPct: null, raised: null, threshold: null, quote: null,
});

/** Fifteen live team coins in four leagues (NBA's regular season has not started: no receipts), plus $DEFICIT (not a team coin) and a
 *  retired NHL coin (not counted). Small counts: the coins launched in late September. */
export const SEASON_INDEX: PlatformIndexJson = {
  schema: "burnticker.index/v1", generatedAt: "2026-10-10T14:00:00Z", audit: null, pairs: [],
  tokens: [
    tok("OILERS", "catalogue:espn.team:nhl-EDM-loss", 2, 0.98), tok("FLAMES", "catalogue:espn.team:nhl-CGY-loss", 1, 0.49), tok("BRUINS", "catalogue:espn.team:nhl-BOS-loss", 1, 0.51), tok("RANGERS", "catalogue:espn.team:nhl-NYR-win", 0, 0),
    tok("RAYS", "catalogue:espn.team:mlb-TB-loss", 5, 2.41), tok("DODGERS", "catalogue:espn.team:mlb-LAD-win", 2, 0.99), tok("CUBS", "catalogue:espn.team:mlb-CHC-loss", 1, 0.5), tok("MARINERS", "catalogue:espn.team:mlb-SEA-loss", 0, 0),
    tok("LAKERS", "catalogue:espn.team:nba-LAL-loss", 0, 0), tok("CELTICS", "catalogue:espn.team:nba-BOS-win", 0, 0), tok("KNICKS", "catalogue:espn.team:nba-NY-loss", 0, 0),
    tok("JAGUARS", "catalogue:espn.team:nfl-JAX-loss", 3, 1.46), tok("EAGLES", "catalogue:espn.team:nfl-PHI-loss", 2, 0.98), tok("CHIEFS", "catalogue:espn.team:nfl-KC-loss", 2, 0.97), tok("BILLS", "catalogue:espn.game:nfl-401772510-BUF-loss", 1, 1.0),
    tok("DEFICIT", "catalogue:treasury.debt", 235, 6.45), tok("COYOTES", "catalogue:espn.team:nhl-ARI-loss", 4, 2.0, "retired"),
  ],
  totals: { tokens: 17, live: 16, burns: 254, burnedTokens: "0", pairs: 0 },
};
const burnOn = (day: string) => [rc({ eventId: day, settledAt: day })];
/** Four team coins burned on 2026-10-09 (the "yesterday" of a post on 10-10): $RAYS, $DODGERS, $OILERS, $BRUINS. $DEFICIT burned too
 *  and is not a team coin; $KNICKS' row was skipped; $FLAMES and $CHIEFS burned on 10-08. */
export const SEASON_RECEIPTS: Record<string, ReceiptJson[]> = Object.fromEntries([
  ["RAYS", RAYS_RECEIPTS],
  ...["OILERS", "BRUINS", "DODGERS"].map((t) => [t, burnOn("2026-10-09")]),
  ["FLAMES", burnOn("2026-10-08")], ["CHIEFS", burnOn("2026-10-08")], ["EAGLES", burnOn("2026-10-05")],
  ["KNICKS", [rc({ status: "skipped", burned: null, skippedReason: "spend under $1" })]], ["DEFICIT", burnOn("2026-10-09")],
]);
