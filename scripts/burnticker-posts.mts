#!/usr/bin/env node
/**
 * burnticker-posts — builds X posts in the six fixed formats (receipt · scoreboard · season-card · explainer · launch-thread · teaser)
 * from the keeper's published files, or from fixtures, lints every one, and APPENDS the clean ones to the owner's review queue
 * (data/launch/post-queue.jsonl, append-only). It never posts, never signs in, never calls X or any other network service. A post
 * with a copy-lint hit, an unfilled placeholder or more than 280 X-characters is refused: printed to stderr, never queued, exit 3.
 * Plan of record: docs/launch/gtm/PLAN.md §3 and §5. Library: src/lib/launch/postQueue.ts.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-posts.mts <format|all> [flags]
 *
 *   all --fixtures --print                      every format from the fixtures (the dry run the owner reads first)
 *   teaser [--topic=devnet-receipt|the-rule|open-source|coverage]   pre-launch posts that are true today
 *   explainer [--topic=how-a-burn-happens|what-a-receipt-is|why-lp-is-locked|why-creators-earn-nothing]
 *   launch-thread --kind=deficit|platform|coin [--ticker=T] [--launch-tx=URL]
 *   receipt [--ticker=T|--deficit] [--day=YYYY-MM-DD] [--all]   confirmed burns only (default: the day before --now, UTC)
 *   scoreboard [--day=YYYY-MM-DD] [--league=NHL] [--season=…] [--season-over] [--pair=<pairId>]   (one post per league + the count line)
 *   season-card --ticker=T
 *   digest --digest-file=FILE                   one post from a saved GET /api/burnticker/v1/digest?day= answer (cheap-features item 8)
 *
 * Flags: --fixtures (test/postQueueFixtures.ts instead of data dirs) · --print (show every post) · --dry-run (write nothing) ·
 * --queue=FILE (default data/launch/post-queue.jsonl) · --site=URL (default https://burnticker.com) · --deficit-site=URL (default
 * https://deficit.burnticker.com) · --platform-dir=DIR (BURNTICKER_PUBLISH_DIR or data/burnticker-site: index.json, t/<T>/status.json +
 * receipts.json, p/<id>/pair.json) · --dir=DIR ($DEFICIT keeper: BURNKEEPER_PUBLISH_DIR or data/burnkeeper-site: status.json +
 * burns.json) · --now=ISO (the clock, for previews and tests).
 */

import fs from "node:fs";
import path from "node:path";
import type { BurnJson, StatusJson } from "@/lib/burnKeeper/statusPage";
import type { PairTally, PlatformIndexJson, ReceiptJson, TokenStatusJson } from "@/lib/burnticker/tokenPage";
import { rulesSha256 } from "@/lib/burnKeeper/rules";
import {
  DEVNET_EVIDENCE, EXPLAINER_TOPICS, POST_FORMATS, PostRefused, QUEUE_FILE, TEASER_TOPICS, appendQueue, checkDraft, coinLaunchThread, coverageCounts, deficitFacts, deficitLaunchThread,
  deficitReceiptDraft, devnetReceipt, explainerDraft, pairScoreboardDraft, platformLaunchThread, printDraft, receiptDraft, reviewFacts, scoreboardDrafts, seasonCardDraft, teaserDraft,
  DIGEST_FORMAT, type Draft, type ExplainerTopic, type PostFormat, type QueuedPost, type TeaserTopic,
} from "@/lib/launch/postQueue";
import { digestDraft, type Digest } from "@/lib/burnticker/digest";

const positional: string[] = [];
const args = new Map<string, string>();
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) args.set(m[1], m[2] ?? "true"); else positional.push(a); }
const usage = (msg: string): never => { console.error(`${msg}\nusage: scripts/burnticker-posts.mts <${[...POST_FORMATS, "all"].join("|")}> [--fixtures] [--print] [--dry-run] … (see the header)`); process.exit(2); };
const format = positional[0] ?? usage("no format");
if (format !== "all" && format !== DIGEST_FORMAT && !(POST_FORMATS as readonly string[]).includes(format)) usage(`unknown format ${format}`);
const fixtures = args.has("fixtures");
const site = args.get("site") ?? "https://burnticker.com";
const deficitSite = args.get("deficit-site") ?? "https://deficit.burnticker.com";
const queueFile = args.get("queue") ?? QUEUE_FILE;
const now = args.has("now") ? Date.parse(args.get("now")!) : Date.now();
if (Number.isNaN(now)) usage(`--now is not a date: ${args.get("now")}`);
const day = args.get("day") ?? new Date(now - 86_400_000).toISOString().slice(0, 10);
const platformDir = args.get("platform-dir") ?? process.env.BURNTICKER_PUBLISH_DIR?.trim() ?? path.join("data", "burnticker-site");
const deficitDir = args.get("dir") ?? process.env.BURNKEEPER_PUBLISH_DIR?.trim() ?? path.join("data", "burnkeeper-site");

const readJson = <T,>(file: string): T | null => { try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return null; } };

