// B-19 (seventh prelaunch audit, 2026-10-20): an unsigned prepare under a made-up wallet held any free ticker for 24 hours against every
// creator. An UNPROVEN draft (a public prepare with no wallet that proved control and holds the launch cost) now holds its ticker only
// against other unproven prepares, for 15 minutes, and never against a proven creator; a recorded create send makes it hold; its own
// creator can still resume it. The auditor's acceptance test is test/audit7LaunchSquat.test.ts.
import { test, describe } from "node:test";
import fs from "node:fs";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { prepareLaunch, resetConfirmGuards } from "@/lib/burnticker/api/handlers";
import { limiter } from "@/lib/burnticker/api/http";
import { DRAFT_TTL_MS, SENT_HOLD_MS, UNPROVEN_HOLD_MS, UNPROVEN_DRAFT_PREFIX, type Registry } from "@/lib/burnticker/registry";
import { heldTickerRows, lookalikeRows } from "@/lib/burnticker/launchGuards";
import { tickerChecks, type TickerCheck } from "@/lib/burnticker/tickerCheck";
import { autoTickerSwaps } from "@/lib/burnticker/tickerSwap";
import { lintCopy } from "@/lib/launch/copyLint";
import { signLaunchRequest, type WalletProof } from "@/lib/burnticker/walletProof";
import { base58 } from "@/lib/burnticker/vanityMint";
import { makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const RULE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
const wallet = () => Keypair.generate().publicKey.toBase58();
const body = (ticker: string, creator: string) => ({ creator, ticker, name: `${ticker} coin`, rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } });
type R = Awaited<ReturnType<typeof prepareLaunch>>;
const code = (r: R) => ("error" in r ? String((r.error.body as { code?: string }).code) : "ok");
const said = (r: R) => ("error" in r ? String((r.error.body as { error?: string }).error) : "");
const signerOf = (k: Keypair) => async (m: Uint8Array): Promise<Uint8Array> => {
  const key = crypto.createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: Buffer.from(k.secretKey.slice(0, 32)).toString("base64url"), x: Buffer.from(k.publicKey.toBytes()).toString("base64url") }, format: "jwk" });
  return new Uint8Array(crypto.sign(null, Buffer.from(m), key));
};
const proofFor = async (k: Keypair, tickers: string[], mints: string[]): Promise<WalletProof> => (await signLaunchRequest(signerOf(k), { creator: k.publicKey.toBase58(), tickers, mints }, base58))!;
const regInput = (r: Registry, ticker: string, creator: string, unproven: boolean) => {
  const live = r.tokens("live")[0];
  return { mint: wallet(), ticker, name: `${ticker} coin`, creator, description: "", imageUrl: null, links: [], rulesText: live.rulesJson, feePda: live.feePda, vault: null, tokenConfig: live.tokenConfig, poolId: null, launchTx: null, cluster: live.cluster, platformId: live.platformId, baselineAt: live.baselineAt, status: "draft" as const, unproven };
};

test("an unsigned public prepare writes an unproven draft; a second unsigned creator is refused for 15 minutes with the true reason", async () => {
  const w = await makeWorld(); limiter.reset(); resetConfirmGuards();
  const mintA = wallet();
  const a = await prepareLaunch(w.p, body("SQUATZ", wallet()), { register: true, mint: mintA, client: "6.6.6.6" });
  assert.equal(code(a), "ok");
  assert.ok(w.registry.unprovenDraftMints().has(mintA), "marked unproven");
  limiter.reset();
  const b = await prepareLaunch(w.p, body("SQUATZ", wallet()), { register: true, mint: wallet(), client: "7.7.7.7" });
  assert.equal(code(b), "ticker-taken");
  assert.match(said(b), /\$SQUATZ is held by a launch that has not been signed yet\. It frees up at \d{1,2} [A-Z][a-z]+ \d{4}, \d{2}:\d{2} UTC, in (1[0-5]|[1-9]) minutes?, or you can pick another ticker\./);
  assert.doesNotMatch(said(b), /already the ticker of another/, "never the false reason");
  assert.deepEqual(lintCopy(said(b)).hits, []);
});

