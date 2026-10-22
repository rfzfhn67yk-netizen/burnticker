import type { BurnRule, RuleMode } from "@/lib/burnticker/rules";
import type { FeeSplit } from "@/lib/burnticker/fees";
import type { SerializedIx } from "@/lib/burnticker/program";
import type { UnsignedTx } from "@/lib/burnticker/transactions";
import type { VerifyResult } from "@/lib/burnticker/verify";
import type { Backtest } from "@/lib/burnticker/oracle/backtest";
import type { PairCounterpart, PairForwardJson, ReceiptJson, TokenStatusJson } from "@/lib/burnticker/pageTypes";
import type { LpLockJson, LpLockPolicyJson } from "@/lib/burnticker/lockFees";

/**
 * The public API's JSON shapes, as the SDK returns them. The OpenAPI document (GET /api/burnticker/v1/openapi.json) is the
 * language-neutral version of the same contract; the route tests validate every response against it.
 */

export type { BurnRule, RuleMode, FeeSplit, SerializedIx, UnsignedTx, VerifyResult, Backtest, ReceiptJson, TokenStatusJson, LpLockJson, LpLockPolicyJson, PairCounterpart, PairForwardJson };

/** One resolution source (GET /catalogue). */
export interface SourceCard {
  id: string; kind: "market" | "assertion" | "attested-http" | "onchain"; tier: 1 | 2 | 3 | 4 | 5; tierLabel: string; title: string; sourceName: string; sourceUrl: string; cadence: string;
  unit: { size: number; label: string; definition: string } | null; direction: string | null; baseline: "previousSettlement" | number | null; carry: string | null; valueLabel: string | null; flags: string[];
  launchable: { ok: boolean; why: string | null }; param: unknown; needsKey: string | null; fixtureFetchedAt: string | null; refusals: string[];
  lastReading: { id: string; value: string | null; at: string } | null; readings: { id: string; value: string | null }[]; preview: unknown;
  /** attested-http only: the public selection config a verifier needs (header values withheld). */
  config: Record<string, unknown> | null;
}
export interface Catalogue { sources: SourceCard[]; tiers: Record<string, string>; admission: { all: string[]; byTier: Record<string, string> }; kalshi: { search: string; note: string } }

export interface KalshiSeries { oracle: string; ticker: string; title: string; category: string | null; frequency: string | null; settlementSource: { name: string; url: string } | null; tags: string[]; refused?: string[] }
export interface KalshiEventHit {
  eventTicker: string; seriesTicker: string; title: string; subTitle: string | null; category: string | null; competition: string | null; expectedAt: string | null; closeTime: string | null;
  markets: { ticker: string; suffix: string; label: string; status: string; closeTime: string | null }[]; score: number; matchedSides: string[]; matched: string[];
  /** Two-team games: both sides and the two selector modes (thisGameOnly: one market, side B inverted — a partition; everyGame: each side's own-leg filter — not a partition in general). */
  pair: Record<string, unknown> | null; refused: string[];
}
export interface KalshiSearchResult { query: string; results: KalshiSeries[]; events?: KalshiEventHit[]; ranking?: "events" | "series"; teams?: { league: string; abbr: string; city: string; nickname: string }[] }
export interface KalshiEvents { query: string; series: string | null; events: KalshiEventHit[]; scanned: string[]; teams: { league: string; abbr: string; city: string; nickname: string }[]; leagues?: { id: string; label: string; series: { ticker: string; title: string }[] }[]; count?: number }
export interface KalshiTeam { abbr: string; city: string; nickname: string | null; name: string; ticker: string; league: string | null; filter: string; collisions: string[]; next: { eventTicker: string; marketTicker: string; title: string; expectedAt: string | null; opponent: string | null } | null; record: { w: number; l: number; d: number; since: string } }
export interface KalshiTeams { series: string; since: string; teams: KalshiTeam[]; note: string }
/** GET /browse — one source, any venue, in one shape. */
export interface BrowseSourceCard { id: string; venue: "feed" | "polymarket" | "kalshi"; venueLabel: string; tier: number; tierLabel: string; title: string; cadence: string | null; kind: "binary" | "scalar"; next: { label: string; at: string | null } | null; example: string; launchable: { ok: boolean; why: string | null }; refused: string[]; flags: string[]; sourceName: string | null; sourceUrl: string | null; pick: { oracle: "catalogue" | "polymarket" | "kalshi"; series: string | null; market: string | null; title: string } }
export interface Browse {
  venues: { kalshi: boolean; polymarket: boolean; feeds: boolean };
  categories?: { id: string; label: string; blurb: string; feeds: number; polymarket: string[]; kalshi: string[] }[];
  category?: { id: string; label: string; blurb: string }; cards?: BrowseSourceCard[]; counts?: { feeds: number; polymarket: number; kalshi: number }; errors?: string[]; note?: string;
}
/** GET /kalshi/categories — Kalshi's category → tag tree, or one category's series (most traded first) with the matching Polymarket tag's events. */
export interface KalshiCategorySeries { ticker: string; title: string; category: string | null; frequency: string | null; tags: string[]; settlementSource: { name: string; url: string } | null; volume: number; kindHint: "binary" | "scalar"; example: string; refused: string[]; events: { open: number; next: { eventTicker: string; title: string; closeTime: string | null; expectedAt: string | null } | null; ladder: boolean } | null }
export interface KalshiCategories {
  categories?: { category: string; tags: string[]; seriesCount: number | null; polymarket: { slug: string; label: string } | null }[];
  category?: string; total?: number; offset?: number; limit?: number; tags?: { tag: string; count: number }[]; series?: KalshiCategorySeries[];
  polymarket?: { tag: { slug: string; label: string }; events: unknown[]; error: string | null } | null; note?: string;
}
export interface KalshiSeriesDetail { series: KalshiSeries; open: { ticker: string; title: string; closeTime: string | null; yesPrice: number | null }[]; openCount: number; refusals: { kind: string; id: string; reason: string; matched: string }[]; note: string }

