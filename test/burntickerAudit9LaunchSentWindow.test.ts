// Ninth pre-launch audit (2026-10-21) LAUNCH LA9-1, HB-208 / HS-103 (B-19 re-sign loop): a "sent" report holds only for SENT_HOLD_MS
// from the draft's FIRST reported send (MIN(sent_at)), so re-signing the never-broadcast create with a fresh blockhash every 4 minutes
// no longer restarts the hold. Folded from docs/burnticker/audits/prelaunch-2026-10-21-ninth-pass/evidence/tests/LAUNCH/
// audit9LaunchSentWindow.test.ts. In-memory registry (makeWorld), stubbed chain reader, no network.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { markCreateSent, prepareLaunch, resetConfirmGuards } from "@/lib/burnticker/api/handlers";
import { limiter } from "@/lib/burnticker/api/http";
import { SENT_HOLD_FAIL_MAX_MS, SENT_HOLD_MS, UNPROVEN_HOLD_MS, type Registry } from "@/lib/burnticker/registry";
import { CREATE_SEND_PENDING_MS } from "@/lib/burnticker/launchPending";
import { configPda } from "@/lib/burnReceipts/pda";
import { SdkLaunchLab, type LaunchBundle } from "@/lib/burnticker/launchBundle";
import { LAUNCHLAB_PROGRAM } from "@/lib/burnKeeper/launchlab";
import { signLaunchRequest, type WalletProof } from "@/lib/burnticker/walletProof";
import { base58 } from "@/lib/burnticker/vanityMint";
import { encodeAccount, makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

type Any = any;
const RULE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const r = () => Keypair.generate().publicKey;
const wallet = () => r().toBase58();
const body = (ticker: string, creator: string) => ({ creator, ticker, name: `${ticker} coin`, rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } });
const code = (x: Any) => ("error" in x ? String(x.error.body.code) : "ok");
const said = (x: Any) => ("error" in x ? String(x.error.body.error) : "");
const signerOf = (k: Keypair) => async (m: Uint8Array): Promise<Uint8Array> => {
  const key = crypto.createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: Buffer.from(k.secretKey.slice(0, 32)).toString("base64url"), x: Buffer.from(k.publicKey.toBytes()).toString("base64url") }, format: "jwk" });
  return new Uint8Array(crypto.sign(null, Buffer.from(m), key));
};
const proofFor = async (k: Keypair, tickers: string[], mints: string[]): Promise<WalletProof> => (await signLaunchRequest(signerOf(k), { creator: k.publicKey.toBase58(), tickers, mints }, base58))!;
const regInput = (rg: Registry, ticker: string, creator: string, unproven: boolean) => {
  const live = rg.tokens("live")[0];
  return { mint: wallet(), ticker, name: `${ticker} coin`, creator, description: "", imageUrl: null, links: [], rulesText: live.rulesJson, feePda: live.feePda, vault: null, tokenConfig: live.tokenConfig, poolId: null, launchTx: null, cluster: live.cluster, platformId: live.platformId, baselineAt: live.baselineAt, status: "draft" as const, unproven } as Any;
};
async function sdkWorld() {
  const w = await makeWorld();
  const G = { curveType: 0, index: 0, migrateFee: BigInt(0), tradeFeeRate: BigInt(2500), maxShareFeeRate: BigInt(10000), minSupplyA: BigInt(10_000_000), maxLockRate: BigInt(999_999), minSellRateA: BigInt(1), minMigrateRateA: BigInt(1), minFundRaisingB: BigInt(1), mintB: WSOL };
  const P = { feeRate: BigInt(7500), creatorFeeRate: BigInt(500), platformScale: BigInt(0), creatorScale: BigInt(100_000), burnScale: BigInt(900_000), cpConfigId: r(), platformCpCreator: PublicKey.default, platformClaimFeeWallet: r(), platformLockNftWallet: r(), platformVestingScale: BigInt(0), restrictCurve: false } as Any;
  (w.p as Any).launchLab = new SdkLaunchLab({ cluster: "devnet", programId: LAUNCHLAB_PROGRAM.devnet, platformId: r(), configId: r(), global: G, platform: P } as Any);
  return w;
}
const ixOf = (s: LaunchBundle["transactions"][number]["instructions"][number]) => new TransactionInstruction({ programId: new PublicKey(s.programId), keys: s.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })), data: Buffer.from(s.dataBase64, "base64") });
function signedStep(b: LaunchBundle, step: number, signers: Keypair[]): string {
  const vt = new VersionedTransaction(new TransactionMessage({ payerKey: signers[0].publicKey, recentBlockhash: r().toBase58(), instructions: b.transactions[step].instructions.map(ixOf) }).compileToV0Message());
  vt.sign(signers);
  return Buffer.from(vt.serialize()).toString("base64");
}
beforeEach(() => { limiter.reset(); resetConfirmGuards(); });

