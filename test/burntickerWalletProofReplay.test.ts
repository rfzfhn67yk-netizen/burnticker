// REVIEW OF BLOCK M (LOW): a captured signed launch request could be sent again, and another site could ask a wallet to sign the same
// text. The signed text now names this site and the page's origin, and a proof is spent once the prepare it came with succeeds (per
// wallet, nonce and the request's own tickers and mints; kept 15 minutes, bounded).
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";
import { prepareLaunch, resetWalletBalances } from "@/lib/burnticker/api/handlers";
import { signLaunchRequest, walletProofMessage } from "@/lib/burnticker/walletProof";
import { checkWalletProof, NONCES_PER_WALLET, resetSpentProofs, spendProof } from "@/lib/burnticker/walletProofCheck";
import { base58 } from "@/lib/burnticker/vanityMint";

// deno-lint-ignore no-explicit-any
type Any = any;
const RULE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
const AZ = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const rnd = () => Array.from({ length: 8 }, () => AZ[Math.floor(Math.random() * AZ.length)]).join("");
const body = (ticker: string, creator: string) => ({ creator, ticker, name: `${ticker} coin`, rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } });
const code = (r: Any) => ("error" in r ? r.error.body.code : "ok");
const signer = (k: Keypair) => { const key = crypto.createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: Buffer.from(k.secretKey.slice(0, 32)).toString("base64url"), x: Buffer.from(k.publicKey.toBytes()).toString("base64url") }, format: "jwk" }); return async (m: Uint8Array) => new Uint8Array(crypto.sign(null, Buffer.from(m), key)); };

test("a proof is spent once its prepare succeeds; the same proof again is refused, a refused prepare does not spend it", async () => {
  resetSpentProofs(); resetWalletBalances();
  const w = await makeWorld();
  const k = Keypair.generate(), t = rnd(), m = Keypair.generate().publicKey.toBase58();
  const proof = (await signLaunchRequest(signer(k), { creator: k.publicKey.toBase58(), tickers: [t], mints: [m] }, base58))!;
  // a refused prepare (a bad acknowledgement) does not spend it
  assert.notEqual(code(await prepareLaunch(w.p, { ...body(t, k.publicKey.toBase58()), acknowledgements: { ruleLocked: false, noReturns: true }, walletProof: proof }, { register: true, mint: m, client: "c" })), "ok");
  assert.equal(code(await prepareLaunch(w.p, { ...body(t, k.publicKey.toBase58()), walletProof: proof }, { register: true, mint: m, client: "c" })), "ok");
  const again = await prepareLaunch(w.p, { ...body(t, k.publicKey.toBase58()), walletProof: proof }, { register: true, mint: m, client: "attacker" });
  assert.equal(code(again), "wallet-proof-invalid");
  assert.match((again as Any).error.body.error, /already used/);
});

const real = async (k: Keypair, f: { tickers: string[]; nonce: string; origin?: string }) => {
  const message = walletProofMessage({ origin: f.origin ?? "https://burnticker.com", creator: k.publicKey.toBase58(), tickers: f.tickers, mints: null, nonce: f.nonce, issuedAt: new Date().toISOString() });
  return { message, signature: base58(await signer(k)(new TextEncoder().encode(message))) };
};

test("one signature covers both requests of a matchup press; spent, it is refused; a text naming another website is refused", async () => {
  resetSpentProofs();
  const k = Keypair.generate(), creator = k.publicKey.toBase58();
  const want = (tickers: string[]) => ({ creator, tickers, mints: [] as string[] });
  const p = await real(k, { tickers: ["AAA", "BBB"], nonce: "n".repeat(20) });
  assert.deepEqual(checkWalletProof(p, want(["AAA"])), { ok: true });
  spendProof(p, want(["AAA"]));
  assert.deepEqual(checkWalletProof(p, want(["AAA"])), { ok: false, reason: "the signed request was already used" });
  assert.deepEqual(checkWalletProof(p, want(["BBB"])), { ok: true }, "coin B of the same press is not a replay");
  assert.deepEqual(checkWalletProof(p, { ...want(["BBB"]), origins: ["https://other.example"] }), { ok: false, reason: "the signed text names another website" });
  const elsewhere = await real(k, { tickers: ["CCC"], nonce: "m".repeat(20), origin: "https://other.example" });
  assert.equal((checkWalletProof(elsewhere, { ...want(["CCC"]), origins: ["https://burnticker.com"] }) as { reason: string }).reason, "the signed text names another website");
  const noSite = { ...p, message: p.message.replace("Site: burnticker.com\n", "") };
  assert.equal((checkWalletProof(noSite, want(["AAA"])) as { reason: string }).reason, "the signed text is not a Burnticker launch request");
});

test("the spent store is bounded per wallet: the oldest spent proof leaves first", async () => {
  resetSpentProofs();
  const k = Keypair.generate(), want = { creator: k.publicKey.toBase58(), tickers: ["X"], mints: [] as string[] };
  const proofs = [];
  for (let i = 0; i <= NONCES_PER_WALLET; i++) proofs.push(await real(k, { tickers: ["X"], nonce: `nonce${String(i).padStart(12, "0")}` }));
  for (const p of proofs) spendProof(p, want);
  assert.deepEqual(checkWalletProof(proofs[0], want), { ok: true }, "the oldest left the store");
  assert.deepEqual(checkWalletProof(proofs[NONCES_PER_WALLET], want), { ok: false, reason: "the signed request was already used" });
});
