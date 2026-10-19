import type { Readiness } from "@/lib/burnticker/readiness";
import { progressOf, type ProgressView } from "@/lib/burnticker/progress";
import { statedSentences } from "@/lib/burnticker/sources/polyStated";
import type { StatedJson } from "@/lib/burnticker/pageTypes";
import { coinPageHref } from "@/lib/burnticker/coinKey";
import { cardAge } from "@/lib/burnticker/cardAge.mjs";
import { coinWatchKey } from "@/lib/burnticker/watchlist";
import { coinLinks, type CoinLinks } from "@/lib/burnticker/tradeLinks";
import { coinStatusSentence, type CoinStatusFacts } from "@/lib/burnticker/coinStatus";
import type { CoinListing } from "@/lib/burnticker/coinsList";
/**
 * ONE COIN CARD, ONE FIELD ORDER (website-10, 2026-10-12; rebuilt by website-13 the same day for Claude site audit 2 item 7 and ChatGPT
 * audit 6 A10 / A11, with the owner's decision to show the market cap). Every surface that lists coins prints the same rows in the same
 * order, and never hides one:
 *
 *   image · name · $TICKER · badge · progress (six steps, website-14) · rule (one line) · next result · curve ("X / <raise> SOL raised",
 *   the raise read from the coin's own pool, never a typed 85; "— raised" when not read) · market cap · holders · age · burned (amount
 *   and share of supply) · Check receipt
 *
 * A field this site has not read prints "—" and carries the reason (shown on hover and to screen readers). Nothing is invented: a number
 * appears only when it was read from the pool, the curve, the registry or the keeper's files. The market cap is a bare number with no
 * arrow and no commentary. The app's CoinCard component and the static home page's renderer both read this shape, so the order cannot
 * drift between them. Client-safe: no file reads.
 */

export type CardTagTone = "featured" | "rehearsal" | "devnet" | "grad" | "neutral";
export interface CardTag { label: string; tone: CardTagTone }

/** One field: its text, or null for "—"; `why` says why it is "—" (or what the number means). */
export interface CardCell { text: string | null; why: string | null }

/** "public" = a coin anyone can trade; "test" = a featured coin not created yet, a disclosed rehearsal or a devnet coin. */
export type CardGroup = "public" | "test";

export interface CardView {
  /** unique per card ($DEFICIT appears twice before launch: the mainnet coin and the devnet rehearsal) */
  id: string;
  ticker: string;
  name: string;
  imageUrl: string | null;
  group: CardGroup;
  /** the badge row: featured, rehearsal, network, phase, window */
  tags: CardTag[];
  /** one plain sentence under the name, on featured cards only */
  note: string | null;
  /**
   * coin card status 2026-10-18 (the owner's UX walkthrough): what happens next, in one status sentence chosen by the coin's state
   * (coinStatus.ts). Shown on the card above the "Details" expander; null or absent when the state was not read (the card shows the rule).
   */
  status?: string | null;
  /**
   * the Coins page (owner 2026-10-19, coinsList.ts): a decided coin's one result line, and an open coin's next-result line, built in the
   * browser in the viewer's zone; absent elsewhere
   */
  resultLine?: string | null;
  nextLine?: string | null;
  /** the rule in one line */
  rule: string;
  /** when the next result settles */
  nextSettle: CardCell;
  /** where the coin stands in six steps (progress.ts, a view of readiness.ts); null when this site does not read it (progressWhy says why) */
  progress: ProgressView | null;
  progressWhy: string | null;
  /** the bonding curve: raised of the coin's own raise ("85 SOL"); `of` is null when the raise was not read, `raised` null when not read */
  /** `na`: the coin never had a curve (the devnet rehearsal coin; website-15 item 6), so the row says "Not applicable" */
  curve: { raised: string | null; of: string | null; pct: number | null; done: boolean; why: string | null; na?: boolean };
  /** website-15 item 13: the creator's own text and links, under the rule (registered coins only) */
  creatorText?: string | null;
  links?: { label: string; url: string }[];
  /** sources-2: a Polymarket coin's stated source and dispute window, one line under the rule (polyStated.ts statedSentences) */
  stated?: string | null;
  /** website-17 item 2: the coin's line on the scoreboard (coinRank.ts rankLines), read from the registry; null or absent when not read */
  rank?: string | null;
  /** market cap in SOL (a bare number), read from the curve before graduation */
  mcap: CardCell;
  holders: CardCell;
  /** when the coin was created (ISO); the components print its age */
  createdAt: string | null;
  createdWhy: string | null;
  /** total burned, with the share of supply */
  burned: CardCell;
  /** a mint address shown on the card (pre-launch $DEFICIT: the address is reserved, the coin does not exist) */
  mint: { address: string; label: string } | null;
  /** the coin's own page; null when there is none */
  href: string | null;
  /** "Check receipt": the newest receipt's own check (its signature and network); null when the coin has no receipt */
  receipt: { href: string } | null;
  /** why "Check receipt" is off */
  receiptWhy: string | null;
  /** the coin's follow key, network and mint (watchlist.ts coinWatchKey; private review 8 F1); null when the card cannot be followed */
  watchKey?: string | null;
  /** owner 2026-10-14: where to trade the coin and look it up (tradeLinks.ts coinLinks); absent or null when there is nothing to link */
  trade?: CoinLinks | null;
  /** what each empty row says instead of a dash (emptyLabels below); set by the home API for the static page, computed by the app */
  empty?: Partial<Record<"progress" | "nextSettle" | "curve" | "mcap" | "holders" | "age" | "burned", string>>;
  /** coin card status 2026-10-18: the one number in view (headlineStat below); set by the home API for the static page, computed by the app */
  stat?: { key: "burned" | "curve" | "mcap" | "holders"; label: string; text: string } | null;
}

