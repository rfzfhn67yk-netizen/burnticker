import fs from "node:fs";
import path from "node:path";
import { deficitPrelaunch } from "@/lib/burnticker/deficitPrelaunch";
import { sampleReceipts, type SampleList } from "@/lib/burnticker/trustpack/samples";
import { loadTransparency } from "@/lib/burnticker/trust";
import { deficitHref } from "@/lib/burnticker/creatorLaunches";
import { checkReceiptHref } from "@/lib/burnticker/coinPage";
import type { SiteLaunchState } from "@/lib/burnticker/launchAvailability";
import { STATUS_SENTENCES, coinStatusSentence, readingSentence, type CoinStatusFacts } from "@/lib/burnticker/coinStatus";
import { CARD_MEANINGS, NOT_READ, curveCell, emptyLabels, featuredLine, groupDigits, headlineStat, holdersCell, longDay, mcapCell, pctOfSupply, shortDay, type CardCell, type CardView, type IndexCoin } from "@/lib/burnticker/cardView";
import { sortEvents, eventsFromKeeper, type ActivityEvent } from "@/lib/burnticker/activity";
import { deficitQueue, type DeficitQueue, type KeeperFiles } from "@/lib/burnticker/deficitQueue";
import { readinessOf, type Readiness } from "@/lib/burnticker/readiness";
import { progressOf } from "@/lib/burnticker/progress";
import { RAISE_PRESETS_SOL } from "@/lib/burnticker/launchPresets";
import { upcomingNotice, upcomingSet, type UpcomingSet } from "@/lib/burnticker/upcoming";
import { coinWatchKey } from "@/lib/burnticker/watchlist";
import { REHEARSAL_SENTENCE } from "@/lib/burnticker/rehearsalCopy";
import { historyCounts } from "@/lib/burnticker/history";
import { historyCountsLine } from "@/lib/burnticker/historyCopy";
import type { FeaturedSlot } from "@/lib/burnticker/featuredSlots";
import { publicHomeData, siteCluster } from "@/lib/burnticker/devnetHide";
import { coinPageHref, sharedTickers } from "@/lib/burnticker/coinKey";
import { coinLinks } from "@/lib/burnticker/tradeLinks";
import { isTestCoin, testCoinKeys, type TestCoinKeys } from "@/lib/burnticker/testCoins";
export { REHEARSAL_SENTENCE } from "@/lib/burnticker/rehearsalCopy";

/**
 * THE HOME PAGE'S DATA (website-10, 2026-10-12; evidence defects fixed by website-13 the same day, Codex review 5 F3 and F4). Read from
 * files, the coin registry and the keeper's published state, never typed here:
 *
 *   featured   the cards that lead the grid, in a fixed order: $DEFICIT (the operator's first coin), $REHEARSAL (the disclosed mainnet
 *              rehearsal coin) and the devnet rehearsal coin. Once $DEFICIT is created, its card MERGES the registry's live state (burns,
 *              share of supply, latest receipt, curve) and says "Unavailable" when that state cannot be read, never "nothing burned".
 *   events     the activity line under the header: confirmed burns only, newest first, each linking ITS OWN receipt check (its signature
 *              and network), never the featured demo receipt.
 *   stats      the platform strip: total burned, burns and receipts the public audit checked, as numbers ("0", not words).
 *   status     the one-line current status, from config/burnticker/current-status.json; the full record stays on the Trust page.
 *
 * GET /api/burnticker/home serves all of it; the app's home and the static landing page render the same answer.
 */

export type { ActivityEvent } from "@/lib/burnticker/activity";
export interface HomeStats {
  burnedTokens: string; burns: number; receiptsVerified: number | null; receiptsWhy: string | null;
  /** B-5 (third audit 2026-10-19): the receipts the audit recomputed; receiptsVerified counts only those the chain check verified */
  receiptsRecorded?: number | null;
  /** website-15 item 15: the devnet practice burns, shown with a "(devnet)" mark while mainnet has no burn; null when none were read */
  devnet?: { burns: number; burnedTokens: string } | null;
}
export interface HomeData {
  schema: "burnticker.home/v1"; generatedAt: string; featured: CardView[]; events: ActivityEvent[]; noEvents: string;
  /** The raises a creator may choose (40, 60 or 85 SOL; LAUNCHPAD-PATH §75). A coin's own raise is read from its pool, never from here. */
  raisePresetsSol: readonly string[];
  /** The $DEFICIT queued-units counter (deficitQueue.ts), from the keeper's published files; state "unavailable" when they were not read. */
  deficitQueue: DeficitQueue;
  /**
   * The next result each coin waits for (upcoming.ts upcomingSet): the rows read, the coins that could not be read, and ready, partial or
   * unavailable. An unread registry is "unavailable", never an empty list (website-15, code review 6 P2 2).
   */
  upcoming: UpcomingSet;
  stats: HomeStats | null;
  /** The one-line status: the phase and governance facts, then the site launch record's one sentence. */
  statusLine: string | null;
  /** website-12's site launch record (launchAvailability.ts siteLaunchState), for the static pages' launch dialog; null when not passed. */
  launch: SiteLaunchState | null;
  /** website-17 item 3: the earned featured slots in rule order (featuredSlots.ts), set by the home route; null when the registry was not read */
  featuredSlots?: FeaturedSlot[] | null;
  /** ChatGPT audit 6 item 22: the sentence above the featured cards, counted from the cards served (cardView.ts featuredLine) */
  featuredLine?: string | null;
  /** ChatGPT audit 6 item 22: the next-results sentence, knowing how many coins the page lists (upcoming.ts upcomingNotice); null when the rows say it all */
  nextNotice?: string | null;
}

