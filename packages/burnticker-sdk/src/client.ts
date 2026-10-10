import { PublicKey, type Connection } from "@solana/web3.js";
import type { Cluster } from "@/lib/burnReceipts/constants";
import { ApiTransport, orStatus, type Fetch } from "./http.ts";
import { compose, lock, type Mapping, type Selector } from "./rules.ts";
import { buildLaunchBundle, feePdaFor, type LaunchOptions, type LaunchResult } from "./launch.ts";
import { verifyReceipt, type VerifyOptions } from "./verify.ts";
import { crank, type CrankPlan } from "./crank.ts";
import { subscribe, type SubscribeOptions, type Subscription } from "./events.ts";
import type {
  BacktestResult, Browse, BurntickerEvent, Catalogue, KalshiCategories, KalshiEvents, KalshiSearchResult, KalshiSeriesDetail, KalshiTeams, PolymarketSearchResult, ReceiptJson, Receipts, ServerVerification, TokenDetail, TokenList, TokenStatusJson, Trust, VerifyResult,
} from "./types.ts";

export interface BurntickerOptions {
  /** The API root, e.g. "https://<burnticker host>/api/burnticker/v1". Required for every call that reads platform data. */
  apiBase?: string;
  /** A fetch implementation (default: the global fetch). */
  fetch?: Fetch;
  /** Your Solana RPC: fresh blockhashes for launch bundles, crank transactions, chain events, and the chain check of verifyReceipt. */
  connection?: Connection;
  /** The deployed burn_receipts program id (needed for crank, chain events and the local fee-PDA check). */
  programId?: PublicKey | string;
  /** Which CPMM deployment the program build talks to (crank only). Default "devnet". */
  cluster?: Cluster;
  /** Mainnet is refused everywhere unless this is true. */
  allowMainnet?: boolean;
  userAgent?: string;
}

/** A token as a bot wants it: the page's status, its receipts, the next possible burn and the market-implied chance (display only). */
export interface TokenView extends TokenDetail {
  ticker: string; mint: string;
  nextBurn: TokenStatusJson["next"];
  /** The market-implied chance that the NEXT settlement burns — DISPLAY ONLY; the rule never reads a price. */
  impliedChance: number | null;
}

/**
 * THE BURNTICKER CLIENT. Everything the launch wizard does and everything the pages show, for bots: trading bots, launch bots,
 * Telegram bots, agents. Public data and unsigned transactions only — the client never asks for a key; your code signs.
 *
 * What you CANNOT do, by design: change a rule after launch (a different rule is a different token), claim or redirect any fee, or
 * add a burn rule to a coin that already exists (burn_receipts' initialize_token must be signed by the NEW mint keypair, and the burn
 * pool must be LaunchLab's creator from the first trade).
 *
 * @example
 * const bt = new Burnticker({ apiBase: "https://burnticker.com/api/burnticker/v1" });
 * const hits = await bt.kalshi.search("broncos");
 * const t = await bt.token("BRONCO");
 */
export class Burnticker {
  readonly options: BurntickerOptions;
  private readonly transport: ApiTransport | null;

  constructor(o: BurntickerOptions = {}) {
    this.options = o;
    this.transport = o.apiBase ? new ApiTransport({ apiBase: o.apiBase, fetch: o.fetch, userAgent: o.userAgent }) : null;
  }

  /** The HTTP transport (throws when no apiBase was given). */
  get api(): ApiTransport {
    if (!this.transport) throw new Error("burnticker: this call reads platform data — pass { apiBase: \"https://<host>/api/burnticker/v1\" }");
    return this.transport;
  }

  /** Every resolution source with its tier (1 adjudicated market … 5 page-scraped), launchability and public selection config. */
  catalogue(): Promise<Catalogue> { return this.api.get<Catalogue>("/catalogue"); }

  /** What a catalogue rule would have burned over the source's frozen fixture (the source fixes unit/direction/baseline; you pick the mapping). */
  sourcePreview(id: string, mapping: { fractionOfPool?: number; tokens?: number } = {}): Promise<Record<string, unknown>> {
    return this.api.get(`/sources/${encodeURIComponent(id)}/preview`, { fractionOfPool: mapping.fractionOfPool, tokens: mapping.tokens });
  }

  /** Browse every source by Burnticker category: no argument → the categories; a category id → its source cards (feeds first, then Polymarket, then Kalshi when the host enables it). */
  browse(category?: string, o: { q?: string } = {}): Promise<Browse> { return this.api.get<Browse>("/browse", { category, q: o.q }); }