/** The fixed row order, by key. test/burntickerHomeShell.test.ts holds the component and the static renderer to it. */
export const CARD_ROWS = ["image", "name", "ticker", "badge", "progress", "rule", "nextSettle", "curve", "mcap", "holders", "age", "burned", "receipt"] as const;

/** The row labels, the same on the app and the static page. Data labels, not prose. */
export const CARD_LABELS = { progress: "Progress", rule: "Rule", nextSettle: "Next result", curve: "Curve", mcap: "Market cap", holders: "Holders", age: "Age", burned: "Burned" } as const;

/** What a card's fields mean, for the "What these mean" note and hover text (Codex review 5 glossary, first use on a card). */
export const CARD_MEANINGS = {
  progress: "Six steps from creation to the first burn: created, trading on the curve, graduated, pool registered, ready to burn, burned.",
  curve: "A new coin first trades on a bonding curve. When buyers have put in the raise, the coin graduates to its own Raydium trading pool.",
  mcap: "This number is the curve's current SOL per token times the total supply, read from the pool on chain.",
  holders: "How many wallets hold the coin.",
  burned: "Tokens the program bought with the coin's burn pool and destroyed, and their share of the total supply.",
  receipt: "A receipt is the burn's transaction plus the source reading behind it. Anyone can check one in the browser.",
} as const;

export const NOT_READ = {
  holders: "Counting holders needs an indexer that lists every token account of the coin. This site does not run one.",
  mcapPool: "After graduation this number comes from the Raydium pool, and this site could not read that pool.",
  mcapNotRead: "This site has not read the coin's curve.",
  curveNotRead: "This site has not read the coin's curve.",
  nextNone: "This rule has no scheduled result.",
} as const;
/**
 * HOLDERS (coin card status 2026-10-18, the owner's UX walkthrough): a fresh coin's only token account is its own bonding curve, so the
 * count read "1" for a coin nobody holds. When every wallet the count found is the coin's own curve or trading pool (holders.ts
 * poolOwnerLabels), the row says "No holders yet". With no count read it says "Not read yet", never a "?" on its own.
 */
export const POOL_HOLDER_LABELS: readonly string[] = ["bonding curve", "trading pool"];
export const NO_HOLDERS = "No holders yet";
export const NO_HOLDERS_WHY = "The only wallet holding this coin is its own bonding curve or trading pool.";
export const HOLDERS_NOT_READ = "Not read yet";
/**
 * Whether every holder counted is the coin's own curve or pool: a count of 0, or a count no larger than the labelled pool rows.
 * Review L7 (accepted): the labels come from holders.ts poolOwnerLabels, which knows only this cluster's LaunchLab and CPMM programs. A
 * curve held under a program it does not know carries no label, so such a coin shows its count ("1") rather than "No holders yet".
 */
