import { shortDay } from "@/lib/burnticker/cardView";
import { sourcePublisher } from "@/lib/burnticker/coinSourceLine";

/**
 * NEXT RESULTS (website-14, ChatGPT product idea 3; page /burnticker/upcoming and a strip on the home page). For each coin this site
 * follows, the next result its rule waits for: the event in words, the source, when the source publishes as the SOURCE'S OWN SCHEDULE
 * (never a promise from this site), and where the latest result stands:
 *
 *   waiting     no result is in hand: the rule waits for the source
 *   published   the source published a result and the keeper read it, but it is not signed on chain yet
 *   attested    the reading is signed on chain and waits for its burn run
 *   burned      the latest result burned (its receipt is linked); the rule now waits for the next one
 *   deferred    a burn is due and on hold, with its recorded reason (for example, the pool is not registered yet)
 *   unavailable the coin's own records could not be read (website-15): said so, never shown as "nothing due"
 *
 * Built from each coin's own status and receipts (the platform keeper, via the API) and, for $DEFICIT, its keeper's published files and
 * locked rule file (src/lib/burnKeeper/schedule.ts polls). Copy note: the page's heading says "Next results", because the copy lint
 * refuses the word "upcoming" in visible text; only the address keeps it. Pure and client-safe.
 */
export type SettlementStatus = "waiting" | "published" | "attested" | "burned" | "deferred" | "unavailable";
export const SETTLEMENT_LABEL: Record<SettlementStatus, string> = { waiting: "Waiting for the source", published: "Published, not signed yet", attested: "Signed, waiting for its burn run", burned: "Burned", deferred: "On hold", unavailable: "Unavailable" };

export interface UpcomingRow {
  ticker: string; name: string; href: string; network: "mainnet" | "devnet";
  /** the coin's mint, when known: with the network it is the follow key (watchlist.ts; private review 8 F1) */
  mint?: string | null;
  /** the result the rule waits for, in words */
  event: string;
  /** who publishes it, in words; never the event-contract venue's name */
  source: string;
  sourceUrl: string | null;
  /** when the source publishes, as the source's own schedule */
  schedule: string;
  /** the next time this site or the keeper checks the source (ISO), or the market's scheduled close; null when none is known */
  nextAt: string | null;
  status: SettlementStatus;
  /** one plain sentence on the latest result */
  statusText: string;
  /** the latest burn's receipt check, when the latest result burned */
  receiptHref: string | null;
}

export const UPCOMING_EMPTY = "No coin is registered on this site yet, so no result is being waited for. Each coin appears here once it is created and registered.";
/**
 * No coin is registered, but the page lists coins anyway (the featured $DEFICIT and test coins): the empty sentence must not say "no coin"
 * under a list of coins (ChatGPT audit 6 item 22).
 */
export const UPCOMING_NONE_REGISTERED_LISTED = "No coin on this page is waiting for a result here yet. This list follows coins once they are registered on this site, and none of the coins above is registered yet.";
/** Every registered coin is a draft, expired or retired (website-15, code review 6 P2 2). */
export const UPCOMING_NONE_ACTIVE = "No pending results. No coin registered on this site is active right now.";
/** The registry itself could not be read: unavailable, never "no coin". */
export const UPCOMING_UNAVAILABLE = "The next results are unavailable, because this site could not read its list of coins just now.";

/**
 * THE NEXT-RESULTS ANSWER (website-15, code review 6 P2 2). The rows that were read, the coins that could not be read, and one state:
 *   ready        every registered coin was read (rows may be empty: no coin registered, or none active)
 *   partial      some coins were read and some failed; the readable rows stay, with a notice naming the rest
 *   unavailable  the registry could not be read, or every coin failed
 * `registered` is the number of coins in a readable registry (null when the registry was not read); `active` counts the rows a coin
 * could produce. A failure is never shown as an empty list.
 */
export interface UpcomingOmitted { ticker: string; reason: string }
export interface UpcomingSet { state: "ready" | "partial" | "unavailable"; rows: UpcomingRow[]; omitted: UpcomingOmitted[]; registered: number | null }

export function upcomingSet(rows: readonly UpcomingRow[], omitted: readonly UpcomingOmitted[], registered: number | null): UpcomingSet {
  const state = registered === null || (omitted.length > 0 && rows.length === 0) ? "unavailable" : omitted.length > 0 ? "partial" : "ready";
  return { state, rows: [...rows], omitted: [...omitted], registered };
}

/**
 * The one sentence a next-results list shows beside (partial) or instead of (empty, unavailable) its rows; null when the rows say it all.
 * `listed`: how many coins the same page shows elsewhere (the home's featured cards), so an empty registry under listed coins never reads
 * "No coin is registered" as if the page were empty.
 */
