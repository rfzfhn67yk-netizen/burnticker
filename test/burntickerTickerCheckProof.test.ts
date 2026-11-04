// REVIEW OF BLOCK M (LOW): /v1/launch/review with `creator: X` answered "not taken" only for the wallet that owned a draft, so anyone could
// learn who owns a draft by asking with different wallets. The review now treats a ticker as the creator's own only when the request
// carries that wallet's signed request over its tickers; without one every holder counts. A lookalike refusal never names a draft's ticker.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { API, POST_HEADERS, callRoute, makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";
import { lockRule } from "@/lib/burnticker/rules";
import { signLaunchRequest, PROVE_TICKER_LABEL } from "@/lib/burnticker/walletProof";
import { base58 } from "@/lib/burnticker/vanityMint";
import { lookalikeHits } from "@/lib/burnticker/lookalike";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";

// deno-lint-ignore no-explicit-any
type Any = any;
const signer = (k: Keypair) => { const key = crypto.createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: Buffer.from(k.secretKey.slice(0, 32)).toString("base64url"), x: Buffer.from(k.publicKey.toBytes()).toString("base64url") }, format: "jwk" }); return async (m: Uint8Array) => new Uint8Array(crypto.sign(null, Buffer.from(m), key)); };

test("the review: a claimed wallet alone never makes a draft's ticker free; the owner's signature does", async () => {
  const w = await makeWorld();
  const owner = Keypair.generate(), mint = Keypair.generate().publicKey.toBase58();
  w.registry.register({ mint, ticker: "MYDRAFT", name: "My draft", creator: owner.publicKey.toBase58(), description: "", imageUrl: null, links: [], rulesText: lockRule(BRONCOS).text, feePda: "F", vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: new Date().toISOString(), status: "draft" });
  const review = async (extra: Record<string, unknown>) => (await (await callRoute(`${API}/launch/review`, { method: "POST", headers: POST_HEADERS, body: JSON.stringify({ rule: BRONCOS, ticker: "MYDRAFT", name: "Another name", ...extra }) })).json()) as Any;
  const stranger = await review({ creator: Keypair.generate().publicKey.toBase58() });
  const claimed = await review({ creator: owner.publicKey.toBase58() });
  assert.equal(stranger.tickers[0].taken, true);
  assert.equal(claimed.tickers[0].taken, true, "the owner's wallet named without a signature reads exactly like anyone else's");
  assert.deepEqual(claimed.tickers, stranger.tickers);
  const walletProof = await signLaunchRequest(signer(owner), { creator: owner.publicKey.toBase58(), tickers: ["MYDRAFT"], mints: [] }, base58);
  const proven = await review({ creator: owner.publicKey.toBase58(), walletProof });
  assert.equal(proven.tickers[0].taken, false, "with the owner's signature the draft counts as theirs");
  const borrowed = await review({ creator: Keypair.generate().publicKey.toBase58(), walletProof });
  assert.equal(borrowed.tickers[0].taken, true, "someone else's signature proves nothing for another wallet");
});

test("a lookalike of a draft's ticker is refused without naming it; the button's words are plain", () => {
  const hits = lookalikeHits({ ticker: "SECRETX", name: "zz" }, [{ ticker: "SECRET", name: "Secret", status: "draft", creator: "W" }]);
  assert.equal(hits.length, 1);
  assert.doesNotMatch(hits[0].reason + hits[0].existing, /SECRET\b|\$SECRET[^X]/);
  for (const s of [hits[0].reason, PROVE_TICKER_LABEL]) { const r = lintCopy(s, loadCopyLintConfig()); assert.ok(r.ok, formatHits(r)); }
});
