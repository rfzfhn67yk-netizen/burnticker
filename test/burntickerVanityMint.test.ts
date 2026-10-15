// MINT ADDRESSES THAT END IN burn (owner, 2026-10-14): the matcher and the residue check, a deterministic grind on a fake RNG, the
// WebCrypto seed export, the worker loop on a fake scope, the page's pool on fake workers (progress, found keys checked, skip, failure),
// the search panel's words (lint clean, a live counter), the server's prepared key checked before signing (2026-10-14 night: mandatory,
// from the host's bank; the browser search is the fallback), the local key attached to the prepared bundle (and refused when the server
// built another mint), the server taking the browser's public keys when its bank is empty (one coin, a LaunchLab pair, the pair curve), and
// the wiring by each file's source: the page, the Coin vs Coin tile and the record close, the sign card, the worker, the coin and trust
// pages, the CLIs and the execution README.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { webcrypto } from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import {
  base58, base58Decode, expectedTries, mintWorkerCount, grindMint, groundMintProblem, matchesSuffix, MintGrindPool, MINT_MISMATCH_LINE, runGrindWorker, secretBase58,
  MINT_BANK_EMPTY, MINT_FAILED_SENTENCE, MINT_SERVER_KEY_LINE, isMintBankEmpty, serverKeyFor, withMintSource, withServerKey, seedFromPkcs8, suffixResidue, tailResidue, webcryptoEd25519Works, withLocalKey,
  type FromWorker, type GroundMint, type SubtleLike, type ToWorker, type WorkerLike,
} from "@/lib/burnticker/vanityMint";
import {
  coinAddressLine, MINT_ADDRESS_NOTE, MINT_ADDRESS_TRUST, MINT_FAILED_LINE, MINT_KEY_DISCLOSURE, MINT_SEARCH_DEVICE_LINE, MINT_SEARCH_LINE, MINT_SEARCH_PAIR_LINE,
  MINT_SEARCH_PRIVATE_LINE, mintFoundLine, mintSearchProgress, mintSearchView,
} from "@/lib/burnticker/mintAddressCopy";
import { launchlabPlan, pairCurvePlan, planProblems } from "@/lib/burnticker/signPlan";
import { buildPairBundles, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { ATTESTER, CREATOR, makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";
import { limiter } from "@/lib/burnticker/api/http";
import { LaunchRequestError } from "@/lib/burnticker/pairLaunchClient";

const read = (f: string) => fs.readFileSync(f, "utf8");
const cfg = loadCopyLintConfig();
const clean = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); };

/** A seeded RNG (xorshift32): the same seed gives the same bytes. */
function seeded(seed: number) {
  let x = seed >>> 0 || 1;
  return (n: number) => { const out = new Uint8Array(n); for (let i = 0; i < n; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; out[i] = x & 0xff; } return out; };
}
/** A real key whose address ends in `suffix` (short suffixes only: quick). */
function keyEndingIn(suffix: string, seed: number): GroundMint {
  const r = grindMint({ suffix, batch: 200_000, rng: seeded(seed) });
  assert.ok(r.found, `a key ending in ${suffix}`);
  return r.found!;
}

describe("the matcher", () => {
  test("burn and BURN at the end, nothing else", () => {
    assert.equal(matchesSuffix("39fUzheUNWXi9TiBungPqxnZbE51wzaVZf149in5BURN"), true);
    assert.equal(matchesSuffix("39fUzheUNWXi9TiBungPqxnZbE51wzaVZf149in5burn"), true);
    for (const x of ["39fUzheUNWXi9TiBungPqxnZbE51wzaVZf149in5Burn", "39fUzheUNWXi9TiBungPqxnZbE51wzaVZf149in5bURN", "burn39fUzheUNWXi9TiBungPqxnZbE51wzaVZf149in5", "39fUzheUNWXi9TiBungPqxnZbE51wzaVZf149in5burnx", "", null as unknown as string])
      assert.equal(matchesSuffix(x), false, String(x));
    // the coins made before 2026-10-14 do not match, so nothing ever says their address ends in burn
    assert.equal(matchesSuffix("AJJ4"), false);
    assert.equal(coinAddressLine("So11111111111111111111111111111111111111112"), null);
    assert.equal(coinAddressLine("39fUzheUNWXi9TiBungPqxnZbE51wzaVZf149in5BURN"), "This coin's address ends in BURN. Every coin made here gets an address that ends in burn.");
  });
  test("the residue check is the last four base58 digits, for any key", () => {
    const rng = seeded(7);
    for (let i = 0; i < 300; i++) {
      const pub = rng(32), s = base58(pub);
      assert.equal(tailResidue(pub), suffixResidue(s.slice(-4)), s);
      assert.equal(tailResidue(pub, 2), suffixResidue(s.slice(-2)), s);
    }
    assert.equal(base58(new Keypair().publicKey.toBytes()).length >= 32, true);
    assert.equal(Math.round(expectedTries()), Math.round(58 ** 4 / 2), "both spellings halve the work: about 5.66 million tries");
    assert.throws(() => suffixResidue("bl0"), /base58/);
  });
});