export function upcomingNotice(u: UpcomingSet | null | undefined, listed = 0): string | null {
  if (!u || !Array.isArray(u.rows)) return UPCOMING_UNAVAILABLE;
  if (u.state === "unavailable") return u.registered === null ? UPCOMING_UNAVAILABLE : `The next results are unavailable, because this site could not read ${tickers(u.omitted)} just now.`;
  if (u.state === "partial") return `Some next results are missing, because this site could not read ${tickers(u.omitted)} just now.`;
  if (u.rows.length) return null;
  return u.registered === 0 ? (listed > 0 ? UPCOMING_NONE_REGISTERED_LISTED : UPCOMING_EMPTY) : UPCOMING_NONE_ACTIVE;
}
const tickers = (o: readonly UpcomingOmitted[]) => { const t = o.map((x) => `$${x.ticker}`); return t.length <= 1 ? (t[0] ?? "a coin") : `${t.slice(0, -1).join(", ")} and ${t[t.length - 1]}`; };

/** Words for a source: the publisher by name (walkthrough 13: never "the source's own published data"; coinSourceLine.ts sourcePublisher). */
const sourceWords = (oracle: string, selectorKey: string): string => sourcePublisher(oracle, selectorKey);

interface StatusLike {
  ticker: string; name: string; cluster: string; status: string; oracle: string; selectorKey: string; seriesTitle: string | null;
  next: { nextCheckAt: string | null; nextMarket: string | null; nextCloseTime: string | null };
  profile?: { oneLiner?: string; badge?: string } | null;
}
interface ReceiptLike { status: string; settledAt: string; units: number; signature: string | null; readingDate?: string | null; waitReason?: string | null; skippedReason?: string | null; settlementSourceUrl?: string | null; market?: string; execution?: string | null }

const hhmmUtc = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

/** Where the latest result stands, from a registered coin's newest receipt. */
export function settlementOf(receipts: readonly ReceiptLike[], cluster: string): { status: SettlementStatus; text: string; receiptHref: string | null } {
  const l = [...receipts].sort((a, b) => (a.settledAt < b.settledAt ? 1 : -1))[0] ?? null;
  if (!l) return { status: "waiting", text: "No result has been read for this coin yet.", receiptHref: null };
  const when = shortDay(l.settledAt) ?? l.settledAt.slice(0, 10);
  const net = cluster === "mainnet" ? "mainnet" : "devnet";
  if (l.status === "confirmed") return { status: "burned", text: `The latest result, settled on ${when}, burned.`, receiptHref: l.signature ? `/burnticker/check?sig=${encodeURIComponent(l.signature)}&cluster=${net}#verify` : null };
  if (l.status === "pending-pair") return { status: "deferred", text: `The latest result, settled on ${when}, waits until both coins of the pair have a registered pool.`, receiptHref: null };
  if (l.status === "planned" || l.status === "sending") {
    if (l.execution === "program" && !l.readingDate) return { status: "published", text: `The latest result, settled on ${when}, was read and is not signed on chain yet.`, receiptHref: null };
    if (l.waitReason) return { status: "deferred", text: `The latest result, settled on ${when}, is due to burn and on hold. The recorded reason is: ${l.waitReason}.`, receiptHref: null };
    return { status: "attested", text: `The latest result, settled on ${when}, is signed and waits for its burn run.`, receiptHref: null };
  }
  return { status: "waiting", text: `The latest result, settled on ${when}, counted nothing to burn${l.skippedReason ? ` (${l.skippedReason})` : ""}. The rule waits for the next one.`, receiptHref: null };
}

/** One registered coin's row. */
/** `key`: the coin's URL key (coinKey.ts), its ticker while it alone holds it and its mint once the ticker is shared. */
export function upcomingFromStatus(s: StatusLike, receipts: readonly ReceiptLike[], key: string = s.ticker, mint: string | null = null): UpcomingRow | null {
  if (s.status === "draft" || s.status === "expired" || s.status === "retired") return null;
  const st = settlementOf(receipts, s.cluster);
  const close = s.next.nextCloseTime, check = s.next.nextCheckAt;
  const schedule = close ? `The market is scheduled to close at ${hhmmUtc(close)}. The result counts once the source settles it, on the source's own timing.`
    // walkthrough 13: the check time is said once, in Denver time, by the list (NextResults.tsx), not here in UTC as well
    : check ? "The source publishes on its own schedule, and this site reads it again at the next check."
    : "This rule has no scheduled result that this site knows of.";
  const latestSrc = [...receipts].reverse().find((r) => r.settlementSourceUrl)?.settlementSourceUrl ?? null;
  return {
    ticker: s.ticker, name: s.name, href: `/burnticker/t/${encodeURIComponent(key)}`, network: s.cluster === "devnet" ? "devnet" : "mainnet", mint,
    event: s.next.nextMarket ? `${s.seriesTitle ?? s.profile?.oneLiner ?? s.selectorKey}, market ${s.next.nextMarket}` : s.seriesTitle ?? s.profile?.oneLiner ?? s.selectorKey,
    source: sourceWords(s.oracle, s.selectorKey), sourceUrl: latestSrc, schedule, nextAt: close ?? check, status: st.status, statusText: st.text, receiptHref: st.receiptHref,
  };
}

