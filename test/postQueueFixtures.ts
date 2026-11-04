// Fixtures for the post generator (scripts/burnticker-posts.mts --fixtures, test/postQueue.test.ts). Illustrative coins only — none of
// these is a live coin; the teasers read the real committed files (transparency.json, the $DEFICIT rule file, the coverage report, the
// $DEFICIT sample in site/deficit/sample) so the fixture run shows exactly what a live run would say about them today.
import fs from "node:fs";
import type { BurnJson, StatusJson } from "@/lib/burnKeeper/statusPage";
import type { PairTally, PlatformIndexJson, ReceiptJson, TokenStatusJson } from "@/lib/burnticker/tokenPage";
import { rulesSha256 } from "@/lib/burnKeeper/rules";
import { DEVNET_EVIDENCE, coverageCounts, deficitFacts, devnetReceipt, reviewFacts, type DeficitRuleFacts, type DevnetReceipt, type ReviewFacts, type TeaserContext } from "@/lib/launch/postQueue";

export const FIXTURE_SITE = "https://burnticker.com";
export const FIXTURE_DEFICIT_SITE = "https://deficit.burnticker.com";
export const FIXTURE_DAY = "2026-10-09";

export const receipt = (over: Partial<ReceiptJson>): ReceiptJson => ({
  eventId: FIXTURE_DAY, settledAt: FIXTURE_DAY, oracle: "catalogue", market: FIXTURE_DAY, result: null, value: "1", title: "NYY 5 @ TB 2", method: "espn-final+mlb", sourceUrl: null, settlementSourceUrl: null,
  units: 1, kind: "increase", note: "", prevValue: null, carryIn: "0", mapping: { fractionOfPool: 0.01 }, pool: "0.4120", spent: "0.0041", got: "40973", burned: "40973", shortOut: null, status: "confirmed", skippedReason: null, memo: null,
  signature: "5QmRaysFixture", txUrl: "https://solscan.io/tx/5QmRaysFixture", execution: null, readingDate: null, lead: null, waitReason: null, partial: null,
  verify: { curl: "", formula: "", expected: "", checks: [], verified: true }, ...over,
});

/** $RAYS: a Rays-loss team coin with five receipts. */
export const RAYS_STATUS = {
  ticker: "RAYS", name: "Rays losses", seriesTitle: "Tampa Bay Rays losses (MLB)", selectorKey: "catalogue:espn.team:mlb-TB-loss", status: "live", launchedAt: "2026-09-01T14:00:00Z",
  supply: { initial: "1000000000", current: "975900000", source: "chain" },
  burned: { total: "24100000", pctOfSupply: 2.41, count: 5, last30d: "24100000", lastAt: FIXTURE_DAY },
  rules: { sha256: "c0ffee".padEnd(64, "0"), sha12: "c0ffee000000", statement: "", file: "rules.json", oneShot: false },
  profile: { imageUrl: null, description: "", links: [], oneLiner: "Burns 1% of its pool on every Tampa Bay Rays loss (MLB, ESPN final score confirmed by MLB StatsAPI)." },
  addresses: { creator: "Cr8torWa11etFixture1111111111111111111111111" },
  lifecycle: null,
} as unknown as TokenStatusJson;
export const RAYS_RECEIPTS: ReceiptJson[] = [
  receipt({ eventId: "2026-09-27", settledAt: "2026-09-27", title: "TB 1 @ BAL 3" }), receipt({ eventId: "2026-09-30", settledAt: "2026-09-30", title: "TB 2 @ TOR 6" }),
  receipt({ eventId: "2026-10-03", settledAt: "2026-10-03", title: "BOS 4 @ TB 3" }), receipt({ eventId: "2026-10-06", settledAt: "2026-10-06", title: "NYY 7 @ TB 1" }), receipt({}),
  receipt({ eventId: "2026-10-10", settledAt: "2026-10-10", status: "skipped", burned: null, skippedReason: "spend under $1" }),
];

/** A one-shot coin whose rule resolves once. */
export const ONESHOT_STATUS = { ...RAYS_STATUS, ticker: "ELSAYED", name: "El-Sayed", seriesTitle: "Michigan Senate 2026", selectorKey: "polymarket:market:0xabc", burned: { total: "0", pctOfSupply: 0, count: 0, last30d: "0", lastAt: null }, rules: { ...RAYS_STATUS.rules, oneShot: true, sha12: "e15a7ed00000" }, profile: { ...RAYS_STATUS.profile, oneLiner: "Burns 10% of its pool if El-Sayed wins the Michigan Senate race (on-chain payout, certified result as the cross-check)." } } as unknown as TokenStatusJson;

