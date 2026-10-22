// THE BOT STARTER KIT (growth batch 2026-10-10; packages/burnticker-bot-starter): follow.ts prints each new receipt once with its
// verifier call; launch.ts builds a launch bundle for a catalogue rule, prints the unsigned transactions and the rules sha, and never
// signs; post.ts renders a lint-clean receipt post through the platform's generator and appends it to a queue file (no X API). Run
// against the real v1 route handlers on the fakes (makeWorld). Plus the rules the README states, checked on the source.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Transaction } from "@solana/web3.js";
import { API, makeWorld, routeFetch, type World } from "./burntickerApiHelpers.ts";
import { Burnticker, rules } from "../packages/burnticker-bot-starter/src/sdk.ts";
import { followOnce, formatReceipt, loadState, main as followMain, newReceipts, saveState } from "../packages/burnticker-bot-starter/src/follow.ts";
import { launchableSources, preview, ruleFor, main as launchMain } from "../packages/burnticker-bot-starter/src/launch.ts";
import { coinDraft, pickReceipt, queueDraft, main as postMain } from "../packages/burnticker-bot-starter/src/post.ts";
import { config, parseArgs } from "../packages/burnticker-bot-starter/src/config.ts";
import { readQueue } from "@/lib/launch/postQueue";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const PKG = path.resolve(import.meta.dirname, "../packages/burnticker-bot-starter");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bt-starter-"));
const WALLET = "CreatorWa11et111111111111111111111111111111";
let w: World, bt: Burnticker;
before(async () => { w = await makeWorld(); bt = new Burnticker({ apiBase: API, fetch: routeFetch }); });