export function onlyPoolHolders(count: number | null | undefined, top: readonly { label: string | null }[] | null | undefined): boolean {
  if (typeof count !== "number") return false;
  if (count <= 0) return true;
  const pools = (top ?? []).filter((r) => r.label !== null && POOL_HOLDER_LABELS.includes(r.label)).length;
  return pools > 0 && count <= pools;
}
/** B-6: the holder count a card shows: the wallets (program accounts left out) when read, else the raw count, else null. */
export const walletHolders = (h: { count: number | null; wallets?: number | null } | null | undefined): number | null => (h ? (typeof h.wallets === "number" ? h.wallets : h.count) : null);
export function holdersCell(count: number | null | undefined, onlyPools: boolean, note: string | null): CardCell {
  if (typeof count === "number" && onlyPools) return { text: NO_HOLDERS, why: NO_HOLDERS_WHY };
  if (typeof count === "number") return { text: groupDigits(count), why: null };
  return { text: null, why: note || NOT_READ.holders };
}

/** Walkthrough 13: a card whose next time is only the keeper's next read of the source (not a market close) says so. */
export const NEXT_WHEN_PUBLISHED = "When published";
export const nextCheckWhy = (day: string): string => `The publisher decides when the next result is out. This site next reads the source on ${day}.`;

/** website-17 item 2: what the rank line under "Burned" means (hover text). A rank is a line on a scoreboard and nothing more. */
export const RANK_MEANING = "The coin's place on the scoreboard by confirmed receipts, read from the coin registry. A rank pays nothing and unlocks nothing.";

/**
 * ONE RANK LINE FOR A GRID (coin card status 2026-10-18, the owner's UX walkthrough): "No receipts yet, so it has no rank on this site."
 * printed under every card said the same thing a dozen times. A grid prints the no-rank line once above the cards, and a card keeps its
 * own line only when it differs (a ranked coin, or a coin on another season's board). When every card shares it the line above says so
 * for all of them; when only some do, it says what a coin with no receipt means, and the cards that differ carry their own line.
 */
