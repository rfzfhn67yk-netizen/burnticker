// PRELAUNCH AUDIT 2026-10-18 A-3: nine anonymous connections could spend the host's whole daily upload allowance (50 pins) with made-up
// creators, and every real creator was then refused until midnight UTC. A prepare now carries the creator wallet's signature over the
// request (walletProof.ts: wallet, tickers, mints, nonce, time; checked before the budget, the bank key or any upload). Unsigned requests
// share the daily limit less a reserve kept for signed ones, a signature that does not check out is refused, and the owner's phone hears
// once a day when half of the uploads are used (bt-pin-budget).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";
import { DEFAULT_PIN_CREATOR_DAILY_CAP, DEFAULT_PIN_DAILY_CAP, DEFAULT_PIN_SIGNED_RESERVE, UNSIGNED_UPLOADS_SENTENCE, WALLET_BALANCE_CACHE_MAX, WALLET_BALANCE_CACHE_MS, WALLET_PROOF_REFUSED, cachedBalanceWallets, pinBudgetAlertText, prepareLaunch, resetWalletBalances, unfundedUploadsSentence, walletCovers } from "@/lib/burnticker/api/handlers";
import { launchLabCostLamports } from "@/lib/burnticker/launchCost";
import { PROOF_MAX_AGE_MS, signLaunchRequest, walletProofMessage, type WalletProof } from "@/lib/burnticker/walletProof";
import { checkWalletProof } from "@/lib/burnticker/walletProofCheck";
import { base58 } from "@/lib/burnticker/vanityMint";
import { launchErrorMessage } from "@/lib/burnticker/pairLaunchClient";
import { PUSH_KIND_OF_ALERT, PUSH_LEAD, PUSH_TITLE } from "@/lib/burnticker/push";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";

const RULE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
const body = (ticker: string, creator: string) => ({ creator, ticker, name: `${ticker} coin`, rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } });
const mintPk = () => Keypair.generate().publicKey.toBase58();
const AZ = "ABCDEFGHJKLMNPQRSTUVWXYZ";
let seq = 0;
/** far-apart tickers, so the lookalike refusal never fires */
const rnd = () => { seq++; return Array.from({ length: 8 }, () => AZ[Math.floor(Math.random() * AZ.length)]).join(""); };
// deno-lint-ignore no-explicit-any
type Any = any;
const code = (r: Any) => ("error" in r ? r.error.body.code : "ok");
const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); };

/** A wallet's signMessage (ed25519 over the bytes), as Phantom answers it. */
const signerOf = (k: Keypair) => async (m: Uint8Array): Promise<Uint8Array> => {
  const key = crypto.createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: Buffer.from(k.secretKey.slice(0, 32)).toString("base64url"), x: Buffer.from(k.publicKey.toBytes()).toString("base64url") }, format: "jwk" });
  return new Uint8Array(crypto.sign(null, Buffer.from(m), key));
};
const proofFor = async (k: Keypair, tickers: string[], mints: string[] = [], now = Date.now()): Promise<WalletProof> => (await signLaunchRequest(signerOf(k), { creator: k.publicKey.toBase58(), tickers, mints }, base58, now))!;