/** A free keypair's unproven draft; returns everything needed to re-sign and re-report its create at will. */
async function squatter(ticker: string, getAccountInfo?: (k: PublicKey) => Promise<unknown>) {
  const w = await sdkWorld();
  (w.p as Any).market = { getAccountInfo: getAccountInfo ?? (async () => null) };
  const sq = Keypair.generate(), sm = Keypair.generate();
  const a = await prepareLaunch(w.p, body(ticker, sq.publicKey.toBase58()), { register: true, mint: sm.publicKey.toBase58(), client: "6.6.9.1" });
  assert.ok("ok" in a, said(a));
  const bundle = (a as Any).ok.bundle as LaunchBundle;
  const report = (at: number) => markCreateSent(w.p, sm.publicKey.toBase58(), signedStep(bundle, 1, [sq, sm]), at);   // a fresh blockhash = a new signature
  const signedPrepareAt = async (at: number) => {
    const real = Date.now;
    try { Date.now = () => at; limiter.reset(); const k = Keypair.generate(), m = wallet(); return await prepareLaunch(w.p, { ...body(ticker, k.publicKey.toBase58()), walletProof: await proofFor(k, [ticker], [m]) }, { register: true, mint: m, client: "1.2.3.9" }); }
    finally { Date.now = real; }
  };
  return { w, sm, report, signedPrepareAt };
}

test("LA9-1: re-signing the never-broadcast create with a fresh blockhash every 4 minutes no longer keeps the 'sent' hold alive against a signed, funded creator (chain read says absent)", async () => {
  const s = await squatter("REFRESH");
  const t0 = Date.now();
  let rows = 0;
  for (let at = t0; at <= t0 + 2 * 3_600_000; at += 4 * 60_000) { const r = await s.report(at); assert.equal(r.status, 200, JSON.stringify(r.body)); if ((r.body as Any).fresh) rows++; }
  console.log("fresh send rows recorded:", rows, "| draft_sends for the mint:", s.w.registry.createSends(s.sm.publicKey.toBase58()).length);
  const b = await s.signedPrepareAt(t0 + 2 * 3_600_000 + 60_000);
  console.log("signed, funded creator 2 h 1 min after the first report (last report 1 min ago):", code(b), said(b).slice(0, 200));
  assert.equal(code(b), "ok", "each re-signed report is a new draft_sends row and restarts the 5-minute hold; nothing was ever broadcast");
});

test("LA9 edge: the same, while the chain read fails every time: the failed-read hour does not stack, but the re-signed reports still hold (record)", async () => {
  const s = await squatter("RPCDOWN", async () => { throw new Error("rpc down"); });
  const t0 = Date.now();
  await s.report(t0);
  const at30 = await s.signedPrepareAt(t0 + 30 * 60_000);
  const at61 = await s.signedPrepareAt(t0 + 61 * 60_000);
  console.log("one report, RPC down: 30 min:", code(at30), "| 61 min:", code(at61));
  assert.equal(code(at30), "ticker-taken"); assert.equal(code(at61), "ok");
});

test("LA9 edge: a 'sent' report on a draft that is 23 h old is accepted and holds for 5 minutes (record); an expired draft's report holds nothing", async () => {
  const s = await squatter("LATESENT");
  const t0 = Date.now() + 23 * 3_600_000;
  const r = await s.report(t0);
  const b = await s.signedPrepareAt(t0 + 60_000);
  const c = await s.signedPrepareAt(t0 + 6 * 60_000);
  console.log("23 h old draft report:", r.status, "| signed creator 1 min later:", code(b), "| 6 min later:", code(c));
  assert.equal(r.status, 200); assert.equal(code(b), "ticker-taken"); assert.equal(code(c), "ok");
});

test("LA9 edge: the review path never runs the chain read, so a landed-but-unconfirmed unproven draft shows its ticker as free at review (record)", async () => {
  const s = await squatter("REVIEWFREE");
  const t0 = Date.now();
  await s.report(t0);
  const unprovenAt = s.w.registry.unprovenDraftMints(t0 + 6 * 60_000).has(s.sm.publicKey.toBase58());
  console.log("unproven (review reads this) 6 min after the report, no prepare since:", unprovenAt);
  assert.equal(unprovenAt, true);
});

test("LA6-2 / LA7-5 (3fa8c733): a signed creator's second registering prepare of the same ticker on another mint is refused 409 draft-exists; an unsigned one is not (by design, record)", async () => {
  const w = await sdkWorld();
  const k = Keypair.generate(), m1 = wallet(), m2 = wallet();
  const a = await prepareLaunch(w.p, { ...body("TWICE", k.publicKey.toBase58()), walletProof: await proofFor(k, ["TWICE"], [m1]) }, { register: true, mint: m1, client: "1.2.3.10" });
  limiter.reset();
  const b = await prepareLaunch(w.p, { ...body("TWICE", k.publicKey.toBase58()), walletProof: await proofFor(k, ["TWICE"], [m2]) }, { register: true, mint: m2, client: "1.2.3.10" });
  const u = wallet(); limiter.reset();
  const c1 = await prepareLaunch(w.p, body("TWICEU", u), { register: true, mint: wallet(), client: "1.2.3.11" }); limiter.reset();
  const c2 = await prepareLaunch(w.p, body("TWICEU", u), { register: true, mint: wallet(), client: "1.2.3.11" });
  console.log("signed first:", code(a), "| signed second:", code(b), said(b).slice(0, 160), "| unsigned first/second:", code(c1), code(c2));
  assert.equal(code(a), "ok"); assert.equal(code(b), "draft-exists");
});
