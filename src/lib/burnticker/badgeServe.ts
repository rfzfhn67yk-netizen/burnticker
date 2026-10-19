import "server-only";
import { publicOrigin } from "@/lib/burnticker/coinArt";
import { tokenPageData, type Platform, type TokenPageOpts } from "@/lib/burnticker/server";
import { findToken, flagshipToken } from "@/lib/burnticker/api/v1";
import { readKeeperFiles } from "@/lib/burnticker/deficitQueue";
import { registryCoinKey } from "@/lib/burnticker/coinLookup";
import { BADGE_CACHE_SEC, BADGE_DISCLAIMER, BADGE_SCHEMA, badgePayloadProblems, coinBadge, pairBadge, renderBadgeSvg, seasonScope, snippets, type BadgeJson, type CoinBadgeJson, type SideInput } from "@/lib/burnticker/badge";
import type { TokenRow } from "@/lib/burnticker/registry";
import { safeParam } from "@/lib/burnticker/safeParam";

/**
 * Serving the receipt badge (badge.ts) from the registry: the coin page's own status + receipts (tokenPageData), one memo per
 * (coin or pair, origin) for BADGE_CACHE_SEC so a README that embeds the badge a thousand times costs one page build a minute. The SVG
 * is rendered from the JSON; the PNG through sharp (as the coin image is, coinArtServe.ts). Drafts and expired drafts are not badged.
 */

const memo = new Map<string, { at: number; v: BadgeJson }>();
const MAX = 500;

/** HB-35: what a pair card reads (tokenPageInput lite and without the market reads); exported for the source test. */
export const PAIR_BADGE_READ: TokenPageOpts = { lite: true, live: false };

async function side(p: Platform, t: TokenRow, origin: string, now: number, opts: TokenPageOpts = {}): Promise<SideInput> {
  const d = await tokenPageData(p, t, now, opts);
  return { status: d.status, receipts: d.receipts, rule: p.registry.lockedRule(t).rule, origin, now, key: registryCoinKey(p.registry, t) };
}

const badged = (t: TokenRow | null): t is TokenRow => !!t && t.status !== "draft" && t.status !== "expired";

/** A coin's badge payload, or null when there is no launched coin by that mint (or ticker, when one coin holds it; the route answers a shared ticker with the list). */
export async function coinBadgeData(p: Platform, id: string, origin: string, now = Date.now(), env: Readonly<Record<string, string | undefined>> = process.env, root = process.cwd()): Promise<BadgeJson | null> {
  const t = findToken(p, id);
  // handoff 2026-10-19: the flagship has no registry row while its own keeper runs it, so its card comes from the keeper's files
  if (!badged(t)) return flagshipBadgeData(p, id, origin, now, env, root);
  const key = `coin:${t.mint}:${origin}`;
  const hit = memo.get(key);
  if (hit && now - hit.at < BADGE_CACHE_SEC * 1000) return hit.v;
  const v = coinBadge(await side(p, t, origin, now));
  remember(key, now, v);
  return v;
}

type KeeperStatusLite = { schema?: string; rules?: { sha256?: string }; feed?: { nextPollAt?: string | null } };
type KeeperBurnRow = { recordDate?: string; status?: string; units?: number; burned?: string | null };
const FLAGSHIP_LINER = "Fees burn $DEFICIT when the Treasury reports a qualifying rise in the public debt.";
const FLAGSHIP_AFFILIATION = "This coin is not affiliated with any team, league, candidate, agency or market.";

/**
 * The flagship's badge while its own keeper runs it (F-25: no registry row, the token API names it through flagshipToken). The card
 * reads the keeper's published status.json and burns.json (deficitQueue.ts readKeeperFiles): confirmed burns with tokens burned are its
 * receipts, the feed's next poll is its next settlement, the rules hash is the keeper's (else the locked file's). Null when this host
 * does not name the flagship (devnet, or the registry already holds it) or the id is neither its ticker nor its mint. No market data.
 */