describe("the grinder (pure, an injected RNG)", () => {
  test("deterministic: the same seed finds the same key after the same number of tries", () => {
    const a = grindMint({ suffix: "bu", batch: 20_000, rng: seeded(42) });
    const b = grindMint({ suffix: "bu", batch: 20_000, rng: seeded(42) });
    assert.ok(a.found && b.found);
    assert.equal(a.found.publicKey, b.found.publicKey);
    assert.equal(a.tries, b.tries);
    assert.ok(a.found.publicKey.endsWith("bu"));
    assert.equal(groundMintProblem(a.found, ["bu"]), null, "the key derives its address");
    assert.equal(Keypair.fromSecretKey(a.found.secretKey).publicKey.toBase58(), a.found.publicKey, "a standard Solana keypair");
    const c = grindMint({ suffix: "bu", batch: 20_000, rng: seeded(43) });
    assert.notEqual(c.found?.publicKey, a.found.publicKey);
  });
  test("burn or BURN through a fake key generator: the first matching address is returned, the tries counted", () => {
    const pubs = ["11111111111111111111111111111111", "39fUzheUNWXi9TiBungPqxnZbE51wzaVZf149in5Burn", "39fUzheUNWXi9TiBungPqxnZbE51wzaVZf149in5BURN"];
    const bytes = pubs.map((x) => new PublicKey(x).toBytes());
    let i = 0;
    const r = grindMint({ batch: 10, rng: () => new Uint8Array(32), keygen: () => ({ publicKey: bytes[i], secretKey: new Uint8Array(64).fill(i++) }) });
    assert.equal(r.tries, 3, "mixed case is skipped");
    assert.equal(r.found?.publicKey, pubs[2]);
    i = 0;
    assert.deepEqual(grindMint({ batch: 2, rng: () => new Uint8Array(32), keygen: () => ({ publicKey: bytes[i], secretKey: new Uint8Array(64).fill(i++) }) }), { found: null, tries: 2 });
  });
  test("a key is checked before it is trusted: wrong length, a secret for another address, a plain address (never accepted now)", () => {
    const k = keyEndingIn("B", 3);
    assert.equal(groundMintProblem({ ...k, secretKey: k.secretKey.slice(0, 32) }), "the key is not 64 bytes");
    const other = Keypair.generate();
    assert.equal(groundMintProblem({ publicKey: k.publicKey, secretKey: other.secretKey }), "the key does not match its address");
    let plain = Keypair.generate(); while (matchesSuffix(plain.publicKey.toBase58())) plain = Keypair.generate();
    assert.equal(groundMintProblem({ publicKey: plain.publicKey.toBase58(), secretKey: plain.secretKey, plain: true } as never), "the address does not end in burn or BURN", "there is no plain escape hatch");
  });
});

describe("WebCrypto Ed25519 (the fast engine)", () => {
  test("the PKCS#8 seed derives the same address as web3.js", async () => {
    assert.equal(await webcryptoEd25519Works(webcrypto.subtle as unknown as SubtleLike), true);
    const kp = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as unknown as CryptoKeyPair;
    const seed = seedFromPkcs8(await webcrypto.subtle.exportKey("pkcs8", kp.privateKey));
    const raw = new Uint8Array(await webcrypto.subtle.exportKey("raw", kp.publicKey));
    assert.equal(Keypair.fromSeed(seed).publicKey.toBase58(), base58(raw));
    assert.throws(() => seedFromPkcs8(new Uint8Array(48)), /PKCS#8/);
    assert.equal(await webcryptoEd25519Works(null), false);
  });
});

/** The worker loop on a fake scope: what it posts. */
function fakeScope() {
  const posted: FromWorker[] = [];
  const scope = { onmessage: null as null | ((e: { data: ToWorker }) => void), postMessage: (m: FromWorker) => { posted.push(m); } };
  return { scope, posted, send: (m: ToWorker) => scope.onmessage!({ data: m }) };
}
const until = async (f: () => boolean, ms = 20_000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 5)); } };

describe("the worker protocol", () => {
  for (const engine of ["js", "auto"] as const) {
    test(`engine ${engine}: start → engine, progress, found (a checked 64-byte secret); stop ends the loop`, async () => {
      const w = fakeScope();
      let clock = 0;
      runGrindWorker(w.scope, { subtle: webcrypto.subtle as unknown as SubtleLike, randomBytes: (n) => webcrypto.getRandomValues(new Uint8Array(n)), now: () => (clock += 50), pause: () => new Promise((r) => setTimeout(r, 0)), progressMs: 100 });
      w.send({ type: "start", suffixes: ["b"], engine });
      await until(() => w.posted.filter((m) => m.type === "found").length >= 2);
      w.send({ type: "stop" });
      const n = w.posted.length;
      await new Promise((r) => setTimeout(r, 30));
      assert.ok(w.posted.length <= n + 1, "after stop at most the closing progress line");
      const eng = w.posted.find((m) => m.type === "engine");
      assert.deepEqual(eng, { type: "engine", engine: engine === "js" ? "js" : "webcrypto" });
      const found = w.posted.filter((m): m is Extract<FromWorker, { type: "found" }> => m.type === "found");
      for (const f of found) {
        assert.equal(f.secretKey.length, 64);
        assert.ok(f.publicKey.endsWith("b"));
        assert.equal(groundMintProblem(f, ["b"]), null);
        assert.equal(Keypair.fromSecretKey(f.secretKey).publicKey.toBase58(), f.publicKey);
      }
      assert.ok(w.posted.some((m) => m.type === "progress" && m.tries > 0), "progress lines carry the count");
      const counts = w.posted.filter((m): m is Extract<FromWorker, { type: "progress" }> => m.type === "progress").map((m) => m.tries);
      assert.deepEqual(counts, [...counts].sort((a, b) => a - b), "the count only grows");
    });
  }
});

