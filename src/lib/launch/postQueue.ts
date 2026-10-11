import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BurnJson, StatusJson } from "@/lib/burnKeeper/statusPage";
import type { PairTally, PlatformIndexJson, ReceiptJson, TokenStatusJson } from "@/lib/burnticker/tokenPage";
import { BURN_POOL_CURVE_BPS, BURNTICKER_DEV_FEE_BPS, LP_LOCKED_PCT, LOCK_FEE_BURN_BPS, LOCK_FEE_OPERATOR_BPS } from "@/lib/burnticker/fees";
import { LEAGUES } from "@/lib/burnticker/sources/espn";
import { formatHits, lintCopy, loadCopyLintConfig, xLength, type CopyLintConfig, type CopyLintHit } from "@/lib/launch/copyLint";
import { GRADUATION_SOL } from "@/lib/burnticker/readiness";
import { DISCLAIMER, SHORT_DISCLAIMER, allLeaguesLine, dailyText, fmtInt, fmtPct, pairDailyText, receiptPostText, scoreboardLeagues, scoreboardText } from "@/lib/launch/dailyPost";

/**
 * THE POST QUEUE (go-to-market pack, 2026-10-10; plan of record docs/launch/gtm/PLAN.md §3 and §5). Builds X posts in six fixed
 * formats from the keeper's own published files (or fixtures), lints every one, and appends the clean ones to an append-only queue
 * file the owner reads, edits nothing in, and posts BY HAND. Nothing here posts, signs in or opens a network connection.
 *
 *   receipt        one per confirmed burn — @BurnTicker (dailyPost.ts receiptPostText, the copy agent's format) or @USA_DEFICIT (dailyText)
 *   scoreboard     one league, one season per post (dailyPost.ts scoreboardText) — never a ranking across leagues; across leagues only the
 *                  count line (allLeaguesLine) — or a pair (pairDailyText)
 *   season-card    one coin's rule, its window (only what status.json says), receipts so far, the locked hash
 *   explainer      how a burn happens · what a receipt is · why LP is locked · why creators earn nothing (numbers from fees.ts)
 *   launch-thread  $DEFICIT (from its rule file), the platform (guardrails derived from transparency.json), or any coin
 *   teaser         pre-launch, true today: the devnet receipt, the $DEFICIT rule, the reviews, open source, settlement coverage
 *
 * Every post runs through the copy lint (config/launch/copy-lint.json) and is REFUSED — never queued — on any hit, on an unfilled
 * {PLACEHOLDER}, on more than 280 X-characters (links count 23), or on a thread longer than THREAD_MAX. Claims that depend on the
 * state of the world (how many reviews are published, whether the bounty is live, which leagues are read, the coverage counts) are
 * read from the files that record that state, so a post cannot get ahead of the code.
 */

export const QUEUE_SCHEMA = "burnticker.post-queue/v1";
export const QUEUE_FILE = path.join("data", "launch", "post-queue.jsonl");
export const POST_FORMATS = ["receipt", "scoreboard", "season-card", "explainer", "launch-thread", "teaser"] as const;
export type PostFormat = (typeof POST_FORMATS)[number];
export type Account = "@BurnTicker" | "@USA_DEFICIT";
export const THREAD_MAX = 8;
export { SHORT_DISCLAIMER };
export const PUBLIC_REPO = "https://github.com/rfzfhn67yk-netizen/burnticker";
const REPO_FILE = (p: string) => `${PUBLIC_REPO}/blob/main/${p}`;
const REPO_TREE = (p: string) => `${PUBLIC_REPO}/tree/main/${p}`;

export interface Draft { format: PostFormat; account: Account; subject: string; posts: string[] }
export interface QueuedPost extends Draft {
  schema: typeof QUEUE_SCHEMA; id: string; queuedAt: string; source: string; xLength: number[]; warnings: string[];
  status: "awaiting-owner"; note: string;
}

export type RefusalReason = "lint" | "length" | "placeholder" | "thread" | "empty";
export class PostRefused extends Error {
  readonly draft: Draft; readonly reason: RefusalReason; readonly detail: string; readonly hits: CopyLintHit[];
  constructor(draft: Draft, reason: RefusalReason, detail: string, hits: CopyLintHit[] = []) {
    super(`refused ${draft.format} (${draft.subject}): ${reason} — ${detail}`);
    this.draft = draft; this.reason = reason; this.detail = detail; this.hits = hits;
  }
}