export function flagshipBadgeData(p: Pick<Platform, "registry" | "cluster">, id: string, origin: string, now = Date.now(), env: Readonly<Record<string, string | undefined>> = process.env, root = process.cwd()): CoinBadgeJson | null {
  const f = flagshipToken(p, root);
  if (!f) return null;
  const key = id.trim();
  if (key.toUpperCase() !== f.ticker && key !== f.mint) return null;
  const memoKey = `coin:${f.mint}:${origin}`;
  const hit = memo.get(memoKey);
  if (hit && now - hit.at < BADGE_CACHE_SEC * 1000) return hit.v as CoinBadgeJson;
  const k = readKeeperFiles(env as Record<string, string | undefined>, root);
  const st = k.status && (k.status as KeeperStatusLite).schema === "burnkeeper.status/v1" ? (k.status as KeeperStatusLite) : null;
  const rows = (Array.isArray(k.burns) ? k.burns : (k.burns as { burns?: unknown[] } | null)?.burns ?? []) as KeeperBurnRow[];
  const burns = rows
    .filter((b) => b.status === "confirmed" && /[1-9]/.test(String(b.burned ?? "0")) && /^\d{4}-\d{2}-\d{2}$/.test(String(b.recordDate ?? "")))
    .map((b) => ({ at: `${b.recordDate}T00:00:00.000Z`, units: Number(b.units ?? 0), burned: String(b.burned) }))
    .sort((x, y) => (x.at < y.at ? 1 : -1));
  const scope = seasonScope({ oracle: "catalogue", series: null }, now);
  const inScope = scope.from ? burns.filter((b) => b.at.slice(0, 10) >= scope.from!) : burns;
  const o = origin.replace(/\/$/, ""), t = encodeURIComponent(f.ticker);
  const page = `${o}/burnticker/t/${t}`, badgePath = `/api/burnticker/v1/badge/${t}`;
  const sha = st?.rules?.sha256 || f.rulesSha256;
  const next = st?.feed?.nextPollAt && !Number.isNaN(Date.parse(st.feed.nextPollAt)) ? new Date(st.feed.nextPollAt).toISOString() : null;
  const v: CoinBadgeJson = {
    schema: BADGE_SCHEMA, kind: "coin", generatedAt: new Date(now).toISOString(),
    ticker: f.ticker, name: f.name, oneLiner: FLAGSHIP_LINER, window: null, status: "live",
    lastBurn: burns[0] ?? null, receipts: { count: inScope.length, label: scope.label }, rulesSha12: sha.slice(0, 12), pageUrl: page, verifyUrl: `${page}#verify`,
    nextSettlementAt: next, nextSettlementNote: next ? "the keeper's next read of the source" : "no result scheduled",
    badgeUrl: { svg: `${o}${badgePath}.svg`, png: `${o}${badgePath}.png`, json: `${o}${badgePath}.json` }, embedUrl: `${o}/burnticker/embed/${t}`,
    embed: snippets({ origin: o, embedPath: `/burnticker/embed/${t}`, badgePath: `${badgePath}.svg`, pagePath: `/burnticker/t/${t}`, alt: `${f.ticker} receipts on Burnticker` }),
    disclaimer: BADGE_DISCLAIMER, affiliation: FLAGSHIP_AFFILIATION,
  };
  remember(memoKey, now, v);
  return v;
}

/** A rivalry pair's badge payload, or null when the pair does not exist or a side is not launched. */
export async function pairBadgeData(p: Platform, pairId: string, origin: string, now = Date.now()): Promise<BadgeJson | null> {
  const pair = p.registry.pair(pairId);
  if (!pair) return null;
  const a = p.registry.token(pair.mintA), b = p.registry.token(pair.mintB);
  if (!badged(a) || !badged(b)) return null;
  const key = `pair:${pairId}:${origin}`;
  const hit = memo.get(key);
  if (hit && now - hit.at < BADGE_CACHE_SEC * 1000) return hit.v;
  // continuous audit HB-35: the pair card reads the registry and one parallel program read per side (no market, holder or date reads it
  // never shows); the full coin-page read took about 5 s cold
  const [sa, sb] = await Promise.all([side(p, a, origin, now, PAIR_BADGE_READ), side(p, b, origin, now, PAIR_BADGE_READ)]);
  const v = pairBadge(pairId, sa, sb);
  remember(key, now, v);
  return v;
}

function remember(key: string, at: number, v: BadgeJson): void {
  const problems = badgePayloadProblems(v);
  if (problems.length) throw new Error(`badge payload carries market data: ${problems.join("; ")}`);
  if (memo.size > MAX) memo.clear();
  memo.set(key, { at, v });
}

/** For tests. */
export function clearBadgeMemo(): void { memo.clear(); }

/** `BRONCO.svg` → { id: "BRONCO", fmt: "svg" }; null for anything else. */
export function parseBadgeFile(file: string, idPattern = /^[A-Za-z0-9]{2,44}$/): { id: string; fmt: "svg" | "png" | "json" } | null {
  const m = /^(.+)\.(svg|png|json)$/.exec(safeParam(file));
  return m && idPattern.test(m[1]) ? { id: m[1], fmt: m[2] as "svg" | "png" | "json" } : null;
}

/** The badge in the requested format. */
export async function badgeBody(b: BadgeJson, fmt: "svg" | "png"): Promise<{ body: Uint8Array; type: string }> {
  const svg = renderBadgeSvg(b);
  if (fmt === "svg") return { body: new TextEncoder().encode(svg), type: "image/svg+xml; charset=utf-8" };
  const sharp = (await import("sharp")).default;
  return { body: new Uint8Array(await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer()), type: "image/png" };
}

/**
 * The origin links in a badge point at: BURNTICKER_PUBLIC_ORIGIN when set (the public host), else the request's own origin unless that is
 * a loopback address (behind the proxy every request is http://localhost:3000; audit 2026-10-15 F8), which gets the public origin.
 */
export function badgeOrigin(req: Request, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const pub = (env.BURNTICKER_PUBLIC_ORIGIN ?? "").trim().replace(/\/$/, "");
  if (/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(pub)) return pub;
  const u = new URL(req.url);
  return /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i.test(u.hostname) ? publicOrigin(env) : u.origin;
}
