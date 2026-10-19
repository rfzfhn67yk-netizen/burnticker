// PRELAUNCH AUDIT 2026-10-18 A-2: a ticker is held by one creator. The launch prepare refuses the very same ticker when another creator's
// launched coin or open draft holds it (the review says the same under the ticker field), and every ticker it suggests instead passes
// the launch's own lookalike check. A creator may prepare their own draft again. The ticker URL of an existing coin never turns into a
// chooser for a stranger's new coin, a draft never owns a ticker's static directory, featured slots belong to a mint, and the SDK's
// verifyReceipt needs a mint (burntickerSdk.test.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { makeWorld, CREATOR } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";
import { prepareLaunch } from "@/lib/burnticker/api/handlers";
import { lookalikeHits, lookalikeRefusal, sameTickerSentence } from "@/lib/burnticker/lookalike";
import { lookalikeRows } from "@/lib/burnticker/launchGuards";
import { freeTickers, inUseWarning, isTeamRule, tickerChecks } from "@/lib/burnticker/tickerCheck";
import { lookupCoin } from "@/lib/burnticker/coinLookup";
import { siteKeysOf } from "@/lib/burnticker/coinKey";
import { featuredSlots, type FeaturedInput } from "@/lib/burnticker/featuredSlots";
import { launchErrorMessage } from "@/lib/burnticker/pairLaunchClient";
import { fieldLinkText, nameFieldId } from "../src/app/burnticker/launch/fieldChecks.ts";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";

const RULE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
const body = (ticker: string, creator: string, name = `${ticker} coin`) => ({ creator, ticker, name, rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } });
const mintPk = () => Keypair.generate().publicKey.toBase58();
const wallet = () => Keypair.generate().publicKey.toBase58();
// deno-lint-ignore no-explicit-any
type Any = any;
const code = (r: Any) => ("error" in r ? r.error.body.code : "ok");
const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); };

describe("A-2: the same ticker is refused for another creator", () => {
  test("the audit's shared-ticker case, inverted: a stranger's exact $BRONCO is refused; the ticker it is offered instead is accepted", async () => {
    const w = await makeWorld();
    const stranger = wallet();
    const clone = await prepareLaunch(w.p, body("BRONCO", stranger, "Unrelated Name"), { register: true, mint: mintPk(), client: "s1" });
    assert.equal(code(clone), "ticker-taken");
    const err = (clone as Any).error.body as { error: string; suggestions?: string[] };
    assert.match(err.error, /\$BRONCO is already the ticker of another Burnticker coin/);
    assert.doesNotMatch(err.error, new RegExp(w.bronco.mint), "the refusal names no mint");
    clean(err.error);
    assert.ok(err.suggestions && err.suggestions.length > 0, "the refusal offers free tickers");
    const shown = launchErrorMessage(409, { code: "ticker-taken", error: err.error });
    assert.doesNotMatch(shown, /\.\./); assert.match(shown, /Please pick another ticker\. These tickers are free: \$/); clean(shown);
    // the review offers the same kind of tickers (every one passes the lookalike check against every coin)
    const [chk] = tickerChecks([{ side: "A", ticker: "BRONCO", team: isTeamRule(RULE) }], { inUse: (t) => w.registry.tokensByTicker(t), existing: lookalikeRows(w.registry), reserved: new Set(), creator: stranger });
    assert.equal(chk.taken, true);
    assert.ok(chk.suggestions.length > 0);
    for (const s of chk.suggestions) assert.deepEqual(lookalikeHits({ ticker: s, name: "", creator: stranger }, lookalikeRows(w.registry)), [], s);
    const suggested = await prepareLaunch(w.p, body(chk.suggestions[0], wallet(), "Another Unrelated"), { register: true, mint: mintPk(), client: "s2" });
    assert.equal(code(suggested), "ok", JSON.stringify((suggested as Any).error?.body));
    // the ticker of the existing coin still opens that coin, never a chooser
    const l = lookupCoin(w.registry, "BRONCO");
    assert.equal(l.kind, "one");
    assert.equal(l.kind === "one" && l.token.mint, w.bronco.mint);
  });

  test("an open draft holds its ticker against strangers; its own creator may prepare it again (the same mint, or a new one)", async () => {
    const w = await makeWorld();
    const owner = wallet(), mint = mintPk();
    assert.equal(code(await prepareLaunch(w.p, body("HELDTKR", owner), { register: true, mint, client: "o1" })), "ok");
    assert.equal(w.registry.token(mint)!.status, "draft");
    const stranger = await prepareLaunch(w.p, body("HELDTKR", wallet()), { register: true, mint: mintPk(), client: "x1" });
    assert.equal(code(stranger), "ticker-taken");
    assert.doesNotMatch((stranger as Any).error.body.error, new RegExp(mint), "the refusal never reveals the draft's mint");
    assert.equal(code(await prepareLaunch(w.p, body("HELDTKR", owner), { register: true, mint, client: "o1" })), "ok", "the same draft again");
    assert.equal(code(await prepareLaunch(w.p, body("HELDTKR", owner), { register: true, mint: mintPk(), client: "o1" })), "ok", "the creator's own ticker, a new mint");
    // the same team's rule never lets a stranger take the very same ticker (the lookalike check skips same-team coins)
    assert.equal(code(await prepareLaunch(w.p, body("BRONCO", wallet()), { register: true, mint: mintPk(), client: "x2" })), "ticker-taken");
  });

  test("lookalike.ts: an identical ticker is a hit unless it is the candidate's own coin; the sentence names no coin", () => {
    const rows = [{ ticker: "ABCD", name: "Alpha", status: "draft", creator: "W1" }, { ticker: "LIVE", name: "Live one", status: "live", creator: "W2" }];
    assert.equal(lookalikeHits({ ticker: "ABCD", name: "x", creator: "W1" }, rows).length, 0);
    // review of block M: the creator's own LAUNCHED coin refuses the ticker too (a second coin would make /t/<TICKER> a chooser)
    assert.equal(lookalikeHits({ ticker: "LIVE", name: "x", creator: "W2" }, rows)[0].reason, sameTickerSentence("LIVE"));
    assert.equal(lookalikeHits({ ticker: "abcd", name: "x", creator: "W9" }, rows)[0].reason, sameTickerSentence("ABCD"));
    assert.ok(lookalikeRefusal({ ticker: "LIVE", name: "x" }, rows), "with no creator given, any holder refuses");
    clean(sameTickerSentence("ABCD")); clean(inUseWarning("ABCD", [1])!);
  });

  test("free tickers pass the lookalike check: no digit endings that read as the same letters", () => {
    const existing = [{ ticker: "LAD", name: "Dodgers", status: "live", creator: "W" }];
    const s = freeTickers("LAD", { inUse: () => [], existing, reserved: new Set() }, 2, { team: true });
    assert.equal(s.length, 2);
    for (const t of s) { assert.doesNotMatch(t, /^LAD\d$/); assert.deepEqual(lookalikeHits({ ticker: t, name: "" }, existing), []); }
  });

  test("the Name step says a field's problem once and links to the field from the list", () => {
    assert.equal(fieldLinkText("ticker", null), "Go to the ticker");
    assert.equal(fieldLinkText("name", "B"), "Go to the name of coin B");
    assert.equal(nameFieldId("a", "ticker"), "bt-profile-a-ticker");
    for (const s of [fieldLinkText("ticker", null), fieldLinkText("name", "A")]) clean(s);
  });
});

