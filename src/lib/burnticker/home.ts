import fs from "node:fs";
import path from "node:path";
import { deficitPrelaunch } from "@/lib/burnticker/deficitPrelaunch";
import { sampleReceipts, type SampleList } from "@/lib/burnticker/trustpack/samples";
import { loadTransparency } from "@/lib/burnticker/trust";
import { deficitHref } from "@/lib/burnticker/creatorLaunches";
import { checkReceiptHref } from "@/lib/burnticker/coinPage";
import type { SiteLaunchState } from "@/lib/burnticker/launchAvailability";
import { CARD_MEANINGS, NOT_READ, curveCell, groupDigits, longDay, pctOfSupply, shortDay, type CardCell, type CardView, type IndexCoin } from "@/lib/burnticker/cardView";
import { sortEvents, eventsFromKeeper, type ActivityEvent } from "@/lib/burnticker/activity";
import { deficitQueue, type DeficitQueue, type KeeperFiles } from "@/lib/burnticker/deficitQueue";
import { readinessOf, type Readiness } from "@/lib/burnticker/readiness";
import { progressOf } from "@/lib/burnticker/progress";
import { RAISE_PRESETS_SOL } from "@/lib/burnticker/launchPresets";
import type { UpcomingRow } from "@/lib/burnticker/upcoming";

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
export interface HomeStats { burnedTokens: string; burns: number; receiptsVerified: number | null; receiptsWhy: string | null }
export interface HomeData {
  schema: "burnticker.home/v1"; generatedAt: string; featured: CardView[]; events: ActivityEvent[]; noEvents: string;
  /** The raises a creator may choose (40, 60 or 85 SOL; LAUNCHPAD-PATH §75). A coin's own raise is read from its pool, never from here. */
  raisePresetsSol: readonly string[];
  /** The $DEFICIT queued-units counter (deficitQueue.ts), from the keeper's published files; state "unavailable" when they were not read. */
  deficitQueue: DeficitQueue;
  /** The next result each coin waits for (upcoming.ts); an empty list when no coin is registered or the registry was not read. */
  upcoming: UpcomingRow[];
  stats: HomeStats | null;
  /** The one-line status: the phase and governance facts, then the site launch record's one sentence. */
  statusLine: string | null;
  /** website-12's site launch record (launchAvailability.ts siteLaunchState), for the static pages' launch dialog; null when not passed. */
  launch: SiteLaunchState | null;
}

/** One registered coin as the home route read it: the index card fields plus its newest confirmed receipt. `readOk` false = its page failed. */
export interface HomeCoin extends Pick<IndexCoin, "ticker" | "burns" | "lastBurnAt"> {
  mint?: string; burned?: string; pctOfSupply?: number; launchedAt?: string | null; phase?: IndexCoin["phase"]; progressPct?: number | null;
  raised?: string | null; threshold?: string | null; quote?: string | null; marketCap?: string | null; holders?: number | null;
  cluster?: string; latestSignature?: string | null; readOk?: boolean;
  /** website-14: the coin's own activity rows (activity.ts eventsFromStatus) and where it stands (readiness.ts) */
  events?: ActivityEvent[]; readiness?: Readiness | null;
}

export const NO_EVENTS_LINE = "Nothing has happened on chain yet. Burns, signed readings, graduations and pool registrations appear here once they are recorded.";
export const UNAVAILABLE = "Unavailable";
const OWN_TOKENS = path.join("config", "own-tokens.json");
const REHEARSAL_RULES = path.join("config", "burnkeeper", "rehearsal.rules.json");
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

/** A curve with no raise read: "— raised", and the reason. Never a typed 85 (LAUNCHPAD-PATH §75). */
const noCurve = (why: string): CardView["curve"] => ({ raised: null, of: null, pct: null, done: false, why });
/** The keeper's status.json, when it is the live schema. */
type KeeperStatus = { schema?: string; burned?: { total: string; pctOfSupply: number; count: number }; curve?: { phase: "curve" | "migrating" | "graduated"; raised: string; threshold: string; quote: string; progressPct: number } | null; readiness?: Readiness; addresses?: { mint: string | null } };
const keeperLive = (k: KeeperFiles | null): KeeperStatus | null => { const s = k?.status as KeeperStatus | null | undefined; return s && s.schema === "burnkeeper.status/v1" ? s : null; };

