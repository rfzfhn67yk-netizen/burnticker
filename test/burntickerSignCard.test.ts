// SIGN AND SEND FOR EVERY LAUNCH (2026-10-11, the public-launch blocker: a single LaunchLab coin ended at an unsigned bundle card). The
// review card's Launch → the bundle(s) from POST /api/burnticker/launch → ONE signing plan (signPlan.ts) → SignCard.tsx: the mint key
// signs, then the wallet, send, confirm, step by step; then `action: "launched"` with the transaction the mint signed; then the coin
// page. The same plan and card sign a pair (two LaunchLab bundles, or the pair-curve set), so single coins and pairs cannot drift.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Keypair, type Transaction } from "@solana/web3.js";
import { limiter } from "@/lib/burnticker/api/http";
import { confirmPlan, launchlabPlan, planConfirmations, planProblems, signAndSendPlan, type LaunchlabBundleLike, type SignPlan } from "@/lib/burnticker/signPlan";
import { launchedErrorMessage } from "@/lib/burnticker/pairLaunchClient";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { gameSeries, teamSeries } from "@/lib/burnticker/sources/espn";
import { polyRule } from "@/lib/burnticker/search";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { DEBT_RULE } from "./burntickerHelpers.ts";
import { makeWorld } from "./burntickerApiHelpers.ts";
import { EAGLES_CID } from "./burntickerPolyHelpers.ts";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const BH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";
const creatorKp = Keypair.generate(), CREATOR = creatorKp.publicKey.toBase58();

const legacy = async (body: Record<string, unknown>) => {
  const { POST } = await import("../src/app/api/burnticker/launch/route.ts");
  const r = await POST(new Request("http://bt.test/api/burnticker/launch", { method: "POST", headers: { host: "bt.test", origin: "http://bt.test", "content-type": "application/json", "x-forwarded-for": `192.0.2.${Math.floor(Math.random() * 200)}` }, body: JSON.stringify(body) }));
  return { status: r.status, json: await r.json() as Record<string, unknown> };
};
const coin = (ticker: string, rule: unknown) => ({ creator: CREATOR, ticker, name: `${ticker} Coin`, description: "", imageUrl: null, links: [], rule, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } });

/** The page's paths, each with the rule the review card would launch (one LaunchLab coin). */
const PATHS: [string, string, unknown][] = [
  ["the sentence search (a feed card)", "DEBTWATCH", DEBT_RULE],
  ["Team coin", "RAYSWINS", firstPartyRule(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 }), 0.02)],
  ["Matchup (one side, this game)", "TBGAME", firstPartyRule(gameSeries("mlb", "401999999", "TB", "loss"), 0.1)],
  ["Any result / Elections (one market, resolves once)", "EAGLEMKT", polyRule(EAGLES_CID, 0.1)],
  ["a template (A public number)", "DEBTTPL", { ...DEBT_RULE, scalar: { ...(DEBT_RULE as { scalar: object }).scalar, perUnit: { fractionOfPool: 0.05 } } }],
];

const fakeDeps = (log: string[], over: Partial<{ refuseAt: number; chainErrAt: number }> = {}) => {
  let n = 0;
  return {
    latestBlockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 1 }),
    signTransaction: async (tx: Transaction) => {
      const pre = tx.signatures.filter((s) => s.signature).length;
      if (over.refuseAt === n) throw new Error("User rejected the request.");
      log.push(`wallet signs (${pre} key signature(s) already on it)`); tx.partialSign(creatorKp); return tx;
    },
    sendRaw: async () => { n++; log.push(`send ${n}`); return `sig${n}`; },
    confirm: async () => ({ err: over.chainErrAt === n ? { InstructionError: [0, "Custom"] } : null }),
  };
};