/** The $DEFICIT keeper's row, from its status.json, burns.json and the locked rule file's schedule. Null before the coin exists. */
export function upcomingFromKeeper(statusFile: unknown, burnsFile: unknown, rules: { feedName: string; feedUrl: string | null; polls: readonly string[]; timeZone: string }): UpcomingRow | null {
  const s = statusFile as { schema?: string; ticker?: string; cluster?: string; addresses?: { mint?: string | null } | null; feed?: { lastRecordDate: string | null; nextPollAt: string | null }; program?: { queue?: { lastOnChain: string | null } } | null } | null;
  if (!s || s.schema !== "burnkeeper.status/v1") return null;
  const raw = Array.isArray(burnsFile) ? burnsFile : burnsFile && typeof burnsFile === "object" && Array.isArray((burnsFile as { burns?: unknown }).burns) ? (burnsFile as { burns: unknown[] }).burns : null;
  // website-15 (code review 6, P2 1): a missing or wrong-shape burns.json is unavailable, never "counted no unit"
  const valid = !!raw && raw.every((r) => !!r && typeof r === "object" && typeof (r as { status?: unknown }).status === "string" && typeof (r as { recordDate?: unknown }).recordDate === "string");
  const rows = (valid ? raw : []) as { recordDate: string; status: string; units: number; signature: string | null; waitReason: string | null; skippedReason: string | null }[];
  const latest = [...rows].sort((a, b) => (a.recordDate < b.recordDate ? 1 : -1))[0] ?? null;
  const lastRead = s.feed?.lastRecordDate ?? null;
  const lastOnChain = s.program?.queue?.lastOnChain ?? null;
  const t = s.ticker ?? "DEFICIT";
  let status: SettlementStatus = "waiting", text = "No reading has been recorded since launch yet.", receiptHref: string | null = null;
  if (!valid) { status = "unavailable"; text = "Where the latest reading stands is unavailable, because the keeper's list of readings and burns did not load."; }
  else if (latest && (!lastRead || latest.recordDate >= lastRead)) {
    const d = shortDay(latest.recordDate) ?? latest.recordDate;
    if (latest.status === "confirmed") { status = "burned"; text = `The reading for ${d} burned.`; receiptHref = latest.signature ? `/burnticker/check?sig=${encodeURIComponent(latest.signature)}&cluster=mainnet#verify` : null; }
    else if (latest.status === "skipped") { status = "waiting"; text = `The reading for ${d} bought nothing (${latest.skippedReason ?? "skipped"}). The rule waits for the next business day.`; }
    else if (s.program && (!lastOnChain || latest.recordDate > lastOnChain)) { status = "published"; text = `The reading for ${d} was read and is not signed on chain yet.`; }
    else if (latest.waitReason) { status = "deferred"; text = `The reading for ${d} counted ${latest.units === 1 ? "one unit" : `${latest.units} units`}, and its burn is on hold. The recorded reason is: ${latest.waitReason}.`; }
    else { status = "attested"; text = `The reading for ${d} is signed and waits for its burn run.`; }
  } else if (lastRead) text = `The reading for ${shortDay(lastRead) ?? lastRead} counted no unit, so nothing is due. The rule waits for the next business day.`;
  const polls = rules.polls.join(" and ");
  return {
    ticker: t, name: "Deficit", href: "https://deficit.burnticker.com/", network: s.cluster === "devnet" ? "devnet" : "mainnet", mint: s.addresses?.mint ?? null,
    event: "The next business day's U.S. national debt figure", source: rules.feedName, sourceUrl: rules.feedUrl,
    schedule: `The Treasury publishes each business day's figure on its own schedule. The keeper checks for it at ${polls} ${rules.timeZone === "America/New_York" ? "New York" : rules.timeZone} time.`,
    nextAt: s.feed?.nextPollAt ?? null, status, statusText: text, receiptHref,
  };
}
