import { utcDay } from "@/lib/burnticker/utcWords";
import { rawToTokens } from "@/lib/burnKeeper/rules";
import type { Registry, ReceiptRow, TokenRow } from "@/lib/burnticker/registry";

/**
 * THE LEADERBOARD (cheap-features pass item 3, owner 2026-10-13): four lists under Coins, read-only from the registry's receipts. No
 * network read, no chain read, no market data; launched coins only (drafts and expired drafts are left out).
 *
 *   mostBurned      tokens burned in total by each coin (confirmed receipts)
 *   biggestBurn     the largest single burns (one receipt each)
 *   longestStreak   the longest run of results in a row that each burned (a result that burned nothing ends a run; one still waiting
 *                   for its run is not counted either way)
 *   newestReceipt   the newest confirmed receipts
 *
 * A burn count is a count of receipts, not a prize: nothing is won. Memoised per minute (and per registry), so the page and the API
 * cost one pass over the receipts a minute.
 */
export const LEADERBOARD_ROWS = 10;
const ZERO = BigInt(0);

export interface LeaderRow { rank: number; ticker: string; name: string; mint: string; page: string; value: string; detail: string; at: string | null; signature: string | null }
export interface Leaderboard { generatedAt: string; coins: number; mostBurned: LeaderRow[]; biggestBurn: LeaderRow[]; longestStreak: LeaderRow[]; newestReceipt: LeaderRow[]; labels: Record<"mostBurned" | "biggestBurn" | "longestStreak" | "newestReceipt", string>; note: string }

export const LEADERBOARD_LABELS: Leaderboard["labels"] = {
  mostBurned: "Most burned",
  biggestBurn: "Biggest single burn",
  longestStreak: "Longest streak",
  newestReceipt: "Newest receipt",
};
export const LEADERBOARD_NOTE = "Counted from the receipts this site records. A receipt is a record of what the rule burned, and nothing is won. Tokens are whole tokens of each coin, so two coins' amounts are not comparable as money. Only coins registered on this site are counted. $DEFICIT runs on its own keeper, so its receipts are on its own page, not here. Test coins are left out.";

type Reader = Pick<Registry, "tokens" | "receipts"> & Partial<Pick<Registry, "testTokens">>;
const burned = (r: ReceiptRow): bigint => (r.status === "confirmed" ? r.burnRaw ?? ZERO : ZERO);
const group = (s: string): string => { const [w, f] = s.split("."); return `${w.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${f ? `.${f.slice(0, 2)}` : ""}`; };
const tokens = (raw: bigint): string => rawToTokens(raw, 6);
const SETTLED_ORDER = (a: ReceiptRow, b: ReceiptRow) => (a.settledAt === b.settledAt ? (a.eventId < b.eventId ? -1 : 1) : a.settledAt < b.settledAt ? -1 : 1);

/** The longest run of consecutive burning results (and the current run) in a coin's receipts. */
export function streaksOf(rows: readonly ReceiptRow[]): { longest: number; current: number; endedAt: string | null } {
  let run = 0, longest = 0, endedAt: string | null = null;
  for (const r of [...rows].sort(SETTLED_ORDER)) {
    if (r.status === "planned" || r.status === "sending" || r.status === "pending-pair") continue;
    if (burned(r) > ZERO) { run++; if (run > longest) { longest = run; endedAt = r.settledAt; } } else run = 0;
  }
  return { longest, current: run, endedAt };
}

/** Builds the four lists (pure over the registry rows). */
export function buildLeaderboard(reg: Reader, now = Date.now(), pageOf: (t: TokenRow) => string = (t) => `/burnticker/t/${encodeURIComponent(t.mint)}`): Leaderboard {
  // owner 2026-10-14: a coin the operator marked test (testCoins.ts) is left off the lists
  const tests = new Set((() => { try { return reg.testTokens?.() ?? []; } catch { return []; } })().map((x) => x.mint));
  const coins = reg.tokens().filter((t) => t.status !== "draft" && t.status !== "expired" && !tests.has(t.mint));
  const most: (LeaderRow & { raw: bigint })[] = [], big: (LeaderRow & { raw: bigint })[] = [], streak: (LeaderRow & { n: number })[] = [], newest: (LeaderRow & { key: string })[] = [];
  for (const t of coins) {
    const rows = reg.receipts(t.mint);
    const base = { rank: 0, ticker: t.ticker, name: t.name, mint: t.mint, page: pageOf(t) };
    const burns = rows.filter((r) => burned(r) > ZERO);
    const total = burns.reduce((a, r) => a + burned(r), ZERO);
    if (total > ZERO) most.push({ ...base, raw: total, value: tokens(total), detail: `${group(tokens(total))} $${t.ticker} burned on ${burns.length} ${burns.length === 1 ? "receipt" : "receipts"}.`, at: burns.map((r) => r.settledAt).sort().pop() ?? null, signature: null });
    for (const r of burns) big.push({ ...base, raw: burned(r), value: tokens(burned(r)), detail: `${group(tokens(burned(r)))} $${t.ticker} burned on the result of ${utcDay(r.settledAt)}.`, at: r.settledAt, signature: r.signature });
    const s = streaksOf(rows);
    if (s.longest > 0) streak.push({ ...base, n: s.longest, value: String(s.longest), detail: `${s.longest} ${s.longest === 1 ? "result" : "results"} in a row that each burned${s.current === s.longest ? ", and the run is still going" : ""}.`, at: s.endedAt, signature: null });
    for (const r of rows.filter((x) => x.status === "confirmed")) newest.push({ ...base, key: `${r.settledAt}|${r.eventId}`, value: tokens(burned(r)), detail: burned(r) > ZERO ? `${group(tokens(burned(r)))} $${t.ticker} burned on the result of ${utcDay(r.settledAt)}.` : `A receipt for the result of ${utcDay(r.settledAt)}, which burned nothing.`, at: r.settledAt, signature: r.signature });
  }
  const top = <T extends LeaderRow>(xs: T[], cmp: (a: T, b: T) => number): LeaderRow[] => xs.sort(cmp).slice(0, LEADERBOARD_ROWS).map((x, i) => ({ rank: i + 1, ticker: x.ticker, name: x.name, mint: x.mint, page: x.page, value: x.value, detail: x.detail, at: x.at, signature: x.signature }));
  const big2 = (a: bigint, b: bigint) => (a === b ? 0 : a > b ? -1 : 1);
  return {
    generatedAt: new Date(now).toISOString(), coins: coins.length,
    mostBurned: top(most, (a, b) => big2(a.raw, b.raw) || a.ticker.localeCompare(b.ticker)),
    biggestBurn: top(big, (a, b) => big2(a.raw, b.raw) || (a.at ?? "").localeCompare(b.at ?? "")),
    longestStreak: top(streak, (a, b) => b.n - a.n || a.ticker.localeCompare(b.ticker)),
    newestReceipt: top(newest, (a, b) => b.key.localeCompare(a.key)),
    labels: LEADERBOARD_LABELS, note: LEADERBOARD_NOTE,
  };
}

const memo = new WeakMap<object, { minute: number; v: Leaderboard }>();
/** The leaderboard, memoised per minute per registry. */
export function leaderboard(reg: Reader, now = Date.now(), pageOf?: (t: TokenRow) => string): Leaderboard {
  const minute = Math.floor(now / 60_000);
  const hit = memo.get(reg);
  if (hit && hit.minute === minute) return hit.v;
  const v = buildLeaderboard(reg, now, pageOf);
  memo.set(reg, { minute, v });
  return v;
}