/** One registered coin as the home route read it: the index card fields plus its newest confirmed receipt. `readOk` false = its page failed. */
export interface HomeCoin extends Pick<IndexCoin, "ticker" | "burns" | "lastBurnAt"> {
  mint?: string; burned?: string; pctOfSupply?: number; launchedAt?: string | null; phase?: IndexCoin["phase"]; progressPct?: number | null;
  raised?: string | null; threshold?: string | null; quote?: string | null; marketCap?: string | null; holders?: number | null;
  /** coin card status 2026-10-18: every holder counted is the coin's own curve or pool (cardView.ts onlyPoolHolders) */
  holdersOnlyPools?: boolean;
  /** coin card status 2026-10-18: the facts behind the card's status sentence (coinStatus.ts) */
  statusFacts?: CoinStatusFacts | null;
  cluster?: string; latestSignature?: string | null; readOk?: boolean;
  /** website-14: the coin's own activity rows (activity.ts eventsFromStatus) and where it stands (readiness.ts) */
  events?: ActivityEvent[]; readiness?: Readiness | null;
  /** website-17 item 2: the coin's rank line (coinRank.ts rankLines); null when not read */
  rank?: string | null;
}

/**
 * HS-5 (continuous audit 2026-10-19): the "Follow the season" sentence on the home page. "3 team coins are on the scoreboards of 25
 * leagues" read as if three coins spanned 25 leagues; the counts are now said apart: how many team coins there are and which leagues
 * they are in, then how many leagues have a scoreboard. Every number comes from the leagues index (leagues.ts leagueIndex), never typed.
 */
export interface SeasonsCounts { teamCoins: number; leagues: number; /** the labels of the leagues that hold at least one team coin */ coinLeagues: readonly string[] }
const ARTICLE_LESS = /^(La Liga|Serie A|Ligue 1|Liga MX|Brasileir|College |NCAA )/;
/** A league's label in a sentence: "the NFL", "the Premier League", "La Liga", "college football". */
export const leagueInSentence = (label: string): string => (/^College /.test(label) ? label.toLowerCase() : ARTICLE_LESS.test(label) ? label : `the ${label}`);
export function seasonsStripLine(s: SeasonsCounts): string {
  if (s.teamCoins === 0) return `No team coin has launched yet, so all ${s.leagues} league scoreboards are empty. Each one fills in from its coins' own receipts.`;
  const n = s.teamCoins, coins = `${n} team coin${n === 1 ? "" : "s"} so far`;
  const names = s.coinLeagues.map(leagueInSentence);
  const where = names.length === 1 ? (n === 1 ? `, in ${names[0]}` : `, all in ${names[0]}`) : names.length === 2 ? `, in ${names[0]} and ${names[1]}` : names.length > 2 ? `, across ${names.length} leagues` : "";
  return `${coins}${where}. Scoreboards are ready for ${s.leagues} league${s.leagues === 1 ? "" : "s"}.`;
}

