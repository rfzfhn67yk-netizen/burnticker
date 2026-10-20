/**
 * THE COINS PAGE ORDER (owner decisions 2026-10-19). Settled coins stay visible and are never hidden. The list leads with the open coins
 * (in the order the selected tab already gives them), then the decided coins under two dividers, "Decided, waiting to graduate" and
 * "Decided, ended", and last one collapsed line for the retired and void coins with their count. Each decided coin carries one result
 * line (won or lost, or the result of a rule that is not a game; the settled day; what happens next) and each open coin one next-result
 * line, stated as a fact: when the keeper reads the source for it, the cadence of a feed, a market's stated close, or that a one-shot
 * resolves once. Never a promise and never a bare date presented as when a burn happens.
 *
 * The list API (GET /api/burnticker/tokens) sends each coin's `listing` (coinsListServe.ts builds it from the status the route already
 * read and the registry's locked rule; no extra chain or source read). The lines are built here, in the browser, so the times read in
 * the viewer's own zone. "Open only" is a per-browser toggle in localStorage; every read and write is wrapped, so the page renders the
 * same without storage. Pure and client-safe.
 */

export type ListGroup = "open" | "decided-waiting" | "decided-ended" | "retired" | "void";
export const LIST_GROUPS: readonly ListGroup[] = ["open", "decided-waiting", "decided-ended", "retired", "void"];

/** What follows a decided result. */
export type ResultNext = "burn-after-graduation" | "burned" | "burn-waiting" | "no-burn-losing" | "no-burn" | "end-sink" | "nothing";

export interface ListResult {
  /** won / lost / draw for a game or a pair side; settled for a market or another one-shot rule; void; ended for a rule whose window closed */
  outcome: "won" | "lost" | "draw" | "settled" | "void" | "ended";
  /** a market's settled outcome in words ("Yes", "No", "Arsenal"); null for a game side, or when not recorded */
  words: string | null;
  /** when the result settled (ISO), or when the rule ended; null when not recorded */
  settledAt: string | null;
  next: ResultNext;
  /** the end sink in words for an ended coin ("the rest goes to $DEFICIT's burn"); null otherwise */
  sink: string | null;
}

export type NextShape = "game" | "season" | "feed" | "market" | "one-shot";
export interface ListNext {
  shape: NextShape;
  /** game, season: the keeper's next planned read of the source (from the schedule it reads); market: its stated close */
  at: string | null;
  /** feed: the source's own cadence words ("daily (the morning after)"); null when the catalogue has none */
  cadence: string | null;
  /** one-shot: the end of its window as a day (YYYY-MM-DD or ISO); null when not stated */
  windowEnd: string | null;
}

export interface CoinListing { group: ListGroup; result: ListResult | null; next: ListNext | null }

/** The divider and collapsed-line words (the tests lint each one). */
export const LIST_COPY = {
  decidedWaiting: "Decided, waiting to graduate",
  decidedEnded: "Decided, ended",
  openOnly: "Open only",
  openOnlyHint: "Hide decided, retired and void coins. This browser remembers the choice.",
  show: "Show",
  hide: "Hide",
} as const;
/** "2 retired or void coins" (one line with a count and an expander). */
export const collapsedLine = (n: number): string => `${n} retired or void ${n === 1 ? "coin" : "coins"}`;

/** A coin with no listing (an older answer) is open, unless the registry status says retired. */
export function groupOf(c: { status: string; listing?: CoinListing | null }): ListGroup | null {
  if (c.status === "draft" || c.status === "expired") return null;
  if (c.listing) return c.listing.group;
  return c.status === "retired" ? "retired" : "open";
}

export interface GroupedList<T> { open: T[]; decidedWaiting: T[]; decidedEnded: T[]; closed: T[] }

/**
 * The page's groups, each in the order it was given (the tab's own sort). A draft or an expired draft is never listed. `openOnly` leaves
 * the open group alone.
 */