// ---- the daily digest (cheap-features item 8): one post from a saved GET /v1/digest?day= answer; nothing is read from the network ----
if (format === DIGEST_FORMAT) {
  const file = args.get("digest-file") ?? usage("digest needs --digest-file=FILE (a saved answer of GET /api/burnticker/v1/digest?day=YYYY-MM-DD)");
  const d = readJson<Digest>(file);
  if (!d || typeof d.day !== "string" || !d.counts || !Array.isArray(d.burns)) usage(`${file} is not a digest answer`);
  let entry: QueuedPost;
  try { entry = checkDraft(digestDraft(d!), { source: `digest ${d!.day}`, now }); }
  catch (e) { if (!(e instanceof PostRefused)) throw e; console.error(`REFUSED ${e.draft.format} · ${e.draft.subject} — ${e.reason}\n${e.detail}\n${printDraft(e.draft)}`); process.exit(3); }
  const dry = args.has("dry-run");
  const r = dry ? { appended: [entry!], skipped: [] as QueuedPost[] } : appendQueue(queueFile, [entry!]);
  if (args.has("print") || dry) for (const e of [...r.appended, ...r.skipped]) console.log(`${printDraft(e)}\n`);
  console.error(`${dry ? "dry run: nothing written" : `${queueFile}: ${r.appended.length} appended, ${r.skipped.length} already queued`} · nothing was posted (the owner posts by hand)`);
  process.exit(0);
}

// ---- the data: fixtures or the keepers' published files ----
interface Data {
  index: PlatformIndexJson | null; status: (t: string) => TokenStatusJson | null; receipts: (t: string) => ReceiptJson[]; pair: (id: string) => PairTally | null;
  deficit: { status: StatusJson; burns: BurnJson[] } | null;
}
async function load(): Promise<Data> {
  if (fixtures) {
    const F = await import("../test/postQueueFixtures.ts");
    const d = F.deficitSample();
    // The committed sample has no chain (no txUrl); the fixture run stands in a placeholder transaction so the format can be read.
    d.burns = d.burns.map((b) => ({ ...b, txUrl: b.txUrl ?? `https://solscan.io/tx/SAMPLE-${b.recordDate}` }));
    const statuses: Record<string, TokenStatusJson> = { RAYS: F.RAYS_STATUS, ELSAYED: F.ONESHOT_STATUS };
    return { index: F.SEASON_INDEX, status: (t) => statuses[t] ?? null, receipts: (t) => F.SEASON_RECEIPTS[t] ?? [], pair: (id) => (id === F.PAIR_TALLY.pairId ? F.PAIR_TALLY : null), deficit: d };
  }
  const st = readJson<StatusJson>(path.join(deficitDir, "status.json")), burns = readJson<BurnJson[]>(path.join(deficitDir, "burns.json"));
  return {
    index: readJson<PlatformIndexJson>(path.join(platformDir, "index.json")),
    status: (t) => readJson<TokenStatusJson>(path.join(platformDir, "t", t, "status.json")),
    receipts: (t) => readJson<ReceiptJson[]>(path.join(platformDir, "t", t, "receipts.json")) ?? [],
    pair: (id) => readJson<{ tally: PairTally }>(path.join(platformDir, "p", id, "pair.json"))?.tally ?? null,
    deficit: st && burns ? { status: st, burns } : null,
  };
}

// The committed facts every run reads (the same files in both modes: they ARE the state of the world the posts describe).
const rulesText = fs.readFileSync(path.join("config", "burnkeeper", "deficit.rules.json"), "utf8");
const deficit = deficitFacts(rulesText, rulesSha256(rulesText));
const reviews = reviewFacts(JSON.parse(fs.readFileSync(path.join("config", "burnticker", "transparency.json"), "utf8")));
const coverage = coverageCounts(fs.readFileSync(path.join("docs", "burnticker", "SETTLEMENT-COVERAGE.md"), "utf8")) ?? undefined;
const devnet = devnetReceipt(JSON.parse(fs.readFileSync(DEVNET_EVIDENCE, "utf8")) as BurnJson[]);

