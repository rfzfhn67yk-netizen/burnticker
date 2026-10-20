// THE MINT KEY BANK (owner, 2026-10-14 night: "the BURN vanity address is mandatory. Save them like pump.fun does so they launch
// instantly."): the bank (take once, never twice, the 24-hour delete, the sealed secrets: a wrong key cannot open them, a missing key and
// a plaintext file are refused), the housekeeping and the low alert, the launch route (one key per coin, two distinct for a pair, the
// pair curve's two, an empty bank or plain HTTP → mint-bank-empty, a refused request deletes its keys, "launched" marks the key spent),
// the disclosure on every page that says what the site controls (lint clean, pinned per page), and the unit + deploy wiring.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Keypair } from "@solana/web3.js";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import {
  bankHousekeeping, MintBank, MintBankRefusal, mintBankSettings, MINT_BANK_EMPTY_CODE, MINT_BANK_EMPTY_SENTENCE, MINT_BANK_LOW_ALERT_KIND,
  MINT_BANK_NO_KEY, MINT_BANK_TAKEN_TTL_MS, parseBankKey, seal, unseal,
} from "@/lib/burnticker/mintBank";
import { base58, base58Decode, grindMint, groundMintProblem, MINT_BANK_EMPTY, type GroundMint } from "@/lib/burnticker/vanityMint";
import { MINT_ADDRESS_NOTE, MINT_ADDRESS_TRUST, MINT_KEY_DISCLOSURE } from "@/lib/burnticker/mintAddressCopy";
import { PUSH_KIND_OF_ALERT, PUSH_LEAD, PUSH_TITLE } from "@/lib/burnticker/push";
import { limiter } from "@/lib/burnticker/api/http";
import { CREATOR, makeWorld, testMintBank } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const read = (f: string) => fs.readFileSync(f, "utf8");
const cfg = loadCopyLintConfig();
const clean = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); };
const KEY = () => randomBytes(32).toString("base64");
const key = (seed = 0): GroundMint => grindMint({ suffix: "b", batch: 200_000, rng: (n) => new Uint8Array(randomBytes(n)) }).found! ?? assert.fail(String(seed));
const memBank = (n = 0) => { const b = new MintBank(":memory:", { key: KEY(), suffixes: ["b"] }); for (let i = 0; i < n; i++) b.insert(key(i), 1_000 + i); return b; };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bt-mintbank-"));