export const NO_EVENTS_LINE = "Nothing has happened on chain yet. Burns, signed readings, graduations and pool registrations appear here once they are recorded.";
export const UNAVAILABLE = "Unavailable";
const OWN_TOKENS = path.join("config", "own-tokens.json");
/** Whether config/own-tokens.json marks $DEFICIT launched (the owner flips it on launch day). False when the file cannot be read. */
export function deficitCreated(root = process.cwd()): boolean {
  try { return (JSON.parse(fs.readFileSync(path.join(root, OWN_TOKENS), "utf8")) as { tokens: { symbol: string; status: string }[] }).tokens.some((t) => t.symbol === "DEFICIT" && t.status === "launched"); }
  catch { return false; }
}
/** $DEFICIT's mint once config/own-tokens.json marks it launched (the trade link's address); null before the create or when unreadable. */
export function deficitMint(root = process.cwd()): string | null {
  try { const t = (JSON.parse(fs.readFileSync(path.join(root, OWN_TOKENS), "utf8")) as { tokens: { symbol: string; status: string; address: string | null }[] }).tokens.find((x) => x.symbol === "DEFICIT"); return t?.status === "launched" && t.address ? t.address : null; }
  catch { return null; }
}
const REHEARSAL_RULES = path.join("config", "burnkeeper", "rehearsal.rules.json");
/** The mainnet rehearsal's evidence file (its LaunchLab create: pool id and signature). */
export const REHEARSAL_EVIDENCE = path.join("docs", "burnkeeper", "evidence", "mainnet-rehearsal-2026-10-11", "rehearsal.json");
/** The rehearsal's LaunchLab create from its evidence file: the pool, the create signature and the day. Null when the file is unreadable. */
export function rehearsalCreate(root = process.cwd()): { mint: string; poolId: string; signature: string; date: string } | null {
  try {
    const e = JSON.parse(fs.readFileSync(path.join(root, REHEARSAL_EVIDENCE), "utf8")) as { date: string; mint: string; steps: { step: string; poolId?: string; signature?: string }[] };
    const c = e.steps.find((x) => x.step === "launchlab create");
    return c?.poolId && c.signature ? { mint: e.mint, poolId: c.poolId, signature: c.signature, date: e.date } : null;
  } catch { return null; }
}
/** The rehearsal's curve as the home route read it from its LaunchLab pool (market.ts readKeeperCurve); null when not read. */
export type RehearsalCurve = { phase: "curve" | "migrating" | "graduated"; raised: string; threshold: string; quote: string; progressPct: number; marketCap?: string | null } | null;
const DEVNET_RULES = path.join("config", "burnkeeper", "deficit.devnet.rules.json");
const STATUS_FILE = path.join("config", "burnticker", "current-status.json");

interface DebtRulesFile { buyback: { fractionPerUnit: string }; rule: { unitUsd: string }; totalSupply: string }
const rulesOf = (root: string, rel: string): DebtRulesFile => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")) as DebtRulesFile;
/** A debt rules file's dial in words: "2%" of the pool per "$1B". */
function dialOf(r: DebtRulesFile): { percent: string; unitLabel: string } {
  return { percent: `${Number(r.buyback.fractionPerUnit) * 100}%`, unitLabel: `$${Number(r.rule.unitUsd) / 1e9}B` };
}

/** The amount a receipt's memo says was burned ("…|burn=4010874.872446|…"), or null. */
export const memoBurn = (memo: string): number | null => { const m = /\|burn=([\d.]+)\|/.exec(memo); return m ? Number(m[1]) : null; };

const debtRule = (percent: string, unitLabel: string) => `Spends ${percent} of its burn pool for each ${unitLabel} the U.S. national debt rises, and burns what it gets.`;
const DEBT_NEXT: CardCell = { text: "Each business day", why: "The rule reads the Treasury's debt figure after it is posted each business day, in New York time." };
const cell = (text: string | null, why: string | null): CardCell => ({ text, why });

const REHEARSAL_UNREAD = "This site could not read $REHEARSAL's pool just now.";
/** A curve with no raise read: "— raised", and the reason. Never a typed 85 (LAUNCHPAD-PATH §75). */
const noCurve = (why: string): CardView["curve"] => ({ raised: null, of: null, pct: null, done: false, why });
/** The keeper's status.json, when it is the live schema. */
type KeeperStatus = { schema?: string; burned?: { total: string; pctOfSupply: number; count: number }; curve?: { phase: "curve" | "migrating" | "graduated"; raised: string; threshold: string; quote: string; progressPct: number; marketCap?: string | null } | null; readiness?: Readiness; addresses?: { mint: string | null } };
const keeperLive = (k: KeeperFiles | null): KeeperStatus | null => { const s = k?.status as KeeperStatus | null | undefined; return s && s.schema === "burnkeeper.status/v1" ? s : null; };

