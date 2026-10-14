import { tokenPageData, type Platform } from "@/lib/burnticker/server";
import { fail, ok, okRaw, type ApiResult } from "@/lib/burnticker/api/http";
import { lookupCoin, sharedTickerBody } from "@/lib/burnticker/coinLookup";
import { coinCanonicalHref } from "@/lib/burnticker/coinKey";
import { API_PREFIX } from "@/lib/burnticker/api/spec";
import { calendarIcs, coinCalendar, type CoinCalendar } from "@/lib/burnticker/calendar";
import { leaderboard } from "@/lib/burnticker/leaderboard";
import { buildDigest, digestDay } from "@/lib/burnticker/digest";
import { checklistOf } from "@/lib/burnticker/checklist";
import { markUsed, queueView } from "@/lib/burnticker/postApproval";
import { opsAllowed } from "@/lib/burnticker/api/product";
import { receiptCardPath } from "@/lib/burnticker/receiptCardServe";
import type { TokenRow } from "@/lib/burnticker/registry";

/**
 * THE CHEAP-FEATURES PASS IN THE PUBLIC API (owner 2026-10-13; OpenAPI 1.18.0; featuresSpec.ts): a coin's burn calendar (JSON and
 * .ics), its post-launch checklist, the leaderboard, the daily digest, and the operator's post-approval queue (list and mark used,
 * operator only, never posts). Read-only apart from the operator's "used" marks, which go to their own append-only file.
 */
const ZERO = BigInt(0);
const decode = (s: string): string => { try { return decodeURIComponent(s); } catch { return s; } };
const pageOf = (t: Pick<TokenRow, "mint">): string => coinCanonicalHref(t.mint);

/** One launched coin by mint (or by a ticker one coin holds); a 300 for a shared ticker, a 404 otherwise. Drafts count as found. */
function coin(p: Platform, id: string): { t: TokenRow } | { error: ApiResult } {
  const l = lookupCoin(p.registry, id);
  if (l.kind === "many") return { error: { status: 300, body: sharedTickerBody(p.registry, l) } };
  if (l.kind === "none" || l.token.status === "expired") return { error: fail(404, `There is no coin called ${decode(id)}.`) };
  return { t: l.token };
}

async function calendarFor(p: Platform, t: TokenRow, now: number): Promise<CoinCalendar> {
  const d = await tokenPageData(p, t, now).catch(() => null);
  return coinCalendar({
    ticker: t.ticker, mint: t.mint, page: pageOf(t), ics: `${API_PREFIX}/coins/${encodeURIComponent(t.mint)}/calendar.ics`,
    rule: p.registry.lockedRule(t).rule, next: d ? { nextCheckAt: d.status.next.nextCheckAt, nextCloseTime: d.status.next.nextCloseTime } : null,
    teamSeason: p.teamSeason ?? null, now,
  });
}

/** GET /coins/{mint}/calendar: the next scheduled readings (calendar.ts). */
export async function v1CoinCalendar(p: Platform, id: string, now = Date.now()): Promise<ApiResult> {
  const c = coin(p, id);
  if ("error" in c) return c.error;
  return ok(await calendarFor(p, c.t, now));
}

/** GET /coins/{mint}/calendar.ics: the same entries as an iCalendar file. */
export async function v1CoinCalendarIcs(p: Platform, id: string, origin: string, now = Date.now()): Promise<ApiResult> {
  const c = coin(p, id);
  if ("error" in c) return c.error;
  const cal = await calendarFor(p, c.t, now);
  return okRaw(calendarIcs(cal, { origin, now }), "text/calendar; charset=utf-8", { "content-disposition": `attachment; filename="${c.t.ticker}-readings.ics"` });
}

/** GET /coins/{mint}/checklist: created, trading, graduated, pool verified, first reading, first burn; the next action and who. */
export async function v1CoinChecklist(p: Platform, id: string, now = Date.now()): Promise<ApiResult> {
  const c = coin(p, id);
  if ("error" in c) return c.error;
  const t = c.t;
  const d = await tokenPageData(p, t, now).catch(() => null);
  const burns = p.registry.receipts(t.mint).filter((r) => r.status === "confirmed" && (r.burnRaw ?? ZERO) > ZERO).length;
  let readings = d ? d.readings.length : 0;
  if (!d) { try { readings = p.registry.readings(t.selectorKey, t.baselineAt).length; } catch { readings = 0; } }
  const s = d?.status ?? null;
  const cl = checklistOf({
    ticker: t.ticker, mint: t.mint, status: t.status, launched: t.status !== "draft" && t.status !== "expired",
    phase: s?.market?.phase ?? null, poolRegistered: s?.program ? (s.program.initialized ? s.program.pool.registered : false) : null, readings, burns,
  });
  return ok({ ...cl, page: pageOf(t), shareImage: receiptCardPath(t.mint) });
}

/** GET /leaderboard: most burned, biggest single burn, longest streak, newest receipt (memoised per minute). */
export function v1Leaderboard(p: Platform, now = Date.now()): ApiResult {
  return ok(leaderboard(p.registry, now, pageOf));
}

/** GET /digest?day=YYYY-MM-DD: one UTC day's results, burns, new coins and graduations (default today). */
export function v1Digest(p: Platform, q: URLSearchParams, now = Date.now()): ApiResult {
  const day = digestDay(q.get("day"), now);
  if (!day) return fail(400, "The day must be a calendar day written as YYYY-MM-DD, in UTC.");
  return ok(buildDigest(p.registry, day, now, pageOf));
}

type Env = Readonly<Record<string, string | undefined>>;
export interface QueueFiles { queueFile?: string; usedFile?: string }

/** GET /ops/post-queue?state=: the owner's post queue with each post's state. Operator only. Never posts. */
export function v1OpsPostQueue(req: Request, q: URLSearchParams, env: Env = process.env, files: QueueFiles = {}): ApiResult {
  const denied = opsAllowed(req, env);
  if (denied) return denied;
  const state = q.get("state") ?? "all";
  if (!["waiting", "used", "all"].includes(state)) return fail(400, "The state must be waiting, used or all.");
  try { return ok(queueView({ ...files, state: state as "waiting" | "used" | "all" })); } catch (e) { return fail(500, `The post queue could not be read. The reason given was: ${(e as Error).message.slice(0, 160)}`); }
}

/** POST /ops/post-queue/used { id, note? }: marks one queued post as used. Operator only. Appends a mark; never posts. */
export function v1OpsPostUsed(req: Request, body: Record<string, unknown> | null, env: Env = process.env, files: QueueFiles = {}, now = Date.now()): ApiResult {
  const denied = opsAllowed(req, env);
  if (denied) return denied;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) return fail(400, "Send the queued post's id as id.");
  const r = markUsed(id, { ...files, now, note: typeof body?.note === "string" ? body.note : "" });
  if (r.status === "not-found") return fail(404, `No queued post has the id ${id.slice(0, 40)}.`);
  return ok({ ok: true, id, status: r.status, usedAt: r.at, note: "Marked as used. Nothing was posted." });
}