const PLACEHOLDER = /\{[A-Z_]{2,}[^}]*\}/;

/** Lints and measures a draft; returns the queue entry or throws PostRefused. The only way a draft becomes a queue entry. */
export function checkDraft(d: Draft, opts: { source: string; now: number; cfg?: CopyLintConfig }): QueuedPost {
  const cfg = opts.cfg ?? loadCopyLintConfig();
  if (!d.posts.length || d.posts.some((p) => !p.trim())) throw new PostRefused(d, "empty", "a post with no text");
  if (d.posts.length > THREAD_MAX) throw new PostRefused(d, "thread", `${d.posts.length} posts > ${THREAD_MAX}`);
  const lengths: number[] = [];
  const warnings: string[] = [];
  d.posts.forEach((text, i) => {
    const where = d.posts.length > 1 ? `post ${i + 1}/${d.posts.length}` : "post";
    const r = lintCopy(text, cfg);
    if (!r.ok) throw new PostRefused(d, "lint", `${where}:\n${formatHits(r)}`, r.hits);
    const ph = PLACEHOLDER.exec(text);
    if (ph) throw new PostRefused(d, "placeholder", `${where}: unfilled ${ph[0]}`);
    if (r.xLength > cfg.maxChars) throw new PostRefused(d, "length", `${where}: ${r.xLength} > ${cfg.maxChars} X-characters (links count ${cfg.linkCountsAs})`);
    lengths.push(r.xLength);
    warnings.push(...r.warnings.map((w) => `${where}: ${w}`));
  });
  return {
    schema: QUEUE_SCHEMA, id: draftId(d), queuedAt: new Date(opts.now).toISOString(), source: opts.source, ...d, xLength: lengths, warnings,
    status: "awaiting-owner", note: "Nothing auto-posts. The owner reads this, and posts it by hand or not at all.",
  };
}

/** Content id: the same format, account, subject and words always get the same id, so a re-run never queues a duplicate. */
export const draftId = (d: Draft): string => crypto.createHash("sha256").update([d.format, d.account, d.subject, ...d.posts].join("␞")).digest("hex").slice(0, 16);

// ---- the append-only queue ----
export function readQueue(file: string): QueuedPost[] {
  if (!fs.existsSync(file)) return [];
  const out: QueuedPost[] = [];
  fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    let j: QueuedPost;
    try { j = JSON.parse(line) as QueuedPost; } catch { throw new Error(`${file}:${i + 1}: not JSON — the queue is append-only; fix it by hand, the generator never rewrites it`); }
    if (j.schema !== QUEUE_SCHEMA || typeof j.id !== "string" || !Array.isArray(j.posts)) throw new Error(`${file}:${i + 1}: not a ${QUEUE_SCHEMA} entry`);
    out.push(j);
  });
  return out;
}

/**
 * Appends entries whose id is not in the file yet. Never truncates, never rewrites: the file is opened for append only, and after the
 * write the old bytes are checked to be an exact prefix of the new file.
 */
export function appendQueue(file: string, entries: readonly QueuedPost[]): { appended: QueuedPost[]; skipped: QueuedPost[] } {
  const before = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
  const have = new Set(readQueue(file).map((e) => e.id));
  const appended: QueuedPost[] = [], skipped: QueuedPost[] = [];
  for (const e of entries) { if (have.has(e.id)) skipped.push(e); else { have.add(e.id); appended.push(e); } }
  if (!appended.length) return { appended, skipped };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lead = before.length && before[before.length - 1] !== 0x0a ? "\n" : "";
  fs.appendFileSync(file, lead + appended.map((e) => JSON.stringify(e)).join("\n") + "\n", { flag: "a" });
  const after = fs.readFileSync(file);
  if (after.length < before.length || !after.subarray(0, before.length).equals(before)) throw new Error(`${file}: the earlier entries changed during the append — stop and look`);
  return { appended, skipped };
}