describe("one signing plan for every launch path", () => {
  for (const [label, ticker, rule] of PATHS) test(`${label}: Launch → bundle → the mint key signs, then the wallet → sent → "launched" with that transaction`, async () => {
    await makeWorld(); limiter.reset();
    const r = await legacy(coin(ticker, rule));
    assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 300));
    const b = r.json.bundle as LaunchlabBundleLike;
    assert.ok(b.mintSecretKey, "the bundle hands over its fresh mint key");
    const plan = launchlabPlan([b]);
    assert.ok(plan.steps.length >= 1);
    assert.deepEqual(plan.confirms.map((c) => c.mint), [b.mint]);
    assert.ok(plan.steps[plan.confirms[0].step].signers.includes("mint"), "the confirming step is the one the mint signs (launchVerify)");
    assert.deepEqual(planProblems({ ...plan, pending: [] }, CREATOR), [], "the key matches the mint; only the host's pending pieces remain");
    assert.deepEqual(plan.pending, b.ready ? [] : b.pending, "a bundle that is not ready says why and is not signed");
    const log: string[] = [];
    const s = await signAndSendPlan(plan, CREATOR, fakeDeps(log));
    assert.equal(s.error, null);
    assert.ok(log[0].startsWith("wallet signs (1 key"), "the mint key signed before the wallet saw it");
    assert.deepEqual(planConfirmations(plan, s.signatures), [{ mint: b.mint, launchTx: s.signatures[plan.confirms[0].step] }]);
  });

  test("two coins (a matchup this season, or a pair with the pair curve off): A's steps then B's, each confirmed by its own create", async () => {
    await makeWorld(); limiter.reset();
    const a = (await legacy(coin("TBSEASON", firstPartyRule(teamSeries("mlb", "TB", "loss", { kind: "season", year: 2026 }), 0.02)))).json.bundle as LaunchlabBundleLike;
    const b = (await legacy(coin("NYYSEASON", firstPartyRule(teamSeries("mlb", "NYY", "loss", { kind: "season", year: 2026 }), 0.02)))).json.bundle as LaunchlabBundleLike;
    const plan = launchlabPlan([a, b]);
    assert.deepEqual(plan.confirms.map((c) => [c.ticker, c.step]), [["TBSEASON", 0], ["NYYSEASON", a.transactions.length]]);
    assert.deepEqual(Object.keys(plan.keys).sort(), ["mint0", "mint1"]);
    const s = await signAndSendPlan(plan, CREATOR, fakeDeps([]));
    assert.equal(s.signatures.length, plan.steps.length);
  });
});