describe("A-2: keys by mint", () => {
  test("static directories: a draft never owns t/<TICKER>; every coin has t/<MINT>", () => {
    const k = siteKeysOf([
      { ticker: "OWN", mint: "MintDraft1111111111111111111111111111111111", status: "draft", launchedAt: null },
      { ticker: "OWN", mint: "MintLive11111111111111111111111111111111111", status: "live", launchedAt: "2026-10-05T00:00:00Z" },
      { ticker: "SOLO", mint: "MintSolo111111111111111111111111111111111", status: "live", launchedAt: "2026-10-02T00:00:00Z" },
      { ticker: "WAIT", mint: "MintWait111111111111111111111111111111111", status: "draft", launchedAt: null },
    ]);
    assert.deepEqual(k.get("MintDraft1111111111111111111111111111111111"), ["MintDraft1111111111111111111111111111111111"]);
    assert.deepEqual(k.get("MintLive11111111111111111111111111111111111"), ["OWN", "MintLive11111111111111111111111111111111111"]);
    assert.deepEqual(k.get("MintSolo111111111111111111111111111111111"), ["SOLO", "MintSolo111111111111111111111111111111111"]);
    assert.deepEqual(k.get("MintWait111111111111111111111111111111111"), ["MintWait111111111111111111111111111111111"]);
  });
  test("featured slots belong to a mint: two coins on one ticker are two coins, and each slot carries its mint", () => {
    const NOW = Date.parse("2026-10-18T12:00:00Z"), day = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
    const c = (mint: string, o: Partial<FeaturedInput>): FeaturedInput => ({ ticker: "SAME", mint, group: "public", burns: [], createdAt: day(30), poolRegistered: false, ...o });
    const slots = featuredSlots([c("M1", { burns: [{ settledAt: day(1) }, { settledAt: day(2) }] }), c("M2", { burns: [{ settledAt: day(0.5) }] })], NOW);
    assert.deepEqual(slots.map((s) => [s.rule, s.mint]), [["week-receipts", "M1"], ["latest-burn", "M2"]]);
  });
  test("the review route passes each holder's status and creator, and the launch page sends the wallet with the review", async () => {
    const fs = await import("node:fs");
    assert.match(fs.readFileSync("src/app/api/burnticker/v1/launch/review/route.ts", "utf8"), /status: x\.status, creator: x\.creator/);
    assert.match(fs.readFileSync("src/app/burnticker/launch/page.tsx", "utf8"), /reviewer\.want\(reviewKey, active \? \{ rule, \.\.\.\(creator \? \{ creator \} : \{\}\)/);   // audit 7 F02: the body goes to the requester
    assert.ok(CREATOR);
  });
});