type Tok = PlatformIndexJson["tokens"][number];
const tok = (ticker: string, selectorKey: string, burns: number, pct: number, status = "live"): Tok => ({
  ticker, name: ticker, mint: `${ticker}Mint`, oracle: "catalogue", selectorKey, seriesTitle: null, mode: "buyback", status, launchedAt: "2026-09-01T00:00:00Z", burned: "0", burns, pctOfSupply: pct, impliedChance: null, nextCheckAt: null, pairId: null,
  imageUrl: null, oneLiner: "", lastBurnAt: null, nextMarket: null, nextCloseTime: null, oneShot: false, phase: null, progressPct: null, raised: null, threshold: null, quote: null,
});
/** Team coins in four leagues (listed MLB, NBA, NHL, NFL), plus $DEFICIT (not a team coin) and a retired team coin (not counted). */
export const SEASON_INDEX: PlatformIndexJson = {
  schema: "burnticker.index/v1", generatedAt: "2026-10-10T14:00:00Z", audit: null, pairs: [],
  tokens: [
    tok("RAYS", "catalogue:espn.team:mlb-TB-loss", 5, 2.41), tok("LAKERS", "catalogue:espn.team:nba-LAL-loss", 4, 1.96), tok("OILERS", "catalogue:espn.team:nhl-EDM-loss", 6, 2.94),
    tok("EAGLES", "catalogue:espn.team:nfl-PHI-loss", 3, 1.47), tok("MARINERS", "catalogue:espn.team:mlb-SEA-loss", 0, 0),
    tok("DEFICIT", "catalogue:treasury.debt", 235, 6.45), tok("COYOTES", "catalogue:espn.team:nhl-ARI-loss", 9, 3.0, "retired"),
  ],
  totals: { tokens: 7, live: 6, burns: 262, burnedTokens: "0", pairs: 0 },
};
export const SEASON_RECEIPTS: Record<string, ReceiptJson[]> = {
  RAYS: RAYS_RECEIPTS, OILERS: [receipt({ title: "EDM 2 @ CGY 4", method: "espn-final+nhl" })], LAKERS: [receipt({ eventId: "2026-10-08", settledAt: "2026-10-08" })], DEFICIT: [receipt({})],
};

export const PAIR_TALLY: PairTally = {
  pairId: "oilers-flames-26", a: { ticker: "OILERS", name: "Oilers", mint: "A", burns: 3, burned: "30000000", supply: "970000000", lastBurnAt: FIXTURE_DAY }, b: { ticker: "FLAMES", name: "Flames", mint: "B", burns: 1, burned: "10000000", supply: "990000000", lastBurnAt: "2026-10-02" },
  burnsA: 3, burnsB: 1, burnedA: "30000000", burnedB: "10000000", supplyA: "970000000", supplyB: "990000000", supplyPctA: 97, supplyPctB: 99, settlements: 4, voids: 0,
  lastSettlement: { eventId: "EDM-CGY-2026-10-09", settledAt: FIXTURE_DAY, burnedSide: "A", result: "loss", value: null, burned: "10000000" },
  next: { market: "CGY-EDM-2026-10-18", closeTime: null, chanceA: null, chanceB: null }, clause: { voidBy: "2026-11-08", state: "live", waitingOn: [], decidedAt: FIXTURE_DAY, detail: null }, curveA: null, curveB: null,
};

/** $DEFICIT's committed sample (site/deficit/sample) — the same files test/dailyPost.test.ts reads. */
export const deficitSample = (): { status: StatusJson; burns: BurnJson[] } => ({
  status: JSON.parse(fs.readFileSync("site/deficit/sample/status.json", "utf8")) as StatusJson,
  burns: JSON.parse(fs.readFileSync("site/deficit/sample/burns.json", "utf8")) as BurnJson[],
});

/** The real committed facts the teasers and the platform thread read. */
export function committedFacts(): { reviews: ReviewFacts; deficit: DeficitRuleFacts; coverage: NonNullable<TeaserContext["coverage"]>; devnet: DevnetReceipt } {
  const rulesText = fs.readFileSync("config/burnkeeper/deficit.rules.json", "utf8");
  const cov = coverageCounts(fs.readFileSync("docs/burnticker/SETTLEMENT-COVERAGE.md", "utf8"));
  if (!cov) throw new Error("docs/burnticker/SETTLEMENT-COVERAGE.md: no coverage summary line");
  return { reviews: reviewFacts(JSON.parse(fs.readFileSync("config/burnticker/transparency.json", "utf8"))), deficit: deficitFacts(rulesText, rulesSha256(rulesText)), coverage: cov, devnet: devnetReceipt(JSON.parse(fs.readFileSync(DEVNET_EVIDENCE, "utf8")) as BurnJson[]) };
}