/** The owner's reading view. */
export function printDraft(e: Pick<QueuedPost, "format" | "account" | "subject" | "posts"> & { id?: string; xLength?: number[] }): string {
  const head = `── ${e.format} · ${e.account} · ${e.subject}${e.id ? ` · ${e.id}` : ""}`;
  return [head, ...e.posts.map((p, i) => `${e.posts.length > 1 ? `[${i + 1}/${e.posts.length}${e.xLength ? ` · ${e.xLength[i]} ch` : ""}]` : e.xLength ? `[${e.xLength[0]} ch]` : ""}\n${p}`)].join("\n");
}

// ---- shared helpers ----
/**
 * Packs a template's lines into as few posts as fit `max` X-characters each, never splitting a line — how a long template from
 * dailyPost.ts (the pair post, a $DEFICIT burn day) becomes a short thread instead of being retyped. A single line over `max` stays
 * whole, and checkDraft refuses it.
 */
export function asThread(text: string, max = 280): string[] {
  const posts: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    const next = cur ? `${cur}\n${line}` : line;
    if (cur && xLength(next) > max) { posts.push(cur); cur = line; } else cur = next;
  }
  if (cur) posts.push(cur);
  return posts;
}
const siteOf = (site: string) => site.trim().replace(/\/$/, "");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Example teams in the order the copy rotates them — only for leagues the platform reads (src/lib/burnticker/sources/espn.ts LEAGUES); the NFL is never first. */
export const LEAGUE_EXAMPLES: { league: string; label: string; team: string }[] = [
  { league: "mlb", label: "MLB", team: "Rays" }, { league: "nba", label: "NBA", team: "Lakers" }, { league: "nhl", label: "NHL", team: "Oilers" },
  { league: "eng.1", label: "Premier League", team: "Arsenal" }, { league: "usa.1", label: "MLS", team: "Inter Miami" }, { league: "nfl", label: "NFL", team: "Eagles" },
];
export const readLeagues = (): typeof LEAGUE_EXAMPLES => LEAGUE_EXAMPLES.filter((x) => x.league in LEAGUES);

// ---- (1) receipt ----
/** A platform coin's confirmed burn — the copy agent's receipt format (dailyPost.ts receiptPostText), which throws on anything but a confirmed burn. */
export function receiptDraft(s: Pick<TokenStatusJson, "ticker" | "seriesTitle" | "selectorKey" | "supply" | "burned">, receipts: readonly ReceiptJson[], r: ReceiptJson, site: string): Draft {
  return { format: "receipt", account: "@BurnTicker", subject: `$${s.ticker} ${r.eventId}`, posts: [receiptPostText(s, receipts, r, siteOf(site))] };
}

/** $DEFICIT's burn day for @USA_DEFICIT — the daily post's own template (dailyPost.ts dailyText), never retyped. */
export function deficitReceiptDraft(status: StatusJson, burns: readonly BurnJson[], row: BurnJson, site: string): Draft {
  return { format: "receipt", account: "@USA_DEFICIT", subject: `$${status.ticker} ${row.recordDate}`, posts: asThread(dailyText(status, burns, row, siteOf(site))) };
}

// ---- (2) scoreboard ----
export interface ScoreboardInput { index: PlatformIndexJson; receiptsByTicker: Record<string, readonly ReceiptJson[]>; day: string; league?: string | null; season?: string | null; seasonOver?: boolean; top?: number; site: string }

/** One league's season — the copy agent's scoreboard format (dailyPost.ts scoreboardText), with as many ranked lines as fit one post (`top`, default 3, down to 1). */
export function scoreboardDraft(i: ScoreboardInput & { league: string }): Draft {
  let top = Math.max(1, i.top ?? 3);
  const sb = (n: number) => scoreboardText({ ...i, top: n, site: siteOf(i.site) });
  let text = sb(top);
  while (top > 1 && xLength(text) > 280) text = sb(--top);
  return { format: "scoreboard", account: "@BurnTicker", subject: `${i.league.toUpperCase()} season ${i.day}`, posts: [text] };
}

