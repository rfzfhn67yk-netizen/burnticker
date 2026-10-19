import { utcDateTime } from "@/lib/burnticker/utcWords";
import { windowKindOf, PERPETUAL_SENTENCE } from "@/lib/burnticker/describe";
import { parseEspnSeries } from "@/lib/burnticker/sources/espn";
import { GAME_BURN_LINE } from "@/lib/burnticker/sources/provenance";
import type { BurnRule } from "@/lib/burnticker/rules";
import type { DateReadJson, LifecycleDatesJson } from "@/lib/burnticker/pageTypes";
import { MCAP_POOL_MEANING, NOT_READ } from "@/lib/burnticker/cardView";

// rules.ts reads files (node:fs) and cannot ship to the browser; these two values mirror it and test/burntickerCoinPage.test.ts pins them.
export const RULES_SCHEMA = "burnticker.rules/v1";
export const WIND_DOWN_DAYS = 28;

/**
 * THE COIN PAGE'S ORDER AND ITS SMALL FACTS (website-11, 2026-10-12; the owner's review items 6 and 8 as the website brief rewrites
 * them). On top: the chart and ONE outbound link, "Trade on Raydium", to the coin's own pool. Burnticker never takes an order, so there
 * the swap panel (TradePanel.tsx, 2026-10-14) sends swaps straight to the coin's Raydium pool; the site holds nothing. Under it the tabs, in this order: "Burn log" (the receipts, each with "Check receipt" to the in-browser
 * verifier), "Rule" (the locked rule text, its hash, the dial, the window and the end), and "Holders" only when holder data was read.
 * There is no thread. The pair page uses the same order with both sides. Pure and client-safe.
 */

export type CoinTab = "burns" | "rule" | "holders";
export const COIN_TAB_LABEL: Record<CoinTab, string> = { burns: "Burn log", rule: "Rule", holders: "Holders" };

/** The tabs a coin page shows, in order. Holders is left out, not shown empty, when no holder data was read. */
export function coinTabs(hasHolders: boolean): CoinTab[] {
  return hasHolders ? ["burns", "rule", "holders"] : ["burns", "rule"];
}

/** The Holders tab's share line (indexer-1): the ten largest wallets' share of the supply, then the same without the labelled wallets (the
 * bonding curve, the trading pool, the burn pool and the creator). A share that was not read is left out, never shown as zero. */
/**
 * A pair card's title (prelaunch audit 2026-10-16 F-14): the series title without internal labels. A one-game title read "Seattle
 * Seahawks win in ESPN game 2475453" (an event id, and ESPN is not a settlement source): it reads "Seattle Seahawks win, one game". With
 * no title the card says "$A vs $B", never the selector key.
 */
export function pairCardTitle(seriesTitle: string | null | undefined, a: string, b: string): string {
  const t = (seriesTitle ?? "").trim();
  if (!t) return `$${a} vs $${b}`;
  return t.replace(/\s+in ESPN game \d+$/, ", one game");
}

/** "There is 1 holder." / "There are 12 holders." (prelaunch audit 2026-10-16: the page said "There are 1 holders."). */
export const holdersCountSentence = (n: number): string => (n === 1 ? "There is 1 holder." : `There are ${n.toLocaleString("en-US")} holders.`);

export function holdersShareLine(top10Pct: number | null | undefined, top10PctUnlabelled: number | null | undefined): string {
  const pct = (n: number) => `${n.toFixed(2)}%`;
  return [
    typeof top10Pct === "number" ? `The ten largest wallets hold ${pct(top10Pct)} of the supply.` : null,
    typeof top10PctUnlabelled === "number" ? `Leaving out the labelled wallets, the ten largest hold ${pct(top10PctUnlabelled)}.` : null,
  ].filter(Boolean).join(" ");
}

