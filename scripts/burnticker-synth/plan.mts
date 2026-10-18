// The synthetic creator's decisions that need no browser (2026-10-15, the devnet bank and the box's slow address search): which
// instance (the one with the devnet mint bank, or the one with an empty bank) each scenario runs on, how long a press of Launch may
// wait for the browser's address search on this host, what to say when a press times out, and how the team and rivalry forms are
// filled from the league's own team list. Pure functions; scripts/burnticker-synthetic-creator.mts drives the browser with them and
// test/burntickerSynthPlan.test.ts tests them.

// ---- which instance each scenario runs on -------------------------------------------------------------------------------------------

/** The one scenario that must see an empty bank: it proves the page's fallback, the browser search for a burn address. */
export const EMPTY_BANK_SCENARIO = "d-mint-source";

export interface BankPlan { base: string; expect: "empty" | "filled" | null; why: string }

/**
 * Where a scenario runs and what it asserts about the mint source. With `emptyBase` (the box: a second devnet instance with no bank
 * key), d-mint-source runs there and must see the fallback, and every other scenario runs on `base` (the instance with the devnet bank;
 * a bank that ran dry only makes the page search, which is said in the scenario's detail, never failed). Without it, everything runs on
 * `base` and d-mint-source asserts what BURNTICKER_SYNTH_EXPECT_BANK says, if anything.
 */
export function bankPlan(scenario: string, o: { base: string; emptyBase: string | null; expectEnv: "" | "empty" | "filled" }): BankPlan {
  if (scenario !== EMPTY_BANK_SCENARIO) return { base: o.base, expect: null, why: "the bank instance; an empty bank only makes the page search" };
  if (o.emptyBase) return { base: o.emptyBase, expect: "empty", why: "the empty-bank instance: the page must fall back to the browser search" };
  return { base: o.base, expect: o.expectEnv || null, why: o.expectEnv ? `BURNTICKER_SYNTH_EXPECT_BANK=${o.expectEnv}` : "no expectation: the report says which source the host used" };
}

/** Where a launch's addresses came from, read from the launch requests the page made. */
export function mintSourceOf(prepares: readonly { status: number | null; code: string | null; ownMint: boolean }[]): "bank" | "browser" | "none" {
  if (prepares.some((p) => p.code === "mint-bank-empty") || prepares.some((p) => p.ownMint)) return "browser";
  return prepares.some((p) => p.status === 200) ? "bank" : "none";
}

// ---- how long a press of Launch may wait ----------------------------------------------------------------------------------------------

/** The wait after a press of Launch, whatever the host: at least five minutes, at most fifteen. */
export const HUNT_WAIT_FLOOR_MS = 300_000;
export const HUNT_WAIT_CEILING_MS = 900_000;
/** Time for everything that is not the search: the launch request, the bundle, the wallet list. */
export const HUNT_WAIT_SLACK_MS = 60_000;
/**
 * The search is memoryless: the tries until a burn address are geometric (exponential in time), so the wait covers the 95th
 * percentile. One address: -ln(0.05) = 3.0 mean times. Two (a pair, found by the same workers): the 95th percentile of a gamma(2), 4.74.
 */
export const HUNT_QUANTILE: Readonly<Record<1 | 2, number>> = { 1: 3.0, 2: 4.74 };

/**
 * The wait for one press of Launch from the browser's measured search rate (keys a second, all workers) and the expected tries per
 * address (vanityMint.ts expectedTries, about 5.66 million): slack + quantile × mean search time, between the floor and the ceiling.
 * No rate (the measurement failed): the ceiling. An explicit override (BURNTICKER_SYNTH_MINT_SEARCH_MS) wins, still clamped.
 */
export function huntWaitMs(o: { rate: number | null; addresses: 1 | 2; expectedTries: number; overrideMs?: number | null }): number {
  const clamp = (x: number) => Math.round(Math.min(HUNT_WAIT_CEILING_MS, Math.max(HUNT_WAIT_FLOOR_MS, x)));
  if (o.overrideMs && o.overrideMs > 0) return clamp(o.overrideMs);
  if (!o.rate || !Number.isFinite(o.rate) || o.rate <= 0) return HUNT_WAIT_CEILING_MS;
  return clamp(HUNT_WAIT_SLACK_MS + HUNT_QUANTILE[o.addresses] * (o.expectedTries / o.rate) * 1000);
}