describe("A-3: the daily uploads behind a wallet's signature", () => {
  test("WANT F-20 residual: nine anonymous connections cannot close launches; a signed creator is served when unsigned demand is at its cap", async () => {
    const w = await makeWorld();
    let spent = 0;
    for (let c = 0; c < 9; c++) for (let k = 0; k < DEFAULT_PIN_CREATOR_DAILY_CAP; k++) { const r = await prepareLaunch(w.p, body(rnd(), Keypair.generate().publicKey.toBase58()), { register: true, mint: mintPk(), client: `attacker-${c}` }); if (code(r) === "ok") spent++; }
    assert.equal(spent, DEFAULT_PIN_DAILY_CAP - DEFAULT_PIN_SIGNED_RESERVE, "unsigned requests stop short of the reserve");
    // an unsigned stranger is now refused with the real reason
    const anon = await prepareLaunch(w.p, body(rnd(), Keypair.generate().publicKey.toBase58()), { register: true, mint: mintPk(), client: "anon-late" });
    assert.equal(code(anon), "upload-budget-unsigned");
    assert.equal((anon as Any).error.body.error, UNSIGNED_UPLOADS_SENTENCE);
    assert.equal(launchErrorMessage(429, (anon as Any).error.body), UNSIGNED_UPLOADS_SENTENCE, "the page shows the server's sentence, not 'too many requests'");
    // a real creator who signed is served from the reserve
    const k = Keypair.generate(), mint = mintPk(), t = rnd();
    const legit = await prepareLaunch(w.p, { ...body(t, k.publicKey.toBase58()), walletProof: await proofFor(k, [t], [mint]) }, { register: true, mint, client: "real-creator" });
    assert.equal(code(legit), "ok", JSON.stringify((legit as Any).error?.body));
  });

  test("a signature that does not check out is refused before the budget and the bank key; nothing is charged", async () => {
    const w = await makeWorld();
    const k = Keypair.generate(), other = Keypair.generate(), t = rnd();
    let took = 0;
    const takeMintKeys = (tickers: string[]) => { took++; return { keys: tickers.map(() => Keypair.generate()) }; };
    const cases: [string, WalletProof][] = [
      ["another wallet's signature", await proofFor(other, [t])],
      ["another ticker", await proofFor(k, ["ZZZZZZZZ"])],
      ["too old", await proofFor(k, [t], [], Date.now() - PROOF_MAX_AGE_MS - 60_000)],
      ["names a mint the request does not use", await proofFor(k, [t], [mintPk()])],
    ];
    for (const [what, walletProof] of cases) {
      const r = await prepareLaunch(w.p, { ...body(t, k.publicKey.toBase58()), walletProof }, { register: true, takeMintKeys, client: "c" });
      assert.equal(code(r), "wallet-proof-invalid", what);
      assert.equal((r as Any).error.status, 401, what);
      assert.ok(String((r as Any).error.body.error).startsWith(WALLET_PROOF_REFUSED), what);
    }
    assert.equal(took, 0, "no bank key was taken");
    assert.equal(w.registry.getStatus(`pin.budget.${new Date().toISOString().slice(0, 10)}`), null, "no upload was counted");
    // the same request, signed by its own wallet over the site's prepared keys, goes through
    const ok = await prepareLaunch(w.p, { ...body(t, k.publicKey.toBase58()), walletProof: await proofFor(k, [t]) }, { register: true, takeMintKeys, client: "c" });
    assert.equal(code(ok), "ok", JSON.stringify((ok as Any).error?.body)); assert.equal(took, 1);
    clean(WALLET_PROOF_REFUSED); clean(UNSIGNED_UPLOADS_SENTENCE);
  });

  test("half of the day's uploads raises one bt-pin-budget alert, mapped to a phone push", async () => {
    const w = await makeWorld();
    w.p.pinDailyCap = 4;
    for (let i = 0; i < 3; i++) assert.equal(code(await prepareLaunch(w.p, body(rnd(), Keypair.generate().publicKey.toBase58()), { register: true, mint: mintPk() })), "ok");
    const rows = w.registry.alertsSince(0).filter((a) => a.kind === "bt-pin-budget");
    assert.equal(rows.length, 1);
    assert.equal(PUSH_KIND_OF_ALERT["bt-pin-budget"], "pin-budget");
    for (const s of [PUSH_TITLE["pin-budget"], PUSH_LEAD["pin-budget"], pinBudgetAlertText(25, 50, 10), rows[0].text]) clean(s);
  });

  test("the signed text: one field per line, checked field by field", async () => {
    const k = Keypair.generate(), m = mintPk();
    const msg = walletProofMessage({ origin: "https://burnticker.com", creator: k.publicKey.toBase58(), tickers: ["abc", "DEF"], mints: [m], nonce: "a".repeat(32), issuedAt: "2026-10-18T12:00:00.000Z" });
    assert.match(msg, /^Burnticker launch request\nSite: burnticker\.com\nOrigin: https:\/\/burnticker\.com\nWallet: \w+\nTickers: \$ABC \$DEF\nMints: \w+\nNonce: a{32}\nIssued: 2026-10-18T12:00:00\.000Z\n/);
    clean(msg.split("\n").at(-1)!);
    const p = await proofFor(k, ["ABC", "DEF"], [m]);
    assert.deepEqual(checkWalletProof(p, { creator: k.publicKey.toBase58(), tickers: ["DEF"], mints: [m] }), { ok: true }, "one coin of a press signed for two");
    assert.equal(checkWalletProof({ ...p, message: p.message.replace("$ABC", "$ABD") }, { creator: k.publicKey.toBase58(), tickers: ["ABD"], mints: [m] }).ok, false, "an edited text fails the signature");
    assert.equal(checkWalletProof("nope", { creator: k.publicKey.toBase58(), tickers: ["ABC"], mints: [] }).ok, false);
    assert.equal(await signLaunchRequest(undefined, { creator: "x", tickers: ["A"], mints: [] }, base58), null, "a wallet that cannot sign messages: the press goes on unsigned");
    assert.equal(await signLaunchRequest(async () => { throw new Error("declined"); }, { creator: "x", tickers: ["A"], mints: [] }, base58), null);
  });

  test("the launch page and the Coin vs Coin tile send the signature with every prepare", async () => {
    const fs = await import("node:fs");
    assert.match(fs.readFileSync("src/app/burnticker/launch/page.tsx", "utf8"), /const walletProof = await signLaunchRequest\(wallet\.signMessage,/);
    assert.equal((fs.readFileSync("src/app/burnticker/launch/CoinVsCoinTile.tsx", "utf8").match(/await signLaunchRequest\(wallet\.signMessage,/g) ?? []).length, 2);
  });
});

describe("A-3 follow-up: the reserve needs a wallet that already holds the launch's cost", () => {
  const COST = launchLabCostLamports(RULE.reserveSol ?? "0.02");
  /** a chain whose wallets hold what `funds` says (unknown wallets hold nothing); every read is counted */
  const chainWith = (funds: Map<string, number>, reads: { n: number }) => ({ getAccountInfo: async () => null, getBalance: async (pk: { toBase58(): string }) => { reads.n++; return funds.get(pk.toBase58()) ?? 0; } });
  const fill = async (w: Any) => { for (let c = 0; c < 9; c++) for (let k = 0; k < DEFAULT_PIN_CREATOR_DAILY_CAP; k++) await prepareLaunch(w.p, body(rnd(), Keypair.generate().publicKey.toBase58()), { register: true, mint: mintPk(), client: `attacker-${c}` }); };

  test("signed throwaway wallets with no SOL share the unsigned uploads; a funded signed wallet is served from the reserve", async () => {
    resetWalletBalances();
    const w = await makeWorld();
    const funds = new Map<string, number>(), reads = { n: 0 };
    w.p.market = chainWith(funds, reads) as Any;
    await fill(w);
    // a throwaway keypair signs perfectly well, but holds nothing: it is held to the unsigned share, which is used up
    const k0 = Keypair.generate(), t0 = rnd(), m0 = mintPk();
    const broke = await prepareLaunch(w.p, { ...body(t0, k0.publicKey.toBase58()), walletProof: await proofFor(k0, [t0], [m0]) }, { register: true, mint: m0, client: "throwaway" });
    assert.equal(code(broke), "upload-budget-unfunded");
    assert.equal((broke as Any).error.body.error, unfundedUploadsSentence(COST));
    assert.match(launchErrorMessage(429, (broke as Any).error.body), /Put the launch cost in the wallet first/);
    clean(unfundedUploadsSentence(COST));
    // one lamport short is still short; the launch's own cost is enough
    const k1 = Keypair.generate(), k2 = Keypair.generate();
    funds.set(k1.publicKey.toBase58(), COST - 1); funds.set(k2.publicKey.toBase58(), COST);
    const t1 = rnd(), m1 = mintPk();
    assert.equal(code(await prepareLaunch(w.p, { ...body(t1, k1.publicKey.toBase58()), walletProof: await proofFor(k1, [t1], [m1]) }, { register: true, mint: m1, client: "short" })), "upload-budget-unfunded");
    const t2 = rnd(), m2 = mintPk();
    const ok = await prepareLaunch(w.p, { ...body(t2, k2.publicKey.toBase58()), walletProof: await proofFor(k2, [t2], [m2]) }, { register: true, mint: m2, client: "funded" });
    assert.equal(code(ok), "ok", JSON.stringify((ok as Any).error?.body));
    assert.equal(reads.n, 3, "one balance read per signed prepare; unsigned prepares read nothing");
  });

  test("the balance is read once per wallet per minute; a failed read does not count as funded", async () => {
    resetWalletBalances();
    const k = Keypair.generate().publicKey.toBase58(), reads = { n: 0 };
    const p = { market: chainWith(new Map([[k, 10 ** 9]]), reads) } as Any;
    assert.equal(await walletCovers(p, k, COST, 1_000), true);
    assert.equal(await walletCovers(p, k, COST, 1_000 + WALLET_BALANCE_CACHE_MS - 1), true);
    assert.equal(reads.n, 1, "cached for 60 s");
    await walletCovers(p, k, COST, 1_000 + WALLET_BALANCE_CACHE_MS);
    assert.equal(reads.n, 2);
    resetWalletBalances();
    assert.equal(await walletCovers({ market: { getAccountInfo: async () => null, getBalance: async () => { throw new Error("429"); } } } as Any, k, COST), false);
    assert.equal(await walletCovers({ market: null } as Any, k, COST), true, "a host with no chain connection cannot check");
  });
});

describe("review of block M: one funded wallet across many connections", () => {
  test("a proven wallet is counted by itself: its seventh signed prepare in a day is refused, whatever address it comes from", async () => {
    resetWalletBalances();
    const w = await makeWorld();
    const k = Keypair.generate(), reads = { n: 0 };
    w.p.market = { getAccountInfo: async () => null, getBalance: async () => { reads.n++; return 10 ** 9; } } as Any;
    const codes: string[] = [];
    for (let i = 0; i < DEFAULT_PIN_CREATOR_DAILY_CAP + 3; i++) {
      const t = rnd(), m = mintPk();
      codes.push(code(await prepareLaunch(w.p, { ...body(t, k.publicKey.toBase58()), walletProof: await proofFor(k, [t], [m]) }, { register: true, mint: m, client: `ip-${i}` })));
    }
    assert.deepEqual(codes, [...Array(DEFAULT_PIN_CREATOR_DAILY_CAP).fill("ok"), "upload-budget-wallet", "upload-budget-wallet", "upload-budget-wallet"]);
    // an unsigned request naming the same wallet is counted per connection as before (it proves nothing about the wallet)
    assert.equal(code(await prepareLaunch(w.p, body(rnd(), k.publicKey.toBase58()), { register: true, mint: mintPk(), client: "ip-new" })), "ok");
  });
  test("the balance cache keeps at most 1,000 wallets, the least recently used leaving first", async () => {
    resetWalletBalances();
    const p = { market: { getAccountInfo: async () => null, getBalance: async () => 10 ** 9 } } as Any;
    const keys = Array.from({ length: WALLET_BALANCE_CACHE_MAX + 1 }, () => Keypair.generate().publicKey.toBase58());
    for (const k of keys.slice(0, WALLET_BALANCE_CACHE_MAX)) await walletCovers(p, k, 1, 1_000);
    await walletCovers(p, keys[0], 1, 1_001);   // used again: now the most recent
    await walletCovers(p, keys[WALLET_BALANCE_CACHE_MAX], 1, 1_002);
    const held = cachedBalanceWallets();
    assert.equal(held.length, WALLET_BALANCE_CACHE_MAX);
    assert.ok(held.includes(keys[0]), "the wallet used again stays");
    assert.ok(!held.includes(keys[1]), "the least recently used one left");
  });
});