/** The tab a page opens on: the one its address names (#rule, #holders) when that tab exists, else the burn log. */
export function initialTab(hash: string, tabs: readonly CoinTab[]): CoinTab {
  const h = hash.replace(/^#/, "");
  return (tabs as readonly string[]).includes(h) ? (h as CoinTab) : "burns";
}

/** The one outbound trade link: the market block's Raydium link for this coin. Any other venue the API lists is not shown. */
export function raydiumLink(trade: { links: { id: string; label: string; url: string }[] } | null | undefined): { label: string; url: string } | null {
  const l = trade?.links.find((x) => x.id === "raydium" || x.id === "launchlab");
  return l ? { label: "Trade on Raydium", url: l.url } : null;
}

/** "Check receipt": the in-browser verifier with this receipt's transaction filled in, on the coin's own network. */
export function checkReceiptHref(signature: string | null, cluster: string): string | null {
  if (!signature) return null;
  const net = cluster === "mainnet" ? "mainnet" : "devnet";
  return `/burnticker/check?sig=${encodeURIComponent(signature)}&cluster=${net}#verify`;
}

export interface RuleFacts {
  /** What one unit (or one firing result) does to the burn pool, in a sentence. Null when the rule file does not say. */
  dial: string | null;
  /** How long the rule runs. */
  window: string;
  /** What happens when it ends. */
  end: string;
}

const pct = (f: number) => `${Math.round(f * 1000) / 10}%`;

/**
 * The dial, the window and the end of a locked rule, read from its exact rules.json text. A Burnticker rule (burnticker.rules/v1) names
 * its share of the burn pool per unit, its window and its wind-down. The operator's own rule files (burnkeeper.rules/v1, $DEFICIT and
 * $REHEARSAL) name the share as `buyback.fractionPerUnit` and have no end.
 */
export function ruleFacts(rulesText: string, oneShot = false): RuleFacts {
  let raw: unknown = null;
  try { raw = JSON.parse(rulesText); } catch { raw = null; }
  const j = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (j.schema === RULES_SCHEMA) {
    const r = j as unknown as BurnRule;
    const m = r.kind === "binary" ? r.binary?.onYes ?? r.binary?.onNo ?? null : r.scalar?.perUnit ?? null;
    const each = r.kind === "binary" ? "Each result that fires the rule" : "Each unit";
    const dial = m?.tokens !== undefined ? `${each} burns ${m.tokens.toLocaleString("en-US")} tokens from the coin's vault.`
      : typeof m?.fractionOfPool === "number" ? `${each} spends ${pct(m.fractionOfPool)} of the burn pool on this coin and burns what it gets.` : null;
    const kind = windowKindOf(r);
    const window = kind === "perpetual" ? PERPETUAL_SENTENCE
      // owner 2026-10-16: a single-game coin burns once two sources agree, else once one source has shown the same final twice (gameSettle.ts gameSchedule, 2026-10-18)
      : kind === "one-shot" || oneShot ? `This coin resolves once. One result decides it.${r.oracle === "catalogue" && parseEspnSeries(r.series ?? "")?.kind === "game" ? ` ${GAME_BURN_LINE}` : ""}`
      : kind === "next" ? "This coin covers a fixed number of games, and then its rule ends."
      : kind === "post" ? "This coin covers one postseason, and then its rule ends."
      : "This coin covers one season, and then its rule ends.";
    const days = r.onEnd?.windDownDays ?? WIND_DOWN_DAYS;
    const end = kind === "perpetual" ? "The rule has no end, so nothing winds down."
      : `When the rule ends, whatever is left in the burn pool is burned down over ${days} days, and then the coin retires.`;
    return { dial, window, end };
  }
  const bb = (j.buyback ?? null) as { fractionPerUnit?: string } | null;
  const f = bb?.fractionPerUnit !== undefined ? Number(bb.fractionPerUnit) : NaN;
  return {
    dial: Number.isFinite(f) && f > 0 ? `Each unit spends ${pct(f)} of the burn pool on this coin and burns what it gets.` : null,
    window: oneShot ? "This coin resolves once. One result decides it." : PERPETUAL_SENTENCE,
    end: oneShot ? "When the rule ends, whatever is left in the burn pool is burned down, and then the coin retires." : "The rule has no end, so nothing winds down.",
  };
}

/**
 * THE RULE IN BRIEF (prelaunch audit 2026-10-18, optional polish): the Rule tab opens on two short sentences, what fires a burn and what
 * a voided result does, and the locked statement sits under "Read the full rule" (a native <details>, so it stays in the page and needs
 * no script). The dial, the window and the end follow in their own rows, so the brief never repeats them. Plain words, lint-clean.
 */
export const READ_FULL_RULE = "Read the full rule";
export const RULE_VOID_SENTENCE = "A voided result burns nothing.";
/**
 * What one firing does, in words: this coin's burn pool swaps SOL for this coin and burns it, or, for a coin with a pinned burn target
 * (rules.ts burnTarget, round 5), swaps SOL for that other token and burns IT (the review of 2026-10-18: "burns some of this coin" was
 * wrong for those coins).
 */
const firingWords = (j: Record<string, unknown>): string => {
  const t = j.burnTarget as { symbol?: unknown } | null | undefined;
  return t && typeof t.symbol === "string" && t.symbol ? `swaps SOL for ${t.symbol} and burns it` : "burns some of this coin";
};
/**
 * A Burn Derby rule's trigger in words, by its kind (the review of 2026-10-18; derby/spec.ts derbyStatement says the same at length):
 *   a flippening settles once: side A on the first window A passes B, side B if the season ends without that;
 *   a two-coin race burns on each window this coin's reference coin wins;
 *   a single asset ("price") counts units of rise (or fall) in one feed: nothing is won;
 *   a record-close coin ("high") burns on each record day, or once on the first one;
 *   a bracket fan coin burns on each day its coin wins its match.
 */
function derbyFires(r: BurnRule, SOME: string): string {
  const d = r.derby!, side = r.pair?.side ?? null;
  // "This coin burns some of itself once", never "This coin burns some of this coin"; a burn target keeps its own words
  const SELF = SOME === "burns some of this coin" ? "burns some of itself" : SOME;
  if (d.selector === "coinvs") {
    if (d.flip) return side === "B" ? `This coin ${SELF} once, if the season ends without ${d.a.symbol} passing ${d.b.symbol}.` : `This coin ${SELF} once, on the first window ${d.a.symbol} passes ${d.b.symbol}.`;
    return `Each window ${side === "B" ? d.b.symbol : d.a.symbol} wins ${SOME}.`;
  }
  if (d.selector === "price") return `Each full ${r.scalar?.unit ?? "set number of"} percentage points of ${r.scalar?.direction === "down" ? "fall" : "rise"} in ${d.u.symbol} over a window counts as one unit, and each unit ${SOME}.`;
  if (d.selector === "high") return d.once ? `The first day ${d.u.symbol} closes at a record ${SOME}, once.` : `Each day ${d.u.symbol} closes at a record ${SOME}.`;
  return `Each day ${d.underlying.symbol} wins its match ${SOME}.`;
}
export function ruleBrief(rulesText: string): string {
  let raw: unknown = null;
  try { raw = JSON.parse(rulesText); } catch { raw = null; }
  const j = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const SOME = firingWords(j);
  let fires = `A settled result that fires the rule ${SOME}.`;
  if (j.schema === RULES_SCHEMA) {
    const r = j as unknown as BurnRule;
    if (r.oracle === "derby" && r.derby) fires = derbyFires(r, SOME);
    else if (r.kind === "binary") {
      const yes = !!r.binary?.onYes, no = !!r.binary?.onNo;
      fires = yes && no ? `A settled YES or NO result ${SOME}.` : yes ? `A settled YES result ${SOME}, and a NO burns nothing.` : no ? `A settled NO result ${SOME}, and a YES burns nothing.` : fires;
    } else if (r.kind === "scalar") fires = r.inverse ? `Each settled reading that does not pass its baseline counts as one unit, and each unit ${SOME}.` : `Each settled reading counts units against its baseline, and each unit ${SOME}.`;
  } else if (j.buyback) fires = `Each unit in a settled result ${SOME}.`;
  return `${fires} ${voidSentence(j)}`;
}

/**
 * What a voided result does (the review of 2026-10-18), in the statement's terms (rules.ts onEndText): with no end clause it burns
 * nothing; with one, a one-shot's voided result ends the rule and what is left burns down over the wind-down, and a series' voided
 * result burns nothing while a rule that ends void burns down what is left the same way.
 */
export function voidSentence(j: Record<string, unknown>): string {
  if (j.schema !== RULES_SCHEMA) return RULE_VOID_SENTENCE;
  const r = j as unknown as BurnRule;
  if (!r.onEnd) return RULE_VOID_SENTENCE;
  const n = r.onEnd.windDownDays;
  const span = n % 7 === 0 ? `${n / 7 === 4 ? "four" : n / 7} weeks` : `${n} days`;
  const d = r.derby as { selector?: string; flip?: boolean; once?: boolean } | undefined;
  const oneShot = !!r.market || !!r.pair?.game || (r.oracle === "derby" && (d?.flip === true || d?.once === true));
  return oneShot ? `A voided result ends the rule, and what is left burns down over ${span}.` : `A voided result burns nothing, and if the rule ends void, what is left burns down over ${span}.`;
}

/**
 * The pool chart's frame (prelaunch audit 2026-10-18, A-36): GeckoTerminal draws a light chart with light_chart=1, so the frame follows
 * the site's theme; and the box says what it is waiting for until the lazy frame scrolls into view and loads.
 */
export const CHART_PLACEHOLDER = "The chart loads when it comes into view.";
export function chartUrlForTheme(url: string, theme: "dark" | "light"): string {
  const v = theme === "light" ? "1" : "0";
  return /([?&])light_chart=[01]/.test(url) ? url.replace(/([?&])light_chart=[01]/, `$1light_chart=${v}`) : `${url}${url.includes("?") ? "&" : "?"}light_chart=${v}`;
}

/** A receipt's status in words for the burn log (prelaunch audit 2026-10-18 A-30: the row printed "pending-pair"). */
export const RECEIPT_STATUS_WORDS: Record<string, string> = {
  planned: "Read, and waiting for its burn run",
  sending: "Being sent",
  "pending-pair": "Waiting until both coins of the pair have a registered pool",
  skipped: "Counted nothing to burn",
  failed: "The burn did not go through, and the funds stayed in the burn pool",
};
export const receiptStatusWords = (status: string): string => RECEIPT_STATUS_WORDS[status] ?? status.replace(/-/g, " ");

/** The plain line a coin on its bonding curve shows under the curve: burns wait for graduation and the pool's registration. */
export const BURNS_AFTER_GRADUATION = "Burns begin only after the bonding curve fills, the coin moves to its Raydium pool, and that pool is registered with the burn program.";
/** Walkthrough 13: the short form for the fact list's "Last receipt" row (the full line already sits under the curve and in the burn log). */
export const FIRST_BURN_AFTER_GRADUATION = "The first burn comes after graduation.";
/** The same line with the raise that fills the curve, read from the curve or the configured threshold (website-13; never a typed 85). */
export function burnsAfterGraduation(raise: string | null, quote = "SOL"): string {
  return raise ? `Burns begin only after the bonding curve fills at ${raise} ${quote} raised, the coin moves to its Raydium pool, and that pool is registered with the burn program.` : BURNS_AFTER_GRADUATION;
}

/**
 * THE COIN PAGE'S MARKET FACTS (website-13, 2026-10-12; ChatGPT audit 6 A10). What a trader expects to find, filled only from what this
 * site read: the network, the mint with its explorer link, the quote asset, the market cap from the curve, the curve's raised and raise
 * or the pool, holders, the creator and the launch date, and the fees. A field this site does not read says so ("Not read here" and the
 * reason); a coin that is not launched says "Not applicable" and why. No price and no volume figure are invented: this
 * site reads neither, and the copy rules keep price talk off every page. Liquidity is the graduated pool's two reserves when the server
 * read them (market.pool), else said not read. Each row is label, value and the reason or meaning.
 */
export interface FactRow { key: string; label: string; value: string | null; note: string | null; href?: string | null; /** one same-site link under the row (the "Next result" row's How burns are settled) */ more?: { href: string; label: string } | null }
export interface FactInput {
  cluster: string; status: string; mint: string; mintUrl: string; creator: string; creatorUrl: string; launchedAt: string | null;
  phase: "curve" | "migrating" | "graduated" | null;
  curve: { raised: string; threshold: string; quote: string; marketCap?: string | null } | null; curveNote: string | null;
  graduatedPool: string | null; holdersCount: number | null; holdersNote: string;
  feesCurveBps: number; feesPoolBps: number; readAt: string | null;
  /** indexer-1: the graduated coin's Raydium pool as read, why it was not, and the lifecycle dates read on chain */
  pool?: { marketCap: string; tokenReserve?: string; solReserve?: string; readAt?: string } | null; poolNote?: string | null; dates?: LifecycleDatesJson | null;
}
const NOT_LAUNCHED = "Not applicable";
const NOT_READ_HERE = "Not read here";
const dec2 = (s: string) => { const n = Number(s); return Number.isFinite(n) ? (Math.round(n * 100) / 100).toLocaleString("en-US") : s; };
/** The liquidity row's sentence when the pool's reserves were not read (a coin on its curve, or a pool this site could not read). */
export const LIQUIDITY_NOT_READ = "This site does not read the pool's reserves yet.";
/** The liquidity row (legitimacy pass, fix a): a graduated coin's two Raydium pool reserves when the server read them, else why not. */
function liquidityRow(i: FactInput, live: boolean): { value: string; note: string } {
  if (!live) return { value: NOT_LAUNCHED, note: "The coin is not launched yet." };
  const p = i.phase === "graduated" ? i.pool : null;
  if (p?.solReserve && p.tokenReserve) {
    return { value: `${dec2(p.solReserve)} SOL and ${dec2(p.tokenReserve)} tokens`, note: `The two reserves of the coin's Raydium pool, read on chain${p.readAt ? ` on ${utcDateTime(p.readAt)}` : ""}.` };
  }
  return { value: NOT_READ_HERE, note: i.phase === "graduated" && i.poolNote ? i.poolNote : LIQUIDITY_NOT_READ };
}
const pctOf = (bps: number) => `${Math.round(bps) / 100}%`;
/** A lifecycle date row: the day with a link to its transaction when read, else the read's own reason. */
/**
 * launch night 2026-10-13: a fact row's day in Denver time ("Oct 13, 2026"), the operator's and the site's clock. The UTC date slice
 * showed an evening launch in Denver as the next day. An unreadable time stays as given.
 */
export function denverDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", year: "numeric", month: "short", day: "numeric" }).format(d);
}
function dateRow(key: string, label: string, d: DateReadJson, cluster: string): FactRow {
  if (d.state === "read") return { key, label, value: denverDay(d.at), note: null, href: `https://explorer.solana.com/tx/${d.signature}${cluster === "mainnet" ? "" : `?cluster=${cluster}`}` };
  return { key, label, value: d.state === "none" ? NOT_LAUNCHED : NOT_READ_HERE, note: d.reason };
}
export function marketFacts(i: FactInput): FactRow[] {
  const live = i.status !== "draft" && i.status !== "expired";
  const na = (why: string) => ({ value: NOT_LAUNCHED, note: why });
  const notLaunched = "The coin is not launched yet.";
  const quote = i.curve?.quote ?? "SOL";
  return [
    { key: "network", label: "Network", value: `Solana ${i.cluster}`, note: i.cluster === "mainnet" ? "The real Solana network, where trades use real SOL." : "A practice network whose tokens have no money value." },
    { key: "mint", label: "Mint address", value: i.mint, note: "The coin's unique address. Copy it to find the coin in a wallet.", href: i.mintUrl },
    { key: "quote", label: "Traded against", value: quote, note: "The coin trades against SOL, Solana's own coin." },
    { key: "mcap", label: "Market cap", ...(!live ? na(notLaunched) : i.curve?.marketCap && i.phase !== "graduated" ? { value: `${dec2(i.curve.marketCap)} ${quote}`, note: "The curve's current SOL per token times the total supply, read from the pool on chain." } : i.phase === "graduated" && i.pool?.marketCap ? { value: `${dec2(i.pool.marketCap)} ${quote}`, note: MCAP_POOL_MEANING } : { value: NOT_READ_HERE, note: i.phase === "graduated" ? i.poolNote || NOT_READ.mcapPool : i.curveNote || "This site has not read the coin's curve." }) },
    { key: "curve", label: i.phase === "graduated" ? "Trading pool" : "Curve", ...(!live ? na(notLaunched) : i.phase === "graduated" ? { value: i.graduatedPool ?? "Graduated", note: "The curve is complete. The coin trades in its own Raydium pool, and that pool's liquidity is locked." } : i.curve ? { value: `${dec2(i.curve.raised)} / ${dec2(i.curve.threshold)} ${quote} raised`, note: i.phase === "migrating" ? "The curve is full, and the coin is moving to its Raydium pool." : "The coin graduates to its own Raydium pool when the curve has raised its full amount." } : { value: NOT_READ_HERE, note: i.curveNote || "This site has not read the coin's curve." }) },
    { key: "volume", label: "Trading volume, 24 hours", value: NOT_READ_HERE, note: "This site does not read trading volume. The chart on this page, when there is one, comes from GeckoTerminal." },
    { key: "liquidity", label: "Liquidity", ...liquidityRow(i, live) },
    { key: "holders", label: "Holders", value: typeof i.holdersCount === "number" ? i.holdersCount.toLocaleString("en-US") : NOT_READ_HERE, note: typeof i.holdersCount === "number" ? null : i.holdersNote },
    { key: "creator", label: "Creator", value: i.creator, note: "The wallet that launched the coin.", href: i.creatorUrl },
    { key: "launched", label: "Launched", value: i.launchedAt ? denverDay(i.launchedAt) : NOT_LAUNCHED, note: i.launchedAt ? null : notLaunched },
    ...(i.dates ? [dateRow("graduated", "Graduated", i.dates.graduated, i.cluster), dateRow("registered", "Pool registered", i.dates.registered, i.cluster)] : []),
    { key: "fees", label: "Fees per trade", value: `${pctOf(i.feesCurveBps)} on the curve, ${pctOf(i.feesPoolBps)} in the pool`, note: "Raydium shows how far your trade moves the pool, and your slippage setting, before you sign. Burnticker takes no order." },
    { key: "freshness", label: "Read at", value: i.readAt ? utcDateTime(i.readAt) : NOT_READ_HERE, note: i.readAt ? null : "This site has not read the pool." },
  ];
}