export function featuredCoins(root = process.cwd(), samples: SampleList | null = null, coins: readonly HomeCoin[] | null = [], keeper: KeeperFiles | null = null, now = Date.now(), rehearsalCurve: RehearsalCurve = null): CardView[] {
  const out: CardView[] = [];
  const own = JSON.parse(fs.readFileSync(path.join(root, OWN_TOKENS), "utf8")) as { tokens: { symbol: string; address: string | null; status: string }[] };
  const d = deficitPrelaunch(root);
  const deficit = own.tokens.find((t) => t.symbol === "DEFICIT");
  const created = deficit?.status === "launched";
  // F4: after the create, the registered coin's own state; `coins === null` means the registry could not be read at all
  const live = created && coins ? coins.find((c) => c.ticker === "DEFICIT" || (!!deficit?.address && c.mint === deficit.address)) ?? null : null;
  const readable = !!live && live.readOk !== false;
  // website-14: until $DEFICIT is registered here, its own keeper's published files (status.json, burns.json) are its state
  const ks = created && !readable ? keeperLive(keeper) : null;
  const queue = deficitQueue(keeper, now);
  const unreadWhy = coins === null ? "This site could not read the coin registry just now." : !live ? "$DEFICIT is not registered on this site yet, and its keeper's files could not be read here." : "This site could not read $DEFICIT's page just now.";
  const queuedCell = (): CardCell | null => (queue.card ? cell(queue.card, queue.headline) : null);
  const burned: CardCell = !created ? cell(null, "The coin is not created yet, so nothing can have burned.")
    : readable ? (live!.burns === 0 && queuedCell()) || cell(`${groupDigits(live!.burned ?? "0")} $DEFICIT${typeof live!.pctOfSupply === "number" ? `, ${pctOfSupply(live!.pctOfSupply)}` : ""}`, live!.burns > 0 ? `${live!.burns} burn${live!.burns === 1 ? "" : "s"} so far.` : "No burn has confirmed yet.")
    // website-15 (code review 6, P2 1): the keeper's burn list unread or the wrong shape is unavailable, never "0 burned"
    : ks && queue.state === "unavailable" ? cell(UNAVAILABLE, queue.headline)
    : ks?.burned ? (ks.burned.count === 0 && queuedCell()) || cell(`${groupDigits(ks.burned.total)} $DEFICIT, ${pctOfSupply(ks.burned.pctOfSupply)}`, ks.burned.count > 0 ? `${ks.burned.count} burn${ks.burned.count === 1 ? "" : "s"} so far, from the keeper's published files.` : "No burn has confirmed yet.")
    : cell(UNAVAILABLE, unreadWhy);
  const keeperBurns = ks ? ((Array.isArray(keeper?.burns) ? keeper!.burns : (keeper?.burns as { burns?: unknown[] } | null)?.burns ?? []) as { status?: string; signature?: string | null; recordDate?: string }[]) : [];
  const keeperSig = keeperBurns.filter((b) => b.status === "confirmed" && b.signature).sort((a, b) => String(b.recordDate).localeCompare(String(a.recordDate)))[0]?.signature ?? null;
  const sig = readable ? live!.latestSignature ?? null : keeperSig;
  const kc = ks?.curve ?? null;
  const readiness: Readiness | null = !created ? readinessOf({ launched: false, phase: null, raisedSol: null, poolVerified: null, latest: null }) : readable ? live!.readiness ?? null : ks?.readiness ?? null;
  const raiseNum = readable ? Number(live!.threshold) : kc ? Number(kc.threshold) : NaN;
  const raisedNum = readable ? Number(live!.raised) : kc ? Number(kc.raised) : NaN;
  out.push({
    id: "deficit", watchKey: coinWatchKey("mainnet", deficit?.address ?? null), ticker: "DEFICIT", name: "Deficit", imageUrl: "/burnticker/brand/deficit.png", group: "test",
    tags: [{ label: "Featured", tone: "featured" }, ...(created ? [] : [{ label: "Not created yet", tone: "neutral" as const }])],
    note: created ? "The operator's first coin. Say it like DeFi-cit. Trading fees buy back and burn $DEFICIT when the Treasury reports a qualifying rise in debt. Its rules were locked before it was created." : "The operator's first coin. Say it like DeFi-cit. Trading fees buy back and burn $DEFICIT when the Treasury reports a qualifying rise in debt. Its rules are locked, and the coin is not created yet.",
    rule: debtRule(d.dial.percent, d.dial.unitLabel), nextSettle: DEBT_NEXT,
    status: !created ? STATUS_SENTENCES.notCreated : readable && live!.statusFacts ? coinStatusSentence(live!.statusFacts)
      // review L1: $DEFICIT burns only on a reading that shows a rise in the debt; on its curve it waits for the curve too
      : readingSentence("up", (readable ? live!.phase ?? null : kc?.phase ?? null) === "curve"),
    progress: readiness ? progressOf(readiness, { raiseSol: Number.isFinite(raiseNum) && raiseNum > 0 ? raiseNum : null, raisedSol: Number.isFinite(raisedNum) ? raisedNum : null, queuedUnits: queue.state === "queued" ? queue.units : null }) : null,
    progressWhy: readiness ? null : unreadWhy,
    curve: !created ? noCurve("There is no curve until the coin is created. Its raise is read from its pool once it exists.")
      : readable ? curveCell({ phase: live!.phase ?? null, progressPct: live!.progressPct ?? null, raised: live!.raised, threshold: live!.threshold, quote: live!.quote }, null)
      : kc ? curveCell({ phase: kc.phase, progressPct: kc.progressPct, raised: kc.raised, threshold: kc.threshold, quote: kc.quote }, null)
      : noCurve(ks ? "The keeper's files do not carry a curve reading yet." : unreadWhy),
    // walkthrough 13: before $DEFICIT is registered here, its keeper's curve reading carries the market cap (the coin page showed it, the card did not)
    // coin card status 2026-10-18: an untraded curve says "No trades yet"; a traded one gives the figure with its basis (cardView.ts mcapCell)
    mcap: !created ? cell(null, "The coin is not created yet.") : readable ? mcapCell({ cap: live!.marketCap, quote: live!.quote, phase: live!.phase ?? null, raised: live!.raised ?? null })
      : kc ? mcapCell({ cap: kc.marketCap, quote: kc.quote, phase: kc.phase, raised: kc.raised }) : cell(null, ks ? NOT_READ.mcapNotRead : unreadWhy),
    holders: !created ? cell(null, "The coin is not created yet.") : readable && typeof live!.holders === "number" ? holdersCell(live!.holders, live!.holdersOnlyPools ?? false, null) : cell(null, NOT_READ.holders),
    // walkthrough 13: the create date is in config/burnticker/current-status.json (deficit.launch.date) even before the registry has the coin
    createdAt: readable ? live!.launchedAt ?? null : created ? d.launch.date ?? null : null,
    createdWhy: created ? (readable || d.launch.date ? null : ks ? "The keeper's files do not give a creation time." : unreadWhy) : "The coin is not created yet.",
    burned,
    mint: deficit?.address ? { address: deficit.address, label: created ? "Mint address" : "Reserved mint address (coin not created yet)" } : null,
    // review 2 §2: one served $DEFICIT destination — its own site until the coin is created and registered here
    href: deficitHref(created && !!live),
    // owner 2026-10-14: the trade link on the card (Raydium's launchpad page on the curve, its pool after graduation)
    trade: created ? coinLinks({ cluster: "mainnet", mint: deficit?.address, phase: readable ? live!.phase ?? null : kc?.phase ?? null, status: "live", curve: readable ? { raised: live!.raised, threshold: live!.threshold, quote: live!.quote } : kc ? { raised: kc.raised, threshold: kc.threshold, quote: kc.quote } : null }) : null,
    receipt: sig ? { href: checkReceiptHref(sig, readable ? live!.cluster ?? "mainnet" : "mainnet")! } : null,
    receiptWhy: sig ? null : !created ? "The coin is not created yet." : !readable && !ks ? unreadWhy : "No burn has confirmed yet.",
  });

  const rehearsal = loadTransparency(root).rehearsals.find((r) => r.symbol === "REHEARSAL");
  const rc = rehearsalCurve;
  if (rehearsal) {
    const rr = dialOf(rulesOf(root, REHEARSAL_RULES));
    out.push({
      id: "rehearsal", ticker: "REHEARSAL", name: "Rehearsal", imageUrl: null, group: "test",
      tags: [{ label: "Mainnet rehearsal", tone: "rehearsal" }],
      note: REHEARSAL_SENTENCE,
      status: STATUS_SENTENCES.practice,
      rule: debtRule(rr.percent, rr.unitLabel), nextSettle: DEBT_NEXT,
      // website-15 item 9: its LaunchLab pool is read like any coin's (home route); unread is a plain dash with a plain reason
      progress: rc ? progressOf(readinessOf({ launched: true, phase: rc.phase, raisedSol: Number(rc.raised), graduationSol: Number(rc.threshold), poolVerified: null, latest: null }), { raiseSol: Number(rc.threshold), raisedSol: Number(rc.raised) }) : null,
      progressWhy: rc ? null : REHEARSAL_UNREAD,
      curve: rc ? curveCell(rc, null) : noCurve(REHEARSAL_UNREAD),
      mcap: rc ? mcapCell({ cap: rc.marketCap, quote: rc.quote, phase: rc.phase, raised: rc.raised }, REHEARSAL_UNREAD) : cell(null, REHEARSAL_UNREAD), holders: cell(null, NOT_READ.holders),
      // audit 7 item 23: the exact block time of its create transaction when recorded (slot 455825866), else the day
      createdAt: rehearsal.createdAt ?? rehearsal.date ?? null, createdWhy: rehearsal.createdAt || rehearsal.date ? null : "The record does not give a creation date.",
      burned: cell(null, `This site does not read $REHEARSAL's burns. The operator's record says: ${rehearsal.status}.`),
      mint: rehearsal.mint ? { address: rehearsal.mint, label: "Mint address" } : null,
      href: "/burnticker/t/REHEARSAL", receipt: null,   // website-25 (QA 11 M13): the card opens the coin page, which links the disclosure
      receiptWhy: "$REHEARSAL has no burn receipt.",
    });
  }

  const s = samples ?? sampleReceipts(root);
  const burns = s.receipts.filter((r) => r.ticker === "DEFICIT" && r.status === "confirmed").sort((a, b) => b.recordDate.localeCompare(a.recordDate));
  if (burns.length) {
    const total = burns.reduce((a, r) => a + (memoBurn(r.memo) ?? 0), 0);
    const dr = rulesOf(root, DEVNET_RULES);
    const dv = dialOf(dr);
    const supply = Number(dr.totalSupply);
    const st = JSON.parse(fs.readFileSync(path.join(root, STATUS_FILE), "utf8")) as { deficit?: { rehearsal?: { date?: string } } };
    out.push({
      id: "deficit-devnet", ticker: "DEFICIT", name: "Deficit, devnet rehearsal", imageUrl: "/burnticker/brand/deficit.png", group: "test",
      tags: [{ label: "Devnet", tone: "devnet" }],
      note: "The practice run on devnet, a test network where tokens have no money value.",
      status: STATUS_SENTENCES.devnetDone,
      rule: debtRule(dv.percent, dv.unitLabel), nextSettle: cell(null, "The devnet rehearsal is over, so no result is scheduled."),
      // website-15 item 6 (ChatGPT repair 2): the devnet coin never had a curve, so curve and graduation are "not applicable", not done;
      // its real devnet burn stays
      progress: progressOf(readinessOf({ launched: true, phase: null, raisedSol: null, poolVerified: true, latest: { status: "confirmed", units: 1, skippedReason: null, waitReason: null } }), { notApplicable: ["Trading on curve", "Graduated"] }),
      progressWhy: null,
      curve: { raised: null, of: null, pct: null, done: false, na: true, why: "Not applicable. The devnet rehearsal coin traded in its own devnet pool and never had a curve." },
      mcap: cell(null, "Devnet tokens have no money value, so this number does not apply."), holders: cell(null, NOT_READ.holders),
      createdAt: st.deficit?.rehearsal?.date ?? null, createdWhy: st.deficit?.rehearsal?.date ? null : "The record does not give a creation date.",
      burned: cell(`${groupDigits(total)} $DEFICIT${supply > 0 ? `, ${pctOfSupply((total / supply) * 100)}` : ""}`, `${burns.length} confirmed burns on devnet.`),
      mint: null, href: checkReceiptHref(burns[0].signature, "devnet"),
      // the newest confirmed devnet burn's own receipt
      receipt: { href: checkReceiptHref(burns[0].signature, "devnet")! }, receiptWhy: null,
    });
  }
  return out;
}