/** The report's line for the measured rate. */
export function huntRateLine(h: { rate: number | null; workers: number; engine: string | null; problem: string | null }, expectedTries: number, waits: { one: number; two: number }): string {
  if (!h.rate) return `The browser's address search rate could not be measured here (${h.problem ?? "no answer"}), so a press of Launch waits up to ${Math.round(waits.one / 1000)} s.`;
  return `Browser address search on this host: ${Math.round(h.rate).toLocaleString("en-US")} keys a second on ${h.workers} ${h.workers === 1 ? "worker" : "workers"} (${h.engine ?? "?"}), about ${Math.round(expectedTries / h.rate)} s per address; a press of Launch waits up to ${Math.round(waits.one / 1000)} s for one address and ${Math.round(waits.two / 1000)} s for two.`;
}

// ---- what the page was doing when a press timed out ----------------------------------------------------------------------------------

export interface StallState {
  /** the search panel's state (data-mint-search), null when no panel shows */
  search: string | null;
  tries: number | null;
  workers: number | null;
  /** launch requests sent and not answered yet, with the oldest one's age */
  pendingLaunch: number;
  pendingForMs: number | null;
  /** the last answered launch request */
  lastAnswer: { status: number | null; code: string | null } | null;
  /** the review's "Launching" line (ReviewCard data-launching) */
  launching: boolean;
  walletList: boolean;
  /** signature requests the test wallet is still holding (the slow mode) */
  walletBusy: number;
  walletConnected: boolean;
  launchEnabled: boolean | null;
  alert: string | null;
}

const n = (x: number) => Math.round(x).toLocaleString("en-US");

/** One sentence: what the page was doing when the wait ran out (never the page's whole text). */
export function describeStall(s: StallState, o: { waitedMs: number; expectedTries: number }): string {
  const waited = `within ${Math.round(o.waitedMs / 1000)} s of pressing Launch`;
  if (s.search === "searching") {
    const tries = s.tries ?? 0;
    return `Nothing happened ${waited}: the page was still hunting for an address that ends in burn, with ${n(tries)} tries so far on ${s.workers ?? "?"} ${s.workers === 1 ? "worker" : "workers"} (about ${n(o.expectedTries)} expected per address, so ${(tries / o.expectedTries).toFixed(1)} addresses' worth).`;
  }
  if (s.pendingLaunch > 0) return `Nothing happened ${waited}: the page was waiting for the launch service, which had not answered its request${s.pendingForMs !== null ? ` after ${Math.round(s.pendingForMs / 1000)} s` : ""} (it takes the address from the host's bank and builds the launch).`;
  if (s.walletBusy > 0) return `Nothing happened ${waited}: the page was waiting for the wallet, which still held ${s.walletBusy === 1 ? "a signature request" : `${s.walletBusy} signature requests`}.`;
  if (s.walletList) return `Nothing happened ${waited}: the page was waiting for the wallet, with the wallet list open.`;
  if (!s.walletConnected) return `Nothing happened ${waited}: the page was waiting for the wallet, which was not connected.`;
  if (s.search === "found" || s.search === "failed") return `Nothing happened ${waited}: the address search ended (${s.search}) but the page went no further.${s.alert ? ` Its last message: ${s.alert}` : ""}`;
  const last = s.lastAnswer ? ` The last launch request answered HTTP ${s.lastAnswer.status ?? "?"}${s.lastAnswer.code ? ` (${s.lastAnswer.code})` : ""}.` : " No launch request was made.";
  const button = s.launchEnabled === null ? "" : s.launchEnabled ? " Launch was enabled again." : " Launch was still off.";
  return `Nothing happened ${waited}: no address search, no pending launch request and no wallet prompt${s.launching ? ", though the review still said it was launching" : ""}.${last}${button}${s.alert ? ` Its last message: ${s.alert}` : ""}`;
}

// ---- the team and rivalry forms ---------------------------------------------------------------------------------------------------

/** A team as GET /api/burnticker/v1/sports/teams lists it (the page's own list). */
export interface ListedTeam {
  abbr: string; name: string; nickname: string | null;
  next: { eventId: string; startsAt: string | null; opponent: string | null; live?: boolean } | null;
  season?: { status?: string | null } | null;
}

/** The leagues tried in order (BURNTICKER_SYNTH_LEAGUES): the free official feeds first, so no licensed key is needed in season. */
export const DEFAULT_SYNTH_LEAGUES = ["nhl", "mlb", "nba", "nfl"] as const;
/** A game that starts sooner than this is not picked (a coin on a game about to start may be refused, and real chain takes minutes). */
export const MIN_LEAD_MS = 3 * 3_600_000;

const upcoming = (t: ListedTeam, now: number) => !!t.next && !t.next.live && !!t.next.startsAt && Date.parse(t.next.startsAt) - now >= MIN_LEAD_MS;
const seasonOpen = (t: ListedTeam) => t.season?.status !== "over" && t.season?.status !== "none-listed";
/** A rotation that changes daily, so the nightly run does not launch the same team every night (the lookalike guard is per name). */
const rotate = <T,>(xs: readonly T[], now: number): T[] => { if (!xs.length) return []; const k = Math.floor(now / 86_400_000) % xs.length; return [...xs.slice(k), ...xs.slice(0, k)]; };