describe("the bank: each key handed out once", () => {
  test("take marks each key taken (with its ticker) in one go, never hands it out again, and takes nothing when short", () => {
    const b = memBank(3);
    const got = b.take(["AAA", "BBB"], 5_000)!;
    assert.equal(got.length, 2); assert.notEqual(got[0].publicKey, got[1].publicKey);
    for (const k of got) { assert.equal(groundMintProblem(k, ["b"]), null, "a sound key that derives its address"); assert.equal(Keypair.fromSecretKey(k.secretKey).publicKey.toBase58(), k.publicKey); }
    assert.deepEqual(b.takenPending().map((t) => [t.takenFor, t.takenAt]).sort(), [["AAA", 5_000], ["BBB", 5_000]]);
    assert.deepEqual({ ready: b.status().ready, taken: b.status().taken }, { ready: 1, taken: 2 });
    assert.equal(b.take(["CCC", "DDD"]), null, "two wanted, one ready: nothing is taken");
    assert.equal(b.status().ready, 1);
    const last = b.take(["CCC"])!;
    assert.ok(!got.some((k) => k.publicKey === last[0].publicKey), "a taken key never comes back");
    assert.equal(b.take(["EEE"]), null);
    assert.equal(b.insert(got[0]), false, "a key already in the bank is not added twice (and stays taken)");
    assert.equal(b.take(["FFF"]), null);
  });
  test("only sound burn-ending keys go in: a key for another address, or one that does not end in the suffix, is refused", () => {
    const real = new MintBank(":memory:", { key: KEY() });   // the real suffixes: burn / BURN
    let plain = Keypair.generate(); while (/(burn|BURN)$/.test(plain.publicKey.toBase58())) plain = Keypair.generate();
    assert.throws(() => real.insert({ publicKey: plain.publicKey.toBase58(), secretKey: plain.secretKey }), /does not end in burn or BURN/);
    const k = key(), other = Keypair.generate();
    const b = memBank();
    assert.throws(() => b.insert({ publicKey: k.publicKey, secretKey: other.secretKey }), /does not match its address/);
  });
  test("a key taken and not launched within 24 hours is deleted, not recycled; a launched key is kept, its secret wiped; a discarded key is gone", () => {
    const b = memBank(4);
    const [a, c] = b.take(["A", "C"], 0)!;
    const [d] = b.take(["D"], 0)!;
    assert.equal(b.markCreated(c.publicKey, 10), true);
    assert.equal(b.markCreated(c.publicKey, 11), false, "once");
    b.discard([d.publicKey]);
    assert.equal(b.sweep(MINT_BANK_TAKEN_TTL_MS - 1), 0, "not yet");
    assert.equal(b.sweep(MINT_BANK_TAKEN_TTL_MS + 1), 1, "the unlaunched one");
    const s = b.status();
    assert.deepEqual({ ready: s.ready, taken: s.taken, created: s.created }, { ready: 1, taken: 0, created: 1 });
    assert.ok(!b.takenPending().some((t) => t.pubkey === a.publicKey));
    assert.equal(b.take(["X"])![0].publicKey !== a.publicKey, true, "the expired key is never offered again");
    // the launched row keeps no secret
    const db = (b as unknown as { db: DatabaseSync }).db;
    assert.equal((db.prepare("SELECT length(ciphertext) AS n FROM keys WHERE pubkey = ?").get(c.publicKey) as { n: number }).n, 0);
    assert.equal(b.markCreated(Keypair.generate().publicKey.toBase58()), false, "an address the bank never handed out");
  });
});

