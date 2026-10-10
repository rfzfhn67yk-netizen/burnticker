// Shared Polymarket pieces for the Burnticker tests (2026-10-10): the frozen Gamma bodies and Polygon eth_call answers fetched on
// 2026-10-10 (config/burnticker/fixtures/polymarket/), a PolymarketClient over them, and the example rules. Not a test file itself.
import { BURNTICKER_RULES_SCHEMA } from "@/lib/burnticker/rules";
import { gammaFixtureFetch, PolymarketClient, rpcFixtureFetch, type TitleRefuser } from "@/lib/burnticker/oracle/polymarket";
import { fx } from "./burntickerHelpers.ts";

interface Chain { url: string; contract: string; blockNumber: string; calls: Record<string, string> }
interface Fixture { fetchedAt: string; gamma: { url: string; body: unknown }; chain?: Chain; tag?: { url: string; body: unknown }; gammaClosed?: { url: string; body: unknown } }
interface ScanFixture { fetchedAt: string; tag: { url: string; body: unknown }; pages: { url: string; body: unknown }[]; chain: Chain }

export const PM_RESOLVED = fx("polymarket/resolved.market.json") as Fixture;
export const PM_OPEN = fx("polymarket/open.market.json") as Fixture;
/** The closed scan of tag:nfl/moneyline at a clock of PM_NOW: the future-end window, then 14-day end-date windows down to 2026-08-13. */
export const PM_TAG_CLOSED = fx("polymarket/tag.nfl.closed.json") as ScanFixture;
export const PM_TAG_OPEN = fx("polymarket/tag.nfl.open.json") as Fixture;
export const PM_SEARCH = fx("polymarket/search.eagles.json") as Fixture;

/** Buccaneers vs. Cowboys (2026-10-08 NFL moneyline): settled Buccaneers = slot 0 = YES; payout [1, 0] on chain. */
export const BUCS_CID = "0xd43898f7e10c30da1adf9c23c808fc8861ec7c0a53195e4a187c199a9b19f376";
/** Eagles vs. Jaguars (2026-10-11 NFL moneyline): open; payout denominator 0 on chain. */
export const EAGLES_CID = "0xc2cf94d904ba94a2d446c7fcda06fb3e62f0b3708ab0d1519b2904e84a1fb96b";
/** The fixtures were fetched 2026-10-10T17:00Z. */
export const PM_NOW = Date.parse("2026-10-10T17:30:00Z");

export const GAMMA_TABLE: Record<string, unknown> = {
  [PM_RESOLVED.gamma.url]: PM_RESOLVED.gamma.body,
  [PM_OPEN.gamma.url]: PM_OPEN.gamma.body,
  [PM_OPEN.gammaClosed!.url]: PM_OPEN.gammaClosed!.body,
  [PM_TAG_CLOSED.tag.url]: PM_TAG_CLOSED.tag.body,
  ...Object.fromEntries(PM_TAG_CLOSED.pages.map((p) => [p.url, p.body])),
  [PM_TAG_OPEN.gamma.url]: PM_TAG_OPEN.gamma.body,
  [PM_SEARCH.gamma.url]: PM_SEARCH.gamma.body,
};
export const CHAIN: Chain = { url: PM_RESOLVED.chain!.url, contract: PM_RESOLVED.chain!.contract, blockNumber: PM_RESOLVED.chain!.blockNumber, calls: { ...PM_TAG_CLOSED.chain.calls, ...PM_OPEN.chain!.calls, ...PM_RESOLVED.chain!.calls } };

/** A client over the fixtures: 50 markets per Gamma page (the fixtures' page size), no spacing, the fixtures' clock. */
export function polyClient(o: { gamma?: Record<string, unknown>; chain?: Chain; refuse?: TitleRefuser | null; pageCap?: number; chainCap?: number; now?: () => number } = {}): PolymarketClient {
  return new PolymarketClient({ fetchImpl: gammaFixtureFetch(o.gamma ?? GAMMA_TABLE), rpcFetch: rpcFixtureFetch(o.chain ?? CHAIN), rpcUrls: ["https://polygon-rpc.test"], now: o.now ?? (() => PM_NOW), minIntervalMs: 0, pageSize: 50, pageCap: o.pageCap ?? 12, chainCap: o.chainCap, refuse: o.refuse ?? null });
}

const base = { schema: BURNTICKER_RULES_SCHEMA, oracle: "polymarket", filter: {}, kind: "binary", scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null };
/** One market (a one-shot): burns 5% of the pool if the Buccaneers won (YES = the first outcome). */
export const PM_BUCS = { ...base, series: null, market: BUCS_CID, binary: { onYes: { fractionOfPool: 0.05 }, onNo: null } };
/** Every NFL head-to-head moneyline on Polymarket (the "A vs. B" question), burning on NO (the second-listed team won). */
export const PM_NFL_MONEYLINE = { ...base, series: "tag:nfl/moneyline", market: null, filter: { titleRegex: "^[^:]+ vs\\. [^:]+$" }, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } } };
