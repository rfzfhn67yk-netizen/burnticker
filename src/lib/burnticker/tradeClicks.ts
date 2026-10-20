import { goDestination, type GoVenue } from "@/lib/burnticker/tradeLinks";
import { heavyRefusal, RateLimiter } from "@/lib/burnticker/api/http";

/**
 * COUNTED TRADE LINKS (campaign readiness 2026-10-19, item 5). GET /burnticker/go/<venue>?mint=<mint>[&to=swap] answers 302 to the
 * exact address the link used to carry (tradeLinks.ts goDestination: Raydium's launchpad page, Raydium's swap, or Jupiter), and adds
 * one to a counter for the coin, the venue and the UTC day. The counter is a row in the registry's `status` table
 * ("trade-clicks:<day>:<mint>:<venue>", the value a count): no cookie is read or set, and no address, user agent or referrer is
 * stored. The rate limiter keys its buckets in memory only, like every other route. Only a coin this site lists is redirected (a
 * registry row that is not expired, or $DEFICIT's own mint); anything else is a 404, so the route is never an open redirect.
 * The per-coin daily counts are published in ops.json only (checkin.ts buildOpsJson).
 */
export const TRADE_CLICK_PREFIX = "trade-clicks:";
export const GO_VENUES: readonly GoVenue[] = ["raydium", "jupiter"];
/** How many days of counts ops.json carries. */
export const TRADE_CLICK_DAYS = 14;
export interface TradeClickRow { day: string; mint: string; venue: string; clicks: number }

/** The registry's statement surface this file needs (Registry.db, or any node:sqlite DatabaseSync). */
interface Db { prepare(sql: string): { run(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] } }

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const day = (now: number): string => new Date(now).toISOString().slice(0, 10);

/** Adds one click for the coin, the venue and today's UTC day. */
export function countTradeClick(db: Db, mint: string, venue: GoVenue, now = Date.now()): void {
  db.prepare(`INSERT INTO status (key, value, updated_at) VALUES (?, '1', ?)
    ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(status.value AS INTEGER) + 1 AS TEXT), updated_at = excluded.updated_at`).run(`${TRADE_CLICK_PREFIX}${day(now)}:${mint}:${venue}`, now);
}

/** The counts of the last `days` UTC days, newest day first, then by mint and venue. */
export function tradeClickCounts(db: Db, now = Date.now(), days = TRADE_CLICK_DAYS): TradeClickRow[] {
  const from = day(now - (days - 1) * 86_400_000);
  const rows = db.prepare("SELECT key, value FROM status WHERE key >= ? AND key < ? ORDER BY key").all(`${TRADE_CLICK_PREFIX}${from}`, `${TRADE_CLICK_PREFIX}￿`) as { key: string; value: string }[];
  return rows.flatMap((r) => {
    const [d, mint, venue] = r.key.slice(TRADE_CLICK_PREFIX.length).split(":");
    const clicks = Number(r.value);
    return d && mint && venue && Number.isFinite(clicks) ? [{ day: d, mint, venue, clicks }] : [];
  }).sort((a, b) => b.day.localeCompare(a.day) || a.mint.localeCompare(b.mint) || a.venue.localeCompare(b.venue));
}

/** The redirect's own limiter: the read bucket's sizes (120, then 120 a minute) on a limiter of its own. */
export const goLimiter = new RateLimiter();

export interface GoDeps {
  /** whether this site lists the coin (a registry row that is not expired, or $DEFICIT's mint) */
  listed: (mint: string) => boolean;
  /** the click counter (countTradeClick on the registry) */
  count: (mint: string, venue: GoVenue, now: number) => void;
  now?: number;
  limiter?: RateLimiter;
}

const NO_STORE = { "cache-control": "no-store", "referrer-policy": "no-referrer" } as const;
const refuse = (status: number, error: string): Response =>
  new Response(JSON.stringify({ ok: false, error }), { status, headers: { ...NO_STORE, "content-type": "application/json; charset=utf-8" } });

/** The whole route: rate limit, check the venue and the coin, count once, answer 302 with no-store. */
export function goRedirect(req: Request, venue: string, deps: GoDeps): Response {
  const now = deps.now ?? Date.now();
  const limited = heavyRefusal(req, deps.limiter ?? goLimiter, now, "read");
  if (limited) return limited;
  const q = new URL(req.url).searchParams;
  const mint = (q.get("mint") ?? "").trim();
  if (!(GO_VENUES as readonly string[]).includes(venue)) return refuse(404, "This site has no trade link of that kind.");
  if (!MINT.test(mint)) return refuse(400, "The link needs a coin's mint address.");
  if (!deps.listed(mint)) return refuse(404, "This site does not list a coin with that mint address.");
  const to = q.get("to") === "swap" ? "swap" : null;
  const dest = goDestination(venue, mint, to);
  if (!dest) return refuse(404, "This site has no trade link of that kind.");
  try { deps.count(mint, venue as GoVenue, now); } catch { /* a counter that cannot be written never blocks the trade link */ }
  return new Response(null, { status: 302, headers: { ...NO_STORE, location: dest } });
}