const NO_RANK = /^No receipts yet, so it has no rank (on this site|in .+)\.$/;
export function rankLayout(lines: readonly (string | null | undefined)[]): { shared: string | null; perCard: (string | null)[] } {
  const all = lines.map((l) => l ?? null);
  const counts = new Map<string, number>();
  for (const l of all) if (l && NO_RANK.test(l)) counts.set(l, (counts.get(l) ?? 0) + 1);
  const [common, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  if (!common || n < 2) return { shared: null, perCard: all };
  const where = NO_RANK.exec(common)![1];
  // review L5: a card whose rank was not read (null) is not counted as sharing the line, so "No coin here" needs every card to say it
  const every = all.every((l) => l === common);
  return { shared: every ? `No coin here has a receipt yet, so none has a rank ${where}.` : `A coin with no receipt yet has no rank ${where}.`, perCard: all.map((l) => (l === common ? null : l)) };
}

/** A graduated coin's market cap, read from its Raydium pool (indexer-1): the card's hover text and the coin page's note. */
export const MCAP_POOL_MEANING = "The Raydium pool's SOL reserve divided by its token reserve, times the current supply, read on chain.";

/** Follow-up 2026-10-18: the button after a curve line whose raise was not read ("35.7 raised  Raise not read"), in words, never a "?". */
export const RAISE_NOT_READ = "Raise not read";
/** The curve row's words: "35.7 / 85 SOL raised"; "— raised" when the raise was not read (never a typed 85). */
export const curveLine = (c: CardView["curve"]): string => (c.na ? "Not applicable" : c.of === null ? `${c.raised ?? "—"} raised` : `${c.raised ?? "—"} / ${c.of} raised`);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Oct 6" from an ISO date or time (UTC calendar day). */
export function shortDay(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso);
  return Number.isFinite(d.getTime()) ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` : null;
}
/** "Oct 11, 2026" from an ISO date or time (UTC calendar day). */
export function longDay(iso: string | null): string | null {
  const s = shortDay(iso);
  return s && iso ? `${s}, ${iso.slice(0, 4)}` : null;
}

/** "4,010,874.87" from a decimal string or number (two decimals at most). */
export function groupDigits(v: string | number): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  const [i, f] = (Math.round(n * 100) / 100).toFixed(2).split(".");
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const dec = f.replace(/0+$/, "");
  return dec ? `${int}.${dec}` : int;
}

/** A share of supply in words: "0.8% of supply", "under 0.01% of supply". */
export function pctOfSupply(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return "0% of supply";
  if (pct < 0.01) return "under 0.01% of supply";
  const shown = pct < 1 ? pct.toFixed(2).replace(/0$/, "") : groupDigits(pct);
  return `${shown}% of supply`;
}

/**
 * The age of a coin from its creation time: "3 days", "5 hours", "under an hour"; a record that gives only a day counts whole days in the
 * viewer's own time zone. Past records only; nothing counts down. ONE function for the app and the static home (cardAge.mjs; ChatGPT
 * audit 6 item 23, audit 7 item 23).
 */
export const ageText = (iso: string | null, now: number): string | null => cardAge(iso, now);

/**
 * WHAT AN EMPTY FIELD SAYS (ChatGPT audit 6 item 23): never a bare "—". A coin that does not exist yet says "Not created yet"; a field
 * with no reading says "No data yet"; a field that cannot apply says "Not applicable"; a rule with no scheduled result says "None
 * scheduled". The reason stays behind the same tap-or-focus control (Why.tsx, the static page's btWhy).
 */
export const EMPTY_LABEL = { notCreated: "Not created yet", noData: "No data yet", notApplicable: "Not applicable", noneScheduled: "None scheduled" } as const;
/** Whether a card is a coin that does not exist yet (the "Not created yet" or "Not launched" badge). */
export const isNotCreated = (v: Pick<CardView, "tags">): boolean => v.tags.some((t) => t.label === "Not created yet" || t.label === "Not launched");
export function emptyLabel(v: Pick<CardView, "tags">, why: string | null): string {
  if (isNotCreated(v)) return EMPTY_LABEL.notCreated;
  const w = why ?? "";
  if (/does not apply|not applicable|never had/i.test(w)) return EMPTY_LABEL.notApplicable;
  if (/no scheduled result|no result is scheduled/i.test(w)) return EMPTY_LABEL.noneScheduled;
  return EMPTY_LABEL.noData;
}
/**
 * WHAT AN EMPTY CARD ROW SAYS (coin card status follow-up, 2026-10-18): a value this site did not read says "Not read yet" on every
 * card row, and no row prints a "?" after its label (the reason stays behind the label's own button). The other labels ("Not created
 * yet", "Not applicable", "None scheduled") are as emptyLabel gives them.
 */
export const NOT_READ_YET = HOLDERS_NOT_READ;
export function cardEmptyLabel(v: Pick<CardView, "tags">, why: string | null): string {
  const l = emptyLabel(v, why);
  return l === EMPTY_LABEL.noData ? NOT_READ_YET : l;
}
/** The holders row with no count: "Not read yet", or the label the coin's state calls for. */
export function holdersEmptyLabel(v: Pick<CardView, "tags" | "holders">): string { return cardEmptyLabel(v, v.holders.why); }
/** The rows that can be empty, by key; the API sends these labels with each card so the static page prints the same words. */
export const EMPTY_ROWS = ["progress", "nextSettle", "curve", "mcap", "holders", "age", "burned"] as const;
export function emptyLabels(v: CardView): Record<(typeof EMPTY_ROWS)[number], string> {
  return {
    progress: cardEmptyLabel(v, v.progressWhy), nextSettle: cardEmptyLabel(v, v.nextSettle.why), curve: cardEmptyLabel(v, v.curve.why), mcap: cardEmptyLabel(v, v.mcap.why),
    holders: holdersEmptyLabel(v), age: cardEmptyLabel(v, v.createdWhy), burned: cardEmptyLabel(v, v.burned.why),
  };
}

/**
 * A market cap read from the curve, before graduation, is the curve's current SOL per token times the whole supply, which can look large
 * beside a small raise (28 SOL beside 0.1 SOL raised). It carries its basis in words (coin card status 2026-10-18, the owner's UX
 * walkthrough; it said "(curve-implied)" before): "28 SOL from the curve". After graduation it is the pool's number and carries no words.
 * A curve nobody has traded on (0 raised) has no figure at all: the curve's opening ratio times the supply is not a market, so the row
 * says "No trades yet" and shows no SOL figure.
 */
export const CURVE_BASIS = "from the curve";
export const NO_TRADES = "No trades yet";
export const NO_TRADES_WHY = "Nobody has traded on this coin's curve yet, so there is no figure to show.";
/**
 * Third prelaunch audit 2026-10-19 B-6: an untraded LaunchLab curve reads 1 lamport raised ("0.000000001"), not 0, so the card showed a
 * 28 SOL market cap on coins nobody had traded. Below NO_TRADE_DUST_SOL raised, the curve counts as untraded.
 */
export const NO_TRADE_DUST_SOL = 0.001;
/** Whether the coin is still on its curve and the curve was read at nothing raised (below NO_TRADE_DUST_SOL). */
export const noTradesYet = (phase: IndexCoin["phase"] | undefined, raised: string | null | undefined): boolean =>
  phase !== "graduated" && phase !== "migrating" && raised !== null && raised !== undefined && raised.trim() !== "" && Number.isFinite(Number(raised)) && Number(raised) < NO_TRADE_DUST_SOL;
export function mcapText(value: string, quote: string | null | undefined, phase: IndexCoin["phase"] | undefined, raised: string | null = null): string {
  if (noTradesYet(phase, raised)) return NO_TRADES;
  return `${groupDigits(value)} ${quote ?? "SOL"}${phase === "graduated" ? "" : ` ${CURVE_BASIS}`}`;
}
/** The market cap row: "No trades yet" on an untraded curve, the figure with its basis once there is a trade, or "—" with the reason. */
export function mcapCell(c: { cap: string | null | undefined; quote?: string | null; phase?: IndexCoin["phase"]; raised?: string | null }, notRead: string = NOT_READ.mcapNotRead, poolNote: string | null = null): CardCell {
  if (noTradesYet(c.phase, c.raised)) return { text: NO_TRADES, why: NO_TRADES_WHY };
  if (c.cap) return { text: mcapText(c.cap, c.quote, c.phase, c.raised ?? null), why: c.phase === "graduated" ? MCAP_POOL_MEANING : CARD_MEANINGS.mcap };
  return { text: null, why: c.phase === "graduated" ? poolNote || NOT_READ.mcapPool : notRead };
}

const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
/**
 * The sentence above the featured cards, counted from the cards actually shown (ChatGPT audit 6 item 22: the page said "two disclosed
 * test coins" while a mainnet host showed one). Null when no card is shown.
 */
/**
 * Continuous audit run 2, HB-17: the featured group's heading. It names test receipts only once the home data shows a test coin in the
 * group; while loading, on error, or on a host with no test coin (mainnet) it is "Featured coin", never a word about tests.
 */
export const FEATURED_HEADING = "Featured coin";
export const FEATURED_TEST_HEADING = "Featured coin and test receipts";
export function featuredHeading(testCards: readonly unknown[] | null | undefined): string {
  return testCards && testCards.length > 0 ? FEATURED_TEST_HEADING : FEATURED_HEADING;
}
export function featuredLine(cards: readonly Pick<CardView, "id" | "tags">[]): string | null {
  if (!cards.length) return null;
  const deficit = cards.some((c) => c.id === "deficit");
  const tests = cards.filter((c) => c.id !== "deficit");
  const n = tests.length;
  const word = COUNT_WORDS[n] ?? String(n);
  const testPart = `${word} disclosed test coin${n === 1 ? "" : "s"}`;
  const lead = deficit ? (n ? `These are $DEFICIT, the operator's first coin, and ${testPart}.` : "This is $DEFICIT, the operator's first coin.")
    : `${n === 1 ? "This is" : "These are"} ${testPart}.`;
  const devnet = tests.some((c) => c.tags.some((t) => t.tone === "devnet"));
  return devnet ? `${lead} The devnet card is a practice run on a test network where tokens have no money value.` : lead;
}