/** The team for a team coin: one whose season is open, preferring one with a game ahead. */
export function pickTeam(teams: readonly ListedTeam[], now: number): ListedTeam | null {
  const open = teams.filter(seasonOpen);
  return rotate(open.filter((t) => upcoming(t, now)), now)[0] ?? rotate(open, now)[0] ?? null;
}

/**
 * Two teams for a rivalry pair that meet in a listed game at least MIN_LEAD_MS away: team A's next game and the team it names. The
 * page lists the one-game choices from the league's schedule (GET /v1/sports/rivalry), so the game is pressed by its event id when
 * shown, else the first listed meeting.
 */
export function pickRivals(teams: readonly ListedTeam[], now: number): { a: ListedTeam; b: ListedTeam; eventId: string } | null {
  for (const a of rotate(teams.filter((t) => seasonOpen(t) && upcoming(t, now)), now)) {
    const opp = (a.next!.opponent ?? "").trim().toLowerCase();
    if (!opp) continue;
    const b = teams.find((t) => t.abbr !== a.abbr && [t.nickname, t.name].some((x) => (x ?? "").toLowerCase() === opp || (x ?? "").toLowerCase().endsWith(` ${opp}`)));
    if (b) return { a, b, eventId: a.next!.eventId };
  }
  return null;
}

/** The two tickers of a synthetic pair: distinct, 2 to 10 letters or digits, A and B on the end. */
export function pairTickersFor(base: string): [string, string] {
  const t = base.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 9);
  return [`${t}A`, `${t}B`];
}

/** What the name step gets: the i-th name and ticker inputs, in page order (side A, then side B). */
export function nameStepFills(tickers: readonly string[]): { index: number; name: string; ticker: string }[] {
  return tickers.map((t, index) => ({ index, name: `Synthetic ${t}`, ticker: t }));
}

// ---- which browser requests are the wallet connection's RPC ---------------------------------------------------------------------------

/** The site's own RPC proxy path (rpcProxy.ts RPC_PROXY_PATH) and its flight-token path, which is not an RPC call. */
export const SYNTH_RPC_PROXY_PATH = "/api/burnticker/rpc";
export const SYNTH_RPC_FLIGHT_PATH = "/api/burnticker/rpc/flight";

const trimPath = (p: string): string => p.replace(/\/+$/, "") || "/";

/**
 * Which kind of wallet RPC request a browser URL is, or null when it is none (2026-10-18: a-event landed on devnet, but the run said the
 * page never sent a transaction, because the harness only watched the baked endpoint and the page no longer calls it):
 *   "proxy"  the site's proxy on the page's OWN origin, with any query string. Since publish 78 the wallet shell rewrites a cross-origin
 *            proxy endpoint to the page's origin (walletShell.ts sameOriginProxy), and since publish 75 the sign card's reads and sends
 *            carry a flight token in a header (rpcProxy.ts withFlight); the URL itself is still the bare proxy path.
 *   "baked"  the endpoint baked into the build (BURNTICKER_SYNTH_BROWSER_RPC), same origin and path, any query string (a keyed URL).
 * The flight-token path (a GET beside the proxy) is never an RPC call, on either origin.
 */
export function browserRpcKind(url: string | URL, o: { browserRpc: string; pageOrigins: readonly string[] }): "proxy" | "baked" | null {
  let u: URL;
  try { u = new URL(String(url)); } catch { return null; }
  const p = trimPath(u.pathname);
  if (p === SYNTH_RPC_FLIGHT_PATH) return null;
  const sameOrigin = (x: string): boolean => { try { return new URL(x).origin === u.origin; } catch { return false; } };
  if (p === SYNTH_RPC_PROXY_PATH && o.pageOrigins.some(sameOrigin)) return "proxy";
  try { const b = new URL(o.browserRpc); if (b.origin === u.origin && trimPath(b.pathname) === p) return "baked"; } catch { /* no baked endpoint */ }
  return null;
}

/** The JSON-RPC calls in a request body (one call or a batch), so sends and dry runs are counted apart. */
export function rpcCallsOf(postData: string | null): { method: string; id: unknown; params: unknown }[] {
  let body: unknown = null;
  try { body = JSON.parse(postData ?? "null"); } catch { return []; }
  return (Array.isArray(body) ? body : [body])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && typeof (c as { method?: unknown }).method === "string")
    .map((c) => ({ method: String(c.method), id: c.id, params: c.params }));
}