export function featuredCoins(root = process.cwd(), samples: SampleList | null = null, coins: readonly HomeCoin[] | null = [], keeper: KeeperFiles | null = null, now = Date.now()): CardView[] {
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
    id: "deficit", ticker: "DEFICIT", name: "Deficit", imageUrl: "/burnticker/brand/deficit.png", group: "test",
    tags: [{ label: "Featured", tone: "featured" }, ...(created ? [] : [{ label: "Not created yet", tone: "neutral" as const }])],
    note: created ? "The operator's first coin, said like DeFi-cit: decentralized finance pointed at the national deficit. Its rules were locked before it was created." : "The operator's first coin, said like DeFi-cit: decentralized finance pointed at the national deficit. Its rules are locked, and the coin is not created yet.",
    rule: debtRule(d.dial.percent, d.dial.unitLabel), nextSettle: DEBT_NEXT,
    progress: readiness ? progressOf(readiness, { raiseSol: Number.isFinite(raiseNum) && raiseNum > 0 ? raiseNum : null, raisedSol: Number.isFinite(raisedNum) ? raisedNum : null, queuedUnits: queue.state === "queued" ? queue.units : null }) : null,
    progressWhy: readiness ? null : unreadWhy,
    curve: !created ? noCurve("There is no curve until the coin is created. Its raise is read from its pool once it exists.")
      : readable ? curveCell({ phase: live!.phase ?? null, progressPct: live!.progressPct ?? null, raised: live!.raised, threshold: live!.threshold, quote: live!.quote }, null)
      : kc ? curveCell({ phase: kc.phase, progressPct: kc.progressPct, raised: kc.raised, threshold: kc.threshold, quote: kc.quote }, null)
      : noCurve(ks ? "The keeper's files do not carry a curve reading yet." : unreadWhy),
    mcap: !created ? cell(null, "The coin is not created yet.") : readable && live!.marketCap ? cell(`${groupDigits(live!.marketCap)} ${live!.quote ?? "SOL"}`, CARD_MEANINGS.mcap) : cell(null, readable ? (live!.phase === "graduated" ? NOT_READ.mcapPool : NOT_READ.mcapNotRead) : ks ? NOT_READ.mcapNotRead : unreadWhy),
    holders: !created ? cell(null, "The coin is not created yet.") : readable && typeof live!.holders === "number" ? cell(groupDigits(live!.holders), null) : cell(null, NOT_READ.holders),
    createdAt: readable ? live!.launchedAt ?? null : null, createdWhy: created ? (readable ? null : ks ? "The keeper's files do not give a creation time." : unreadWhy) : "The coin is not created yet.",
    burned,
    mint: deficit?.address ? { address: deficit.address, label: created ? "Mint address" : "Reserved mint address (coin not created yet)" } : null,
    // review 2 §2: one served $DEFICIT destination — its own site until the coin is created and registered here
    href: deficitHref(created && !!live),
    receipt: sig ? { href: checkReceiptHref(sig, readable ? live!.cluster ?? "mainnet" : "mainnet")! } : null,
    receiptWhy: sig ? null : !created ? "The coin is not created yet." : !readable && !ks ? unreadWhy : "No burn has confirmed yet.",
  });

  const rehearsal = loadTransparency(root).rehearsals.find((r) => r.symbol === "REHEARSAL");
  if (rehearsal) {
    const rr = dialOf(rulesOf(root, REHEARSAL_RULES));
    out.push({
      id: "rehearsal", ticker: "REHEARSAL", name: "Rehearsal", imageUrl: null, group: "test",
      tags: [{ label: "Mainnet rehearsal", tone: "rehearsal" }],
      note: "A disclosed test coin on mainnet that checks fees and signed readings. The operator does not trade it and asks nobody to. It can only burn if outside buyers fill its curve.",
      rule: debtRule(rr.percent, rr.unitLabel), nextSettle: DEBT_NEXT,
      progress: null, progressWhy: "This site does not read $REHEARSAL's curve or pool, because it is not listed with the coins.",
      curve: noCurve("This site does not read $REHEARSAL's curve, because it is not listed with the coins."),
      mcap: cell(null, "This site does not read $REHEARSAL's curve."), holders: cell(null, NOT_READ.holders),
      createdAt: rehearsal.date ?? null, createdWhy: rehearsal.date ? null : "The record does not give a creation date.",
      burned: cell(null, `This site does not read $REHEARSAL's burns. The operator's record says: ${rehearsal.status}.`),
      mint: rehearsal.mint ? { address: rehearsal.mint, label: "Mint address" } : null,
      href: "/burnticker/trust#rehearsals", receipt: null, receiptWhy: "$REHEARSAL has no burn receipt.",
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
      rule: debtRule(dv.percent, dv.unitLabel), nextSettle: cell(null, "The devnet rehearsal is over, so no result is scheduled."),
      progress: progressOf(readinessOf({ launched: true, phase: "graduated", raisedSol: null, poolVerified: true, latest: { status: "confirmed", units: 1, skippedReason: null, waitReason: null } })),
      progressWhy: null,
      curve: { raised: null, of: null, pct: 100, done: true, why: "The rehearsal coin trades in its own devnet pool. Its curve was not used." },
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
  for (const t of tokens) {
    if (t.events) { ev.push(...t.events); continue; }
    if (!t.lastBurnAt || t.burns < 1) continue;
    const net = t.cluster === "devnet" ? "devnet" : "mainnet";
    ev.push({ kind: "burn", at: t.lastBurnAt, network: net, ticker: t.ticker, signature: t.latestSignature ?? null, href: checkReceiptHref(t.latestSignature ?? null, net) ?? `/burnticker/t/${t.ticker}#receipts`, text: `$${t.ticker} burned on ${shortDay(t.lastBurnAt)}. It has burned ${t.burns} time${t.burns === 1 ? "" : "s"}.` });
  }
  if (keeper) ev.push(...eventsFromKeeper(keeper.status, keeper.burns, { includeBurns: !tokens.some((t) => t.ticker === "DEFICIT" && t.readOk !== false) }));
  for (const r of samples?.receipts ?? []) {
    if (r.status !== "confirmed") continue;
    const amt = memoBurn(r.memo);
    ev.push({ kind: "burn", at: r.recordDate, network: "devnet", ticker: r.ticker, signature: r.signature, href: checkReceiptHref(r.signature, samples!.cluster)!, text: `On ${shortDay(r.recordDate)}, the devnet rehearsal coin $${r.ticker} burned ${amt === null ? "its purchase" : `${groupDigits(amt)} tokens`}.` });
  }
  return sortEvents(ev, limit);
}

/** The platform strip from the index totals and the public audit; null when the index could not be read. */
export function homeStats(totals: { burns: number; burnedTokens: string } | null, audit: { ok: boolean; receipts: number; mismatches: number; chainChecked?: boolean } | null): HomeStats | null {
  if (!totals) return null;
  return {
    burnedTokens: totals.burnedTokens, burns: totals.burns,
    receiptsVerified: audit ? Math.max(0, audit.receipts - audit.mismatches) : null,
    receiptsWhy: !audit ? "The public audit has not run on this site yet."
      : audit.chainChecked === false ? "The public audit checked the published receipts against their rules. It did not read the chain on this run."
      : "The public audit checked each receipt against its rule and the chain.",
  };
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

export function homeData(tokens: readonly HomeCoin[] | null, root = process.cwd(), now = Date.now(), index: { totals: { burns: number; burnedTokens: string }; audit: { ok: boolean; receipts: number; mismatches: number; chainChecked?: boolean } | null } | null = null, statusRecord: unknown = undefined, launch: SiteLaunchState | null = null, keeper: KeeperFiles | null = null, upcoming: UpcomingRow[] = []): HomeData {
  let samples: SampleList | null = null;
  try { samples = sampleReceipts(root); } catch { samples = null; }
  let featured: CardView[] = [];
  try { featured = featuredCoins(root, samples, tokens, keeper, now); } catch { featured = []; }
  let rec: StatusRecord | null = null;
  if (statusRecord !== undefined) rec = statusRecord as StatusRecord | null;
  else { try { rec = JSON.parse(fs.readFileSync(path.join(root, STATUS_FILE), "utf8")) as StatusRecord; } catch { rec = null; } }
  return {
    schema: "burnticker.home/v1", generatedAt: new Date(now).toISOString(), featured, events: activityEvents(tokens ?? [], samples, 12, keeper), noEvents: NO_EVENTS_LINE,
    raisePresetsSol: RAISE_PRESETS_SOL, deficitQueue: deficitQueue(keeper, now), upcoming, stats: homeStats(index?.totals ?? null, index?.audit ?? null),
    statusLine: [homeStatusLine(rec), launch?.sentence ?? null].filter(Boolean).join(" ") || null, launch,
  };
}