describe("follow.ts", () => {
  test("first pass prints every receipt with its verifier call; the second pass prints nothing new", async () => {
    const r1 = await followOnce(bt, "BRONCO", { ticker: "BRONCO", seen: [] }, { api: API, verify: "server" });
    assert.ok(r1.lines.length > 0);
    assert.match(r1.lines[0], /verify: curl -s http:\/\/bt\.test\/api\/burnticker\/v1\/tokens\/BRONCO\/verify\//);
    assert.ok(r1.lines.some((l) => /→\s+verified \(server\)/.test(l)), "the verifier's answer is printed next to the call");
    const r2 = await followOnce(bt, "BRONCO", r1.state, { api: API, verify: "server" });
    assert.deepEqual(r2.lines, []);
  });
  test("state persists across runs; a receipt that changes status prints again", async () => {
    const dir = tmp();
    saveState(dir, { ticker: "X", seen: ["a|planned"] });
    assert.deepEqual(loadState(dir, "X"), { ticker: "X", seen: ["a|planned"] });
    assert.deepEqual(loadState(dir, "NONE"), { ticker: "NONE", seen: [] });
    const r = { eventId: "a", status: "confirmed" } as never;
    assert.equal(newReceipts({ ticker: "X", seen: ["a|planned"] }, [r]).length, 1);
  });
  test("main --once writes the state file and logs the receipts; text lints clean", async () => {
    const dir = tmp(), out: string[] = [];
    await followMain(["DEFICIT2", "--once", "--verify", "none"], { ...config({}), api: API, stateDir: dir }, bt, (s) => out.push(s));
    assert.ok(fs.existsSync(path.join(dir, "follow-DEFICIT2.json")));
    assert.ok(out.length > 1);
    const cfg = loadCopyLintConfig();
    for (const l of out.slice(1)) assert.ok(lintCopy(l.replace(/https?:\/\/\S+/g, ""), cfg).ok, l);
    await assert.rejects(followMain(["bad ticker!"], config({}), bt, () => {}), /usage: follow/);
  });
  test("formatReceipt for a non-confirmed receipt says its status", () => {
    const s = formatReceipt("T", { eventId: "e", status: "skipped", skippedReason: "under the $1 floor", market: "m", settledAt: "2026-10-10T00:00:00Z", units: 0, burned: null, result: null, value: null, txUrl: null, settlementSourceUrl: null } as never, API, null);
    assert.match(s, /\$T skipped \(under the \$1 floor\) · m/);
  });
});

describe("launch.ts", () => {
  test("lists only launchable catalogue sources with a unit", async () => {
    const cat = await bt.catalogue();
    const ls = launchableSources(cat.sources);
    assert.ok(ls.some((s) => s.id === "treasury.debt"));
    assert.ok(ls.every((s) => s.launchable.ok && s.unit));
    const out: string[] = [];
    await launchMain([], { ...config({}), api: API }, bt, (s) => out.push(s));
    assert.ok(out.some((l) => l.includes("treasury.debt")));
  });
  test("previews a bundle: the local and the API's rules sha agree; unsigned transactions only; nothing registered", async () => {
    const before = w.registry.tokens().length;
    const p = await preview(bt, { source: "treasury.debt", fraction: 0.02, ticker: "DEBTX", name: "Debt Burn", wallet: WALLET, register: false });
    assert.equal(p.rulesSha256, p.localSha256);
    assert.match(p.rulesSha256, /^[0-9a-f]{64}$/);
    const src = (await bt.catalogue()).sources.find((s) => s.id === "treasury.debt")!;
    const { selector, mapping } = ruleFor(src, 0.02);
    assert.equal(rules.sha256({ ...rules.compose(selector, mapping), onEnd: { windDownDays: 28, sweepThresholdLamports: 50000000, endSink: true } }), p.rulesSha256, "the same bytes the SDK locks (with the default end)");
    assert.ok(p.unsigned.length >= 1);
    for (const u of p.unsigned) {
      const tx = Transaction.from(Buffer.from(u.transaction, "base64"));
      assert.ok(tx.signatures.every((s) => s.signature === null || s.signature.every((b) => b === 0)), "every signature slot is empty");
      assert.deepEqual([...u.signers].sort(), ["creator", "mint"]);
    }
    assert.ok(p.lines.some((l) => /^sha256 {4}[0-9a-f]{64} {3}\(computed locally: matches/.test(l)));
    assert.ok(p.lines.some((l) => l.startsWith("Nothing was signed.")));
    assert.equal(w.registry.tokens().length, before, "register: false registers nothing");
  });
  test("refuses a bad fraction, an unknown source and a missing wallet", async () => {
    const src = (await bt.catalogue()).sources.find((s) => s.id === "treasury.debt")!;
    assert.throws(() => ruleFor(src, 0.5), /0\.01–0\.10/);
    await assert.rejects(preview(bt, { source: "no.such", fraction: 0.02, ticker: "ABC", name: "x", wallet: WALLET, register: false }), /no catalogue source/);
    await assert.rejects(launchMain(["--source", "treasury.debt", "--ticker", "ABC"], { ...config({}), api: API }, bt, () => {}), /--wallet/);
  });
});

describe("post.ts", () => {
  test("a receipt post from the platform's generator, lint-clean, appended once to the queue file (never twice)", async () => {
    const file = path.join(tmp(), "posts.jsonl");
    const d = await coinDraft(bt, "BRONCO", "receipt", "https://burnticker.com");
    assert.equal(d.format, "receipt"); assert.match(d.posts[0], /\$BRONCO/);
    const a = queueDraft(d, file, "test", Date.parse("2026-10-10T00:00:00Z"));
    assert.equal(a.appended, true); assert.equal(a.entry.status, "awaiting-owner");
    assert.equal(queueDraft(d, file, "test").appended, false, "the same words are not queued twice");
    assert.equal(readQueue(file).length, 1);
    assert.ok(lintCopy(d.posts[0], loadCopyLintConfig()).ok);
  });
  test("the season card, and main's queue line says nothing was posted", async () => {
    const file = path.join(tmp(), "q.jsonl"), out: string[] = [];
    await postMain(["DEFICIT2", "--format", "season-card", "--queue", file], { ...config({}), api: API }, bt, (s) => out.push(s));
    assert.ok(out.some((l) => /nothing was posted; a person posts it by hand/.test(l)));
    assert.equal(readQueue(file)[0].format, "season-card");
  });
  test("a draft the lint refuses is printed with its hits and never queued", async () => {
    const file = path.join(tmp(), "q.jsonl"), out: string[] = [];
    const bad = { format: "receipt" as const, account: "@BurnTicker" as const, subject: "x", posts: ["$BRONCO will moon, buy now"] };
    assert.throws(() => queueDraft(bad, file, "test"), /refused receipt/);
    assert.equal(fs.existsSync(file), false);
    void out;
  });
  test("pickReceipt: the latest confirmed burn, or the one named", async () => {
    const t = await bt.token("DEFICIT2");
    const latest = pickReceipt(t.receipts, null)!;
    assert.equal(latest.status, "confirmed");
    assert.ok(t.receipts.filter((r) => r.status === "confirmed").every((r) => r.settledAt <= latest.settledAt));
    assert.equal(pickReceipt(t.receipts, "nope"), null);
  });
});

describe("the kit's rules, on its source", () => {
  const files = fs.readdirSync(path.join(PKG, "src")).map((f) => [f, fs.readFileSync(path.join(PKG, "src", f), "utf8")] as const);
  test("no signing, no sending, no key files, no X API, no network but the public API and the site", () => {
    for (const [f, src] of files) {
      const code = src.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      assert.doesNotMatch(code, /\.(partialSign|sign|signTransaction|signAllTransactions)\(|sendRawTransaction|sendTransaction|Keypair\.fromSecretKey|secretKey|readFileSync\([^)]*(wallet|key)/i, `${f}: no signing`);
      assert.doesNotMatch(code, /api\.(twitter|x)\.com|oauth|bearer/i, `${f}: no X API`);
      assert.doesNotMatch(code, new RegExp(`["'\`][.]${"env"}|dotenv|process[.]env[.][A-Z_]*(KEY|SECRET|TOKEN|PRIVATE)`), `${f}: no secrets`);
    }
  });
  test("the SDK import is one line (src/sdk.ts), so the kit runs outside the repo with @burnticker/sdk", () => {
    const sdk = files.find(([f]) => f === "sdk.ts")![1];
    const line = ["export * ", "from ", JSON.stringify("../../burnticker-sdk/src/index.ts"), ";"].join("");   // split so the publish script's import scan does not read this test as an import
    assert.ok(sdk.split("\n").includes(line), "the one SDK line");
    assert.match(sdk, /change the path in the line below to the package name, `@burnticker\/sdk`/);
    for (const [f, src] of files) if (f !== "sdk.ts") assert.doesNotMatch(src.match(/^import .*$/gm)?.join("\n") ?? "", /burnticker-sdk/, `${f} imports the SDK through ./sdk.ts`);
  });
  test("the README covers setup, the keyless API, and the rules (no price talk, no auto-posting)", () => {
    const md = fs.readFileSync(path.join(PKG, "README.md"), "utf8");
    for (const s of ["## Setup", "keyless", "no price", "No auto-posting", "never signs", "npm run follow", "npm run launch", "npm run post"]) assert.ok(md.toLowerCase().includes(s.toLowerCase()), s);
  });
  test("parseArgs", () => {
    assert.deepEqual(parseArgs(["A", "--once", "--interval", "30", "--x=1"]), { pos: ["A"], opt: { once: true, interval: "30", x: "1" } });
  });
  test("the public-repo allowlist publishes the kit", () => {
    const allow = fs.readFileSync(path.resolve(import.meta.dirname, "../config/public-repo.allowlist"), "utf8").split("\n").map((l) => l.trim());
    assert.ok(allow.includes("packages/burnticker-bot-starter"));
  });
});