describe("failures: never half-signed, resume at the failed step, plain sentences", () => {
  const bundle = (): LaunchlabBundleLike => {
    const mint = Keypair.generate();
    const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; const Z = BigInt(0), B58 = BigInt(58); let x = BigInt("0x" + Buffer.from(mint.secretKey).toString("hex")), secret = ""; while (x > Z) { secret = A[Number(x % B58)] + secret; x /= B58; }
    const ix = (signer: string) => ({ programId: "11111111111111111111111111111111", label: "test", dataBase64: Buffer.from([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]).toString("base64"), keys: [{ pubkey: CREATOR, isSigner: true, isWritable: true }, { pubkey: signer, isSigner: true, isWritable: true }] });
    return { mint: mint.publicKey.toBase58(), ticker: "TEST", ready: true, pending: [], mintSecretKey: secret, transactions: [{ label: "create", signers: ["creator", "mint"], instructions: [ix(mint.publicKey.toBase58())] }, { label: "first buy", signers: ["creator"], instructions: [ix(CREATOR)] }] };
  };

  test("a missing or wrong mint key is refused before anything reaches the wallet", async () => {
    const b = bundle();
    assert.ok(planProblems(launchlabPlan([{ ...b, mintSecretKey: null }]), CREATOR).some((p) => /did not hand over the mint key/.test(p)));
    assert.ok(planProblems(launchlabPlan([{ ...b, mint: Keypair.generate().publicKey.toBase58() }]), CREATOR).some((p) => /does not match/.test(p)));
    const log: string[] = [];
    const r = await signAndSendPlan(launchlabPlan([{ ...b, mintSecretKey: null }]), CREATOR, fakeDeps(log));
    assert.deepEqual([r.failedAt, log], [0, []], "nothing signed by the wallet, nothing sent");
  });

  test("a refusal in the wallet stops at that step; the next press resumes there; a chain error says so", async () => {
    const plan = launchlabPlan([bundle()]);
    const log: string[] = [];
    const first = await signAndSendPlan(plan, CREATOR, fakeDeps(log, { refuseAt: 1 }));
    assert.deepEqual([first.signatures, first.failedAt, first.error], [["sig1"], 1, "step 2 of 2 was not signed in the wallet"]);
    const again = await signAndSendPlan(plan, CREATOR, fakeDeps(log), undefined, first.signatures);
    assert.equal(again.signatures.length, 2); assert.equal(log.filter((l) => l.startsWith("send")).length, 2, "step 1 sent once");
    const chain = await signAndSendPlan(plan, CREATOR, fakeDeps([], { chainErrAt: 1 }));
    assert.match(chain.error!, /step 1 of 2 failed: the chain rejected it/);
  });

  test('"launched": 404 retried (~5 × 4 s), then 200; 409 / 422 / 429 / 503 stop with a plain sentence; a live coin is not re-sent', async () => {
    const plan: SignPlan = launchlabPlan([bundle()]);
    const reply = (status: number, body: unknown = {}) => ({ ok: status === 200, status, headers: { get: (h: string) => (h === "retry-after" ? "900" : null) }, json: async () => body });
    let n = 0, waits = 0;
    const ok = await confirmPlan(async () => (++n <= 3 ? reply(404) : reply(200, { ok: true })), plan, ["sig1", "sig2"], launchedErrorMessage, { sleep: async (ms) => { waits += ms; } });
    assert.deepEqual([ok.error, ok.confirmed.length, n, waits], [null, 1, 4, 12000]);
    const cfg = loadCopyLintConfig();
    for (const [st, code, re] of [[409, "", /already recorded as launched/], [422, "launch-unverified", /did not accept that transaction/], [429, "rate-limited", /Try again in about 15 minutes/], [503, "launch-unverifiable", /cannot confirm launches yet/]] as const) {
      const r = await confirmPlan(async () => reply(st, { code }), plan, ["sig1", "sig2"], launchedErrorMessage, { sleep: async () => {} });
      assert.match(r.error!, re); assert.ok(lintCopy(r.error!, cfg).ok, r.error!);
    }
    let calls = 0;
    await confirmPlan(async () => { calls++; return reply(200); }, plan, ["sig1", "sig2"], launchedErrorMessage, { already: [plan.confirms[0].mint] });
    assert.equal(calls, 0);
  });
});

describe("the page and the tile reach the same signing card", () => {
  test("every Launch ends on SignCard: one coin, two coins and the pair curve; the old pair-only card is gone", () => {
    const page = read("src/app/burnticker/launch/page.tsx"), tile = read("src/app/burnticker/launch/CoinVsCoinTile.tsx"), card = read("src/app/burnticker/launch/SignCard.tsx");
    assert.match(page, /setStep\("launch"\)/, "the review card's Launch moves to the sign step after the bundle arrives");
    assert.match(page, /pcOut \? pairCurvePlan\(.*\) : pairOut \? launchlabPlan\(\[pairOut\.a, pairOut\.b\]\) : launchlabPlan\(\[bundle!\]\)/);
    assert.equal((page.match(/<SignCard\b/g) ?? []).length, 1); assert.equal((tile.match(/<SignCard\b/g) ?? []).length, 1);
    assert.ok(!fs.existsSync(path.join(ROOT, "src/app/burnticker/launch/PairCurveSign.tsx")));
    assert.match(card, /signAndSendPlan\(/); assert.match(card, /confirmPlan\(/);
    assert.ok(!/odds|price|chance/i.test(card.replace(/\/\*[\s\S]*?\*\//g, "")), "no odds or prices on the signing card");
  });
});