/** One post per league (never a ranking across leagues), then the one cross-league line allowed — a count. With `league`: that league only. */
export function scoreboardDrafts(i: ScoreboardInput): Draft[] {
  const leagues = i.league ? [i.league] : scoreboardLeagues(i.index);
  const per = leagues.map((league) => scoreboardDraft({ ...i, league }));
  return i.league ? per : [...per, { format: "scoreboard", account: "@BurnTicker", subject: `all leagues ${i.day}`, posts: [allLeaguesLine(i.index, i.receiptsByTicker, i.day)] }];
}

/** A rivalry pair's running score — the pair post's own template (dailyPost.ts pairDailyText). */
export function pairScoreboardDraft(t: PairTally, site: string): Draft {
  return { format: "scoreboard", account: "@BurnTicker", subject: `pair ${t.pairId}`, posts: asThread(pairDailyText(t, siteOf(site))) };
}

// ---- (3) season card ----
/** One coin's card: what its rule is, its window as status.json states it (one-shot, ended, winding down), receipts so far, the hash. */
export function seasonCardDraft(s: Pick<TokenStatusJson, "ticker" | "seriesTitle" | "selectorKey" | "rules" | "burned" | "profile" | "status" | "launchedAt"> & { lifecycle?: TokenStatusJson["lifecycle"] }, site: string): Draft {
  const rule = s.profile?.oneLiner?.trim() || s.seriesTitle || s.selectorKey;
  const window = s.lifecycle?.ended ? `Rule ended (${s.lifecycle.ended.reason}) · ${s.lifecycle.line}` : s.rules.oneShot ? "Window: resolves once; after that the supply is fixed." : s.lifecycle?.line && s.lifecycle.line !== "live" ? s.lifecycle.line : null;
  const text = [
    `$${s.ticker} · season card`,
    rule,
    window,
    s.burned.count ? `${plural(s.burned.count, "receipt")} so far · ${fmtPct(s.burned.pctOfSupply)} of supply burned${s.burned.lastAt ? ` · last ${s.burned.lastAt.slice(0, 10)}` : ""}` : "No receipt yet.",
    `Rule locked at launch: sha256:${s.rules.sha12}`,
    `${siteOf(site)}/t/${s.ticker}/`,
    SHORT_DISCLAIMER,
  ].filter((x): x is string => x !== null).join("\n");
  return { format: "season-card", account: "@BurnTicker", subject: `$${s.ticker}`, posts: asThread(text) };
}

// ---- (4) explainers ----
export const EXPLAINER_TOPICS = ["how-a-burn-happens", "what-a-receipt-is", "why-lp-is-locked", "why-creators-earn-nothing"] as const;
export type ExplainerTopic = (typeof EXPLAINER_TOPICS)[number];

/** Fixed explainers. Numbers come from fees.ts so they move with the code; each sentence is checked against the program's Powers Register. */
export function explainerDraft(topic: ExplainerTopic, site: string): Draft {
  const S = siteOf(site);
  const posts: Record<ExplainerTopic, string[]> = {
    "how-a-burn-happens": [
      `How a burn happens on Burnticker 🧵\n\n1. A result settles on its primary source and an independent second publisher agrees (or on an on-chain payout, for an adjudicated race).\n2. The keeper signs that reading and posts it on chain.`,
      `3. The burn_receipts program spends part of the coin's own fee pool buying the coin on its own pool and burns everything it bought, in one instruction.\n4. The memo on that transaction is the receipt: anyone can recompute it.\n${S}/burnticker/trust\n${SHORT_DISCLAIMER}`,
    ],
    "what-a-receipt-is": [
      `A Burnticker receipt is the memo on the burn transaction: date, source, previous and current reading, units, pool, spent, got, burned, the rule hash.\n\nRecompute it from the public source and the coin's rules.json, or call the API's verify route:\n${S}/api/burnticker/v1/openapi.json`,
    ],
    "why-lp-is-locked": [
      `Why LP is locked: when a Burnticker coin graduates, its liquidity moves to a Raydium CPMM pool and ${LP_LOCKED_PCT}% of the LP is locked forever. Nobody can pull it. The Fee Key is held by the burn program: ${LOCK_FEE_BURN_BPS / 100}% of the LP fees go to the burn pool, ${LOCK_FEE_OPERATOR_BPS / 100}% to the operator, fixed in code.`,
    ],
    "why-creators-earn-nothing": [
      `Why creators earn nothing: the creator-fee slot (${BURN_POOL_CURVE_BPS} bps of curve volume) pays the coin's burn pool, 100%. Zero team allocation. The platform's ${BURNTICKER_DEV_FEE_BPS} bps goes to one public developer wallet; the platform never buys any coin, including its own.\n${S}/burnticker/trust`,
    ],
  };
  return { format: "explainer", account: "@BurnTicker", subject: topic, posts: posts[topic] };
}

