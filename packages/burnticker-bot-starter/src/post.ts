/**
 * QUEUE A RECEIPT POST (no X API, no auto-posting). Renders a coin's receipt post, season card or one league's scoreboard with the
 * platform's own generator (src/lib/launch/postQueue.ts — the same templates the operator's queue uses), runs the copy lint over it
 * (config/launch/copy-lint.json: no price talk, no promises, no calls to buy, no prizes), and appends the clean post to a local queue
 * file. A person reads the queue and posts by hand, or not at all. A post the lint refuses is printed with every hit and never queued.
 *
 *   npm run post -- DEFICIT                          # the latest confirmed receipt of $DEFICIT
 *   npm run post -- DEFICIT --event 2026-10-08       # one receipt by its event id
 *   npm run post -- DEFICIT --format season-card     # the coin's season card
 *   npm run post -- --format scoreboard --league nhl # one league's scoreboard (reads the site's public index.json)
 */
import path from "node:path";
import { Burnticker, type ReceiptJson } from "./sdk.ts";
import { config, isMain, parseArgs, type StarterConfig } from "./config.ts";
import { PostRefused, appendQueue, checkDraft, printDraft, receiptDraft, scoreboardDraft, seasonCardDraft, type Draft, type QueuedPost } from "@/lib/launch/postQueue";
import { loadCopyLintConfig, type CopyLintConfig } from "@/lib/launch/copyLint";
import type { PlatformIndexJson } from "@/lib/burnticker/tokenPage";

/** The repository root (the copy lint's word list lives at config/launch/copy-lint.json there), whatever directory this runs from. */
export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
export const lintConfig = (): CopyLintConfig => loadCopyLintConfig(REPO_ROOT);

export type PostFormat = "receipt" | "season-card" | "scoreboard";

/** The latest confirmed receipt with tokens burned (or the one named by `eventId`). */
export function pickReceipt(receipts: readonly ReceiptJson[], eventId: string | null): ReceiptJson | null {
  if (eventId) return receipts.find((r) => r.eventId === eventId) ?? null;
  return [...receipts].filter((r) => r.status === "confirmed" && /[1-9]/.test(r.burned ?? "0")).sort((a, b) => (a.settledAt < b.settledAt ? 1 : -1))[0] ?? null;
}

/** Builds the draft for one coin (receipt or season card) from the public API. */
export async function coinDraft(bt: Burnticker, ticker: string, format: Exclude<PostFormat, "scoreboard">, site: string, eventId: string | null = null): Promise<Draft> {
  const t = await bt.token(ticker);
  if (format === "season-card") return seasonCardDraft(t.status, site);
  const r = pickReceipt(t.receipts, eventId);
  if (!r) throw new Error(eventId ? `$${ticker} has no receipt ${eventId}` : `$${ticker} has no confirmed burn yet — nothing to post`);
  return receiptDraft(t.status, t.receipts, r, site);
}

/** One league's scoreboard from the site's public index.json and each listed coin's receipts. */
export async function leagueDraft(bt: Burnticker, league: string, site: string, fetchJson: (url: string) => Promise<unknown>, day = new Date().toISOString().slice(0, 10)): Promise<Draft> {
  const index = await fetchJson(`${site}/index.json`) as PlatformIndexJson;
  const receiptsByTicker: Record<string, ReceiptJson[]> = {};
  for (const t of index.tokens ?? []) receiptsByTicker[t.ticker] = (await bt.receipts(t.ticker)).receipts;
  return scoreboardDraft({ index, receiptsByTicker, day, league, site });
}

/** Lints and queues a draft: the queue entry (appended, or skipped as a duplicate), or a PostRefused with every lint hit. */
export function queueDraft(d: Draft, file: string, source: string, now = Date.now(), cfg: CopyLintConfig = lintConfig()): { entry: QueuedPost; appended: boolean } {
  const entry = checkDraft(d, { source, now, cfg });
  const r = appendQueue(file, [entry]);
  return { entry, appended: r.appended.length === 1 };
}

export async function main(argv: readonly string[], cfg: StarterConfig = config(), bt = new Burnticker({ apiBase: cfg.api }), log: (s: string) => void = console.log, fetchJson: (url: string) => Promise<unknown> = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); }): Promise<void> {
  const { pos, opt } = parseArgs(argv);
  const format = (typeof opt.format === "string" ? opt.format : "receipt") as PostFormat;
  if (!["receipt", "season-card", "scoreboard"].includes(format)) throw new Error("--format is receipt, season-card or scoreboard");
  const queue = typeof opt.queue === "string" ? opt.queue : cfg.queueFile;
  let d: Draft;
  if (format === "scoreboard") {
    if (typeof opt.league !== "string") throw new Error("--format scoreboard needs --league <id> (one league per post: leagues are never ranked together)");
    d = await leagueDraft(bt, opt.league, cfg.site, fetchJson);
  } else {
    const ticker = (pos[0] ?? "").toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(ticker)) throw new Error("usage: post <TICKER> [--format receipt|season-card] [--event <id>] [--queue file]");
    d = await coinDraft(bt, ticker, format, cfg.site, typeof opt.event === "string" ? opt.event : null);
  }
  try {
    const { entry, appended } = queueDraft(d, queue, `bot-starter ${cfg.api}`);
    log(printDraft(entry));
    log(appended ? `\nqueued in ${queue} — nothing was posted; a person posts it by hand, or not at all.` : `\nalready in ${queue} (same words) — not queued twice.`);
  } catch (e) {
    if (e instanceof PostRefused) { log(printDraft(d)); log(`\nREFUSED (${e.reason}): ${e.detail}`); process.exitCode = 1; return; }
    throw e;
  }
}

if (isMain(import.meta.url)) main(process.argv.slice(2)).catch((e) => { console.error((e as Error).message); process.exit(1); });