export function groupCoins<T extends { status: string; listing?: CoinListing | null }>(list: readonly T[], openOnly = false): GroupedList<T> {
  const out: GroupedList<T> = { open: [], decidedWaiting: [], decidedEnded: [], closed: [] };
  for (const c of list) {
    const g = groupOf(c);
    if (g === null) continue;
    if (g === "open") out.open.push(c);
    else if (openOnly) continue;
    else if (g === "decided-waiting") out.decidedWaiting.push(c);
    else if (g === "decided-ended") out.decidedEnded.push(c);
    else out.closed.push(c);
  }
  return out;
}
/** The groups flattened in page order (open, waiting, ended, then retired and void). */
export const orderedCoins = <T extends { status: string; listing?: CoinListing | null }>(list: readonly T[], openOnly = false): T[] => { const g = groupCoins(list, openOnly); return [...g.open, ...g.decidedWaiting, ...g.decidedEnded, ...g.closed]; };

// ---- times in the viewer's zone ----

export interface ClockZone { now: number; timeZone?: string }
const parts = (iso: string, z: ClockZone, o: Intl.DateTimeFormatOptions): string | null => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  try { return new Intl.DateTimeFormat("en-US", { ...o, ...(z.timeZone ? { timeZone: z.timeZone } : {}) }).format(new Date(t)); } catch { return null; }
};
/** "Oct 16" in the viewer's zone (a bare YYYY-MM-DD day is that calendar day). */
export function dayText(iso: string, z: ClockZone): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return parts(`${iso}T12:00:00Z`, { now: z.now, timeZone: "UTC" }, { month: "short", day: "numeric" });
  return parts(iso, z, { month: "short", day: "numeric" });
}
/** "Sun 2:25 pm MDT" within seven days of now, else "Oct 26, 2:25 pm MDT"; always with the zone. */
export function timeText(iso: string, z: ClockZone): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const near = Math.abs(t - z.now) < 7 * 86_400_000;
  const s = parts(iso, z, near ? { weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  return s ? s.replace(/^([A-Z][a-z]{2}),/, "$1").replace(/[\u202f\u00a0]/g, " ").replace(/\b(AM|PM)\b/, (m) => m.toLowerCase()) : null;
}

// ---- the result line of a decided coin ----

const NEXT_WORDS: Record<Exclude<ResultNext, "end-sink">, string> = {
  "burn-after-graduation": "Burn after graduation.",
  burned: "The burn is done.",
  "burn-waiting": "The burn waits for its pool.",
  "no-burn-losing": "No burn on the losing side.",
  "no-burn": "Nothing burns on it.",
  nothing: "No further result is read.",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One line: the result, the settled day, what happens next. Null for a coin with no result. */
export function resultLine(r: ListResult | null | undefined, z: ClockZone): string | null {
  if (!r) return null;
  const day = r.settledAt ? dayText(r.settledAt, z) : null;
  const on = day ? ` on ${day}` : "";
  const head = r.outcome === "won" ? `Won${on}.`
    : r.outcome === "lost" ? `Lost${on}.`
    : r.outcome === "draw" ? `A draw${on}.`
    : r.outcome === "void" ? `Voided${on}.`
    : r.outcome === "ended" ? `The rule ended${on}.`
    : r.words ? `Settled ${r.words}${on}.` : `Settled${on}.`;
  const tail = r.next === "end-sink" ? (r.sink ? `${cap(r.sink)}.` : NEXT_WORDS.nothing) : NEXT_WORDS[r.next];
  return `${head} ${tail}`;
}

// ---- the next-result line of an open coin ----

/** One line, a fact: when the source is read for the result, its cadence, a market's stated close, or that it resolves once. */
export function nextResultLine(n: ListNext | null | undefined, z: ClockZone): string | null {
  if (!n) return null;
  const at = n.at ? timeText(n.at, z) : null;
  const past = n.at !== null && Number.isFinite(Date.parse(n.at)) && Date.parse(n.at) < z.now;
  if (n.shape === "game") return at ? `Result after the game, read ${past ? "since" : "from"} ${at}.` : "Result after the game.";
  if (n.shape === "season") return at ? `Result after each game, next read ${past ? "due since" : "from"} ${at}.` : "Result after each game.";
  if (n.shape === "feed") return n.cadence ? `Result read ${n.cadence.replace(/\.$/, "")}.` : "Result read when the source publishes.";
  const end = n.windowEnd ? dayText(n.windowEnd, z) : null;
  if (n.shape === "market") return at ? `Market close stated as ${at}.` : end ? `Resolves once, window ends ${end}.` : "Result once the market settles.";
  return end ? `Resolves once, window ends ${end}.` : "Resolves once.";
}

/** A card with its list lines: the result line for a decided or void coin, the next-result line for an open one. */
export function withListLines<V extends object>(v: V, listing: CoinListing | null | undefined, z: ClockZone): V & { resultLine: string | null; nextLine: string | null } {
  if (!listing) return { ...v, resultLine: null, nextLine: null };
  return { ...v, resultLine: listing.group === "open" ? null : resultLine(listing.result, z), nextLine: listing.group === "open" ? nextResultLine(listing.next, z) : null };
}

// ---- "Open only", remembered per browser ----

export const OPEN_ONLY_KEY = "bt-coins-open-only";
type StorageLike = Pick<Storage, "getItem" | "setItem"> | null | undefined;
/** Off unless this browser saved "1"; a missing or throwing storage is off. */
export function readOpenOnly(s: StorageLike): boolean {
  try { return s?.getItem(OPEN_ONLY_KEY) === "1"; } catch { return false; }
}
/** Saves the choice; a missing or throwing storage is ignored (the toggle still works for this visit). */
export function writeOpenOnly(s: StorageLike, on: boolean): void {
  try { s?.setItem(OPEN_ONLY_KEY, on ? "1" : "0"); } catch { /* private window or blocked storage */ }
}
/** The page's own storage, or null where reading it throws. */
export function browserStorage(): StorageLike {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

// ---- the Pairs tab's row words (HS-41, hourly run 7) ----

/** HS-41: the Pairs tab says "no burn yet" where a side has never burned, instead of a dash. */
export const PAIR_NO_BURN_YET = "no burn yet";
/**
 * HS-41: a decided pair's one line under its row, from the two sides' own result lines (the same words the New tab's cards say):
 * "$DENWIN won on Oct 16; $SEAWIN lost. Burn after graduation." Null while neither side is decided.
 */
export function pairDecidedRowLine(a: { ticker: string; listing?: CoinListing | null }, b: { ticker: string; listing?: CoinListing | null }, z: ClockZone): string | null {
  const side = (s: { ticker: string; listing?: CoinListing | null }) => (s.listing && s.listing.group !== "open" && s.listing.result && (s.listing.result.outcome === "won" || s.listing.result.outcome === "lost") ? { ticker: s.ticker, r: s.listing.result } : null);
  const sa = side(a), sb = side(b);
  const w = sa?.r.outcome === "won" ? sa : sb?.r.outcome === "won" ? sb : null;
  const l = sa?.r.outcome === "lost" ? sa : sb?.r.outcome === "lost" ? sb : null;
  if (!w && !l) return null;
  const first = w ?? l!;
  const day = first.r.settledAt ? dayText(first.r.settledAt, z) : null;
  const on = day ? ` on ${day}` : "";
  const head = w && l ? `$${w.ticker} won${on}; $${l.ticker} lost.` : w ? `$${w.ticker} won${on}.` : `$${l!.ticker} lost${on}.`;
  const next = (w ?? l!).r.next;
  const tail = next === "end-sink" ? NEXT_WORDS.nothing : NEXT_WORDS[next];
  return `${head} ${tail}`;
}