/**
 * THE ACTIVITY LINE'S ROWS (website-14, platform item 6): each registered coin's own rows (activity.ts: confirmed burns, its last signed
 * reading, its graduation and pool registration), the $DEFICIT keeper's rows from its published files (its readings always; its burns
 * only while $DEFICIT is not registered here, so no burn is listed twice), then the devnet rehearsal's evidence. Each links its own
 * evidence; mainnet first, newest first.
 */
export function activityEvents(tokens: readonly HomeCoin[], samples: SampleList | null, limit = 12, keeper: KeeperFiles | null = null): ActivityEvent[] {
  const ev: ActivityEvent[] = [];
  const shared = sharedTickers(tokens.map((t) => ({ ticker: t.ticker, mint: t.mint ?? t.ticker })));
  for (const t of tokens) {
    if (t.events) { ev.push(...t.events); continue; }
    if (!t.lastBurnAt || t.burns < 1) continue;
    const net = t.cluster === "devnet" ? "devnet" : "mainnet";
    ev.push({ kind: "burn", at: t.lastBurnAt, network: net, ticker: t.ticker, signature: t.latestSignature ?? null, href: checkReceiptHref(t.latestSignature ?? null, net) ?? `${coinPageHref({ ticker: t.ticker, mint: t.mint ?? t.ticker }, shared)}#receipts`, text: `$${t.ticker} burned on ${shortDay(t.lastBurnAt)}. It has burned ${t.burns} time${t.burns === 1 ? "" : "s"}.` });
  }
  if (keeper) ev.push(...eventsFromKeeper(keeper.status, keeper.burns, { includeBurns: !tokens.some((t) => t.ticker === "DEFICIT" && t.readOk !== false) }));
  for (const r of samples?.receipts ?? []) {
    if (r.status !== "confirmed") continue;
    const amt = memoBurn(r.memo);
    ev.push({ kind: "burn", at: r.recordDate, network: "devnet", ticker: r.ticker, signature: r.signature, href: checkReceiptHref(r.signature, samples!.cluster)!, text: `On ${shortDay(r.recordDate)}, the devnet rehearsal coin $${r.ticker} burned ${amt === null ? "its purchase" : `${groupDigits(amt)} tokens`}.` });
  }
  return sortEvents(ev, limit);
}