/** Polymarket search (GET /polymarket/search): binary markets only — YES = a market's first outcome, NO its second; no prices, odds or volume are returned — only. */
export interface PolymarketMarketHit { conditionId: string; question: string; yes: string; no: string; endDate: string | null; closed: boolean; sportsMarketType: string | null; selector: { oracle: "polymarket"; series: null; market: string }; outcome: string | null }
export interface PolymarketEventHit { slug: string; title: string; url: string; endDate: string | null; closed: boolean; tags: { slug: string; label: string }[]; markets: PolymarketMarketHit[]; marketCount: number; selector: { oracle: "polymarket"; series: string; market: null }; refused: string[] }
export interface PolymarketTagHit { slug: string; label: string; events: number; series: string[] }
export interface PolymarketSearchResult { query: string; status: "open" | "closed" | "all"; venue: "polymarket"; events: PolymarketEventHit[]; markets: PolymarketMarketHit[]; tags: PolymarketTagHit[]; note: string }
export interface BacktestResult { rule: BurnRule; text: string; sha256: string; sha12: string; mode: RuleMode; statement: string; backtest: Backtest; sentence: string; refusals: unknown[]; seriesTitle: string | null; matched: number }

export interface LaunchReview {
  ticker: string; name: string; description: string; creator: string; mint: string; cluster: string; seriesTitle: string | null;
  rules: { text: string; sha256: string; sha12: string; statement: string; mode: string };
  /** The exact receipt format every burn of this coin will write on chain. */
  receiptFormat: string;
  addresses: { tokenConfig: string; feePda: string; vault: string | null; poolId: string; platformId: string; configId: string };
  allocation: { supply: string; curve: string; locked: string; reserve: string; vestDays: number | null; cliffDays: number | null; lpBurnedPct: number; /** since 1.8.0: 100 (LP locked forever; lpBurnedPct is 0) */ lpLockedPct?: number; teamAllocationPct: 0 };
  fees: { curve: FeeSplit; postGraduation: FeeSplit; creatorSliceBps: 0; sentence: string; devFeeWallet: string | null };
  /** LaunchLab's recorded creator: the burn program's fee PDA for the mint (never a person, never the keeper). */
  burnPoolAuthority: string;
  notes: string[]; disclosure: { disclaimer: string; eventContract: string | null }; operator: { can: string[]; cannot: string[]; placeholder: boolean }; acknowledgements: string[];
}
export interface LaunchBundleResponse { ok: true; cluster: string; ready: boolean; pending: string[]; review: LaunchReview; transactions: UnsignedTx[]; registered: { status: string; ticker: string; mint: string } | null; next: string[]; stubs: string[] }

export interface TokenSummary { ticker: string; name: string; mint: string; status: "draft" | "live" | "paused" | "retired" | "expired"; oracle: string; selectorKey: string; mode: string; rulesSha256: string; creator: string; cluster: string; baselineAt: string; receipts: number; burns: number; burnedTokens: string; links: { self: string; receipts: string; page: string } }
export interface TokenList { tokens: TokenSummary[]; count: number; total: number; cluster: string }
export interface Reading { id: string; at: string; result: string | null; value: string | null; title: string | null; sourceUrl: string; settlementSourceUrl: string | null; method: string | null; attestedBy: string[] }
export interface TokenDetail { status: TokenStatusJson; receipts: ReceiptJson[]; readings: Reading[]; rulesText: string; stubs: string[] }
export interface Receipts { ticker: string; mint: string; rulesSha256: string; count: number; receipts: ReceiptJson[] }
export interface ServerVerification extends VerifyResult { receipt: ReceiptJson; how: string[] }
export interface Trust {
  generatedAt: string; cluster: string; powers: { schema: string; placeholder: boolean; powers: { id: string; power: string; holder: string | null; holderKind: string; timelock: string | null; sunset: string | null; canDo: string[]; cannotDo: string[] }[] };
  operator: { can: string[]; cannot: string[]; placeholder: boolean };
  fees: { designed: { curve: FeeSplit; postGraduation: FeeSplit; devFeeBps: number; lpBurnedPct: number; lpLockedPct?: number; lpFeeSplit?: { burnPoolBps: number; operatorBps: number; ofLpBps: { burnPool: number; operator: number } }; creatorCashBps: 0; teamAllocationPct: 0 }; live: { platformId: string; found: boolean; readAt: string; error: string | null; fields: Record<string, { designed: string; live: string; matches: boolean }> | null } };
  program: { programId: string | null; deployed: boolean; buildHash: string | null; verify: string[] }; attesters: unknown[]; audit: unknown; statements: string[]; cannot: string[]; rpcConfigured: boolean; stubs: string[];
  /** since 1.8.0: LP locked forever — the lock program, the fee-keys PDA (Fee Key owner), the operator treasury, the compiled 80/20 split. */
  lpLock?: LpLockPolicyJson;
}