describe("the bank: sealed at rest, no plaintext ever", () => {
  test("AES-256-GCM with the address bound in: the right key opens it, a wrong key or another address cannot", () => {
    const k1 = parseBankKey(KEY()), k2 = parseBankKey(KEY()), m = key();
    const sealed = seal(k1, m.publicKey, m.secretKey);
    assert.equal(sealed.length, 12 + 16 + 64);
    assert.deepEqual(unseal(k1, m.publicKey, sealed), m.secretKey);
    assert.throws(() => unseal(k2, m.publicKey, sealed), MintBankRefusal);
    assert.throws(() => unseal(k1, Keypair.generate().publicKey.toBase58(), sealed), MintBankRefusal, "a row moved to another address does not open");
  });
  test("the key must be 32 bytes in base64; no key at all is refused with a plain sentence and no file is made", () => {
    assert.throws(() => parseBankKey(""), (e: Error) => e.message === MINT_BANK_NO_KEY);
    assert.throws(() => parseBankKey(undefined), MintBankRefusal);
    assert.throws(() => parseBankKey(randomBytes(16).toString("base64")), /exactly 32 bytes/);
    const dir = tmp(), f = path.join(dir, "bank.db");
    assert.throws(() => new MintBank(f, { key: "" }), (e: Error) => e.message === MINT_BANK_NO_KEY);
    assert.equal(fs.existsSync(f), false, "refused before anything is written");
    clean(MINT_BANK_NO_KEY);
  });
  test("on disk: mode 0600, the secret bytes nowhere in the file, a wrong key refused, the web host never creates the file", () => {
    const dir = tmp(), f = path.join(dir, "data", "bank.db"), k = KEY(), m = key();
    assert.throws(() => new MintBank(f, { key: k, create: false }), /does not exist on this host yet/);
    const b = new MintBank(f, { key: k, suffixes: ["b"] });
    b.insert(m); b.close();
    assert.equal(fs.statSync(f).mode & 0o777, 0o600);
    const bytes = Buffer.concat([fs.readFileSync(f), ...["-wal", "-shm"].filter((x) => fs.existsSync(f + x)).map((x) => fs.readFileSync(f + x))]);
    assert.equal(bytes.includes(Buffer.from(m.secretKey.slice(0, 32))), false, "the seed is not in the file");
    assert.equal(bytes.includes(Buffer.from(base58(m.secretKey))), false);
    assert.throws(() => new MintBank(f, { key: KEY(), suffixes: ["b"] }), /not the key this mint bank was sealed with/);
    const again = new MintBank(f, { key: k, suffixes: ["b"], create: false });
    assert.equal(again.take(["T"])![0].publicKey, m.publicKey, "the right key opens it");
    again.close();
  });
  test("a plaintext file is refused: an unsealed secret in a row, or keys without the sealing record", () => {
    const dir = tmp(), k = KEY(), m = key();
    // a bank whose row holds the raw 64-byte secret
    const f1 = path.join(dir, "raw.db");
    new MintBank(f1, { key: k, suffixes: ["b"] }).close();
    const db1 = new DatabaseSync(f1);
    db1.prepare("INSERT INTO keys (pubkey, ciphertext, created_at) VALUES (?, ?, ?)").run(m.publicKey, m.secretKey, 1);
    db1.close();
    assert.throws(() => new MintBank(f1, { key: k, suffixes: ["b"] }), /not sealed, so it is refused/);
    // a keys table with no format / check record
    const f2 = path.join(dir, "bare.db");
    const db2 = new DatabaseSync(f2);
    db2.exec("CREATE TABLE keys (pubkey TEXT PRIMARY KEY, ciphertext BLOB NOT NULL, created_at INTEGER NOT NULL, taken_at INTEGER, taken_for TEXT, mint_created_at INTEGER)");
    db2.prepare("INSERT INTO keys (pubkey, ciphertext, created_at) VALUES (?, ?, ?)").run(m.publicKey, m.secretKey, 1);
    db2.close();
    fs.chmodSync(f2, 0o600);
    assert.throws(() => new MintBank(f2, { key: k, suffixes: ["b"] }), /without its sealing record/);
  });
});

describe("the bank service's housekeeping and the low alert", () => {
  test("launched mints marked from the registry, stale keys deleted, the fill target; the alert after an hour below LOW, once", () => {
    const b = memBank(3);
    const [a, c] = b.take(["A", "C"], 0)!;
    let h = bankHousekeeping(b, { size: 5, low: 2, now: 60_000, isLive: (p) => p === a.publicKey, filling: false });
    assert.deepEqual({ created: h.created, swept: h.swept }, { created: 1, swept: 0 });
    assert.equal(h.filling, true); assert.equal(h.need, 4, "below LOW: fill to SIZE");
    assert.equal(h.alert, null, "not an hour yet");
    h = bankHousekeeping(b, { size: 5, low: 2, now: MINT_BANK_TAKEN_TTL_MS + 1, isLive: () => { throw new Error("registry down"); }, filling: true });
    assert.equal(h.swept, 1, "c was never launched"); assert.ok(!b.takenPending().some((t) => t.pubkey === c.publicKey));
    assert.equal(h.alert?.kind, MINT_BANK_LOW_ALERT_KIND); clean(h.alert!.text);
    assert.match(h.alert!.text, /Launches still work/);
    assert.equal(bankHousekeeping(b, { size: 5, low: 2, now: MINT_BANK_TAKEN_TTL_MS + 2 * 60 * 60_000, isLive: () => false, filling: true }).alert, null, "once per low spell");
    for (let i = 0; i < 4; i++) b.insert(key(i));
    h = bankHousekeeping(b, { size: 5, low: 2, now: MINT_BANK_TAKEN_TTL_MS + 3 * 60 * 60_000, isLive: () => false, filling: true });
    assert.deepEqual({ need: h.need, filling: h.filling }, { need: 0, filling: false }, "full: nothing to grind");
    assert.equal(b.status().lowSince, null, "the spell is over");
    assert.equal(bankHousekeeping(b, { size: 6, low: 2, now: 0, isLive: () => false, filling: false }).need, 0, "between LOW and SIZE and not filling: wait");
  });
  test("settings: the defaults and the names (never a value)", () => {
    assert.deepEqual(mintBankSettings({}), { path: "data/burnticker-mintbank.db", size: 300, low: 100, key: undefined });
    assert.deepEqual(mintBankSettings({ BURNTICKER_MINT_BANK_SIZE: "50", BURNTICKER_MINT_BANK_LOW: "80", BURNTICKER_MINT_BANK_PATH: "/x/b.db" }), { path: "/x/b.db", size: 50, low: 50, key: undefined });
  });
  test("the push: bt-mint-bank-low maps to its own kind with a plain title and lead", () => {
    assert.equal(PUSH_KIND_OF_ALERT[MINT_BANK_LOW_ALERT_KIND], "mint-bank-low");
    clean(PUSH_TITLE["mint-bank-low"]); clean(PUSH_LEAD["mint-bank-low"]);
  });
});