test("the same creator can resume an unproven draft, and a proof on the retry makes the draft hold like any other", async () => {
  const w = await makeWorld(); limiter.reset(); resetConfirmGuards();
  const k = Keypair.generate(), me = k.publicKey.toBase58(), mint = wallet();
  const a = await prepareLaunch(w.p, body("RESUMZ", me), { register: true, mint, client: "1.1.1.1" });
  assert.equal(code(a), "ok");
  assert.ok(w.registry.unprovenDraftMints().has(mint));
  limiter.reset();
  const again = await prepareLaunch(w.p, { ...body("RESUMZ", me), walletProof: await proofFor(k, ["RESUMZ"], [mint]) }, { register: true, mint, client: "1.1.1.1" });
  assert.equal(code(again), "ok", said(again));
  assert.ok(!w.registry.unprovenDraftMints().has(mint), "proven now");
  limiter.reset();
  const other = Keypair.generate(), m2 = wallet();
  const c = await prepareLaunch(w.p, { ...body("RESUMZ", other.publicKey.toBase58()), walletProof: await proofFor(other, ["RESUMZ"], [m2]) }, { register: true, mint: m2, client: "2.2.2.2" });
  assert.equal(code(c), "ticker-taken", "a proven draft holds against a signed stranger");
});

test("registry: an unproven draft holds against unproven callers for 15 minutes, never against proven ones; a recorded send makes it hold", async () => {
  const { registry: r } = await makeWorld();
  const [a, b] = [wallet(), wallet()], now = Date.now();
  const d = r.register(regInput(r, "HOLDUP", a, true), now);
  assert.equal(r.getStatus(UNPROVEN_DRAFT_PREFIX + d.mint), "1");
  assert.deepEqual(r.reserveTicker("HOLDUP", b, null, now + 1000, 15 * 60_000, false), { ok: false, heldBy: "token" }, "unproven vs unproven inside the window");
  assert.deepEqual(r.reserveTicker("HOLDUP", b, null, now + 1000, 15 * 60_000, true), { ok: true }, "a proven caller is not held");
  r.releaseTicker("HOLDUP", b);
  assert.deepEqual(r.reserveTicker("HOLDUP", b, null, now + UNPROVEN_HOLD_MS + 1, 15 * 60_000, false), { ok: true }, "after 15 minutes it is free");
  r.releaseTicker("HOLDUP", b);
  assert.deepEqual(r.reserveTicker("HOLDUP", a, null, now + UNPROVEN_HOLD_MS + 1, 15 * 60_000, false), { ok: true }, "its own creator still may");
  r.releaseTicker("HOLDUP", a);
  const sentAt = now + UNPROVEN_HOLD_MS;
  r.recordCreateSent(d.mint, "5".repeat(88), sentAt);
  assert.ok(!r.unprovenDraftMints(sentAt + 1000).has(d.mint), "a fresh sent create counts as proof");
  assert.deepEqual(r.reserveTicker("HOLDUP", b, null, sentAt + 1000, 15 * 60_000, true), { ok: false, heldBy: "token" }, "a sent draft holds against everyone while it can land");
  // HB-187: a send older than SENT_HOLD_MS proves nothing by itself (signing costs nothing); only the chain can make it hold from then on
  assert.ok(r.unprovenDraftMints(sentAt + SENT_HOLD_MS + 1).has(d.mint), "an old send no longer counts");
  assert.deepEqual(r.reserveTicker("HOLDUP", b, null, sentAt + SENT_HOLD_MS + 1, 15 * 60_000, true), { ok: true }, "an old unlanded send holds nothing against a proven caller");
  r.releaseTicker("HOLDUP", b);
  // a draft written without the mark (every in-process caller, every row before this change) holds as before
  const old = r.register(regInput(r, "OLDWAY", a, false), now);
  assert.equal(r.getStatus(UNPROVEN_DRAFT_PREFIX + old.mint), null);
  assert.deepEqual(r.reserveTicker("OLDWAY", b, null, now + 1000, 15 * 60_000, true), { ok: false, heldBy: "token" });
});

test("lookalike rows: an unproven draft is expired for a proven caller and after 15 minutes for anyone", async () => {
  const { registry: r } = await makeWorld();
  const now = Date.now();
  r.register(regInput(r, "LOOKUP", wallet(), true), now);
  const st = (proven: boolean, at: number) => lookalikeRows(r, at, proven).find((x) => x.ticker === "LOOKUP")!.status;
  assert.equal(st(false, now + 1000), "draft");
  assert.equal(st(true, now + 1000), "expired");
  assert.equal(st(false, now + UNPROVEN_HOLD_MS + 1), "expired");
});

