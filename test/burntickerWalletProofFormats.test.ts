// REVIEW OF BLOCK M (HIGH): a hardware wallet (a Ledger behind Phantom or Solflare) cannot sign raw bytes; it signs the text wrapped as a
// Solana off-chain message. The signed launch request's check accepts both forms (trustpack/operator.ts statementSignatureFormat), and a
// press whose signature is refused anyway (401 wallet-proof-invalid) is sent once more unsigned, never in a loop. The too-old refusal no
// longer says "press Launch again" twice.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { offchainMessageV0 } from "@/lib/burnticker/trustpack/operator";
import { PROOF_MAX_AGE_MS, sendWithProofFallback, walletProofMessage, WALLET_PROOF_INVALID_CODE } from "@/lib/burnticker/walletProof";
import { checkWalletProof } from "@/lib/burnticker/walletProofCheck";
import { base58 } from "@/lib/burnticker/vanityMint";
import { WALLET_PROOF_REFUSED } from "@/lib/burnticker/api/handlers";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";

const keyOf = (k: Keypair) => crypto.createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: Buffer.from(k.secretKey.slice(0, 32)).toString("base64url"), x: Buffer.from(k.publicKey.toBytes()).toString("base64url") }, format: "jwk" });
const sign = (k: Keypair, bytes: Buffer) => base58(new Uint8Array(crypto.sign(null, bytes, keyOf(k))));
const NOW = Date.parse("2026-10-18T20:00:00Z");
const text = (k: Keypair, at = NOW) => walletProofMessage({ origin: "https://burnticker.com", creator: k.publicKey.toBase58(), tickers: ["LEDG"], mints: null, nonce: "n".repeat(24), issuedAt: new Date(at).toISOString() });
const want = (k: Keypair) => ({ creator: k.publicKey.toBase58(), tickers: ["LEDG"], mints: [] as string[] });

test("both signature forms check out: the raw text (a software wallet) and the off-chain message wrapper (a hardware wallet)", () => {
  const k = Keypair.generate(), m = text(k);
  assert.deepEqual(checkWalletProof({ message: m, signature: sign(k, Buffer.from(m, "utf8")) }, want(k), NOW), { ok: true });
  for (const f of [0, 1, 2] as const) assert.deepEqual(checkWalletProof({ message: m, signature: sign(k, offchainMessageV0(m, f)) }, want(k), NOW), { ok: true }, `format ${f}`);
  const other = Keypair.generate();
  assert.equal(checkWalletProof({ message: m, signature: sign(other, offchainMessageV0(m, 0)) }, want(k), NOW).ok, false, "another wallet's wrapper signature is still refused");
});

test("the too-old refusal says 'press Launch again' once", () => {
  const k = Keypair.generate(), m = text(k, NOW - PROOF_MAX_AGE_MS - 1);
  const c = checkWalletProof({ message: m, signature: sign(k, Buffer.from(m, "utf8")) }, want(k), NOW);
  assert.equal(c.ok, false);
  const sentence = `${WALLET_PROOF_REFUSED} The reason was: ${(c as { reason: string }).reason}.`;
  assert.equal((sentence.match(/Press Launch again|press Launch again/g) ?? []).length, 1, sentence);
  const r = lintCopy(sentence, loadCopyLintConfig()); assert.ok(r.ok, formatHits(r));
});

test("a refused signature is sent once more without it; any other refusal, or a second refusal, is not retried", async () => {
  const refusal = (code: string) => Object.assign(new Error(code), { code });
  const sent: Record<string, unknown>[] = [];
  const ok = await sendWithProofFallback({ ticker: "A", walletProof: { message: "m", signature: "s" } }, async (b) => { sent.push(b); if (b.walletProof) throw refusal(WALLET_PROOF_INVALID_CODE); return "prepared"; });
  assert.equal(ok, "prepared");
  assert.deepEqual(sent, [{ ticker: "A", walletProof: { message: "m", signature: "s" } }, { ticker: "A" }]);
  let calls = 0;
  await assert.rejects(sendWithProofFallback({ walletProof: {} }, async () => { calls++; throw refusal(WALLET_PROOF_INVALID_CODE); }), /wallet-proof-invalid/);
  assert.equal(calls, 2, "one unsigned retry, never a loop");
  calls = 0;
  await assert.rejects(sendWithProofFallback({ walletProof: {} }, async () => { calls++; throw refusal("upload-budget"); }), /upload-budget/);
  assert.equal(calls, 1, "other refusals are not retried");
  calls = 0;
  await assert.rejects(sendWithProofFallback({}, async () => { calls++; throw refusal(WALLET_PROOF_INVALID_CODE); }));
  assert.equal(calls, 1, "an unsigned request is never retried");
});

test("the launch page and the Coin vs Coin tile send every prepare through the fallback", async () => {
  const fs = await import("node:fs");
  const page = fs.readFileSync("src/app/burnticker/launch/page.tsx", "utf8"), tile = fs.readFileSync("src/app/burnticker/launch/CoinVsCoinTile.tsx", "utf8");
  assert.match(page, /const post = \(body: Record<string, unknown>\) => sendWithProofFallback\(body, postOnce\);/);
  assert.match(page, /await sendWithProofFallback\(\{ \.\.\.body, pair:/);
  assert.equal((tile.match(/await sendWithProofFallback\(/g) ?? []).length, 2);
});