  /** Kalshi: search series, read one series with its open markets, back-test a selector + mapping on the venue's settled history. */
  readonly kalshi = {
    search: (q: string, o: { category?: string } = {}): Promise<KalshiSearchResult> => this.api.get<KalshiSearchResult>("/kalshi/search", { q, category: o.category }),
    series: (ticker: string): Promise<KalshiSeriesDetail> => this.api.get<KalshiSeriesDetail>("/kalshi/search", { series: ticker }),
    /** Event-level search: games, contests, people ("eagles", "PHI", "jaguars"); `series` scans one series; no arguments → the league chooser. */
    events: (q = "", o: { series?: string; status?: "open" | "closed" | "settled" } = {}): Promise<KalshiEvents> => this.api.get<KalshiEvents>("/kalshi/events", { q: q || undefined, series: o.series, status: o.status }),
    /** The teams of a head-to-head game series (KXNFLGAME, …): next game, season record, the own-leg filter for a team coin. */
    teams: (series: string): Promise<KalshiTeams> => this.api.get<KalshiTeams>("/kalshi/teams", { series }),
    /** Browse like Kalshi: no argument → its categories (tags, series counts, the matching Polymarket tag); a category → its series, most traded first (`events: n` adds the upcoming-event summary to the first n). */
    categories: (category?: string, o: { tag?: string; q?: string; limit?: number; offset?: number; events?: number; polymarket?: boolean } = {}): Promise<KalshiCategories> =>
      this.api.get<KalshiCategories>("/kalshi/categories", { category, tag: o.tag, q: o.q, limit: o.limit, offset: o.offset, events: o.events, polymarket: o.polymarket === false ? "0" : undefined }),
    /** `backtest(selector, mapping)` or `backtest(fullRule)`. The rule is validated locally first. */
    backtest: (selector: Selector | Record<string, unknown>, mapping?: Mapping, o: { months?: number } = {}): Promise<BacktestResult> => {
      const rule = mapping ? compose(selector as Selector, mapping) : selector;
      return this.api.post<BacktestResult>("/kalshi/backtest", { rule: lock(rule).rule, months: o.months });
    },
  };

  /**
   * Polymarket (tier 1, binary only; 2026-10-10): search Gamma (text, an event slug or a condition id) and back-test a selector —
   * `{ oracle: "polymarket", market: "0x…" }` (one market), `{ oracle: "polymarket", series: "tag:nfl/moneyline" }` or
   * `{ oracle: "polymarket", series: "event:<slug>" }` — on Gamma's closed markets. The keeper reads each result from the Conditional
   * Tokens payout vector on Polygon; prices are display only.
   */
  readonly polymarket = {
    search: (q: string, o: { status?: "open" | "closed" | "all" } = {}): Promise<PolymarketSearchResult> => this.api.get<PolymarketSearchResult>("/polymarket/search", { q, status: o.status }),
    /** `backtest(selector, mapping)` or `backtest(fullRule)`; the selector's oracle defaults to "polymarket". Validated locally first. */
    backtest: (selector: Selector | Record<string, unknown>, mapping?: Mapping, o: { months?: number } = {}): Promise<BacktestResult> => {
      const rule = mapping ? compose({ ...(selector as Selector), oracle: (selector as Selector).oracle ?? "polymarket" }, mapping) : selector;
      return this.api.post<BacktestResult>("/polymarket/backtest", { rule: lock(rule).rule, months: o.months });
    },
  };

  /** Server-side rule validation (the same code as rules.validate locally; useful from non-TypeScript bots via the HTTP API). */
  validateRemote(rule: unknown): Promise<{ ok: boolean; canonical?: string; sha256?: string; problems?: string[] }> {
    return orStatus(this.api.post("/rules/validate", { rule }), 400, (e) => ({ ok: false, problems: e.problems }));
  }

  /**
   * Build the launch: unsigned transactions (co-signed by a mint keypair generated HERE), the review payload the wizard shows, the
   * exact receipt format and the rule hash. Your wallet signs and sends; then call confirmLaunch(mint, signature).
   */
  buildLaunchBundle(o: LaunchOptions): Promise<LaunchResult> {
    return buildLaunchBundle(this.api, { ...o, allowMainnet: o.allowMainnet ?? this.options.allowMainnet }, { connection: this.options.connection, programId: this.options.programId ? new PublicKey(this.options.programId) : null });
  }

  /** Report the landed launch transaction: the draft goes live and its baseline is now. */
  confirmLaunch(mint: PublicKey | string, signature: string): Promise<{ ok: boolean; ticker: string; mint: string; status: string; note: string }> {
    return this.api.post("/launch/confirm", { mint: new PublicKey(mint).toBase58(), signature });
  }