/** The devnet practice burns from the sample receipts (confirmed only, the amount from each memo), for the stat strip's "(devnet)" figures. */
export function withDevnet(s: HomeStats | null, samples: SampleList | null): HomeStats | null {
  if (!s) return s;
  const conf = (samples?.receipts ?? []).filter((r) => r.status === "confirmed");
  if (!conf.length) return { ...s, devnet: null };
  const total = conf.reduce((a, r) => a + (memoBurn(r.memo) ?? 0), 0);
  return { ...s, devnet: { burns: conf.length, burnedTokens: String(Math.round(total * 1e6) / 1e6) } };
}

/** The audit summary the index and the home carry: the counts the strip and the badge need (trust.ts readAudit's record), or null. */
export function auditForIndex(a: { ok: boolean; ranAt: string; receipts: number; executed?: number; chainVerified?: number; mismatches: readonly unknown[]; chainChecked: boolean } | null): { ok: boolean; ranAt: string; receipts: number; executed?: number; chainVerified?: number; mismatches: number; chainChecked: boolean } | null {
  if (!a) return null;
  return { ok: a.ok, ranAt: a.ranAt, receipts: a.receipts, ...(typeof a.executed === "number" ? { executed: a.executed } : {}), ...(typeof a.chainVerified === "number" ? { chainVerified: a.chainVerified } : {}), mismatches: a.mismatches.length, chainChecked: a.chainChecked };
}