const notes: string[] = [];
function build(f: PostFormat, data: Data): Draft[] {
  const ticker = args.get("ticker")?.toUpperCase().replace(/^\$/, "");
  const all = format === "all";
  switch (f) {
    case "teaser": {
      const topics = args.has("topic") && !all ? [args.get("topic") as TeaserTopic] : [...TEASER_TOPICS];
      return topics.map((t) => { if (!TEASER_TOPICS.includes(t)) usage(`unknown teaser topic ${t}`); return teaserDraft(t, { site, reviews, deficit, coverage, devnet }); });
    }
    case "explainer": {
      const topics = args.has("topic") && !all ? [args.get("topic") as ExplainerTopic] : [...EXPLAINER_TOPICS];
      return topics.map((t) => { if (!EXPLAINER_TOPICS.includes(t)) usage(`unknown explainer topic ${t}`); return explainerDraft(t, site); });
    }
    case "launch-thread": {
      const kinds = all ? ["deficit", "platform", "coin"] : [args.get("kind") ?? usage("launch-thread needs --kind=deficit|platform|coin")];
      return kinds.flatMap((k) => {
        if (k === "deficit") return [deficitLaunchThread(deficit, deficitSite, args.get("launch-tx") ?? null)];
        if (k === "platform") return [platformLaunchThread(reviews, site)];
        if (k === "coin") { const t = ticker ?? (all && fixtures ? "RAYS" : usage("--kind=coin needs --ticker")); const s = data.status(t); if (!s) { notes.push(`no status.json for $${t}`); return []; } return [coinLaunchThread(s, site)]; }
        return usage(`unknown --kind ${k}`);
      });
    }
    case "receipt": {
      const out: Draft[] = [];
      const wantDeficit = args.has("deficit") || (all && !ticker);
      const pick = <T extends { day: string }>(rows: T[]) => (args.has("all") ? rows : rows.filter((r) => r.day === day));
      if (wantDeficit && data.deficit) {
        const { status, burns } = data.deficit;
        const rows = burns.filter((b) => b.status === "confirmed").map((b) => ({ day: b.recordDate, b }));
        const chosen = all && fixtures ? rows.slice(-1) : pick(rows);
        if (!chosen.length) notes.push(`$DEFICIT: no confirmed burn for ${day}`);
        out.push(...chosen.map(({ b }) => deficitReceiptDraft(status, burns, b, deficitSite)));
      } else if (wantDeficit) notes.push(`$DEFICIT: no status.json + burns.json in ${deficitDir}`);
      const tickers = ticker ? [ticker] : all ? (data.index?.tokens.filter((t) => t.status === "live" && t.ticker !== "DEFICIT").map((t) => t.siteKey ?? t.ticker) ?? []) : [];
      for (const t of tickers) {
        const s = data.status(t); if (!s) { if (ticker) notes.push(`no status.json for $${t}`); continue; }
        const rs = data.receipts(t);
        const rows = rs.filter((r) => r.status === "confirmed" && r.burned && r.burned !== "0").map((r) => ({ day: r.settledAt.slice(0, 10), r }));
        const chosen = all && fixtures ? rows.slice(-1) : pick(rows);
        if (!chosen.length && ticker) notes.push(`$${t}: no confirmed burn for ${day}`);
        out.push(...chosen.map(({ r }) => receiptDraft(s, rs, r, site)));
      }
      if (!wantDeficit && !tickers.length) usage("receipt needs --ticker=T or --deficit");
      return out;
    }
    case "scoreboard": {
      const id = args.get("pair") ?? (all && fixtures ? "oilers-flames-26" : null);
      const out: Draft[] = [];
      if (id) { const t = data.pair(id); if (t) out.push(pairScoreboardDraft(t, site)); else notes.push(`no pair.json for ${id}`); }
      if (!args.has("pair")) {
        if (!data.index) notes.push(`no index.json in ${platformDir}`);
        else {
          const receiptsByTicker: Record<string, ReceiptJson[]> = {};
          // keyed by mint, read from the coin's own directory (tickers are not unique, owner 2026-10-12)
          for (const t of data.index.tokens) receiptsByTicker[t.mint] = data.receipts(t.siteKey ?? t.ticker);
          const sbDay = all && fixtures ? "2026-10-09" : day;
          out.push(...scoreboardDrafts({ index: data.index, receiptsByTicker, day: sbDay, league: args.get("league") ?? null, season: args.get("season") ?? null, seasonOver: args.has("season-over"), site }));
        }
      }
      return out;
    }
    case "season-card": {
      const tickers = ticker ? [ticker] : all && fixtures ? ["RAYS", "ELSAYED"] : usage("season-card needs --ticker=T");
      return tickers.flatMap((t) => { const s = data.status(t); if (!s) { notes.push(`no status.json for $${t}`); return []; } return [seasonCardDraft(s, site)]; });
    }
  }
}

const data = await load();
const formats: PostFormat[] = format === "all" ? [...POST_FORMATS] : [format as PostFormat];
const clean: QueuedPost[] = [];
let refused = 0;
for (const f of formats) {
  for (const d of build(f, data)) {
    try { clean.push(checkDraft(d, { source: fixtures ? "fixtures" : "live", now })); }
    catch (e) {
      if (!(e instanceof PostRefused)) throw e;
      refused++;
      console.error(`REFUSED ${e.draft.format} · ${e.draft.account} · ${e.draft.subject} — ${e.reason}\n${e.detail}\n${printDraft(e.draft)}\n`);
    }
  }
}
for (const n of notes) console.error(`note: ${n}`);

const dry = args.has("dry-run");
const { appended, skipped } = dry ? { appended: clean, skipped: [] as QueuedPost[] } : appendQueue(queueFile, clean);
if (args.has("print") || dry) for (const e of [...appended, ...skipped]) console.log(`${printDraft(e)}${skipped.includes(e) ? "\n(already in the queue)" : ""}\n`);
console.error(`${dry ? "dry run: nothing written" : `${queueFile}: ${appended.length} appended, ${skipped.length} already queued`} · ${refused} refused · nothing was posted (the owner posts by hand)`);
process.exit(refused ? 3 : 0);