// ---- (5) launch threads ----
/** The parts of the $DEFICIT rule file a thread needs (config/burnkeeper/deficit.rules.json). */
export interface DeficitRuleFacts { ticker: string; fractionPerUnit: string; unitUsd: string; feedName: string; sha256: string }
export function deficitFacts(rulesText: string, sha256: string): DeficitRuleFacts {
  const j = JSON.parse(rulesText) as { ticker: string; buyback: { fractionPerUnit: string }; rule: { unitUsd: string }; feed: { name: string } };
  return { ticker: j.ticker, fractionPerUnit: j.buyback.fractionPerUnit, unitUsd: j.rule.unitUsd, feedName: j.feed.name, sha256 };
}
const pctOf = (f: string) => `${+(Number(f) * 100).toFixed(4)}%`;
const keepOf = (f: string) => String(+(1 - Number(f)).toFixed(6));
const dollarsB = (usd: string) => `$${fmtInt(usd)}`;

/**
 * THE LAUNCH-DAY LINE (2026-10-11): $DEFICIT cannot burn before graduation (crank_buyback requires pool_verified; the curve graduates
 * at 85 SOL raised; the seed gift does not count). No launch draft says or implies a burn on launch day; both launch threads carry this.
 */
export const NOTHING_BURNS_LINE = "Nothing burns until the curve fills and the debt rises";

/** $DEFICIT's launch thread for @USA_DEFICIT: the rule (fraction from the rule file), the source, the receipt format, the guardrails. */
export function deficitLaunchThread(f: DeficitRuleFacts, site: string, launchTxUrl?: string | null): Draft {
  const S = siteOf(site), T = `$${f.ticker}`;
  return {
    format: "launch-thread", account: "@USA_DEFICIT", subject: `${T} launch`,
    posts: [
      `${T}: every full ${dollarsB(f.unitUsd)} the U.S. national debt rises, ${pctOf(f.fractionPerUnit)} of its burn pool buys ${T} on its own pool and the program burns all of it. A receipt for every burn. 🧵`,
      `The rule: each business day, every full ${dollarsB(f.unitUsd)} added to Treasury's Debt to the Penny since the previous reading is one unit. Spend = pool × (1 − ${keepOf(f.fractionPerUnit)}^units).\n\nLocked at launch. Rule hash sha256:${f.sha256.slice(0, 12)}`,
      `The source: ${f.feedName}, posted each business-day afternoon ET, cross-read against FRED's quarterly copy of the same figure. Nothing happens until the debt rises: the first reading after launch is the baseline.`,
      `${NOTHING_BURNS_LINE}: ${T} trades on its bonding curve first; burns start only after it graduates at ${GRADUATION_SOL} SOL raised and its pool is registered. Earlier readings wait in line.${launchTxUrl ? `\nLaunch: ${launchTxUrl}` : ""}`,
      `Creators earn nothing: the creator fee goes to the burn pool, 100%. LP locked forever; its fees fund the burn (80% burned, 20% operator). The platform never buys any coin.\n\nReceipts: ${S}\n${DISCLAIMER}`,
    ],
  };
}