/** What the coins index (GET /api/burnticker/tokens) says about one registered coin. */
export interface IndexCoin {
  ticker: string; name: string; mint: string; oneLiner: string; status: string; imageUrl: string | null; burned: string; burns: number;
  /** website-15 item 13 */ creatorText?: string | null; links?: { label: string; url: string }[];
  nextCheckAt: string | null; nextCloseTime: string | null; lastBurnAt: string | null; launchedAt: string | null; pairId: string | null; badge?: string | null;
  phase: "curve" | "migrating" | "graduated" | null; progressPct: number | null;
  /** website-14: where the coin stands (readiness.ts), computed by the API from its status and receipts; absent when not read */
  readiness?: Readiness | null;
  raised?: string | null; threshold?: string | null; quote?: string | null; pctOfSupply?: number; marketCap?: string | null; holders?: number | null;
  /** indexer-1: why the holder count or the graduated pool was not read (status.json market.holders.countNote, market.poolNote) */
  holdersNote?: string | null; poolNote?: string | null;
  /** coin card status 2026-10-18: every wallet the count found is the coin's own bonding curve or trading pool (onlyPoolHolders) */
  holdersOnlyPools?: boolean;
  /** sources-2: a one-market Polymarket coin's stated source and dispute window */
  stated?: StatedJson | null;
  /** website-17 item 2: the coin's line on the scoreboard (coinRank.ts), when the serving route read it */
  rank?: string | null;
  /** coin card status 2026-10-18: the facts the status sentence is built from (coinStatus.ts coinStatusFactsOf), when the route read them */
  statusFacts?: CoinStatusFacts | null;
  /** owner 2026-10-19: the coin's group on the Coins page, its result and its next-result facts (coinsList.ts), when the route built them */
  listing?: CoinListing | null;
}