/** A fake Worker: records what the page sends; the test plays the worker's side. */
class FakeWorker implements WorkerLike {
  sent: ToWorker[] = []; terminated = false;
  onmessage: ((e: { data: FromWorker }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  postMessage(m: ToWorker) { this.sent.push(m); }
  terminate() { this.terminated = true; }
  emit(m: FromWorker) { this.onmessage?.({ data: m }); }
}

describe("the pool (the page side) on fake workers", () => {
  test("ensure(2) starts N workers, sums their counts, banks only checked keys, stops when it has two, and resolves", async () => {
    const workers: FakeWorker[] = [];
    let now = 1_000;
    const pool = new MintGrindPool({ workers: 3, now: () => now, suffixes: ["b"], makeWorker: () => { const w = new FakeWorker(); workers.push(w); return w; } });
    let ticks = 0; pool.subscribe(() => { ticks++; });
    const p = pool.ensure(2);
    assert.equal(workers.length, 3);
    for (const w of workers) assert.deepEqual(w.sent[0], { type: "start", suffixes: ["b"] });
    workers[0].emit({ type: "engine", engine: "webcrypto" });
    workers[0].emit({ type: "progress", tries: 1000 }); workers[1].emit({ type: "progress", tries: 2500 });
    now = 13_500;
    let s = pool.snapshot();
    assert.equal(s.tries, 3500); assert.equal(s.workers, 3); assert.equal(s.engine, "webcrypto"); assert.equal(s.elapsedMs, 12_500); assert.equal(s.running, true);
    const k1 = keyEndingIn("b", 11), k2 = keyEndingIn("b", 12), wrong = Keypair.generate();
    workers[2].emit({ type: "found", publicKey: k1.publicKey, secretKey: wrong.secretKey, tries: 3000 });   // a secret for another address
    assert.equal(pool.snapshot().found, 0, "a key that does not derive its address is never banked");
    workers[2].emit({ type: "found", publicKey: k1.publicKey, secretKey: k1.secretKey, tries: 3100 });
    workers[2].emit({ type: "found", publicKey: k1.publicKey, secretKey: k1.secretKey, tries: 3200 });
    assert.equal(pool.snapshot().found, 1, "the same key is banked once");
    workers[1].emit({ type: "found", publicKey: k2.publicKey, secretKey: k2.secretKey, tries: 2600 });
    const keys = await p;
    assert.deepEqual(keys.map((k) => k.publicKey), [k1.publicKey, k2.publicKey]);
    assert.ok(workers.every((w) => w.terminated && w.sent.at(-1)?.type === "stop"), "every worker told to stop and terminated");
    s = pool.snapshot();
    assert.equal(s.running, false); assert.equal(s.tries, 1000 + 2600 + 3200, "the count is kept after the stop");
    assert.deepEqual(mintSearchView(s).state, "found");
    assert.ok(ticks > 0, "listeners hear every change");
    // a key the server registered a draft for is spoken for; the other stays banked for the next press (no new search)
    pool.consume(k1.publicKey);
    const again = await pool.ensure(1);
    assert.equal(again[0].publicKey, k2.publicKey);
    assert.equal(workers.length, 3, "no new workers: the bank had one");
    pool.dispose();
  });
  test("a late message from a stopped worker is ignored", async () => {
    const workers: FakeWorker[] = [];
    const pool = new MintGrindPool({ workers: 1, suffixes: ["b"], makeWorker: () => { const w = new FakeWorker(); workers.push(w); return w; } });
    const p = pool.ensure(1);
    const k = keyEndingIn("b", 21);
    workers[0].emit({ type: "found", publicKey: k.publicKey, secretKey: k.secretKey, tries: 10 });
    await p;
    workers[0].emit({ type: "progress", tries: 99_999 });
    assert.equal(pool.snapshot().tries, 10);
  });
  test("no Worker in this browser: the waiting press is refused with a plain sentence, and the panel says why", async () => {
    const pool = new MintGrindPool({ workers: 4, makeWorker: () => { throw new Error("Worker is not defined"); } });
    const p = pool.ensure(1);
    await assert.rejects(p, new RegExp(MINT_FAILED_SENTENCE.slice(0, 40)));
    const v = mintSearchView(pool.snapshot());
    assert.equal(v.state, "failed"); assert.deepEqual(v.lines, [MINT_FAILED_LINE]);
    assert.equal(MINT_FAILED_LINE, MINT_FAILED_SENTENCE, "the panel and the refusal say the same thing");
  });
  test("a worker error stops the search and refuses the waiting press; the next press tries again", async () => {
    const workers: FakeWorker[] = [];
    const pool = new MintGrindPool({ workers: 2, suffixes: ["b"], makeWorker: () => { const w = new FakeWorker(); workers.push(w); return w; } });
    const p = pool.ensure(1);
    workers[1].emit({ type: "error", message: "boom" });
    await assert.rejects(p);
    assert.equal(pool.snapshot().failed, "boom");
    assert.equal(pool.snapshot().running, false);
    const again = pool.ensure(1);
    assert.equal(workers.length, 4, "a new search started"); assert.equal(pool.snapshot().failed, null);
    const k = keyEndingIn("b", 31);
    workers[3].emit({ type: "found", publicKey: k.publicKey, secretKey: k.secretKey, tries: 1 });
    assert.equal((await again)[0].publicKey, k.publicKey);
  });
  test("workers: every core but one, at least one, at most 16", () => {
    assert.equal(mintWorkerCount(10), 9); assert.equal(mintWorkerCount(1), 1); assert.equal(mintWorkerCount(undefined), 3); assert.equal(mintWorkerCount(64), 16);
  });
});

describe("the search panel's words (owner: people must see it is working, not frozen)", () => {
  const base = { tries: 0, elapsedMs: 0, workers: 9, engine: "webcrypto" as const, wanted: 1, found: 0, running: true, addresses: [], failed: null };
  test("every line is plain English and passes the copy lint", () => {
    for (const t of [MINT_SEARCH_LINE, MINT_SEARCH_PAIR_LINE, MINT_SEARCH_DEVICE_LINE, MINT_SEARCH_PRIVATE_LINE, MINT_FAILED_LINE, MINT_ADDRESS_NOTE, MINT_ADDRESS_TRUST, MINT_KEY_DISCLOSURE, MINT_MISMATCH_LINE, MINT_SERVER_KEY_LINE,
      mintSearchProgress({ tries: 1_234_567, elapsedMs: 12_300, workers: 9 }), mintSearchProgress({ tries: 1, elapsedMs: 1_000, workers: 1 }),
      mintFoundLine(["39fUzheUNWXi9TiBungPqxnZbE51wzaVZf149in5BURN"]), mintFoundLine(["39fUzheUNWXi9TiBungPqxnZbE51wzaVZf149in5BURN", "39fUzheUNWXi9TiBungPqxnZbE51wzaVZf149in5burn"]),
      coinAddressLine("39fUzheUNWXi9TiBungPqxnZbE51wzaVZf149in5burn")!]) clean(t);
    assert.match(MINT_SEARCH_LINE, /^No prepared address was ready, so this browser is finding one that ends in burn\./, "the search says why it runs");
    assert.equal(MINT_ADDRESS_NOTE, "Every coin made here gets an address that ends in burn. The address is prepared ahead of time on this site, handed to the creator at launch and used once. If none is ready, the creator's browser finds one.", "mandatory again, prepared ahead of time (owner, 2026-10-14 night)");
    assert.equal(MINT_ADDRESS_TRUST, MINT_KEY_DISCLOSURE, "the trust page carries the disclosure");
    for (const t of [MINT_ADDRESS_NOTE, MINT_ADDRESS_TRUST, MINT_SEARCH_LINE, MINT_FAILED_LINE]) { assert.doesNotMatch(t, /plain address|normal Solana address|unless its creator chose|never reaches this site/); }
  });
  test("the counter: keys tried, seconds, searches at once; the device estimate", () => {
    const v = mintSearchView({ ...base, tries: 2_117_632, elapsedMs: 10_400 });
    assert.equal(v.state, "searching");
    assert.equal(v.progress, "Tried 2,117,632 addresses in 10 seconds, using 9 searches at once.");
    assert.deepEqual(v.lines, [MINT_SEARCH_LINE, MINT_SEARCH_DEVICE_LINE]);
    assert.match(MINT_SEARCH_DEVICE_LINE, /laptop/); assert.match(MINT_SEARCH_DEVICE_LINE, /phone/);
    const pair = mintSearchView({ ...base, wanted: 2, found: 1, addresses: ["x"], tries: 5 });
    assert.deepEqual(pair.lines, [MINT_SEARCH_PAIR_LINE, MINT_SEARCH_DEVICE_LINE, "1 of 2 found."]);
  });
  test("no skip button any more: the burn ending is mandatory; idle shows nothing, found shows the address", () => {
    assert.equal("showSkip" in mintSearchView({ ...base, elapsedMs: 0 }), false);
    assert.equal(mintSearchView({ ...base, elapsedMs: 0, running: false }).state, "idle");
    const found = mintSearchView({ ...base, running: false, found: 1, addresses: ["39fUzheUNWXi9TiBungPqxnZbE51wzaVZf149in5BURN"] });
    assert.equal(found.state, "found");
    assert.deepEqual(found.lines, ["Found an address that ends in burn: 39fUzheUNWXi9TiBungPqxnZbE51wzaVZf149in5BURN."]);
  });
  test("the panel's source: redraws four times a second, a CSS spinner and a ticking line, the count and the workers, no skip and no switch", () => {
    const src = read("src/app/burnticker/launch/MintSearch.tsx");
    assert.match(src, /setInterval\([\s\S]*?, 250\)/);
    assert.match(src, /animate-spin/); assert.doesNotMatch(src, /\.gif/i);
    assert.match(src, /data-mint-ticker/); assert.match(src, /data-mint-tries=\{s\.tries\}/); assert.match(src, /data-mint-workers=\{s\.workers\}/);
    assert.doesNotMatch(src, /data-mint-skip|pool\.skip|MINT_SKIP|checkbox|localStorage|useBurnChoice|MintChoice/);
    assert.match(src, /export function MintAddressBlock\(\{ pool \}[^)]*\) \{[\s\S]*<MintSearch pool=\{pool\} \/>[\s\S]*data-mint-note>\{MINT_ADDRESS_NOTE\}/);
    assert.match(src, /new Worker\(new URL\("\.\/vanity\.worker\.ts", import\.meta\.url\), \{ type: "module" \}\)/);
    assert.match(src, /if \(s\.users === 0\) \{ s\.pool\.dispose\(\);/, "the workers stop when the last user goes away");
  });
});

describe("the prepared bundle must name the mint this page made", () => {
  test("the local secret is attached and the plan checks; another mint is refused before any signature", () => {
    const k = keyEndingIn("bu", 5);
    const bundle = { mint: k.publicKey, ticker: "AAA", ready: true, pending: [], mintSecretKey: null, transactions: [{ label: "create", signers: ["creator", "mint"], instructions: [] }] };
    assert.ok(planProblems(launchlabPlan([bundle]), CREATOR).length > 0, "without the key the plan cannot sign");
    const withKey = withLocalKey(bundle, k);
    assert.equal(withKey.mintSecretKey, secretBase58(k));
    assert.deepEqual(planProblems(launchlabPlan([withKey]), CREATOR), []);
    assert.throws(() => withLocalKey({ ...bundle, mint: Keypair.generate().publicKey.toBase58() }, k), new RegExp(MINT_MISMATCH_LINE.slice(0, 40)));
    // the pair curve: the page's own two keys against the set's two mints
    const kB = keyEndingIn("bu", 6);
    const pc = { mints: { a: k.publicKey, b: kB.publicKey }, ready: true, pending: [], transactions: [{ label: "a", signers: ["creator", "mintA"], instructions: [] }, { label: "b", signers: ["creator", "mintB"], instructions: [] }] };
    assert.deepEqual(planProblems(pairCurvePlan(pc as never, { a: secretBase58(k), b: secretBase58(kB) }), CREATOR), []);
    assert.ok(planProblems(pairCurvePlan(pc as never, { a: secretBase58(kB), b: secretBase58(k) }), CREATOR).some((x) => /does not match/.test(x)), "swapped keys are caught by the plan");
  });
});

/** Real public keys that end in burn (ground on the Mac on 2026-10-14; their secrets were deleted): the fallback sends only public keys. */
const BURN_PUBS = ["DReoHj97MwYHh5vCrsDoUK5wfTyJyhby21WRvjPkburn", "4UvEV42RgcgvSwbs3ZbTv7hPqLPYX8nRZ9Smeuhhburn", "82CXNdMkgDKydXNfs2ZVnj338xvsjv45hJ9x2HrWburn"];

describe("the fallback: the server takes the browser's burn-ending public keys and never makes or sees their secrets", () => {
  const deps = () => ({ program: new FakeBurnProgram("devnet"), launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m: string) => `https://x/${m}.json` });
  const LOSE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } } };
  const input = { creator: CREATOR, ticker: "DENVER", name: "Denver", description: "", imageUrl: null, links: [], rule: LOSE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" } as never;
  test("buildPairBundles with both mints: those mints, no secret, A names B and B names A", async () => {
    const a = Keypair.generate().publicKey.toBase58(), b = Keypair.generate().publicKey.toBase58();
    const built = await buildPairBundles({ a: input, b: { ticker: "CHIEFS", name: "Chiefs", description: "", imageUrl: null, links: [] }, voidBy: "2027-01-15" }, { ...deps(), mint: a, mintB: b });
    assert.equal(built.a.mint, a); assert.equal(built.b.mint, b);
    assert.equal(built.a.mintSecretKey, null); assert.equal(built.b.mintSecretKey, null);
    assert.equal(JSON.parse(built.b.rules.text).pair.counterpartMint, a, "B's rule names A's mint");
    await assert.rejects(buildPairBundles({ a: input, b: { ticker: "CHIEFS", name: "Chiefs", description: "", imageUrl: null, links: [] }, voidBy: "2027-01-15" }, { ...deps(), mintB: b }), /side A's too/);
    await assert.rejects(buildPairBundles({ a: input, b: { ticker: "CHIEFS", name: "Chiefs", description: "", imageUrl: null, links: [] }, voidBy: "2027-01-15" }, { ...deps(), mint: a, mintB: a }), /two different mints/);
  });
  const legacy = async (body: unknown) => {
    const { POST } = await import("../src/app/api/burnticker/launch/route.ts");
    return POST(new Request("http://bt.test/api/burnticker/launch", { method: "POST", headers: { host: "bt.test", origin: "http://bt.test", "content-type": "application/json", "x-forwarded-proto": "https", "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200)}` }, body: JSON.stringify(body) }));
  };
  const pairBody = (extra: Record<string, unknown> = {}) => ({ creator: CREATOR, ticker: "DENVER", name: "Denver", description: "", imageUrl: null, links: [], rule: LOSE, acknowledgements: { ruleLocked: true, noReturns: true }, pair: { ticker: "CHIEFS", name: "Chiefs" }, ...extra });
  test("one coin: the route builds for the page's mint and hands back no secret", async () => {
    const w = await makeWorld(); limiter.reset();
    const mint = BURN_PUBS[0];
    const r = await legacy({ creator: CREATOR, ticker: "DENVER", name: "Denver", description: "", imageUrl: null, links: [], rule: LOSE, acknowledgements: { ruleLocked: true, noReturns: true }, mint });
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()).slice(0, 300));
    const j = await r.json() as { bundle: { mint: string; mintSecretKey: string | null } };
    assert.equal(j.bundle.mint, mint); assert.equal(j.bundle.mintSecretKey, null);
    assert.equal(w.registry.tokenByTicker("DENVER")?.mint, mint, "the draft is the page's mint");
  });
  test("a LaunchLab pair: both drafts on the page's two mints, no secrets in the answer", async () => {
    const w = await makeWorld(); limiter.reset();
    const was = process.env.BURNTICKER_PAIR_CURVE_ENABLED; delete process.env.BURNTICKER_PAIR_CURVE_ENABLED;
    try {
      const [a, b] = BURN_PUBS;
      const r = await legacy(pairBody({ mint: a, pair: { ticker: "CHIEFS", name: "Chiefs", mint: b } }));
      assert.equal(r.status, 200, JSON.stringify(await r.clone().json()).slice(0, 300));
      const j = await r.json() as { bundles: { a: { mint: string; mintSecretKey: string | null }; b: { mint: string; mintSecretKey: string | null } } };
      assert.deepEqual([j.bundles.a.mint, j.bundles.b.mint], [a, b]);
      assert.deepEqual([j.bundles.a.mintSecretKey, j.bundles.b.mintSecretKey], [null, null]);
      assert.deepEqual([w.registry.tokenByTicker("DENVER")?.mint, w.registry.tokenByTicker("CHIEFS")?.mint], [a, b]);
      // one mint without the other is the public API's single-coin call: refused for a pair, as before
      limiter.reset();
      const half = await legacy(pairBody({ ticker: "ORCAS", mint: BURN_PUBS[2], pair: { ticker: "WHALES", name: "Chiefs" } }));
      assert.equal(half.status, 400, JSON.stringify(await half.clone().json()));
      limiter.reset();
      const same = BURN_PUBS[2];
      assert.equal((await legacy(pairBody({ ticker: "LIONS", mint: same, pair: { ticker: "TIGERS", name: "Chiefs", mint: same } }))).status, 400, "one mint for both coins is refused");
      // a plain address is refused: every coin's address ends in burn (owner, 2026-10-14 night)
      limiter.reset();
      const plain = await legacy(pairBody({ ticker: "BEARS", mint: BURN_PUBS[0], pair: { ticker: "WOLVES", name: "Chiefs", mint: "So11111111111111111111111111111111111111112" } }));
      assert.equal(plain.status, 400); assert.equal((await plain.json() as { code: string }).code, "mint-not-burn");
    } finally { if (was !== undefined) process.env.BURNTICKER_PAIR_CURVE_ENABLED = was; }
  });
  test("the pair curve: its two mints are the page's, and mintSecretKeys carries nothing", async () => {
    await makeWorld(); limiter.reset();
    const was = process.env.BURNTICKER_PAIR_CURVE_ENABLED; process.env.BURNTICKER_PAIR_CURVE_ENABLED = "1";
    try {
      const [a, b] = BURN_PUBS;
      const r = await legacy(pairBody({ venue: "pair-curve", mint: a, pair: { ticker: "CHIEFS", name: "Chiefs", mint: b } }));
      assert.equal(r.status, 200, JSON.stringify(await r.clone().json()).slice(0, 300));
      const j = await r.json() as { pairCurve: { mints: { a: string; b: string } }; mintSecretKeys: { a: string | null; b: string | null } };
      assert.deepEqual(j.pairCurve.mints, { a, b });
      assert.deepEqual(j.mintSecretKeys, { a: null, b: null });
    } finally { if (was === undefined) delete process.env.BURNTICKER_PAIR_CURVE_ENABLED; else process.env.BURNTICKER_PAIR_CURVE_ENABLED = was; }
  });
});

describe("the wiring, by each file's source", () => {
  test("the launch page: no mint sent, the server's key checked; the search only on mint-bank-empty, its public keys sent, its secrets attached", () => {
    const src = read("src/app/burnticker/launch/page.tsx");
    assert.match(src, /const mintPool = useMintPool\(\)/);
    assert.match(src, /const mintsNeeded = pairOn \? 2 : 1/);
    assert.doesNotMatch(src, /useBurnChoice|launchMints|MintChoice|plainMint|mintPool\.ensure\(/, "no switch, no plain keys, no search started by the page itself");
    assert.match(src, /prepareIfCurrent\(sentRev, \(\) => curRev\.current, \(\) => withMintSource\(\{ pool: mintPool, n: mintsNeeded, stale: \(\) => curRev\.current !== sentRev, staleLine: STALE_PREPARE_SENTENCE \}, async \(keys: GroundMint\[\] \| null\)/, "the server's keys first; an edit while searching sends nothing");
    assert.match(src, /const keyed = \(bundle: Bundle, k: GroundMint \| undefined\) => \(k \? withLocalKey\(bundle, k\) : withServerKey\(bundle\)\)/);
    assert.match(src, /const sentMint = \(k: GroundMint \| undefined\) => \(k \? \{ mint: k\.publicKey \} : \{\}\)/);
    assert.equal((src.match(/\.\.\.sentMint\(kA\)/g) ?? []).length, 2, "the one coin and side A (and the matchup's first coin)");
    assert.equal((src.match(/\.\.\.sentMint\(kB\)/g) ?? []).length, 2, "side B, and the matchup's second coin");
    assert.equal((src.match(/keyed\(/g) ?? []).length, 5, "the five bundles: the matchup's two, the pair's two, the one coin");
    assert.match(src, /if \(kA && kB && \(j\.pairCurve\.mints\.a !== kA\.publicKey \|\| j\.pairCurve\.mints\.b !== kB\.publicKey\)\) throw new Error\(MINT_MISMATCH_LINE\)/);
    assert.match(src, /serverKeyFor\(j\.pairCurve\.mints\.a, j\.mintSecretKeys\?\.a\)/); assert.match(src, /serverKeyFor\(j\.pairCurve\.mints\.b, j\.mintSecretKeys\?\.b\)/);
    assert.match(src, /mintSearch=\{<MintAddressBlock pool=\{mintPool\} \/>\}/);
    assert.doesNotMatch(src, /secretKey[^\n]*(localStorage|sessionStorage|DRAFT_STORE)/, "the keys are never saved with the draft");
  });
  test("the Coin vs Coin tile and the record close: the same flow, the server's keys checked, the search only as the fallback", () => {
    const src = read("src/app/burnticker/launch/CoinVsCoinTile.tsx");
    assert.match(src, /withMintSource\(\{ pool: mintPool, n: 2, /); assert.match(src, /withMintSource\(\{ pool: mintPool, n: 1, /);
    assert.doesNotMatch(src, /useBurnChoice|launchMints|MintChoice|mintPool\.ensure\(/);
    assert.match(src, /kA && kB \? \{ \.\.\.body, mint: kA\.publicKey, pair: \{ \.\.\.body\.pair, mint: kB\.publicKey \} \} : body/);
    assert.match(src, /JSON\.stringify\(\{ \.\.\.body, \.\.\.\(kA \? \{ mint: kA\.publicKey \} : \{\}\) \}\)/);
    assert.match(src, /a: kA \? withLocalKey\(A, kA\) : withServerKey\(A\), b: kB \? withLocalKey\(B, kB\) : withServerKey\(B\)/);
    assert.match(src, /got\.ok\.kA \? withLocalKey\(got\.ok\.bundle, got\.ok\.kA\) : withServerKey\(got\.ok\.bundle\)/);
    assert.match(src, /serverKeyFor\(j\.pairCurve\.mints\.a, j\.mintSecretKeys\?\.a\)/);
    assert.equal((src.match(/mintSearch=\{<MintAddressBlock pool=\{mintPool\} \/>\}/g) ?? []).length, 2);
    assert.equal((src.match(/const mintPool = useMintPool\(\);/g) ?? []).length, 2, "the record close and the tile share the tab's one pool");
  });
  test("the review card shows the panel above Launch; the sign card shows each address before signing", () => {
    const rc = read("src/app/burnticker/launch/ReviewCard.tsx");
    assert.match(rc, /\{p\.mintSearch\}\n\s*<div className="space-y-1 pt-1">/);
    const sc = read("src/app/burnticker/launch/SignCard.tsx");
    assert.match(sc, /data-mint-addresses>\{plan\.confirms\.map\(\(c\) => <li key=\{c\.mint\}[^>]*data-mint-address=\{c\.mint\}>\$\{c\.ticker\}&apos;s address is <code[^>]*>\{c\.mint\}<\/code>/);
    assert.match(sc, /plan\.confirms\.every\(\(c\) => matchesSuffix\(c\.mint\)\) && <p[^>]*data-mint-note>\{MINT_ADDRESS_NOTE\}/);
  });
  test("the worker: the grind loop only, no request of any kind", () => {
    const src = read("src/app/burnticker/launch/vanity.worker.ts");
    assert.match(src, /runGrindWorker\(scope,/);
    assert.doesNotMatch(src, /fetch|XMLHttpRequest|WebSocket|sendBeacon|importScripts/);
    assert.doesNotMatch(read("src/lib/burnticker/vanityMint.ts"), /fetch\(|XMLHttpRequest|WebSocket|sendBeacon/);
  });
  test("the route: bank keys when no mint is sent, the two public keys otherwise; the coin page and the trust page say it", () => {
    const rt = read("src/app/api/burnticker/launch/route.ts");
    assert.match(rt, /prepareLaunch\(p, body, \{ register: true, \.\.\.\(own !== undefined \? \{ mint: own \} : \{\}\), \.\.\.\(ownB !== undefined \? \{ mintB: ownB \} : \{\}\), \.\.\.\(taken \? \{ mintKeypair: taken\[0\], \.\.\.\(taken\[1\] \? \{ mintKeypairB: taken\[1\] \} : \{\}\) \} : \{\}\) \}\)/);
    const coin = read("src/app/burnticker/t/[ticker]/page.tsx");
    assert.match(coin, /\{coinAddressLine\(s\.mint\) && <span[^>]*data-mint-suffix>\{coinAddressLine\(s\.mint\)\}<\/span>\}/);
    assert.match(read("src/app/burnticker/trust/page.tsx"), /<h2 className="font-medium">How this was built<\/h2>[\s\S]{0,300}data-mint-suffix>\{MINT_ADDRESS_TRUST\}/);
  });
  test("the CLIs and the README: operator launches end in burn too", () => {
    const launch = read("scripts/burnkeeper-launch.mts");
    assert.match(launch, /scripts\/burnticker-grind-mint\.mts/);
    assert.match(launch, /if \(SEND && !flag\("allow-plain-mint"\)\) problems\.push/);
    const admin = read("scripts/burnreceipts-admin.mts");
    assert.match(admin, /if \(opt\("mint-keypair"\) && !opt\("mint"\)\) args\.push\("--mint", opt\("mint-keypair"\)!\)/);
    assert.match(admin, /does not end in burn or BURN/);
    const grind = read("scripts/burnticker-grind-mint.mts");
    assert.match(grind, /mode: 0o600, flag: "wx"/); assert.match(grind, /console\.log\(key\.publicKey\)/);
    assert.doesNotMatch(grind, /console\.(log|error)\([^)]*secretKey/, "the key is never printed");
    const readme = read("docs/burnkeeper/README-execution.md");
    assert.match(readme, /## Mint addresses that end in burn \(owner decision 2026-10-14\)/);
    assert.match(readme, /solana-keygen grind --ends-with burn:1 --ends-with BURN:1/);
  });
});

describe("mandatory again (owner, 2026-10-14 night): the server's key first, the browser search only on mint-bank-empty", () => {
  const bankEmpty = () => new LaunchRequestError(503, MINT_BANK_EMPTY, "none ready");
  test("the server answered with its key: run(null) once, no search", async () => {
    let ensures = 0, calls: unknown[] = [];
    const pool = { ensure: async () => { ensures++; return []; } };
    const out = await withMintSource({ pool, n: 2 }, async (keys) => { calls.push(keys); return "ok"; });
    assert.equal(out, "ok"); assert.deepEqual(calls, [null]); assert.equal(ensures, 0);
  });
  test("mint-bank-empty: the search runs for n keys and the press goes on with them", async () => {
    const k1 = keyEndingIn("b", 51), k2 = keyEndingIn("b", 52);
    const asked: number[] = [], calls: (GroundMint[] | null)[] = [];
    const pool = { ensure: async (n: number) => { asked.push(n); return [k1, k2].slice(0, n); } };
    const out = await withMintSource({ pool, n: 2 }, async (keys) => { calls.push(keys); if (!keys) throw bankEmpty(); return keys.map((k) => k.publicKey); });
    assert.deepEqual(out, [k1.publicKey, k2.publicKey]); assert.deepEqual(asked, [2]); assert.equal(calls.length, 2);
    assert.equal(isMintBankEmpty(bankEmpty()), true); assert.equal(isMintBankEmpty(new Error("x")), false);
  });
  test("any other refusal is not a reason to search; an edit while searching sends nothing more", async () => {
    let ensures = 0;
    const pool = { ensure: async () => { ensures++; return [keyEndingIn("b", 53)]; } };
    await assert.rejects(withMintSource({ pool, n: 1 }, async () => { throw new LaunchRequestError(409, "mint-taken", "taken"); }), /taken/);
    assert.equal(ensures, 0);
    let second = false;
    await assert.rejects(withMintSource({ pool, n: 1, stale: () => true, staleLine: "changed" }, async (keys) => { if (!keys) throw bankEmpty(); second = true; return 1; }), /changed/);
    assert.equal(second, false);
    await assert.rejects(withMintSource({ pool: null, n: 1 }, async () => { throw bankEmpty(); }), /has not started yet/);
  });
  test("the server's key is checked before signing: it must derive the bundle's mint and end in burn", () => {
    const kp = Keypair.generate();
    // a sound key that does not end in burn is refused (the check uses the real suffixes)
    if (!matchesSuffix(kp.publicKey.toBase58())) assert.throws(() => withServerKey({ mint: kp.publicKey.toBase58(), mintSecretKey: base58(kp.secretKey) }), new RegExp(MINT_SERVER_KEY_LINE.slice(0, 30)));
    assert.throws(() => withServerKey({ mint: BURN_PUBS[0], mintSecretKey: null }), new RegExp(MINT_SERVER_KEY_LINE.slice(0, 30)));
    assert.throws(() => withServerKey({ mint: BURN_PUBS[0], mintSecretKey: base58(kp.secretKey) }), new RegExp(MINT_SERVER_KEY_LINE.slice(0, 30)), "a secret for another address");
    assert.throws(() => serverKeyFor(BURN_PUBS[0], "0OIl"), new RegExp(MINT_SERVER_KEY_LINE.slice(0, 30)), "not base58");
    // base58 round trip of a real 64-byte secret, leading zero bytes included
    for (const bytes of [kp.secretKey, new Uint8Array([0, 0, 7, ...kp.secretKey.slice(3)])]) assert.deepEqual(base58Decode(base58(bytes)), bytes);
  });
  test("the pool has no skip, no opt-out and no plain keys; the suffix rule lives in mintSuffix.ts only", () => {
    const pool = new MintGrindPool({ workers: 1, makeWorker: () => new FakeWorker() }) as unknown as Record<string, unknown>;
    assert.equal(typeof pool.skip, "undefined"); assert.equal(typeof pool.optOut, "undefined");
    assert.doesNotMatch(read("src/lib/burnticker/vanityMint.ts"), /plainMint|readBurnChoice|launchMints|MINT_BURN_CHOICE_KEY/);
    assert.doesNotMatch(read("src/lib/burnticker/mintSuffix.ts"), /MINT_BURN_CHOICE_KEY/);
  });
  test("the handlers and the bundle builder need no suffix (the route and the bank enforce it); the route refuses a plain mint", () => {
    assert.doesNotMatch(read("src/lib/burnticker/api/handlers.ts"), /matchesSuffix|MINT_SUFFIX/);
    assert.doesNotMatch(read("src/lib/burnticker/launchBundle.ts"), /matchesSuffix|MINT_SUFFIX/);
    const rt = read("src/app/api/burnticker/launch/route.ts");
    assert.match(rt, /if \(\(own !== undefined && !matchesSuffix\(own\)\) \|\| \(ownB !== undefined && !matchesSuffix\(ownB\)\)\) return NextResponse\.json\(\{[^}]*code: "mint-not-burn" \}, \{ status: 400 \}\)/);
  });
});