// LA7 fix A (2026-10-20): the review's ticker check reads the same B-19 hold as the prepare. A stranger's unproven draft held a ticker
// for the full 24 hours at review, so the page's automatic swap moved every creator off a predictable generated ticker.
describe("the launch review applies the unproven-draft hold", () => {
  const review = async (ticker: string, extra: Record<string, unknown> = {}) => {
    const { POST } = await import("../src/app/api/burnticker/v1/launch/review/route.ts");
    limiter.reset();
    const res = await POST(new Request("http://bt.test/api/burnticker/v1/launch/review", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", "x-forwarded-for": "203.0.113.40" }, body: JSON.stringify({ rule: RULE, ticker, name: `${ticker} coin`, raiseSol: "85", ...extra }) }));
    const j = await res.json() as { tickers?: TickerCheck[] };
    assert.equal(res.status, 200, JSON.stringify(j));
    return j.tickers!.find((t) => t.side === "A")!;
  };

  test("a stranger's unproven draft older than 15 minutes does not read taken, and the page keeps the generated ticker", async () => {
    const { registry: r } = await makeWorld();
    r.register(regInput(r, "SQWTOLD", wallet(), true), Date.now() - UNPROVEN_HOLD_MS - 60_000);
    const chk = await review("SQWTOLD");
    assert.equal(chk.taken, false, JSON.stringify(chk));
    assert.equal(chk.warning, null);
    assert.deepEqual(autoTickerSwaps([chk], { a: "SQWTOLD", b: "" }, true), {}, "no automatic swap off a ticker whose unproven hold has run out");
  });

  test("inside its 15 minutes an unproven draft reads taken with the prepare's own sentence and the time it frees up", async () => {
    const { registry: r } = await makeWorld();
    const at = Date.now() - 5 * 60_000;
    r.register(regInput(r, "SQWTNEW", wallet(), true), at);
    const chk = await review("SQWTNEW");
    assert.equal(chk.taken, true);
    assert.match(chk.warning ?? "", /^\$SQWTNEW is held by a launch that has not been signed yet\. It frees up at \d{1,2} [A-Z][a-z]+ \d{4}, \d{2}:\d{2} UTC, in (10|11) minutes, or you can pick another ticker\.$/);
    assert.equal(chk.freesAt, new Date(at + UNPROVEN_HOLD_MS).toISOString());
    assert.deepEqual(lintCopy(chk.warning!).hits, []);
  });

  test("a proven draft holds at review for its whole lifetime; one past 24 hours holds nothing", async () => {
    const { registry: r } = await makeWorld();
    r.register(regInput(r, "PRVHELD", wallet(), false), Date.now() - 2 * 60 * 60_000);
    const held = await review("PRVHELD");
    assert.equal(held.taken, true);
    assert.equal(held.freesAt, undefined);
    assert.match(held.warning ?? "", /already the ticker of another/);
    assert.ok(autoTickerSwaps([held], { a: "PRVHELD", b: "" }, true).a, "a truly held generated ticker is still swapped");
    r.register(regInput(r, "PRVGONE", wallet(), false), Date.now() - DRAFT_TTL_MS - 60_000);
    assert.equal((await review("PRVGONE")).taken, false);
  });

  test("the caller's own proven draft does not read taken; the route reads the held rows, not raw drafts", async () => {
    const { registry: r } = await makeWorld();
    const mine = wallet();
    r.register(regInput(r, "MYOWNDR", mine, false), Date.now() - 60 * 60_000);
    const rows = heldTickerRows(r, "MYOWNDR");
    assert.equal(rows.length, 1);
    const [chk] = tickerChecks([{ side: "A", ticker: "MYOWNDR" }], { inUse: (t) => heldTickerRows(r, t), reserved: new Set(), existing: lookalikeRows(r), creator: mine });
    assert.equal(chk.taken, false);
    const src = fs.readFileSync(new URL("../src/app/api/burnticker/v1/launch/review/route.ts", import.meta.url), "utf8");
    assert.match(src, /inUse: \(t\) => heldTickerRows\(reg, t\)/);
    assert.doesNotMatch(src, /reg\.tokensByTicker\(/);
  });
});
