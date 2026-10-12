import fs from "node:fs";
import path from "node:path";
import { hostCluster } from "@/lib/burnticker/launchAvailability";
import { sampleReceipts, SAMPLE_SETS, type SampleList } from "@/lib/burnticker/trustpack/samples";
import { checkReceiptHref } from "@/lib/burnticker/coinPage";
import type { CardView } from "@/lib/burnticker/cardView";
import { DEVNET_COPY } from "@/lib/burnticker/devnetCopy";
import type { ActivityEvent } from "@/lib/burnticker/activity";
import type { HomeData } from "@/lib/burnticker/home";

/**
 * DEVNET ITEMS OFF THE PUBLIC PAGES (owner decision, 2026-10-12: "hide the devnet rehearsal items from the public site; add the real coins
 * when they launch"). On a MAINNET host (launchAvailability.ts hostCluster, the BURNTICKER_CLUSTER setting) the home data, the coins grid,
 * the activity strip, next results, featured slots and the feeds carry no devnet item: no devnet featured card, no devnet activity row, no
 * devnet next-result row, no devnet stat and no registry row on the devnet cluster. Real coins appear through the registry reads when they
 * are created on mainnet; nothing is pinned by hand. A devnet host keeps showing its devnet items.
 *
 * The devnet items stay reachable on one page, /burnticker/devnet, linked only from the Trust page and the History page. Its data
 * (devnetPageData) lists each devnet coin, its mint on the explorer and its confirmed burns, from the devnet evidence files and any
 * registry rows on the devnet cluster. Its words are in devnetCopy.ts.
 */

/** Whether a host hides devnet items from its public pages: only a mainnet host does. */
export const hidesDevnet = (host: string | null | undefined): boolean => host === "mainnet";
/** The host's cluster as the site reads it (BURNTICKER_CLUSTER), for callers without a platform at hand. */
export const siteCluster = (env: Record<string, string | undefined> = process.env): string => hostCluster(env);

/** A featured card that belongs to devnet: the devnet $DEFICIT practice card, or any card tagged devnet. */
export const isDevnetCard = (v: Pick<CardView, "id" | "tags">): boolean => v.id === "deficit-devnet" || v.tags.some((t) => t.tone === "devnet");

/** Registry rows a host lists publicly: on a mainnet host, never a row on the devnet cluster. */
export function publicRegistryRows<T extends { cluster?: string | null }>(rows: readonly T[], host: string | null | undefined): T[] {
  return hidesDevnet(host) ? rows.filter((r) => r.cluster !== "devnet") : [...rows];
}

/** Activity rows a host shows publicly. */
export function publicEvents<T extends Pick<ActivityEvent, "network">>(events: readonly T[], host: string | null | undefined): T[] {
  return hidesDevnet(host) ? events.filter((e) => e.network !== "devnet") : [...events];
}

/** The home answer a host serves: on a mainnet host the devnet cards, rows, next results and stats are removed. */
export function publicHomeData<T extends HomeData>(d: T, host: string | null | undefined): T {
  if (!hidesDevnet(host)) return d;
  return {
    ...d,
    featured: d.featured.filter((v) => !isDevnetCard(v)),
    events: publicEvents(d.events, host),
    upcoming: d.upcoming && Array.isArray(d.upcoming.rows) ? { ...d.upcoming, rows: d.upcoming.rows.filter((r) => r.network !== "devnet") } : d.upcoming,
    stats: d.stats ? { ...d.stats, devnet: null } : d.stats,
  };
}

// ---- the devnet page ----

export { DEVNET_COPY, DEVNET_HREF } from "@/lib/burnticker/devnetCopy";

export interface DevnetBurn { date: string; text: string; checkHref: string; explorerHref: string; signature: string }
export interface DevnetCoin { ticker: string; mint: string | null; mintHref: string | null; pageHref: string | null; burns: DevnetBurn[] }
export interface DevnetPageData { coins: DevnetCoin[] }

const memoAmount = (memo: string): string | null => /\|burn=([\d.]+)\|/.exec(memo)?.[1] ?? null;
const addressHref = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;
function rulesMint(root: string, rel: string): string | null {
  try { const m = (JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")) as { mint?: unknown }).mint; return typeof m === "string" && m ? m : null; } catch { return null; }
}

/**
 * The devnet page's list: each devnet evidence coin (trustpack/samples.ts SAMPLE_SETS, the mint from its rules file) with its confirmed
 * burns, newest first, then every registry row on the devnet cluster that is not already listed (linked to its own coin page).
 */
export function devnetPageData(root = process.cwd(), registry: readonly { ticker: string; mint: string; cluster?: string | null; status?: string }[] | null = [], samples: SampleList | null = null): DevnetPageData {
  let s = samples;
  if (!s) { try { s = sampleReceipts(root); } catch { s = null; } }
  const coins: DevnetCoin[] = [];
  for (const set of SAMPLE_SETS) {
    const rows = (s?.receipts ?? []).filter((r) => r.ticker === set.ticker && r.status === "confirmed").sort((a, b) => b.recordDate.localeCompare(a.recordDate));
    const mint = rulesMint(root, set.rules);
    if (!rows.length && !mint) continue;
    coins.push({
      ticker: set.ticker, mint, mintHref: mint ? addressHref(mint) : null, pageHref: null,
      burns: rows.map((r) => ({ date: r.recordDate, text: DEVNET_COPY.burnLine(memoAmount(r.memo)), checkHref: checkReceiptHref(r.signature, "devnet")!, explorerHref: r.explorerUrl, signature: r.signature })),
    });
  }
  for (const t of registry ?? []) {
    if (t.cluster !== "devnet" || t.status === "draft" || t.status === "expired") continue;
    const same = coins.find((c) => c.mint === t.mint);
    if (same) { same.pageHref = `/burnticker/t/${encodeURIComponent(t.ticker)}`; continue; }
    coins.push({ ticker: t.ticker, mint: t.mint, mintHref: addressHref(t.mint), pageHref: `/burnticker/t/${encodeURIComponent(t.ticker)}`, burns: [] });
  }
  return { coins };
}
