// PRELAUNCH AUDIT 2026-10-18 A-3 follow-up: `walletProof` is described in the OpenAPI spec (LaunchRequest, 401 wallet-proof-invalid)
// and sent by the SDK's buildLaunchBundle when it is given the wallet's signMessage; the two launch routes keep only the top-level
// fields a launch reads (api/launchBody.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { LAUNCH_BODY_FIELDS, launchBodyOf } from "@/lib/burnticker/api/launchBody";
import { ENDPOINTS, SCHEMAS } from "@/lib/burnticker/api/spec";
import { launchBody } from "@/lib/burnticker/launchDraft";
import { checkWalletProof } from "@/lib/burnticker/walletProofCheck";
import { buildLaunchBundle } from "../packages/burnticker-sdk/src/launch.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

test("unknown top-level fields are dropped; every field the launch page sends is kept", () => {
  const b = launchBodyOf({ creator: "W", ticker: "ABC", walletProof: { message: "m", signature: "s" }, pair: { ticker: "B", extra: 1 }, referral: "x", __proto__x: 1, discount: 50 });
  assert.deepEqual(Object.keys(b).sort(), ["creator", "pair", "ticker", "walletProof"]);
  assert.deepEqual((b as Any).pair, { ticker: "B", extra: 1 }, "nested objects are left to their own readers");
  assert.equal(launchBodyOf(null), null); assert.deepEqual(launchBodyOf([1]), [1]);
  // the page's own bodies (launchDraft.launchBody, ProfileFields.profileBody, the press's common fields) are all known
  const page = { ...launchBody({ creator: "W", ticker: "a", name: "n", description: "d", descCtx: {}, note: "", rule: BRONCOS as Any, timings: { a: 1 }, raiseSol: "85" }), creatorDescription: "", links: [], image: {}, imageRights: true, imageBadge: false, idempotencyKey: "k", mint: "M", walletProof: {}, pair: {}, venue: "launchlab", dryRun: true, action: "launched", launchTx: "t", recentBlockhash: "b", register: false };
  for (const k of Object.keys(page)) assert.ok(LAUNCH_BODY_FIELDS.includes(k), k);
  assert.match(fs.readFileSync("src/app/api/burnticker/launch/route.ts", "utf8"), /body = launchBodyOf\(body\);/);
  assert.match(fs.readFileSync("src/app/api/burnticker/v1/launch/bundle/route.ts", "utf8"), /const body = launchBodyOf\(await readJson\(req\)\);/);
});

test("the OpenAPI spec describes walletProof and the 401 it can answer", () => {
  const props = (SCHEMAS.LaunchRequest as Any).properties;
  assert.deepEqual((props.walletProof.required as string[]).sort(), ["message", "signature"]);
  assert.match(props.walletProof.description, /401 wallet-proof-invalid/);
  assert.ok(!(SCHEMAS.LaunchRequest as Any).required.includes("walletProof"), "optional");
  assert.ok(ENDPOINTS.find((e) => e.operationId === "buildLaunchBundle")!.errors.includes(401));
});

test("the SDK signs the request with the wallet's signMessage, and the server's check accepts it", async () => {
  const wallet = Keypair.generate();
  const key = crypto.createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: Buffer.from(wallet.secretKey.slice(0, 32)).toString("base64url"), x: Buffer.from(wallet.publicKey.toBytes()).toString("base64url") }, format: "jwk" });
  const signMessage = async (m: Uint8Array) => new Uint8Array(crypto.sign(null, Buffer.from(m), key));
  let sent: Any = null;
  const api = { post: async (_p: string, b: unknown) => { sent = b; throw new Error("stop here"); } } as Any;
  const mintKeypair = Keypair.generate();
  const o = { wallet: wallet.publicKey, rule: BRONCOS as Any, metadata: { ticker: "sdkp", name: "SDK proof" }, acknowledgements: { ruleLocked: true as const, noReturns: true as const }, mintKeypair };
  await assert.rejects(buildLaunchBundle(api, { ...o, signMessage }), /stop here/);
  assert.deepEqual(checkWalletProof(sent.walletProof, { creator: wallet.publicKey.toBase58(), tickers: ["SDKP"], mints: [mintKeypair.publicKey.toBase58()] }), { ok: true });
  await assert.rejects(buildLaunchBundle(api, o), /stop here/);
  assert.equal(sent.walletProof, undefined, "no signMessage: the request goes unsigned");
});