/** What transparency.json says about the reviews and the bounty — the only source for the "reviewed" claim in any post. */
export interface ReviewFacts { blindDone: number; chatgptDone: boolean; bountyPublished: boolean; firmAudit: boolean }
export function reviewFacts(t: { howBuilt: { firmAudit: boolean; reviews: { id: string; status: string }[]; bounty: { status: string } } }): ReviewFacts {
  const done = (s: string) => /^completed/i.test(s);
  return {
    blindDone: t.howBuilt.reviews.filter((r) => r.id.startsWith("claude-blind") && done(r.status)).length,
    chatgptDone: t.howBuilt.reviews.some((r) => r.id.startsWith("chatgpt") && done(r.status)),
    bountyPublished: /^published/i.test(t.howBuilt.bounty.status), firmAudit: t.howBuilt.firmAudit,
  };
}
const NUM = ["no", "one", "two", "three", "four", "five", "six"];
/** "three blind AI reviews published in full, the adversarial ChatGPT review pending, the public bounty not published" — status words only, never "audit", never a date. */
export function reviewLine(r: ReviewFacts): string {
  return [
    `${NUM[r.blindDone] ?? r.blindDone} blind AI ${r.blindDone === 1 ? "review" : "reviews"} published in full`,
    r.chatgptDone ? "an adversarial ChatGPT review published" : "the adversarial ChatGPT review pending",
    r.bountyPublished ? "a public bounty" : "the public bounty not published",
  ].join(", ");
}

/** The @BurnTicker announcement thread: the sentence, the engine, the receipt, the show (leagues the code reads), the guardrails, $DEFICIT. */
export function platformLaunchThread(rf: ReviewFacts, site: string): Draft {
  const S = siteOf(site);
  const lg = readLeagues();
  const ex = lg.slice(0, 3).map((x) => x.team);
  return {
    format: "launch-thread", account: "@BurnTicker", subject: "Burnticker launch",
    posts: [
      `Coins that burn on real-world results — with receipts.\n\nLaunch one. Follow the season. 🧵`,
      `Launch: pick a result ("${ex[0]} lose", "Denver high above 90", "US debt rises $1B"), set the share of the coin's fee pool each burn spends, lock the rule. The rule is hashed at launch and enforced by a program, not a promise.`,
      `When the result settles on its primary source and an independent publisher agrees, the reading is signed on chain and the program spends the coin's own fees buying it on its own pool and burning all of it. The memo is the receipt.`,
      `Follow the season: team coins across ${lg.map((x) => x.label).join(", ")} (${lg.map((x) => x.team).join(", ")}), scored in receipts. Nothing is won here. Things are only burned.`,
      `Guardrails: creators earn nothing · zero team allocation · the platform never buys any coin · LP locked forever, its fees fund the burn · rules locked at launch · every receipt recomputable from its public source.`,
      `Open source: ${PUBLIC_REPO}\nReviewed: ${reviewLine(rf)}. Not audited by a security firm.`,
      `First coin: $DEFICIT (@USA_DEFICIT): each $1B the U.S. debt rises, its fees buy it back and burn it. ${NOTHING_BURNS_LINE}.\n\nRun by one independent operator.\nMemecoins: the rule says what supply does, not what price does. ${S}`,
    ],
  };
}

/** A coin launched by a creator (never ours): what it is, the rule, the hash, the page. */
export function coinLaunchThread(s: Pick<TokenStatusJson, "ticker" | "name" | "seriesTitle" | "selectorKey" | "rules" | "profile" | "addresses">, site: string): Draft {
  const S = siteOf(site), T = `$${s.ticker}`;
  const creator = s.addresses.creator ? `${s.addresses.creator.slice(0, 4)}…${s.addresses.creator.slice(-4)}` : "—";
  return {
    format: "launch-thread", account: "@BurnTicker", subject: `${T} launch`,
    posts: [
      `New on Burnticker: ${T} (${s.name}). ${s.profile?.oneLiner?.trim() || s.seriesTitle || s.selectorKey}`,
      `Rule locked at launch: sha256:${s.rules.sha12}. Creator wallet ${creator} earns nothing from fees; the creator fee pays ${T}'s burn pool, 100%.\n\n${S}/t/${s.ticker}/\n${SHORT_DISCLAIMER}`,
    ],
  };
}

// ---- (6) teasers (pre-launch; true today) ----
/**
 * The devnet rehearsal's first program burn, read from its evidence file (docs/burnkeeper/evidence/devnet-2026-10-10/burns.json, the
 * record behind docs/burnkeeper/devnet-run.md §4): a test coin under the devnet rule (1% per unit, `deficit.devnet.rules.json`), so the
 * teaser says "test" and "devnet" and links the explorer and the log. No signature is typed into this file.
 */
