import { rawToTokens } from "@/lib/burnKeeper/rules";
import type { Registry, TokenRow } from "@/lib/burnticker/registry";
import { REGISTER_EVENT, REGISTER_POOL_EVENT } from "@/lib/burnticker/lockFeesKeeper";
import { SHORT_DISCLAIMER, fmtDay } from "@/lib/launch/dailyPost";
import { DIGEST_FORMAT, type Draft } from "@/lib/launch/postQueue";

/**
 * THE DAILY DIGEST (cheap-features pass item 8, owner 2026-10-13): one UTC day of the platform, read-only from the registry. GET
 * /v1/digest?day=YYYY-MM-DD answers it, the /burnticker/digest page shows it, and the post generator (scripts/burnticker-posts.mts
 * digest) turns a saved answer into one lint-checked post for the owner's queue. Nothing posts by itself.
 *
 *   readings      results recorded that day for a launched coin's source (one row per result, with the coins that read it)
 *   burns         confirmed burns recorded that day (the day the burn was confirmed, else the result's day)
 *   newCoins      coins whose launch time falls on that day
 *   graduations   coins whose graduated pool this site registered that day (the first register-fee-key or register-pool transaction the
 *                 keeper sent); a graduation registered by someone else shows on the coin page, not here
 */
const ZERO = BigInt(0);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface DigestReading { selectorKey: string; id: string; at: string; result: string | null; value: string | null; title: string | null; coins: string[] }
export interface DigestBurn { ticker: string; mint: string; page: string; eventId: string; tokens: string; at: string; signature: string | null }
export interface DigestCoin { ticker: string; name: string; mint: string; page: string; at: string }
export interface Digest {
  day: string; generatedAt: string;
  counts: { readings: number; burns: number; newCoins: number; graduations: number };
  readings: DigestReading[]; burns: DigestBurn[]; newCoins: DigestCoin[]; graduations: DigestCoin[];
  lines: string[]; note: string;
}

/** The day a request names, or today (UTC); null when it is not a real calendar day. */
export function digestDay(q: string | null | undefined, now = Date.now()): string | null {
  if (q === null || q === undefined || q === "") return new Date(now).toISOString().slice(0, 10);
  if (!DAY_RE.test(q)) return null;
  const t = Date.parse(`${q}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== q ? null : q;
}

const isoDay = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString().slice(0, 10));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const group = (s: string): string => { const [w, f] = s.split("."); return `${w.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${f ? `.${f.slice(0, 2)}` : ""}`; };

type Reader = Pick<Registry, "tokens" | "receipts" | "readings" | "signatures">;

export function buildDigest(reg: Reader, day: string, now = Date.now(), pageOf: (t: TokenRow) => string = (t) => `/burnticker/t/${encodeURIComponent(t.mint)}`): Digest {
  const coins = reg.tokens().filter((t) => t.status !== "draft" && t.status !== "expired");
  const bySelector = new Map<string, string[]>();
  for (const t of coins) bySelector.set(t.selectorKey, [...(bySelector.get(t.selectorKey) ?? []), t.ticker]);
  const readings: DigestReading[] = [];
  for (const [sel, tickers] of bySelector) {
    let rows: ReturnType<Reader["readings"]> = [];
    try { rows = reg.readings(sel); } catch { rows = []; }
    for (const r of rows) if (r.at.slice(0, 10) === day) readings.push({ selectorKey: sel, id: r.id, at: r.at, result: r.result ?? null, value: r.value ?? null, title: r.title ?? null, coins: tickers.map((x) => `$${x}`) });
  }
  readings.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const burns: DigestBurn[] = [], newCoins: DigestCoin[] = [], graduations: DigestCoin[] = [];
  for (const t of coins) {
    const page = pageOf(t);
    for (const r of reg.receipts(t.mint)) {
      if (r.status !== "confirmed" || (r.burnRaw ?? ZERO) <= ZERO) continue;
      const at = r.confirmedAt !== null ? new Date(r.confirmedAt).toISOString() : r.settledAt;
      if (at.slice(0, 10) === day) burns.push({ ticker: t.ticker, mint: t.mint, page, eventId: r.eventId, tokens: rawToTokens(r.burnRaw ?? ZERO, 6), at, signature: r.signature });
    }
    if (t.baselineAt.slice(0, 10) === day) newCoins.push({ ticker: t.ticker, name: t.name, mint: t.mint, page, at: t.baselineAt });
    const sent = [...reg.signatures(t.mint, REGISTER_EVENT), ...reg.signatures(t.mint, REGISTER_POOL_EVENT)].filter((s) => s.status !== "failed" && s.status !== "expired").map((s) => s.sentAt).sort((a, b) => a - b);
    if (sent.length && isoDay(sent[0]) === day) graduations.push({ ticker: t.ticker, name: t.name, mint: t.mint, page, at: new Date(sent[0]).toISOString() });
  }
  burns.sort((a, b) => a.at.localeCompare(b.at));
  const counts = { readings: readings.length, burns: burns.length, newCoins: newCoins.length, graduations: graduations.length };
  const lines = [
    `On ${day} (UTC) this site recorded ${plural(counts.readings, "result")}, ${plural(counts.burns, "burn")}, ${plural(counts.newCoins, "new coin")} and ${plural(counts.graduations, "graduation")}.`,
    ...burns.map((b) => `$${b.ticker} burned ${group(b.tokens)} tokens.`),
    ...newCoins.map((c) => `$${c.ticker} (${c.name}) launched.`),
    ...graduations.map((c) => `$${c.ticker} completed its curve, and its pool was registered.`),
  ];
  return { day, generatedAt: new Date(now).toISOString(), counts, readings, burns, newCoins, graduations, lines, note: "Read from this site's own records. Days are UTC. A result is a reading from a coin's source; a burn is a confirmed receipt." };
}

/**
 * The digest as one post for the owner's queue (the post generator's `digest` format): the day's counts, then the burns, cut to fit 280
 * X-characters with the short disclaimer. Lint-checked by postQueue.checkDraft like every post.
 */
export function digestPostText(d: Pick<Digest, "day" | "counts" | "burns" | "newCoins">, maxChars = 280): string {
  const head = `Burnticker, ${fmtDay(d.day)} (UTC): ${plural(d.counts.readings, "result")} read, ${plural(d.counts.burns, "burn")}, ${plural(d.counts.newCoins, "new coin")}, ${plural(d.counts.graduations, "graduation")}.`;
  const foot = `\n\n${SHORT_DISCLAIMER.replace(/^./, (c) => c.toUpperCase())}`;
  const body: string[] = [];
  for (const b of d.burns) {
    const line = `$${b.ticker}: ${group(b.tokens)} burned`;
    if ((head + "\n" + [...body, line].join("\n") + foot).length > maxChars - 20) { body.push(`and ${d.burns.length - body.length} more`); break; }
    body.push(line);
  }
  return `${head}${body.length ? `\n${body.join("\n")}` : ""}${foot}`;
}

/** The digest as a draft for the owner's queue (postQueue.ts checkDraft lints it; the owner posts by hand or not at all). */
export function digestDraft(d: Pick<Digest, "day" | "counts" | "burns" | "newCoins">): Draft {
  return { format: DIGEST_FORMAT, account: "@BurnTicker", subject: `digest ${d.day}`, posts: [digestPostText(d)] };
}
