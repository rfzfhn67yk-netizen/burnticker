import { creatorNextLine } from "@/lib/burnticker/creatorBenefits";
import "server-only";
import { platform, tokenPageData, type Platform } from "@/lib/burnticker/server";
import { leagueData } from "@/lib/burnticker/leaguesServe";
import { registryCoinKey } from "@/lib/burnticker/coinLookup";
import { rankLines, receiptsThisWeek, weeklySummary, type RankView } from "@/lib/burnticker/coinRank";
import { safeParam } from "@/lib/burnticker/safeParam";

/**
 * THE CREATOR PAGE'S DATA (website-17, creator benefits items 1, 2 and 5). Every coin a wallet created, from the registry: live, paused
 * and retired coins (a draft was never created on chain; an expired draft never existed). Each with its rule in one line, the creator's
 * own image, text and links from its metadata, its confirmed receipts, its last burn, its next result, its rank line (coinRank.ts over
 * leaguesServe.ts's registry rows, the same rows the Seasons page ranks) and its receipts this week. Server only.
 */

export const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface CreatorCoinView {
  ticker: string; name: string; page: string; status: string; cluster: string;
  /** the coin's mint: the one key two coins never share (Your coins and the coin page match the summary on it) */
  mint: string;
  /** the coin's URL key (coinKey.ts): its ticker while it alone holds it, its mint once the ticker is shared */
  key: string;
  imageUrl: string | null; rule: string; creatorText: string | null; links: { label: string; url: string }[];
  receipts: number; lastBurnAt: string | null; nextAt: string | null;
  /** the "Next result" cell in words (creatorBenefits.ts creatorNextLine): a decided one-shot is decided, a past time is overdue */
  nextLine: string;
  rank: RankView | null; week: number; summary: string;
}
export type CreatorData = { kind: "bad-wallet" } | { kind: "unavailable"; wallet: string } | { kind: "ok"; wallet: string; coins: CreatorCoinView[]; readAt: string };

const sentence = (s: string) => { const t = s.trim().replace(/^./, (c) => c.toUpperCase()); return /[.!?]$/.test(t) ? t : `${t}.`; };

export async function creatorData(wallet: string, now = Date.now(), p: Platform | null = null): Promise<CreatorData> {
  const w = safeParam(wallet).trim();
  if (!WALLET_RE.test(w)) return { kind: "bad-wallet" };
  let plat: Platform;
  try { plat = p ?? platform(); } catch { return { kind: "unavailable", wallet: w }; }
  let ranks: Map<string, RankView> | null = null;
  let burnsBy = new Map<string, readonly { settledAt: string }[]>();
  try { const d = leagueData(plat, now); ranks = rankLines(d.coins); burnsBy = new Map(d.coins.map((c) => [c.mint, c.burns])); } catch { ranks = null; }
  let rows;
  try { rows = plat.registry.tokens().filter((t) => t.creator === w && t.status !== "draft" && t.status !== "expired").slice(0, 100); } catch { return { kind: "unavailable", wallet: w }; }
  const coins: CreatorCoinView[] = [];
  for (const t of rows) {
    let d;
    try { d = await tokenPageData(plat, t, now); } catch { continue; }
    const s = d.status;
    const rank = ranks?.get(s.mint) ?? null;
    const week = receiptsThisWeek(burnsBy.get(s.mint) ?? [], now);
    coins.push({
      ticker: s.ticker, name: s.name, mint: s.mint, key: registryCoinKey(plat.registry, t), page: `/burnticker/t/${encodeURIComponent(registryCoinKey(plat.registry, t))}`, status: s.status, cluster: s.cluster,
      imageUrl: s.profile?.imageUrl ?? null, rule: sentence(s.profile?.oneLiner ?? s.seriesTitle ?? s.selectorKey), creatorText: s.profile?.creatorText ?? null, links: s.profile?.links ?? [],
      receipts: burnsBy.get(s.mint)?.length ?? d.receipts.filter((r) => r.status === "confirmed" && Number(r.burned ?? 0) > 0).length, lastBurnAt: s.burned.lastAt ?? null, nextAt: s.next.nextCloseTime ?? s.next.nextCheckAt ?? null,
      nextLine: creatorNextLine({ oneShot: !!s.rules.oneShot, receipts: d.receipts, graduated: s.market?.phase === "graduated", nextAt: s.next.nextCloseTime ?? s.next.nextCheckAt ?? null }, now),
      rank, week, summary: weeklySummary(s.ticker, week, rank),
    });
  }
  return { kind: "ok", wallet: w, coins, readAt: new Date(now).toISOString() };
}