export const DEVNET_EVIDENCE = path.join("docs", "burnkeeper", "evidence", "devnet-2026-10-10", "burns.json");
export interface DevnetReceipt { date: string; units: number; spentSol: string; burned: string; txUrl: string; log: string }
export function devnetReceipt(rows: readonly BurnJson[]): DevnetReceipt {
  const r = rows.find((b) => b.status === "confirmed" && b.txUrl && b.burned);
  if (!r) throw new Error(`${DEVNET_EVIDENCE}: no confirmed burn with a transaction`);
  return { date: r.recordDate, units: r.units, spentSol: Number(r.spent).toFixed(4), burned: String(r.burned), txUrl: r.txUrl!, log: REPO_FILE("docs/burnkeeper/devnet-run.md") };
}

export const TEASER_TOPICS = ["devnet-receipt", "the-rule", "reviews", "open-source", "coverage"] as const;
export type TeaserTopic = (typeof TEASER_TOPICS)[number];
export interface TeaserContext { site: string; reviews?: ReviewFacts; deficit?: DeficitRuleFacts; coverage?: { settleable: number; adjudicatedOnly: number; uncovered: number }; devnet?: DevnetReceipt }

/** Reads "N settleable · M adjudicated-only · K uncovered" from docs/burnticker/SETTLEMENT-COVERAGE.md (written by the coverage audit). */
export function coverageCounts(md: string): TeaserContext["coverage"] | null {
  const m = /(\d+) settleable · (\d+) adjudicated-only · (\d+) uncovered/.exec(md);
  return m ? { settleable: +m[1], adjudicatedOnly: +m[2], uncovered: +m[3] } : null;
}

export function teaserDraft(topic: TeaserTopic, c: TeaserContext): Draft {
  const S = siteOf(c.site);
  const need = <T>(v: T | undefined, what: string): T => { if (v === undefined) throw new Error(`teaser ${topic}: needs ${what}`); return v; };
  const text: Record<TeaserTopic, () => { account: Account; posts: string[] }> = {
    "devnet-receipt": () => { const d = need(c.devnet, "the devnet evidence file"); return { account: "@BurnTicker", posts: [`Devnet rehearsal, ${d.date}: Treasury's debt figure counted ${d.units} units. The burn_receipts program spent ${d.spentSol} SOL of a test coin's fee pool, bought ${fmtInt(d.burned)} test $DEFICIT on its own pool and burned all of it, memo on chain.\n${d.txUrl}\nLog: ${d.log}`] }; },
    "the-rule": () => { const f = need(c.deficit, "the $DEFICIT rule file"); return { account: "@USA_DEFICIT", posts: [`$${f.ticker}'s rule: every full ${dollarsB(f.unitUsd)} added to Treasury's Debt to the Penny is one unit; each unit spends ${pctOf(f.fractionPerUnit)} of the burn pool buying $${f.ticker} on its own pool, and the program burns all of it.\nRule file sha256:${f.sha256.slice(0, 12)}\n${SHORT_DISCLAIMER}`] }; },
    reviews: () => { const r = need(c.reviews, "transparency.json review facts"); return { account: "@BurnTicker", posts: [`Burnticker's program and keeper: ${reviewLine(r)}. Every finding is in the reports with its fix. Not audited by a security firm.\n\n${REPO_TREE("docs/burnticker/reviews")}`] }; },
    "open-source": () => ({ account: "@BurnTicker", posts: [`Everything Burnticker runs is public: the on-chain program, the keeper, the pages, the tests. The operator's trading bots refuse every platform coin, in code, and that file is public too.\n\nOperated by one independent operator.\n${PUBLIC_REPO}`] }),
    coverage: () => { const k = need(c.coverage, "the coverage counts"); return { account: "@BurnTicker", posts: [`What Burnticker can settle today, category by category, with the primary source and its independent cross-read: ${k.settleable} settleable · ${k.adjudicatedOnly} on an on-chain payout only · ${k.uncovered} uncovered.\n\n${REPO_FILE("docs/burnticker/SETTLEMENT-COVERAGE.md")}\n${S}/burnticker/trust`] }; },
  };
  const t = text[topic]();
  return { format: "teaser", account: t.account, subject: topic, posts: t.posts };
}