describe("the launch route takes the bank's keys", () => {
  const LOSE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } } };
  const one = (extra: Record<string, unknown> = {}) => ({ creator: CREATOR, ticker: "DENVER", name: "Denver", description: "", imageUrl: null, links: [], rule: LOSE, acknowledgements: { ruleLocked: true, noReturns: true }, ...extra });
  const post = async (body: unknown, https = true) => {
    const { POST } = await import("../src/app/api/burnticker/launch/route.ts");
    return POST(new Request("http://bt.test/api/burnticker/launch", { method: "POST", headers: { host: "bt.test", origin: "http://bt.test", "content-type": "application/json", ...(https ? { "x-forwarded-proto": "https" } : {}), "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200)}` }, body: JSON.stringify(body) }));
  };
  const keyOf = (mint: string, secret: string | null) => { assert.ok(secret, "the bundle carries the secret"); const k = { publicKey: mint, secretKey: base58Decode(secret!) }; assert.equal(groundMintProblem(k, ["b"]), null, "it derives the bundle's mint"); return k; };
  test("one coin: one key, its secret in the bundle once, marked taken for the ticker; the next launch gets another; launched marks it spent", async () => {
    const w = await makeWorld(); limiter.reset();
    const bank = testMintBank({ refill: false }); for (let i = 0; i < 3; i++) bank.bank.insert(key(i));
    w.p.mintBank = bank;
    const r = await post(one());
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()).slice(0, 300));
    const j = await r.json() as { bundle: { mint: string; mintSecretKey: string | null } };
    keyOf(j.bundle.mint, j.bundle.mintSecretKey);
    assert.deepEqual(bank.bank.takenPending().map((t) => [t.pubkey, t.takenFor]), [[j.bundle.mint, "DENVER"]]);
    assert.equal(w.registry.tokenByTicker("DENVER")?.mint, j.bundle.mint);
    limiter.reset();
    const r2 = await post(one({ ticker: "BOULDER", name: "Boulder" }));
    const j2 = await r2.json() as { bundle: { mint: string } };
    assert.equal(r2.status, 200); assert.notEqual(j2.bundle.mint, j.bundle.mint, "a key is never handed out twice");
    assert.equal(bank.bank.status().ready, 1);
    limiter.reset();
    const done = await post({ action: "launched", mint: j.bundle.mint, launchTx: "5".repeat(87) });
    assert.equal(done.status, 200, JSON.stringify(await done.clone().json()).slice(0, 300));
    assert.equal(bank.bank.status().created, 1, "the launched key is spent and its secret wiped");
  });
  test("a pair takes two distinct keys; the pair curve hands both secrets back in mintSecretKeys", async () => {
    const w = await makeWorld(); limiter.reset();
    const bank = testMintBank(); w.p.mintBank = bank;
    const was = process.env.BURNTICKER_PAIR_CURVE_ENABLED;
    try {
      delete process.env.BURNTICKER_PAIR_CURVE_ENABLED;
      const r = await post(one({ pair: { ticker: "CHIEFS", name: "Chiefs" } }));
      assert.equal(r.status, 200, JSON.stringify(await r.clone().json()).slice(0, 300));
      const j = await r.json() as { bundles: { a: { mint: string; mintSecretKey: string }; b: { mint: string; mintSecretKey: string } } };
      keyOf(j.bundles.a.mint, j.bundles.a.mintSecretKey); keyOf(j.bundles.b.mint, j.bundles.b.mintSecretKey);
      assert.notEqual(j.bundles.a.mint, j.bundles.b.mint);
      assert.deepEqual(bank.bank.takenPending().map((t) => t.takenFor).sort(), ["CHIEFS", "DENVER"]);
      process.env.BURNTICKER_PAIR_CURVE_ENABLED = "1"; limiter.reset();
      const pc = await post(one({ ticker: "LIONS", name: "Lions", venue: "pair-curve", pair: { ticker: "TIGERS", name: "Tigers" } }));
      assert.equal(pc.status, 200, JSON.stringify(await pc.clone().json()).slice(0, 300));
      const k = await pc.json() as { pairCurve: { mints: { a: string; b: string } }; mintSecretKeys: { a: string; b: string } };
      keyOf(k.pairCurve.mints.a, k.mintSecretKeys.a); keyOf(k.pairCurve.mints.b, k.mintSecretKeys.b);
      assert.equal(bank.bank.takenPending().length, 4);
    } finally { if (was === undefined) delete process.env.BURNTICKER_PAIR_CURVE_ENABLED; else process.env.BURNTICKER_PAIR_CURVE_ENABLED = was; }
  });
  test("an empty bank, a pair with one key left, no bank, or plain HTTP: mint-bank-empty and nothing is taken", async () => {
    const w = await makeWorld(); limiter.reset();
    const bank = testMintBank({ refill: false }); w.p.mintBank = bank;
    for (const [body, https] of [[one(), true], [one(), false]] as const) {
      const r = await post(body, https); limiter.reset();
      assert.equal(r.status, 503);
      assert.deepEqual(await r.json(), { error: MINT_BANK_EMPTY_SENTENCE, code: MINT_BANK_EMPTY_CODE });
    }
    bank.bank.insert(key());
    let r = await post(one(), false); limiter.reset();
    assert.equal(r.status, 503, "a key never leaves over plain HTTP"); assert.equal(bank.bank.status().ready, 1);
    r = await post(one({ pair: { ticker: "CHIEFS", name: "Chiefs" } })); limiter.reset();
    assert.equal(r.status, 503, "a pair needs two"); assert.equal(bank.bank.status().ready, 1, "the one key stays ready");
    w.p.mintBank = null;
    r = await post(one()); limiter.reset();
    assert.equal((await r.json() as { code: string }).code, MINT_BANK_EMPTY);
    assert.equal(MINT_BANK_EMPTY_CODE, MINT_BANK_EMPTY, "the page and the route agree on the code");
    clean(MINT_BANK_EMPTY_SENTENCE);
    assert.equal(w.registry.tokenByTicker("DENVER"), null, "no draft");
  });
  test("a refused request takes no key; a key taken before a later refusal is deleted (never offered again)", async () => {
    const w = await makeWorld(); limiter.reset();
    const bank = testMintBank({ refill: false }); for (let i = 0; i < 2; i++) bank.bank.insert(key(i));
    w.p.mintBank = bank;
    const r = await post(one({ rule: { ...LOSE, kind: "nonsense" } }));
    assert.equal(r.status, 400);
    // audit 2026-10-15 H4: a request its checks refuse takes no key at all (before: the key was taken first, then deleted)
    assert.deepEqual({ ready: bank.bank.status().ready, taken: bank.bank.status().taken }, { ready: 2, taken: 0 }, "no key was taken");
    // a refusal after the key was taken (the upload failed) deletes that key, never returns it
    const { FakePinUploader } = await import("@/lib/burnticker/pin");
    w.p.uploader = new FakePinUploader({ fail: true });
    const r2 = await post(one({ ticker: "UPFAIL", name: "Upload fails" }));
    assert.equal(r2.status, 503);
    assert.deepEqual({ ready: bank.bank.status().ready, taken: bank.bank.status().taken }, { ready: 1, taken: 0 }, "the taken key was deleted, not returned");
  });
});

