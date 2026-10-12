import fs from "node:fs";
import path from "node:path";
import { deficitPrelaunch } from "@/lib/burnticker/deficitPrelaunch";
import { sampleReceipts, type SampleList } from "@/lib/burnticker/trustpack/samples";
import { loadTransparency } from "@/lib/burnticker/trust";
import { deficitHref } from "@/lib/burnticker/creatorLaunches";
import { EXPLORE_VERIFIED_BURN } from "@/lib/burnticker/currentStatusLinks";
import { groupDigits, shortDay, type CardView, type IndexCoin } from "@/lib/burnticker/cardView";

/**
 * THE HOME PAGE'S DATA (website-10, 2026-10-12; the owner's review items 1, 4, 5, 12 and 13). Two things, both read from files and the
 * coin registry, never typed here:
 *
 *   featured   the cards that lead the grid before and after launch, in a fixed order: $DEFICIT (the operator's first coin; its rules are
 *              locked and its mint address is fixed, but the coin is not created until the owner runs the create), $REHEARSAL (the
 *              disclosed mainnet rehearsal coin, not for trading) and the devnet rehearsal coin with its two real burns.
 *   events     the activity line under the header: confirmed burns only, newest first. Mainnet coins' burns come from the registry; the
 *              devnet rehearsal's come from its evidence files. Never a placeholder or a sample row. With no events the line says so.
 *
 * GET /api/burnticker/home serves both; the app's home and the static landing page render the same answer.
 */

export interface ActivityEvent { at: string; network: "mainnet" | "devnet"; text: string; href: string }
export interface HomeData { schema: "burnticker.home/v1"; generatedAt: string; featured: CardView[]; events: ActivityEvent[]; noEvents: string }

export const NO_EVENTS_LINE = "No burn has happened yet. Each burn appears here once its transaction confirms.";
const OWN_TOKENS = path.join("config", "own-tokens.json");
const REHEARSAL_RULES = path.join("config", "burnkeeper", "rehearsal.rules.json");
const DEVNET_RULES = path.join("config", "burnkeeper", "deficit.devnet.rules.json");
/** A debt rules file's dial in words: "2%" of the pool per "$1B". */
function dialOf(root: string, rel: string): { percent: string; unitLabel: string } {
  const r = JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")) as { buyback: { fractionPerUnit: string }; rule: { unitUsd: string } };
  return { percent: `${Number(r.buyback.fractionPerUnit) * 100}%`, unitLabel: `$${Number(r.rule.unitUsd) / 1e9}B` };
}

/** The amount a receipt's memo says was burned ("…|burn=4010874.872446|…"), or null. */
export const memoBurn = (memo: string): number | null => { const m = /\|burn=([\d.]+)\|/.exec(memo); return m ? Number(m[1]) : null; };

const debtRule = (percent: string, unitLabel: string) => `Spends ${percent} of its burn pool for each ${unitLabel} the U.S. national debt rises, and burns what it gets.`;
const DEBT_SCHEDULE = "Each business day, after the Treasury posts the debt figure";