/**
 * The platform strip from the index totals and the public audit; null when the index could not be read. Third prelaunch audit
 * 2026-10-19 B-5: "Receipts verified 3 ... against the chain" was shown while the audit record said 0 executed and 0 chain-verified. The
 * figure counts only receipts the chain check verified (audit.json chainVerified); the audit's recomputation of recorded receipts is
 * said as that (the trust page's words, auditBadge.ts auditHeadline), and `receiptsRecorded` carries how many receipts are recorded.
 */
export function homeStats(totals: { burns: number; burnedTokens: string } | null, audit: { ok: boolean; receipts: number; executed?: number; chainVerified?: number; mismatches: number; chainChecked?: boolean } | null, cluster: string | null = null): HomeStats | null {
  if (!totals) return null;
  if (!audit) return { burnedTokens: totals.burnedTokens, burns: totals.burns, receiptsVerified: null, receiptsRecorded: null, receiptsWhy: "The public audit has not run on this site yet." };
  const net = cluster === "mainnet" || cluster === "devnet" ? `${cluster} ` : "";
  const n = audit.receipts, executed = audit.executed ?? null;
  const verified = audit.chainChecked === true && typeof audit.chainVerified === "number" ? audit.chainVerified : 0;
  const recorded = n === 0 ? "No receipt is recorded yet." : `The audit recomputed ${n === 1 ? "the 1 recorded receipt" : `the ${n} recorded receipts`} from their readings and rules. This is a recomputation of recorded receipts.`;
  const why = executed === 0 || (executed === null && n === 0) ? `No ${net}burn has run yet, so no receipt is verified on chain. ${recorded}`
    : audit.chainChecked !== true ? `This run did not read the chain, so no receipt is counted as verified on chain. ${recorded}`
    : typeof audit.chainVerified !== "number" ? `This audit record does not say which receipts the chain showed, so none is counted as verified on chain. ${recorded}`
    : `${verified === 1 ? "1 receipt was" : `${verified} receipts were`} checked against the chain. ${recorded}`;
  return { burnedTokens: totals.burnedTokens, burns: totals.burns, receiptsVerified: verified, receiptsRecorded: n, receiptsWhy: why };
}

type NetworkRow = { cluster: string; deployment?: string; since?: string | null };
interface StatusRecord { phase?: { label?: string }; networks?: NetworkRow[] | Record<string, Omit<NetworkRow, "cluster">>; attesters?: { quorum?: number; active?: unknown[] } | null; squads?: unknown; upgradeAuthority?: { cluster: string; timeLockSecs?: number | null }[] }

/**
 * THE ONE-LINE STATUS on the home page (Claude site audit 2 item 9): the phase, the mainnet date, the signer count and the time lock, read
 * from current-status.json in plain sentences. The full record stays on the Trust page. Null when the file cannot be read.
 */