/** One decoded program event (Anchor emit_cpi), from a confirmed transaction. */
export interface ProgramEvent { kind: "program"; name: string; data: Record<string, unknown>; signature: string; slot: number; blockTime: number | null; memo: string | null }
/** A receipt that appeared or changed state, seen through the public API (the polling fallback). */
export interface ReceiptEvent { kind: "receipt"; name: "ReceiptNew" | "ReceiptUpdated"; receipt: ReceiptJson; ticker: string }
export type BurntickerEvent = ProgramEvent | ReceiptEvent;

// ---- Burn Derby (2026-10-10; OpenAPI 1.4.0) ----
export interface DerbyUnderlyingJson { symbol: string; pyth: string | null; mint: string | null; pool: string | null; cross: string }
export interface DerbyDayJson {
  day: number; windowId: string; at: string; status: "decided" | "withheld"; winner: "A" | "B" | "tie" | null;
  a: { symbol: string; changePct: string | null; start: string | null; end: string | null; source: string | null }; b: { symbol: string; changePct: string | null; start: string | null; end: string | null; source: string | null } | null;
  margin: string | null; crossMargin: string | null; reason: string | null; eventId: string | null; proofSha256: string | null; proof: { label: string; url: string | null; detail: string }[];
  receipts: { a: { status: string; burned: string | null; signature: string | null; txUrl: string | null } | null; b: { status: string; burned: string | null; signature: string | null; txUrl: string | null } | null };
}
export interface DerbyPairJson {
  pairId: string; selector: "coinvs" | "price"; series: string; window: string; measure: string; flip: boolean; symbols: { a: string; b: string | null };
  season: { start: string; days: number; endsOn: string; over: boolean; windows: number; windowsDone: number };
  score: { a: number; b: number; ties: number; withheld: number; dayNumber: number }; days: DerbyDayJson[]; retired: { a: string | null; b: string | null }; note: string;
}
export interface DerbyTournamentJson {
  id: string; title: string; sha256: string; size: number; start: string; end: string; roundDays: number; fractionOfPool: number; finalBurn: string; finalUnits: number;
  status: "upcoming" | "running" | "complete"; currentRound: number | null; champion: { slot: number; symbol: string; ticker: string | null } | null;
  rounds: { index: number; start: string; end: string; final: boolean; matches: { round: number; index: number; final: boolean; a: { slot: number; symbol: string; ticker: string | null; status: string | null } | null; b: { slot: number; symbol: string; ticker: string | null; status: string | null } | null; winsA: number; winsB: number; ties: number; withheld: number; cumA: string; cumB: string; winner: number | null; tiebreak: string | null; days: { date: string; result: "A" | "B" | "tie" | "withheld" | "open"; changeA: string | null; changeB: string | null }[] }[] }[];
  coins: { slot: number; symbol: string; ticker: string | null; mint: string | null; status: string | null; retiredReason: string | null; eliminatedInRound: number | null }[];
}
export interface DerbyList { tournaments: Pick<DerbyTournamentJson, "id" | "title" | "size" | "start" | "end" | "roundDays" | "status" | "currentRound" | "champion">[]; pairs: { pairId: string; a: string; b: string; series: string; selector: string; season: { start: string; days: number; endsOn: string }; score: { a: number; b: number; ties: number }; page: string }[]; note: string }
export interface DerbyDetail { kind: "tournament" | "pair"; tournament: DerbyTournamentJson | null; pair: DerbyPairJson | null; tickers: { a: string; b: string } | null; post: string | null }
export interface DerbySearchHit { symbol: string; name: string; source: "pyth" | "jupiter"; assetType: string; feed: string | null; mint: string | null; liquidityUsd: number | null; verified: boolean; underlying: DerbyUnderlyingJson | null; why: string | null }
export interface DerbySearch { query: string; assets: string; hits: DerbySearchHit[]; note: string }