export function featuredCoins(root = process.cwd(), samples: SampleList | null = null): CardView[] {
  const out: CardView[] = [];
  const own = JSON.parse(fs.readFileSync(path.join(root, OWN_TOKENS), "utf8")) as { tokens: { symbol: string; address: string | null; status: string }[] };
  const d = deficitPrelaunch(root);
  const deficit = own.tokens.find((t) => t.symbol === "DEFICIT");
  const created = deficit?.status === "launched";
  out.push({
    id: "deficit", ticker: "DEFICIT", name: "Deficit", imageUrl: "/burnticker/brand/deficit.png",
    tags: [{ label: "Featured", tone: "featured" }],
    note: created ? "The operator's first coin. Its rules were locked before it was created." : "The operator's first coin. Its rules are locked, and the coin is not created yet.",
    rule: debtRule(d.dial.percent, d.dial.unitLabel), nextSettle: DEBT_SCHEDULE,
    burned: "Nothing burned yet",
    curve: created ? { label: "Curve read on the coin page", pct: null, done: false } : { label: "No curve until the coin is created", pct: null, done: false },
    mint: deficit?.address ? { address: deficit.address, label: created ? "Mint address" : "Mint address, not created yet" } : null,
    // review 2 §2: one served $DEFICIT destination — its own site until the coin is created and registered here
    href: deficitHref(created), receipt: null,
  });

  const rehearsal = loadTransparency(root).rehearsals.find((r) => r.symbol === "REHEARSAL");
  if (rehearsal) {
    const rr = dialOf(root, REHEARSAL_RULES);
    out.push({
      id: "rehearsal", ticker: "REHEARSAL", name: "Rehearsal", imageUrl: null,
      tags: [{ label: "Mainnet rehearsal", tone: "rehearsal" }],
      note: "A disclosed test coin on mainnet. It checks that fees and signed readings work, and it is not for trading.",
      rule: debtRule(rr.percent, rr.unitLabel), nextSettle: DEBT_SCHEDULE,
      burned: "Nothing burned yet",
      curve: { label: "Nothing can burn until its curve fills", pct: null, done: false },
      mint: rehearsal.mint ? { address: rehearsal.mint, label: "Mint address" } : null,
      href: "/burnticker/trust#rehearsals", receipt: null,
    });
  }

  const s = samples ?? sampleReceipts(root);
  const burns = s.receipts.filter((r) => r.ticker === "DEFICIT" && r.status === "confirmed");
  if (burns.length) {
    const total = burns.reduce((a, r) => a + (memoBurn(r.memo) ?? 0), 0);
    const dv = dialOf(root, DEVNET_RULES);
    out.push({
      id: "deficit-devnet", ticker: "DEFICIT", name: "Deficit, devnet rehearsal", imageUrl: "/burnticker/brand/deficit.png",
      tags: [{ label: "Devnet", tone: "devnet" }],
      note: "The practice run on devnet, a test network where tokens have no money value.",
      rule: debtRule(dv.percent, dv.unitLabel), nextSettle: null,
      burned: `${groupDigits(total)} $DEFICIT burned in ${burns.length} burns`,
      curve: { label: "Trades in its own pool", pct: 100, done: true },
      mint: null, href: EXPLORE_VERIFIED_BURN.href, receipt: { href: EXPLORE_VERIFIED_BURN.href },
    });
  }
  return out;
}

/** Confirmed burns, newest first: mainnet coins from the registry index, then the devnet rehearsal's evidence. At most `limit`. */
export function activityEvents(tokens: readonly Pick<IndexCoin, "ticker" | "burns" | "lastBurnAt">[], samples: SampleList | null, limit = 12): ActivityEvent[] {
  const ev: ActivityEvent[] = [];
  for (const t of tokens) {
    if (!t.lastBurnAt || t.burns < 1) continue;
    ev.push({ at: t.lastBurnAt, network: "mainnet", href: `/burnticker/t/${t.ticker}#receipts`, text: `$${t.ticker} burned on ${shortDay(t.lastBurnAt)}. It has burned ${t.burns} time${t.burns === 1 ? "" : "s"}.` });
  }
  for (const r of samples?.receipts ?? []) {
    if (r.status !== "confirmed") continue;
    const amt = memoBurn(r.memo);
    ev.push({ at: r.recordDate, network: "devnet", href: EXPLORE_VERIFIED_BURN.href, text: `On ${shortDay(r.recordDate)}, the devnet rehearsal coin $${r.ticker} burned ${amt === null ? "its purchase" : `${groupDigits(amt)} tokens`}.` });
  }
  return ev.sort((a, b) => (a.network === b.network ? b.at.localeCompare(a.at) : a.network === "mainnet" ? -1 : 1)).slice(0, limit);
}

export function homeData(tokens: readonly Pick<IndexCoin, "ticker" | "burns" | "lastBurnAt">[], root = process.cwd(), now = Date.now()): HomeData {
  let samples: SampleList | null = null;
  try { samples = sampleReceipts(root); } catch { samples = null; }
  let featured: CardView[] = [];
  try { featured = featuredCoins(root, samples); } catch { featured = []; }
  return { schema: "burnticker.home/v1", generatedAt: new Date(now).toISOString(), featured, events: activityEvents(tokens, samples), noEvents: NO_EVENTS_LINE };
}
