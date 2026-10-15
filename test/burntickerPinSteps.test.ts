// WIRING-ROUND5 items 1 to 4 (2026-10-13): a coin that burns a real token, through the launch bundle, the pair curve, the signing plan and
// the review. The pin (pin_burn_target) runs after initialize_token and before the coin's mint exists: on LaunchLab it rides with
// initialize_token and the create follows in a second transaction (init + pin + create is over the packet limit); on the pair curve the
// side's one transaction becomes initialize_token, pin, then the mint. A LaunchLab coin that burns itself is two transactions as well
// since 2026-10-15 (its rule locked, then the coin created), with no pin anywhere. Side B of a
// pair carries its own pinned token (never side A's). The review counts the pin (a step the page recognises, the rent, the signatures).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { BURN_TARGET_ACCOUNT_BYTES, PIN_IX_LABEL_PREFIX, PIN_STEP_NOTE } from "@/lib/burnticker/burnTarget";
import { buildLaunchBundle, buildPairBundles, FakeLaunchLab, launchTransactions } from "@/lib/burnticker/launchBundle";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { launchlabPlan } from "@/lib/burnticker/signPlan";
import { v0WireSize } from "@/lib/burnticker/lookupTable";
import { lockRule } from "@/lib/burnticker/rules";
import { rentLamports } from "@/lib/burnticker/launchCost";
import { prepareLaunch } from "@/lib/burnticker/api/handlers";
import { withPinSteps } from "@/app/burnticker/launch/burnReal";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { launchlabPair, pairCurveSet, singleCoin } from "./burntickerLutFixtures.ts";
import { BRONCOS } from "./burntickerHelpers.ts";
import { CREATOR, makeWorld } from "./burntickerApiHelpers.ts";