describe("the disclosure: every page that says what the site controls", () => {
  test("the owner's paragraph, lint clean, no competitor named, no 'will', no 'price'", () => {
    for (const t of [MINT_KEY_DISCLOSURE, MINT_ADDRESS_NOTE, MINT_ADDRESS_TRUST]) { clean(t); assert.doesNotMatch(t, /\bwill\b|\bprice\b|pump\.?fun|raydium|bonk|moonshot/i); }
    assert.match(MINT_KEY_DISCLOSURE, /^Every coin made here gets an address that ends in burn\. This site prepares those mint keys ahead of time, keeps them encrypted, hands each one to its creator once at launch and deletes it 24 hours later if that launch does not happen\. Until the coin is created the key only decides the address; it cannot move anything\. /);
    assert.match(MINT_KEY_DISCLOSURE, /The creator's wallet still signs the launch, and the key is never used for anything but creating that one mint\./);
    assert.match(MINT_KEY_DISCLOSURE, /Other launchpads prepare addresses the same way\.$/);
  });
  test("the launch review's 'What you confirm by launching'", () => {
    const rc = read("src/app/burnticker/launch/ReviewCard.tsx");
    assert.match(rc, /<summary className="cursor-pointer text-neutral-300">What you confirm by launching<\/summary>[\s\S]{0,900}\{!p\.mintSearch && <p[^>]*data-mint-disclosure>\{MINT_KEY_DISCLOSURE\}<\/p>\}\s*<\/details>/);   // HS-58: left out when the mint block above the button says it
  });
  test("the trust page's 'How this was built'", () => {
    assert.match(read("src/app/burnticker/trust/page.tsx"), /<h2 className="font-medium">How this was built<\/h2>[\s\S]{0,300}data-mint-suffix>\{MINT_ADDRESS_TRUST\}/);
    assert.equal(MINT_ADDRESS_TRUST, MINT_KEY_DISCLOSURE);
  });
  test("the operator page, under the operator's wallets", () => {
    assert.match(read("src/app/burnticker/operator/page.tsx"), /\{OPERATOR_COPY\.walletsIntro\}<\/p>\s*\{\/\*[^*]*\*\/\}\s*<p[^>]*data-mint-disclosure>\{MINT_KEY_DISCLOSURE\}<\/p>/);
  });
  test("the whitepaper's custody section, in the Markdown and the rendered page", () => {
    const md = read("docs/burnticker/WHITEPAPER.md");
    const sec = md.slice(md.indexOf("## 9. Governance and custody"), md.indexOf("## 10. Security review history"));
    assert.ok(sec.replace(/\s+/g, " ").includes(MINT_KEY_DISCLOSURE), "the paragraph, word for word");
    assert.ok(read("site/burnticker/whitepaper.html").replace(/\s+/g, " ").includes(MINT_KEY_DISCLOSURE.replace(/'/g, "&#39;")) || read("site/burnticker/whitepaper.html").replace(/\s+/g, " ").includes(MINT_KEY_DISCLOSURE), "rendered");
  });
  test("no page still says the address is a normal one or that its key never reaches the site", () => {
    for (const f of ["src/lib/burnticker/mintAddressCopy.ts", "src/app/burnticker/trust/page.tsx", "docs/burnkeeper/README-execution.md", "docs/burnticker/WHITEPAPER.md"])
      assert.doesNotMatch(read(f), /normal Solana address unless|chose one that ends in burn|its key never reaches this site|Use a plain address instead/, f);
  });
});

describe("the unit and the deploy wiring", () => {
  test("the unit runs the service from its entrypoint, at a lower priority, and does not retry a refusal", () => {
    const u = read("deploy/systemd/mct-burnticker-mintbank.service");
    assert.match(u, /ExecStart=\/bin\/sh %h\/meme-coin-trader\/scripts\/service\/run-burnticker-mintbank\.sh/);
    assert.match(u, /Environment=BURNTICKER_MINT_BANK_PATH=%h\/meme-coin-trader\/data\/burnticker-mintbank\.db/);
    assert.match(u, /RestartPreventExitStatus=2/); assert.match(u, /Nice=10/); assert.match(u, /UMask=0077/);
    assert.doesNotMatch(u, /BURNTICKER_MINT_BANK_KEY=/, "the key is never in the unit");
    const run = read("scripts/service/run-burnticker-mintbank.sh");
    assert.match(run, /load_env_local \./); assert.match(run, /umask 077/); assert.match(run, /scripts\/burnticker-mint-bank\.mts "\$@"/);
    assert.ok((fs.statSync("scripts/service/run-burnticker-mintbank.sh").mode & 0o111) !== 0, "executable");
  });
  test("installed, enabled and started like the keepers; published with the public tree; the bank file never is", () => {
    const inst = read("scripts/ops/install-burnticker-units.sh");
    assert.match(inst, /UNITS="[^"]*mct-burnticker-mintbank\.service/); assert.match(inst, /ENABLE="[^"]*mct-burnticker-mintbank\.service/);
    assert.match(read("config/public-repo.allowlist"), /^scripts\/service\/run-burnticker-mintbank\.sh$/m);
    assert.match(read("config/public-repo.allowlist"), /^deploy\/systemd\/mct-burnticker-\*\.service$/m);
    for (const g of [".gitignore", "config/public-repo/overlay/.gitignore"]) assert.match(read(g), /^\/data\/burnticker-mintbank\.db\*$/m, g);
    if (fs.existsSync("scripts/ops/deploy-burnticker-host.sh")) assert.match(read("scripts/ops/deploy-burnticker-host.sh"), /--exclude \/data /, "the deploy never copies data/");   // the deploy script is not in the public tree
  });
  test("the service prints no key; the docs name the env and never a value; the day check reads counts only", () => {
    const svc = read("scripts/burnticker-mint-bank.mts");
    assert.doesNotMatch(svc, /console\.(log|error)\([^)]*secretKey/); assert.doesNotMatch(svc, /log\([^)]*secretKey/);
    assert.match(svc, /refusing: \$\{MINT_BANK_NO_KEY\}/); assert.match(svc, /os\.availableParallelism\(\) - 1/);
    assert.match(svc, /--once/); assert.match(svc, /--fill/); assert.match(svc, /--status/);
    const dep = read("docs/burnticker/deploy.md");
    for (const n of ["BURNTICKER_MINT_BANK_KEY", "BURNTICKER_MINT_BANK_PATH", "BURNTICKER_MINT_BANK_SIZE", "BURNTICKER_MINT_BANK_LOW", "mct-burnticker-mintbank"]) assert.ok(dep.includes(n), n);
    assert.doesNotMatch(dep, /BURNTICKER_MINT_BANK_KEY=[A-Za-z0-9+/]{20,}/);
    if (fs.existsSync("scripts/ops/burnticker-daycheck.sh")) {
      const dc = read("scripts/ops/burnticker-daycheck.sh");
      assert.match(dc, /mct-burnticker-mintbank/); assert.match(dc, /runuser -u mct -- sqlite3 -readonly data\/burnticker-mintbank\.db/);
      assert.doesNotMatch(dc, /ciphertext/, "counts only");
    }
  });
});
