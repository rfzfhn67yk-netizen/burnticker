// RE-REVIEW OF BLOCK M (two lows). (1) A prepare that registers nothing (the page route's dry run, /v1/launch/bundle register: false)
// applies the own-draft ticker exemption only when the request carries that wallet's own signed request, so an unproven `creator` claim
// never tells anyone which wallet owns a draft. (2) The review's ticker panel, for a proven creator, treats their own LAUNCHED coin as
// taken (as the prepare does) and still offers free tickers; only their own unfinished draft stays exempt.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";
import { lockRule } from "@/lib/burnticker/rules";
import { prepareLaunch } from "@/lib/burnticker/api/handlers";
import { signLaunchRequest } from "@/lib/burnticker/walletProof";
import { base58 } from "@/lib/burnticker/vanityMint";
import { tickerChecks } from "@/lib/burnticker/tickerCheck";
import { lookalikeRows } from "@/lib/burnticker/launchGuards";

// deno-lint-ignore no-explicit-any
type Any = any;
const RULE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
const body = (ticker: string, creator: string) => ({ creator, ticker, name: `${ticker} again`, rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } });
const code = (r: Any) => ("error" in r ? r.error.body.code : "ok");
const signer = (k: Keypair) => { const key = crypto.createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: Buffer.from(k.secretKey.slice(0, 32)).toString("base64url"), x: Buffer.from(k.publicKey.toBytes()).toString("base64url") }, format: "jwk" }); return async (m: Uint8Array) => new Uint8Array(crypto.sign(null, Buffer.from(m), key)); };
const row = (w: Any, ticker: string, creator: string, status: "draft" | "live") => w.registry.register({ mint: Keypair.generate().publicKey.toBase58(), ticker, name: `${ticker} coin`, creator, description: "", imageUrl: null, links: [], rulesText: lockRule(BRONCOS).text, feePda: "F", vault: null, tokenConfig: null, poolId: null, launchTx: status === "live" ? "L".repeat(88) : null, cluster: "devnet", platformId: null, baselineAt: new Date().toISOString(), status });

test("a prepare that registers nothing exempts the owner's draft ticker only with the owner's signature", async () => {
  const w = await makeWorld();
  const owner = Keypair.generate(), wallet = owner.publicKey.toBase58();
  row(w, "OWNDRF", wallet, "draft");
  const mint = () => Keypair.generate().publicKey.toBase58();
  // the claim alone: refused exactly as for a stranger (dry run and register: false)
  assert.equal(code(await prepareLaunch(w.p, body("OWNDRF", wallet), { register: false, dryRun: true, client: "c" })), "ticker-taken");
  const m1 = mint();
  assert.equal(code(await prepareLaunch(w.p, body("OWNDRF", wallet), { register: false, mint: m1, client: "c" })), "ticker-taken");
  assert.equal(code(await prepareLaunch(w.p, body("OWNDRF", Keypair.generate().publicKey.toBase58()), { register: false, mint: mint(), client: "c" })), "ticker-taken");
  // with the owner's signature the draft is theirs
  const m2 = mint();
  const walletProof = await signLaunchRequest(signer(owner), { creator: wallet, tickers: ["OWNDRF"], mints: [m2] }, base58);
  assert.notEqual(code(await prepareLaunch(w.p, { ...body("OWNDRF", wallet), walletProof }, { register: false, mint: m2, client: "c" })), "ticker-taken");
  // the registering prepare keeps the exemption (it writes the draft under that wallet)
  assert.equal(code(await prepareLaunch(w.p, body("OWNDRF", wallet), { register: true, mint: mint(), client: "c" })), "ok");
});

test("the review's ticker panel, for a proven creator: their own launched coin is taken (with free tickers); their own draft is not", async () => {
  const w = await makeWorld();
  const wallet = Keypair.generate().publicKey.toBase58();
  row(w, "MYLIVE", wallet, "live"); row(w, "MYDRAFT", wallet, "draft");
  const deps = { inUse: (t: string) => w.registry.tokensByTicker(t), existing: lookalikeRows(w.registry), reserved: new Set<string>(), creator: wallet };
  const [live] = tickerChecks([{ side: "A", ticker: "MYLIVE" }], deps);
  assert.equal(live.taken, true);
  assert.ok(live.suggestions.length > 0);
  const [draft] = tickerChecks([{ side: "A", ticker: "MYDRAFT" }], deps);
  assert.equal(draft.taken, false);
});