/** "14.81" from a decimal string, two places at most. */
const two = (s: string) => groupDigits(s);

/** The progress row for a coin: raised of the raise, from the curve when read, else "—" of the configured raise. */
export function curveCell(c: { phase: IndexCoin["phase"]; progressPct: number | null; raised?: string | null; threshold?: string | null; quote?: string | null }, raiseSol: string | null, notRead: string = NOT_READ.curveNotRead): CardView["curve"] {
  const quote = c.quote ?? "SOL";
  const raise = c.threshold ?? raiseSol;
  const of = raise === null ? null : `${two(raise)} ${quote}`;
  if (c.phase === "graduated") return { raised: raise === null ? null : two(raise), of, pct: 100, done: true, why: "The curve is complete, and the coin trades in its own Raydium pool." };
  const pct = c.progressPct === null ? null : Math.max(0, Math.min(100, c.progressPct));
  if (c.raised === null || c.raised === undefined || pct === null) return { raised: null, of, pct: null, done: false, why: notRead };
  return { raised: two(c.raised), of, pct, done: false, why: c.phase === "migrating" ? "The curve is full, and the coin is moving to its Raydium pool." : null };
}

/**
 * A registered coin as a card: the same rows as the featured cards, read from the index. `raiseSol` is a raise the caller read from the
 * coin's pool (null otherwise; never a configured constant). `shared`: whether its ticker is shared, or the set from coinKey.ts
 * sharedTickers; a coin on a shared ticker links by its mint (owner 2026-10-12: tickers are not unique).
 */