  /** The burn pool (burn_receipts' fee PDA ["fee", mint]) — LaunchLab's recorded creator for the coin. Needs `programId`. */
  feePdaFor(mint: PublicKey | string): PublicKey {
    if (!this.options.programId) throw new Error("burnticker: feePdaFor needs { programId } (the deployed burn_receipts id)");
    return feePdaFor(this.options.programId, mint);
  }

  tokens(o: { status?: "draft" | "live" | "paused" | "retired" | "expired"; limit?: number; offset?: number } = {}): Promise<TokenList> { return this.api.get<TokenList>("/tokens", o); }

  /** One token by ticker or mint: status, receipts, next possible burn, implied chance (display only), the exact rules.json text. */
  async token(tickerOrMint: string): Promise<TokenView> {
    const d = await this.api.get<TokenDetail>(`/tokens/${encodeURIComponent(tickerOrMint)}`);
    return { ...d, ticker: d.status.ticker, mint: d.status.mint, nextBurn: d.status.next, impliedChance: d.status.next.impliedChance };
  }

  receipts(tickerOrMint: string): Promise<Receipts> { return this.api.get<Receipts>(`/tokens/${encodeURIComponent(tickerOrMint)}/receipts`); }

  /** The server's own verification of one receipt (convenient; verifyReceipt below does it without trusting the server). */
  verifyOnServer(tickerOrMint: string, eventId: string): Promise<ServerVerification> { return this.api.get<ServerVerification>(`/tokens/${encodeURIComponent(tickerOrMint)}/verify/${encodeURIComponent(eventId)}`); }

  /**
   * Verify a receipt on THIS machine: re-read the settled result from the original source, re-apply the published rule, recompute
   * the spend, read the memo from chain (with a connection). Pass a receipt object + { ticker, rulesText }, or a ticker and an event id.
   */
  async verifyReceipt(receipt: ReceiptJson | string, o: Partial<VerifyOptions> & { eventId?: string } = {}): Promise<VerifyResult> {
    if (typeof receipt !== "string") {
      if (!o.ticker || !o.rulesText) throw new Error("burnticker.verifyReceipt: with a receipt object, pass { ticker, rulesText }");
      return verifyReceipt(receipt, { connection: this.options.connection, fetch: this.options.fetch, ...o, ticker: o.ticker, rulesText: o.rulesText });
    }
    if (!o.eventId) throw new Error("burnticker.verifyReceipt(ticker, { eventId })");
    const t = await this.token(receipt);
    const r = t.receipts.find((x) => x.eventId === o.eventId);
    if (!r) throw new Error(`no receipt ${o.eventId} for ${t.ticker}`);
    let sourceConfig = o.sourceConfig ?? null;
    if (!sourceConfig && t.status.oracle === "catalogue") {
      const series = lock(JSON.parse(t.rulesText)).rule.series;
      sourceConfig = (await this.catalogue()).sources.find((s) => s.id === series)?.config ?? null;
    }
    return verifyReceipt(r, { connection: this.options.connection, fetch: this.options.fetch, ...o, ticker: t.ticker, rulesText: t.rulesText, sourceConfig });
  }

  /** The permissionless crank transaction for a mint's next attested reading (unsigned; your cranker key signs and pays the fee). */
  crank(mint: PublicKey | string, cranker: PublicKey | string): Promise<CrankPlan> {
    const { connection, programId } = this.options;
    if (!connection || !programId) throw new Error("burnticker.crank needs { connection, programId }");
    return crank(mint, cranker, { connection, programId, cluster: this.options.cluster ?? "devnet", allowMainnet: this.options.allowMainnet });
  }

  /** Program events for a mint (with connection + programId), else receipts polled from the API (pass { ticker }). Returns stop(). */
  subscribe(mint: PublicKey | string, onEvent: (e: BurntickerEvent) => void, o: Omit<SubscribeOptions, "connection" | "programId" | "api"> = {}): Subscription {
    const chain = this.options.connection && this.options.programId;
    return subscribe(mint, onEvent, { ...o, ...(chain ? { connection: this.options.connection, programId: this.options.programId } : { api: this.api }) });
  }

  /** The Powers Register and the live fee bps (designed vs decoded from chain). */
  trust(): Promise<Trust> { return this.api.get<Trust>("/trust"); }

  /** The OpenAPI 3.1 document of the HTTP API. */
  openapi(): Promise<Record<string, unknown>> { return this.api.get("/openapi.json"); }
}