export function homeStatusLine(rec: StatusRecord | null): string | null {
  if (!rec) return null;
  const phase = (rec.phase?.label ?? "").split(" (")[0].trim();
  const nets: NetworkRow[] = Array.isArray(rec.networks) ? rec.networks : Object.entries(rec.networks ?? {}).map(([cluster, n]) => ({ cluster, ...n }));
  const main = nets.find((n) => n.cluster === "mainnet" && n.deployment === "deployed");
  const since = main?.since ? longDay(main.since) : null;
  const signers = Array.isArray(rec.attesters?.active) ? rec.attesters!.active!.length : null;
  const sq = rec.upgradeAuthority?.find((u) => u.cluster === "mainnet") ?? (rec.squads as { mainnet?: { timeLockSecs?: number } } | undefined)?.mainnet ?? null;
  const lock = sq && typeof sq.timeLockSecs === "number" ? sq.timeLockSecs : null;
  const words = ["no", "one", "two", "three", "four", "five"];
  const parts = [
    phase ? `Burnticker is in ${phase}.` : null,
    since ? `Its programs have been on mainnet since ${since}.` : null,
    signers !== null ? `${signers === 1 ? "One key signs" : `${(words[signers] ?? String(signers)).replace(/^./, (c) => c.toUpperCase())} keys sign`} every reading.` : null,
    lock === null ? null : lock === 0 ? "Upgrades have no time lock yet." : `Upgrades wait ${lock >= 3600 ? `${Math.round(lock / 3600)} hours` : `${Math.round(lock / 60)} minutes`} under a time lock.`,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/**
 * THE MAINNET RECORDS IN THE ACTIVITY LINE (website-15 item 15, Claude site audit 3 item 12): until mainnet has burns, the line is not
 * all devnet. From real records only: $REHEARSAL's LaunchLab create (its evidence file: the day and the signature) and, while $DEFICIT
 * is not created, its reserved mint address (config/own-tokens.json; no date is claimed). Nothing when the files cannot be read.
 */
export function mainnetRecordEvents(root = process.cwd()): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  const rh = rehearsalCreate(root);
  if (rh) out.push({ kind: "created", at: rh.date, network: "mainnet", ticker: "REHEARSAL", signature: rh.signature, href: `https://explorer.solana.com/tx/${rh.signature}`, text: `$REHEARSAL created on mainnet, ${shortDay(rh.date) ?? rh.date}` });
  try {
    const own = JSON.parse(fs.readFileSync(path.join(root, OWN_TOKENS), "utf8")) as { tokens: { symbol: string; address: string | null; status: string }[] };
    const d = own.tokens.find((t) => t.symbol === "DEFICIT");
    if (d?.address && d.status !== "launched") out.push({ kind: "reserved", at: null, network: "mainnet", ticker: "DEFICIT", signature: null, href: deficitHref(false), text: "$DEFICIT mint address reserved" });
    // 2026-10-13: once created, the create itself is the record (current-status.json deficit.launch carries the date and the signature)
    if (d?.address && d.status === "launched") {
      const rec = JSON.parse(fs.readFileSync(path.join(root, STATUS_FILE), "utf8")) as { deficit?: { launch?: { date?: string | null; createTx?: string | null } } };
      const l = rec.deficit?.launch;
      if (l?.date && l.createTx) out.push({ kind: "created", at: l.date, network: "mainnet", ticker: "DEFICIT", signature: l.createTx, href: `https://explorer.solana.com/tx/${l.createTx}`, text: `$DEFICIT created on mainnet, ${shortDay(l.date) ?? l.date}` });
    }
  } catch { /* no row */ }
  return out;
}

export function homeData(tokens: readonly HomeCoin[] | null, root = process.cwd(), now = Date.now(), index: { totals: { burns: number; burnedTokens: string }; audit: { ok: boolean; receipts: number; executed?: number; chainVerified?: number; mismatches: number; chainChecked?: boolean } | null } | null = null, statusRecord: unknown = undefined, launch: SiteLaunchState | null = null, keeper: KeeperFiles | null = null, upcoming: UpcomingSet | null = null, rehearsalCurve: RehearsalCurve = null, host: string = siteCluster(), tests: TestCoinKeys = testCoinKeys(root)): HomeData {
  let samples: SampleList | null = null;
  try { samples = sampleReceipts(root); } catch { samples = null; }
  let featured: CardView[] = [];
  try { featured = featuredCoins(root, samples, tokens, keeper, now, rehearsalCurve); } catch { featured = []; }
  // owner 2026-10-14: a test coin ($REHEARSAL today; testCoins.ts) is not a featured card and has no row in the activity line
  featured = featured.filter((v) => !isTestCoin(tests, { mint: v.mint?.address ?? null, ticker: v.ticker }));
  const records = mainnetRecordEvents(root).filter((e) => !isTestCoin(tests, { ticker: e.ticker }));
  let rec: StatusRecord | null = null;
  if (statusRecord !== undefined) rec = statusRecord as StatusRecord | null;
  else { try { rec = JSON.parse(fs.readFileSync(path.join(root, STATUS_FILE), "utf8")) as StatusRecord; } catch { rec = null; } }
  // owner decision 2026-10-12: a mainnet host serves no devnet item (devnetHide.ts); a devnet host keeps them
  const out = publicHomeData({
    schema: "burnticker.home/v1", generatedAt: new Date(now).toISOString(), featured, events: sortEvents([...activityEvents(tokens ?? [], samples, 40, keeper), ...records], 12), noEvents: NO_EVENTS_LINE,
    raisePresetsSol: RAISE_PRESETS_SOL, deficitQueue: deficitQueue(keeper, now), upcoming: upcoming ?? upcomingSet([], [], tokens === null ? null : tokens.length), stats: withDevnet(homeStats(index?.totals ?? null, index?.audit ?? null, host ?? null), samples),
    // legitimacy pass: the one surface hint of the history pages, the dated counts (reviews published, releases since Oct 10)
    statusLine: [homeStatusLine(rec), historyCountsLine(historyCounts(root)), launch?.sentence ?? null].filter(Boolean).join(" ") || null, launch,
  }, host);
  // after the devnet filter, so the count and the empty labels describe the cards this host serves
  // coin card status 2026-10-18: the static page also gets the one number the card keeps in view (cardView.ts headlineStat)
  const shown = out.featured.map((v) => ({ ...v, empty: emptyLabels(v), stat: headlineStat(v) }));
  return { ...out, featured: shown, featuredLine: featuredLine(shown), nextNotice: upcomingNotice(out.upcoming, shown.length) };
}