export function cardViewFromIndex(t: IndexCoin, raiseSol: string | null, cluster = "mainnet", shared: boolean | ReadonlySet<string> = false): CardView {
  const page = coinPageHref(t, shared);
  const next = t.nextCloseTime ?? t.nextCheckAt;
  const tags: CardTag[] = [];
  if (cluster !== "mainnet") tags.push({ label: cluster === "devnet" ? "Devnet" : cluster, tone: "devnet" });
  if (t.phase === "graduated") tags.push({ label: "Trading pool", tone: "grad" });
  if (t.status === "draft") tags.push({ label: "Not launched", tone: "neutral" });
  if (t.pairId) tags.push({ label: "Pair", tone: "neutral" });
  if (t.badge) tags.push({ label: t.badge, tone: "neutral" });
  const curve = curveCell(t, raiseSol);
  const mcap: CardCell = mcapCell({ cap: t.marketCap, quote: t.quote, phase: t.phase, raised: t.raised }, NOT_READ.mcapNotRead, t.poolNote ?? null);
  const pct = typeof t.pctOfSupply === "number" ? t.pctOfSupply : null;
  return {
    id: t.mint, watchKey: coinWatchKey(cluster, t.mint), ticker: t.ticker, name: t.name, imageUrl: t.imageUrl, group: cluster === "mainnet" && t.status !== "draft" ? "public" : "test", tags, note: null,
    rule: t.oneLiner.replace(/^./, (c) => c.toUpperCase()), creatorText: t.creatorText ?? null, links: t.links ?? [],
    stated: t.stated ? statedSentences(t.stated, t.stated.finalAfter) : null,
    rank: t.rank ?? null,
    status: t.statusFacts ? coinStatusSentence(t.statusFacts) : null,
    progress: t.readiness ? progressOf(t.readiness, { raiseSol: t.threshold ? Number(t.threshold) : null, raisedSol: t.raised ? Number(t.raised) : null }) : null,
    progressWhy: t.readiness ? null : "This site did not read where this coin stands.",
    // walkthrough 13 (private review 10's "Next result" item, on the card too): a market close is the result's time; a keeper check is not
    nextSettle: t.nextCloseTime ? { text: `${shortDay(t.nextCloseTime)}`, why: null } : next ? { text: NEXT_WHEN_PUBLISHED, why: nextCheckWhy(shortDay(next) ?? next.slice(0, 10)) } : { text: null, why: NOT_READ.nextNone },
    curve, mcap,
    holders: holdersCell(t.holders, t.holdersOnlyPools ?? false, t.holdersNote ?? null),
    createdAt: t.launchedAt, createdWhy: t.launchedAt ? null : "This coin is not launched yet.",
    burned: { text: `${groupDigits(t.burned)} $${t.ticker}${pct === null ? "" : `, ${pctOfSupply(pct)}`}`, why: t.burns > 0 ? `${t.burns} burn${t.burns === 1 ? "" : "s"} so far.` : "No burn has confirmed yet." },
    mint: null,
    href: page,
    trade: coinLinks({ cluster, mint: t.mint, phase: t.phase, status: t.status }),
    receipt: t.burns > 0 ? { href: `${page}#receipts` } : null,
    receiptWhy: t.burns > 0 ? null : "This coin has no receipt yet.",
  };
}

/**
 * THE ONE NUMBER THE CARD KEEPS IN VIEW (coin card status 2026-10-18): the rest of the rows sit behind the card's "Details" expander.
 * A coin that has burned shows what it burned; a coin on its curve shows how far the curve has filled; a coin past its curve shows its
 * market cap, then its holders. Null when none of these was read. The label is the row's own data label.
 */
export function headlineStat(v: Pick<CardView, "receipt" | "burned" | "curve" | "mcap" | "holders">): { key: "burned" | "curve" | "mcap" | "holders"; label: string; text: string } | null {
  if (v.receipt && v.burned.text) return { key: "burned", label: CARD_LABELS.burned, text: v.burned.text };
  if (!v.curve.na && !v.curve.done && v.curve.raised !== null) return { key: "curve", label: CARD_LABELS.curve, text: curveLine(v.curve) };
  if (v.mcap.text) return { key: "mcap", label: CARD_LABELS.mcap, text: v.mcap.text };
  if (v.holders.text) return { key: "holders", label: CARD_LABELS.holders, text: v.holders.text };
  return null;
}

/** The initials a coin without an image shows, on a receipt-style tile: "$DEFICIT" → "DE". */
export const initialsOf = (ticker: string): string => (ticker.replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || "?").toUpperCase();