const BONK = { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", pool: "HVNwzt7Pxfu76KHCMQPTLuTCLTm6WnQ1esLv4eizseSv", symbol: "BONK", feedId: "72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419" };
const WIF = { mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", pool: "EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2eLKkirfPm5eyMx", symbol: "WIF", feedId: "4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc" };
const PACKET = 1232;
const PIN_MARK = /^Pin .+'s Raydium pool for \$/;
const cfg = loadCopyLintConfig();
const plain = (t: string) => { assert.deepEqual(lintCopy(t, cfg).hits.map((h) => h.rule), [], t); assert.doesNotMatch(t, /\bbuy|\bprice\b|\bwill\b|\btarget/i, t); };
const isPin = (label: string) => label.startsWith(PIN_IX_LABEL_PREFIX);
const isInit = (label: string) => label.startsWith("burn_receipts.initialize_token");

const fakeDeps = (program = new FakeBurnProgram("devnet")) => ({ program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [CREATOR], quorum: 1, metadataUri: (m: string) => `https://x/${m}.json` });
const input = (rule: unknown, firstBuySol = "0") => ({ creator: CREATOR, ticker: "TEAMBONK", name: "Team Bonk", description: "a test", imageUrl: null, links: [], rule, firstBuySol, acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" as const });

describe("the BurnTarget account", () => {
  test("373 bytes: 8 + the IDL's own BurnTarget fields (the review's rent reads this number)", () => {
    const t = (BURN_RECEIPTS_IDL as unknown as { types: { name: string; type: { fields: { type: unknown }[] } }[] }).types.find((x) => x.name === "BurnTarget")!;
    const size = (ty: unknown): number => {
      if (typeof ty === "string") return ({ u8: 1, bool: 1, u16: 2, u32: 4, i32: 4, u64: 8, i64: 8, pubkey: 32 } as Record<string, number>)[ty] ?? NaN;
      const a = (ty as { array?: [unknown, number] }).array;
      return a ? size(a[0]) * a[1] : NaN;
    };
    assert.equal(8 + t.type.fields.reduce((s, f) => s + size(f.type), 0), BURN_TARGET_ACCOUNT_BYTES);
  });
});

describe("the LaunchLab bundle (item 2)", () => {
  test("a coin that burns itself (2026-10-15): [initialize_token], then [the create], both signed by the creator and the mint, no pin", async () => {
    const b = await buildLaunchBundle(input(BRONCOS), fakeDeps());
    assert.equal(b.transactions.length, 2);
    assert.deepEqual(b.transactions.map((t) => t.label), ["Lock in $TEAMBONK's rule", "Create $TEAMBONK (LaunchLab create)"]);
    assert.deepEqual(b.transactions[0].instructions.map((ix) => isInit(ix.label)), [true]);
    assert.ok(b.transactions[1].instructions.length > 0 && b.transactions[1].instructions.every((ix) => !isInit(ix.label) && !isPin(ix.label)));
    for (const t of b.transactions) assert.deepEqual(t.signers, ["creator", "mint"]);
  });
  test("a coin with a pinned token: [initialize_token, pin_burn_target], then [the create], both signed by the creator and the mint", async () => {
    for (const buy of ["0", "0.5"]) {
      const b = await buildLaunchBundle(input({ ...BRONCOS, burnTarget: BONK }, buy), fakeDeps());
      assert.equal(b.transactions.length, 2);
      const [one, two] = b.transactions;
      assert.deepEqual(one.instructions.map((ix) => (isInit(ix.label) ? "init" : isPin(ix.label) ? "pin" : "other")), ["init", "pin"]);
      assert.ok(two.instructions.length > 0 && two.instructions.every((ix) => !isInit(ix.label) && !isPin(ix.label)));
      assert.match(one.label, PIN_MARK);
      assert.equal(one.label, "Pin BONK's Raydium pool for $TEAMBONK after locking in its rule");
      assert.equal(two.label, `Create $TEAMBONK (LaunchLab create${buy === "0" ? "" : " + first buy"})`);
      for (const t of b.transactions) assert.deepEqual(t.signers, ["creator", "mint"]);
    }
  });
  test("a rule with a pinned token whose program client emitted no pin is refused: the coin would burn itself", async () => {
    class NoPin extends FakeBurnProgram {
      override async initializeToken(i: Parameters<FakeBurnProgram["initializeToken"]>[0]) { const r = await super.initializeToken(i); return { ...r, instructions: r.instructions.filter((ix) => !isPin(ix.label)) }; }
    }
    await assert.rejects(buildLaunchBundle(input({ ...BRONCOS, burnTarget: BONK }), fakeDeps(new NoPin("devnet"))), /did not pin BONK's pool, so the coin would burn itself instead/);
    const locked = lockRule(BRONCOS);
    assert.throws(() => launchTransactions({ ticker: "X", firstBuySol: "0" }, locked, [{ programId: "x", label: `${PIN_IX_LABEL_PREFIX} (stray)`, keys: [], dataBase64: "" }], []), /pinned a burn pool for a rule that burns its own coin/);
  });
  test("every transaction fits one packet as v0 against the lookup table, on both networks, worst-case strings and a first purchase", async () => {
    for (const network of ["devnet", "mainnet"] as const) {
      for (const worst of [false, true]) for (const firstBuySol of ["0", "0.5"]) {
        const { bundle, creator } = await singleCoin(network, { worst, firstBuySol, target: BONK });
        assert.equal(bundle.transactions.length, 2);
        for (const t of bundle.transactions) {
          const n = v0WireSize(t.instructions, creator.publicKey.toBase58(), network);
          assert.ok(n !== null && n <= PACKET, `${network} worst=${worst} buy=${firstBuySol} ${t.label}: ${n}`);
        }
      }
      const { pair, creator } = await launchlabPair(network, Keypair.generate(), true, { a: BONK, b: WIF });
      for (const b of [pair.a, pair.b]) for (const t of b.transactions) {
        const n = v0WireSize(t.instructions, creator.publicKey.toBase58(), network);
        assert.ok(n !== null && n <= PACKET, `${network} pair ${b.ticker} ${t.label}: ${n}`);
      }
    }
  });
  test("the signing plan confirms each coin on the transaction that creates it (the last one its mint signs)", async () => {
    const self = await buildLaunchBundle(input(BRONCOS), fakeDeps());
    const real = await buildLaunchBundle({ ...input({ ...BRONCOS, burnTarget: BONK }), ticker: "TEAMWIF" }, fakeDeps());
    const plan = launchlabPlan([self, real]);
    assert.deepEqual(plan.steps.length, 4);
    assert.deepEqual(plan.confirms.map((c) => [c.ticker, c.step]), [["TEAMBONK", 1], ["TEAMWIF", 3]]);
  });
});

describe("a pair's side B carries its own pinned token (item 1)", () => {
  test("side B gets b.burnTarget in its hashed rule; side A's never reaches side B", async () => {
    const { pair } = await launchlabPair("devnet", Keypair.generate(), false, { a: BONK, b: WIF });
    const ra = lockRule(JSON.parse(pair.a.rules.text)).rule, rb = lockRule(JSON.parse(pair.b.rules.text)).rule;
    assert.deepEqual(ra.burnTarget, BONK); assert.deepEqual(rb.burnTarget, WIF);
    assert.equal(pair.b.transactions[0].label, "Pin WIF's Raydium pool for $PAIRB after locking in its rule and linking the two coins");
    const onlyA = await launchlabPair("devnet", Keypair.generate(), false, { a: BONK });
    assert.equal(lockRule(JSON.parse(onlyA.pair.b.rules.text)).rule.burnTarget, undefined);
    // 2026-10-14 (Phantom review ticket 438485): a pair coin that burns itself is two transactions too, its rule locked (and side B's
    // link made) first, then the create, with no pin anywhere
    assert.deepEqual(onlyA.pair.b.transactions.map((t) => t.label), ["Lock in $PAIRB's rule and link the two coins", "Create $PAIRB (LaunchLab create)"], "side B burns itself: lock, then create");
    assert.ok(onlyA.pair.b.transactions.flatMap((t) => t.instructions).every((ix) => !ix.label.startsWith("burn_receipts.pin_burn_target")));
    const onlyB = await launchlabPair("devnet", Keypair.generate(), false, { b: WIF });
    assert.deepEqual(onlyB.pair.a.transactions.map((t) => t.label), ["Lock in $PAIRA's rule", "Create $PAIRA (LaunchLab create)"]);
    assert.equal(onlyB.pair.b.transactions.length, 2);
  });
  test("the bundle route takes pair.burnTarget, checks its shape and puts it in side B's rule", async () => {
    const w = await makeWorld();
    const RULE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
    const body = { creator: CREATOR, ticker: "MILEHI", name: "Mile High", rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, pair: { ticker: "ARROWHD", name: "Arrowhead", description: "", imageUrl: null, links: [], burnTarget: WIF } };
    const r = await prepareLaunch(w.p, body, { register: false }) as { pair?: { bundles: { a: { rules: { text: string } }; b: { rules: { text: string }; transactions: unknown[] } } }; error?: unknown };
    assert.ok(r.pair, JSON.stringify(r).slice(0, 400));
    assert.deepEqual(JSON.parse(r.pair!.bundles.b.rules.text).burnTarget, WIF);
    assert.equal(JSON.parse(r.pair!.bundles.a.rules.text).burnTarget, undefined);
    assert.equal(r.pair!.bundles.b.transactions.length, 2);
    const bad = await prepareLaunch(w.p, { ...body, ticker: "MILEHJ", pair: { ...body.pair, ticker: "ARROWHE", burnTarget: { ...WIF, mint: "nope" } } }, { register: false }) as { error?: { status: number; body: { error: string; code: string } } };
    assert.equal(bad.error?.status, 400); assert.equal(bad.error?.body.code, "burn-target"); assert.match(bad.error!.body.error, /^Side B: burnTarget\.mint/);
  });
});

describe("the pair curve (item 3)", () => {
  test("a side with a pinned token: initialize_token, then the pin, then the mint; a side that burns itself is unchanged", async () => {
    const plainSet = await pairCurveSet("devnet", Keypair.generate());
    const { pc, creator } = await pairCurveSet("devnet", Keypair.generate(), { a: BONK });
    const kinds = (t: { instructions: { label: string }[] }) => t.instructions.map((ix) => (isInit(ix.label) ? "init" : isPin(ix.label) ? "pin" : ix.label.split(" ")[0]));
    assert.deepEqual(kinds(pc.transactions[0]), ["init", "pin", "system.create_account", "spl_token.initialize_mint2"]);
    assert.deepEqual(kinds(pc.transactions[1]), ["system.create_account", "spl_token.initialize_mint2", "init"]);
    assert.deepEqual(kinds(plainSet.pc.transactions[0]), ["system.create_account", "spl_token.initialize_mint2", "init"]);
    assert.equal(pc.transactions.length, 3);
    for (const network of ["devnet", "mainnet"] as const) {
      const s = network === "devnet" ? { pc, creator } : await pairCurveSet(network, Keypair.generate(), { a: BONK, b: WIF });
      for (const t of s.pc.transactions) { const n = v0WireSize(t.instructions, s.creator.publicKey.toBase58(), network); assert.ok(n !== null && n <= PACKET, `${network} ${t.label}: ${n}`); }
    }
  });
});

describe("the review counts the pin (item 4)", () => {
  const env = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" };
  const review = (body: unknown, e: Record<string, string> = env) => { const r = buildLaunchReview(body as never, { env: e, reserved: new Set() }); assert.ok("review" in r); return (r as { review: Parameters<typeof withPinSteps>[0] }).review; };
  test("single coin: two steps either way, the pin rides in the first; its rent is the only difference in the total; the page adds nothing", () => {
    const self = review({ rule: BRONCOS, ticker: "TEAMBONK", name: "Team Bonk", raiseSol: "85" });
    const real = review({ rule: { ...BRONCOS, burnTarget: BONK }, ticker: "TEAMBONK", name: "Team Bonk", raiseSol: "85" });
    assert.deepEqual(self.pins, []);
    assert.deepEqual(real.transactions.steps.map((s) => s.label), ["Pin BONK's Raydium pool for $TEAMBONK after locking in its rule", "Create $TEAMBONK"]);
    assert.equal(real.transactions.count, 2);
    // 2026-10-15: a coin that burns itself is two steps too ("Lock in $X's rule", "Create $X"), so the pin adds no transaction
    assert.deepEqual(self.transactions.steps.map((s) => s.label), ["Lock in $TEAMBONK's rule", "Create $TEAMBONK"]);
    assert.deepEqual(real.pins, [{ side: "A", ticker: "TEAMBONK", symbol: "BONK", step: 1, bytes: 373, rentSol: real.pins[0].rentSol, signatures: 0 }]);
    const added = rentLamports(BURN_TARGET_ACCOUNT_BYTES);
    const diff = Math.round(Number(real.costs.totalSol) * 1e9) - Math.round(Number(self.costs.totalSol) * 1e9);
    assert.ok(Math.abs(diff - added) <= 50_000, `${diff} vs ${added} (the total is shown to 4 places)`);
    assert.equal(real.costs.lines.length, self.costs.lines.length + 1);
    assert.match(real.costs.lines.find((l) => l.kind === "fee")!.sol, /^0\.00002/);
    assert.ok(real.transactions.note.endsWith(PIN_STEP_NOTE));
    assert.match(real.recovery[0], /asks 2 separate times/);
    assert.equal(withPinSteps(real, [{ ticker: "TEAMBONK", symbol: "BONK" }]), real);
    for (const s of [...real.transactions.steps.map((x) => x.label), ...real.costs.lines.map((x) => x.label), real.transactions.note]) plain(s);
  });
  test("a pair: side B's pair.burnTarget is counted at its own step; a bad field is a Coin B problem", () => {
    const RULE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
    const both = review({ rule: { ...RULE, burnTarget: BONK }, ticker: "MILEHI", name: "Mile High", pair: { ticker: "ARROWHD", name: "Arrowhead", burnTarget: WIF } });
    assert.deepEqual(both.transactions.steps.map((s) => s.label), ["Pin BONK's Raydium pool for $MILEHI after locking in its rule", "Create $MILEHI", "Pin WIF's Raydium pool for $ARROWHD after locking in its rule and linking the two coins", "Create $ARROWHD"]);
    assert.deepEqual(both.pins.map((x) => [x.side, x.symbol, x.step]), [["A", "BONK", 1], ["B", "WIF", 3]]);
    assert.deepEqual((both as unknown as { rules: { side: string; step: number }[] }).rules.map((x) => [x.side, x.step]), [["A", 1], ["B", 3]]);
    const onlyB = review({ rule: RULE, ticker: "MILEHI", name: "Mile High", pair: { ticker: "ARROWHD", name: "Arrowhead", burnTarget: WIF } });
    assert.deepEqual(onlyB.transactions.steps.map((s) => s.label), ["Lock in $MILEHI's rule", "Create $MILEHI", "Pin WIF's Raydium pool for $ARROWHD after locking in its rule and linking the two coins", "Create $ARROWHD"]);
    assert.equal(withPinSteps(onlyB, [{ ticker: "ARROWHD", symbol: "WIF" }]), onlyB);
    // 2026-10-14: a pair review with no pin is four steps (each coin locks its rule, then is created); the page's own pin count puts the
    // pin into side B's existing steps (no extra transaction, so no extra fee), the rent only
    const none = review({ rule: RULE, ticker: "MILEHI", name: "Mile High", pair: { ticker: "ARROWHD", name: "Arrowhead" } });
    assert.deepEqual(none.transactions.steps.map((s) => s.label), ["Lock in $MILEHI's rule", "Create $MILEHI", "Lock in $ARROWHD's rule and link the two coins", "Create $ARROWHD"]);
    const paged = withPinSteps(none, [{ ticker: "ARROWHD", symbol: "WIF" }]);
    assert.deepEqual(paged.transactions.steps.map((s) => s.label), ["Lock in $MILEHI's rule", "Create $MILEHI", "Lock in $ARROWHD's rule and link the two coins", "Pin WIF's Raydium pool for $ARROWHD, then create $ARROWHD and link the two coins"]);
    assert.equal(paged.transactions.count, 4);
    assert.ok(!paged.costs.lines.some((l) => /pin transaction/.test(l.label)), "no extra transaction, so no extra fee line");
    for (const t of [...paged.transactions.steps.map((x) => x.label), ...none.costs.lines.map((x) => x.label)]) plain(t);
    const bad = review({ rule: RULE, ticker: "MILEHI", name: "Mile High", pair: { ticker: "ARROWHD", name: "Arrowhead", burnTarget: { ...WIF, feedId: "WIF" } } });
    assert.ok(bad.problems.some((p) => /^Coin B\. burnTarget\.feedId/.test(p)), bad.problems.join(" | "));
    assert.deepEqual(bad.pins, []);
  });
  test("pair curve: the pin rides in the side's one transaction (no extra signatures), with its rent", () => {
    const RULE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
    const pc = review({ rule: { ...RULE, burnTarget: BONK }, ticker: "MILEHI", name: "Mile High", pair: { ticker: "ARROWHD", name: "Arrowhead" } }, { ...env, BURNTICKER_PAIR_CURVE_ENABLED: "1" });
    assert.equal((pc as unknown as { venue: string }).venue, "pair-curve");
    assert.equal(pc.transactions.count, 3);
    assert.equal(pc.transactions.steps[0].label, "Pin BONK's Raydium pool for $MILEHI after locking in its rule, then create $MILEHI");
    assert.deepEqual(pc.pins.map((x) => [x.side, x.step, x.signatures]), [["A", 1, 0]]);
    plain(pc.transactions.steps[0].label);
  });
});
