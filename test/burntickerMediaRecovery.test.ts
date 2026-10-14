// LAUNCH AUDIT 228–240 and 250 (launch-media-recovery, 2026-10-12): the signing card and the recovery notice after a reload. Each [FIX]
// is reproduced here first; each [VERIFY] is either a passing check ("verified working") or the defect it exposed. Nothing here builds a
// real transaction for a network or sends one: the chain, the wallet and the launch route are fakes.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { abandonedSentence, launchlabPlan, listStoredLaunches, loadPlanRecord, memoryPlanStorage, pinReadProblems, planStorageKey, recoverStoredLaunch, signAndSendPlan, storedLaunchSentence, withPlanLock, SESSION_SCOPE_LINE, type LaunchlabBundleLike, type PlanStorage } from "@/lib/burnticker/signPlan";
import { afterRecoveryCheck, archivePlanRecord, checkedAtSentence, readLaunchHistory, recoveryErrorSentence, storedLaunchAction, LAUNCH_HISTORY_KEY } from "@/lib/burnticker/launchRecovery";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const BH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";
const creatorKp = Keypair.generate(), CREATOR = creatorKp.publicKey.toBase58();
const cfg = loadCopyLintConfig();

const b58 = (bytes: Uint8Array) => { const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; const Z = BigInt(0), B = BigInt(58); let x = BigInt("0x" + Buffer.from(bytes).toString("hex")), s = ""; while (x > Z) { s = A[Number(x % B)] + s; x /= B; } return s; };
const bundle = (ticker: string): LaunchlabBundleLike => {
  const mint = Keypair.generate();
  const ix = (signer: string) => ({ programId: "11111111111111111111111111111111", label: "test", dataBase64: Buffer.from([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]).toString("base64"), keys: [{ pubkey: CREATOR, isSigner: true, isWritable: true }, { pubkey: signer, isSigner: true, isWritable: true }] });
  return { mint: mint.publicKey.toBase58(), ticker, ready: true, pending: [], mintSecretKey: b58(mint.secretKey), transactions: [{ label: "create", signers: ["creator", "mint"], instructions: [ix(mint.publicKey.toBase58())] }, { label: "set up", signers: ["creator"], instructions: [ix(CREATOR)] }] };
};
/** a single coin whose only step is its create (the record asks for the launch to be recorded as soon as that step lands) */
const bundle1 = (ticker: string): LaunchlabBundleLike => { const b = bundle(ticker); return { ...b, transactions: b.transactions.slice(0, 1) }; };
/** a fake chain: every send lands; `refuseAt` makes the wallet decline that send number; `chainErrAt` makes that send fail on chain */
const deps = (log: string[], o: { refuseAt?: number; chainErrAt?: number; store?: PlanStorage; slowWallet?: Promise<void> } = {}) => {
  let n = 0;
  return {
    latestBlockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 1 }),
    signTransaction: async (tx: VersionedTransaction) => { if (o.slowWallet) await o.slowWallet; if (o.refuseAt === n) throw new Error("User rejected the request."); log.push(`wallet ${n}`); tx.sign([creatorKp]); return tx; },
    lookupTable: async () => null,
    sendRaw: async () => { n++; log.push(`send ${n}`); return `sig${n}`; },
    confirm: async () => ({ err: o.chainErrAt === n ? { InstructionError: [0, "Custom"] } : null }),
    storage: o.store ?? null,
  };
};
const okFetch = (posts: string[]) => async (_u: string, init: { body: string }) => { posts.push(init.body); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }; };

describe("232 [FIX] the abandoned sentence speaks per coin (A created, B not)", () => {
  test("create A confirmed, B never created: A is named as created and unrecorded, B as not created; never 'nothing is live'", async () => {
    const store = memoryPlanStorage(), coins = [bundle("AYE"), bundle("BEE")];
    await signAndSendPlan(launchlabPlan(coins), CREATOR, { ...deps([], { refuseAt: 1 }), storage: store });
    const reloaded = launchlabPlan(coins.map((c) => ({ ...c, mintSecretKey: null })));
    const r = await signAndSendPlan(reloaded, CREATOR, { ...deps([]), storage: store });
    assert.equal(r.state, "abandoned");
    assert.match(r.error!, /\$AYE was created on chain, but it is not recorded from this plan\. \$BEE was not created\./);
    assert.doesNotMatch(r.error!, /Nothing from this plan is live/);
    const listed = listStoredLaunches(store);
    assert.match(storedLaunchSentence(listed[0]), /\$AYE was created on chain.*\$BEE was not created/);
    assert.ok(lintCopy(r.error!, cfg).ok, r.error!);
  });
  test("nothing created and everything created still read as before", () => {
    const confirms = [{ mint: "A", ticker: "AYE", step: 0 }, { mint: "B", ticker: "BEE", step: 2 }];
    assert.match(abandonedSentence({ confirmed: [], paid: [], confirms, steps: 4 }), /Nothing from this plan is live until the create step confirms/);
    assert.match(abandonedSentence({ confirmed: ["s1", "s2", "s3"], paid: [], confirms, steps: 4 }), /Its create steps are confirmed, but the launch is not recorded from this plan/);
  });
});

describe("236 network transaction fees, with rent named as separate", () => {
  test("the fee line says network transaction fees and that rent is not counted", () => {
    const s = abandonedSentence({ confirmed: ["s1"], paid: [{ step: 0, signature: "s1", lamports: 10_000 }], confirms: [{ mint: "A", ticker: "AYE", step: 0 }], steps: 2 });
    assert.match(s, /The network transaction fees already paid come to 0\.00001 SOL\. Rent held by any account the plan created is separate and is not counted here\./);
    assert.doesNotMatch(s, /The fee already spent/);
    assert.ok(lintCopy(s, cfg).ok, s);
  });
});

describe("235 [VERIFY] a restart never sends a second create for a side already created", () => {
  test("B's create rejected in the wallet; the second press resumes at B and never rebuilds A (one wallet prompt for A in all)", async () => {
    const store = memoryPlanStorage(), plan = launchlabPlan([bundle("AYE"), bundle("BEE")]), log: string[] = [];
    const first = await signAndSendPlan(plan, CREATOR, { ...deps(log, { refuseAt: 2 }), storage: store });
    assert.deepEqual([first.failedAt, first.signatures.length], [2, 2]);
    const log2: string[] = [];
    const again = await signAndSendPlan(plan, CREATOR, { ...deps(log2), storage: store }, undefined, first.signatures);
    assert.equal(again.error, null);
    assert.deepEqual(log2.filter((x) => x.startsWith("send")).length, 2, "only B's two steps were sent on the second press");
    assert.deepEqual(again.signatures.slice(0, 2), first.signatures.slice(0, 2), "A's confirmed signatures are kept, not replaced");
  });
  test("after a reload the keys are gone: no step is built, so a created side cannot be created twice from the old plan", async () => {
    const store = memoryPlanStorage(), coins = [bundle("AYE"), bundle("BEE")];
    await signAndSendPlan(launchlabPlan(coins), CREATOR, { ...deps([], { refuseAt: 2 }), storage: store });
    const log: string[] = [];
    const r = await signAndSendPlan(launchlabPlan(coins.map((c) => ({ ...c, mintSecretKey: null }))), CREATOR, { ...deps(log), storage: store });
    assert.deepEqual([r.state, log], ["abandoned", []]);
  });
});

describe("234 a new plan keeps a read-only history of signatures and mints, never keys", () => {
  test("archiving drops the live record and keeps mints, tickers and signatures; no transaction bytes and no secret key anywhere", async () => {
    const store = memoryPlanStorage(), coins = [bundle("AYE"), bundle("BEE")], plan = launchlabPlan(coins);
    await signAndSendPlan(plan, CREATOR, { ...deps([], { refuseAt: 2 }), storage: store });
    const key = planStorageKey(plan);
    const confirmedBefore = loadPlanRecord(store, plan)!.confirmed;
    const entry = archivePlanRecord(store, key, 1_000)!;
    assert.equal(store.get(key), null, "the live record is gone, so the notice no longer offers it");
    assert.deepEqual(listStoredLaunches(store), []);
    assert.deepEqual(entry.coins.map((c) => [c.ticker, c.mint]), [["AYE", coins[0].mint], ["BEE", coins[1].mint]]);
    assert.deepEqual(entry.signatures, [{ step: 0, signature: confirmedBefore[0], state: "confirmed" }, { step: 1, signature: confirmedBefore[1], state: "confirmed" }]);
    const raw = store.get(LAUNCH_HISTORY_KEY)!;
    for (const c of coins) assert.ok(!raw.includes(c.mintSecretKey!), "a mint secret key is never written to the history");
    assert.ok(!/"tx"|secret|Secret/.test(raw), raw);
    assert.deepEqual(readLaunchHistory(store).map((h) => h.archivedAt), [1_000]);
    // a second archive of the same key is harmless (nothing to archive), and the history is capped
    assert.equal(archivePlanRecord(store, key, 2_000), null);
    for (let i = 0; i < 30; i++) { store.set(`burnticker.signplan.X${i}`, JSON.stringify({ v: 1, mints: [`M${i}`], confirmed: [], recorded: [], pending: null, failed: null, updatedAt: i, confirms: [{ mint: `M${i}`, ticker: "T", step: 0 }], steps: 1 })); archivePlanRecord(store, `burnticker.signplan.X${i}`, 3_000 + i); }
    assert.equal(readLaunchHistory(store).length, 20);
    assert.equal(readLaunchHistory(store)[0].archivedAt, 3_029, "newest first");
  });
  test("the card's Start a new plan archives before it returns to the review", () => {
    const card = code(read("src/app/burnticker/launch/SignCard.tsx"));
    // launch night 2026-10-13: back to the review with the kept draft (launchDraftStore.ts resumeReviewHref)
    assert.match(card, /const startNewPlan = \(\) => \{ archivePlanRecord\(storage, planStorageKey\(plan\)\); window\.location\.assign\(resumeReviewHref\(window\.location\.pathname\)\); \}/);
  });
});

describe("233 [FIX] an abandoned entry gets a real next step", () => {
  test("pending → check on chain; all confirmed → record; lost keys with steps left → start a new launch (not 'Check on chain' forever)", async () => {
    const store = memoryPlanStorage(), coins = [bundle("AYE"), bundle("BEE")];
    await signAndSendPlan(launchlabPlan(coins), CREATOR, { ...deps([], { refuseAt: 1 }), storage: store });
    const [s] = listStoredLaunches(store);
    // the defect: checking an abandoned entry changes nothing and leaves the same button, forever
    const r = await recoverStoredLaunch(store, s, {}, okFetch([]), () => "x");
    assert.equal(r.done, false);
    assert.equal(storedLaunchAction({ key: s.key, rec: r.rec }), "start-new");
    assert.equal(storedLaunchAction({ key: s.key, rec: { ...r.rec, pending: { step: 1, signature: "p", tx: "", blockhash: BH, lastValidBlockHeight: 1, sentAt: 1 } } }), "check");
    assert.equal(storedLaunchAction({ key: s.key, rec: { ...r.rec, confirmed: ["a", "b", "c", "d"] } }), "record");
    const ui = code(read("src/app/burnticker/launch/LaunchRecovery.tsx"));
    assert.match(ui, /storedLaunchAction\(s\) === "start-new"/);
    assert.match(ui, /archivePlanRecord\(storage, s\.key\)/);
  });
});

describe("228 [FIX] + 229: a finished recovery keeps its completion message and coin links, with when it was checked", () => {
  test("the record is gone from storage, but the notice keeps a finished entry with a link per coin", async () => {
    const store = memoryPlanStorage(), plan = launchlabPlan([bundle("AYE")]);
    await signAndSendPlan(plan, CREATOR, { ...deps([]), storage: store });
    // the card never recorded it (the page reloaded before "launched" was posted)
    const [s] = listStoredLaunches(store);
    const posts: string[] = [];
    const r = await recoverStoredLaunch(store, s, {}, okFetch(posts), () => "x");
    assert.equal(r.done, true); assert.equal(posts.length, 1);
    const next = afterRecoveryCheck({ items: [s], finished: [] }, s, r, listStoredLaunches(store), Date.UTC(2026, 0, 1, 19, 5));
    assert.deepEqual(next.items, []);
    assert.equal(next.finished.length, 1, "the finished launch is still shown");
    assert.deepEqual(next.finished[0].coins, [{ ticker: "AYE", href: "/burnticker/t/AYE" }]);
    assert.match(next.finished[0].text, /everything is confirmed on chain and recorded/);
    assert.match(next.finished[0].checked, /^Last checked at \d{1,2}:\d{2}\s?(AM|PM)\.$/);
    const ui = code(read("src/app/burnticker/launch/LaunchRecovery.tsx"));
    assert.match(ui, /afterRecoveryCheck\(/);
    assert.match(ui, /data-launch-finished/);
    assert.match(ui, /Open \$\{c\.ticker\}|Open \$\{?c\.ticker/);
  });
  test("the checked-at line is a time of day only, in plain words", () => {
    assert.match(checkedAtSentence(Date.UTC(2026, 0, 1, 19, 5)), /^Last checked at \d{1,2}:05\s?(AM|PM)\.$/);
  });
});

describe("230 the single-coin card shows a completion card with Open coin instead of a forced redirect", () => {
  test("no timed window.location.assign to the coin page; an Open link per coin", () => {
    const card = code(read("src/app/burnticker/launch/SignCard.tsx"));
    assert.doesNotMatch(card, /setTimeout\(\(\) => window\.location\.assign\(coinHref/);
    assert.doesNotMatch(card, /opening its page/);
    assert.match(card, /data-launch-complete/);
    assert.match(card, />Open \$\{c\.ticker\}</);
  });
});

describe("231 [FIX] the lookup-table setting read failure is retried in place, never by a reload", () => {
  test("the problem sentence no longer says to reload, and the card re-reads on a button", () => {
    assert.deepEqual(pinReadProblems({ devnet: {} }), []);
    assert.match(pinReadProblems(undefined)[0], /still reading/);
    const failed = pinReadProblems(null)[0];
    assert.doesNotMatch(failed, /reload/i);
    assert.match(failed, /Read the setting again/);
    assert.ok(lintCopy(failed, cfg).ok, failed);
    const card = code(read("src/app/burnticker/launch/SignCard.tsx"));
    assert.doesNotMatch(card, /reload the page to try again/);
    assert.match(card, /pinReadProblems\(pins\)/);
    assert.match(card, /setPinTry\(\(x\) => x \+ 1\)/);
    assert.match(card, /\}, \[pinTry\]\);/);
  });
});

describe("237 [VERIFY] a recovery exception never claims 'nothing changed' when something did", () => {
  test("the check adopts a landed step, then the record call throws: the sentence says what is saved, not 'nothing changed'", async () => {
    const store = memoryPlanStorage(), plan = launchlabPlan([bundle1("AYE")]);
    await signAndSendPlan(plan, CREATOR, { ...deps([]), confirm: async () => { throw new Error("timeout"); }, storage: store });
    const [s] = listStoredLaunches(store);
    const before = store.get(s.key);
    // one step pending; the chain says it landed; then the recording throws partway (a broken response)
    const broken = async () => ({ ok: false, status: 500, headers: { get: (): string | null => { throw new Error("broken headers"); } }, json: async () => null });
    await assert.rejects(recoverStoredLaunch(store, s, { getSignatureStatus: async () => ({ err: null, confirmationStatus: "confirmed" }), getBlockHeight: async () => 1 }, broken, (_a, _b, ra) => String(ra)));
    const changed = store.get(s.key) !== before;
    assert.equal(changed, true, "the adopted step was saved before the throw");
    assert.doesNotMatch(recoveryErrorSentence(changed, new Error("broken headers")), /nothing changed/i);
    assert.match(recoveryErrorSentence(false, new Error("rpc down")), /Nothing changed/);
    const ui = code(read("src/app/burnticker/launch/LaunchRecovery.tsx"));
    assert.doesNotMatch(ui, /nothing changed\. Try again/);
    assert.match(ui, /recoveryErrorSentence\(/);
  });
});

describe("238 [VERIFY] replaying a completed recovery is harmless", () => {
  test("a second check with the stale entry posts nothing and does not bring the record back", async () => {
    const store = memoryPlanStorage(), plan = launchlabPlan([bundle1("AYE")]);
    await signAndSendPlan(plan, CREATOR, { ...deps([]), confirm: async () => { throw new Error("timeout"); }, storage: store });
    const [s] = listStoredLaunches(store);
    const posts: string[] = [];
    const chain = { getSignatureStatus: async () => ({ err: null, confirmationStatus: "confirmed" }), getBlockHeight: async () => 1 };
    const first = await recoverStoredLaunch(store, s, chain, okFetch(posts), () => "x");
    assert.equal(first.done, true); assert.equal(posts.length, 1); assert.equal(store.get(s.key), null);
    const again = await recoverStoredLaunch(store, s, chain, okFetch(posts), () => "x");
    assert.equal(posts.length, 1, "nothing is posted a second time");
    assert.equal(store.get(s.key), null, "the finished record is not written back");
    assert.deepEqual(listStoredLaunches(store), []);
    assert.equal(again.done, true);
  });
});

describe("239 [VERIFY] stored indices are validated without shifting their meaning", () => {
  const base = { v: 1, mints: ["A", "B"], recorded: [], pending: null, failed: null, updatedAt: 1, confirms: [{ mint: "A", ticker: "AYE", step: 0 }, { mint: "B", ticker: "BEE", step: 2 }], steps: 4 };
  test("a malformed confirmed list is refused, never compacted (compacting moves step 3's signature to step 2)", () => {
    const store = memoryPlanStorage();
    store.set("burnticker.signplan.A+B", JSON.stringify({ ...base, confirmed: ["s1", 7, "s3"] }));
    assert.deepEqual(listStoredLaunches(store), []);
  });
  test("a confirm whose step is out of range, a pending step out of range, or a bad stepSigners entry: refused", () => {
    for (const bad of [{ confirms: [...base.confirms, { mint: "C", ticker: "SEA", step: 9 }] }, { confirms: [{ mint: "A", ticker: "AYE", step: 0 }, { mint: 5, ticker: "BEE", step: 2 }] }, { pending: { step: 7, signature: "p", tx: "", blockhash: BH, lastValidBlockHeight: 1, sentAt: 1 } }, { stepSigners: [2, "x", 1, 1] }, { confirmed: ["s1", "s2", "s3", "s4", "s5"] }]) {
      const store = memoryPlanStorage();
      store.set("burnticker.signplan.A+B", JSON.stringify({ ...base, confirmed: ["s1"], ...bad }));
      assert.deepEqual(listStoredLaunches(store), [], JSON.stringify(bad));
    }
  });
  test("a well-formed record still lists, unchanged", () => {
    const store = memoryPlanStorage();
    store.set("burnticker.signplan.A+B", JSON.stringify({ ...base, confirmed: ["s1"], stepSigners: [2, 1, 2, 1] }));
    const [s] = listStoredLaunches(store);
    assert.deepEqual([s.rec.confirmed, s.rec.confirms.map((c) => c.step), s.rec.stepSigners], [["s1"], [0, 2], [2, 1, 2, 1]]);
  });
});

describe("240 the session scope is said before signing", () => {
  test("one line beside the sign button: this tab only, keys never saved", () => {
    assert.match(SESSION_SCOPE_LINE, /this browser tab/);
    assert.match(SESSION_SCOPE_LINE, /mint keys are never saved/);
    assert.ok(lintCopy(SESSION_SCOPE_LINE, cfg).ok, SESSION_SCOPE_LINE);
    assert.doesNotMatch(SESSION_SCOPE_LINE, /\bwill\b/);
    assert.match(code(read("src/app/burnticker/launch/SignCard.tsx")), /\{SESSION_SCOPE_LINE\}/);
  });
});

describe("250 [VERIFY] overlapping signing runs are guarded beyond the React busy flag", () => {
  test("two presses in the same render (both see busy = false) start one run; the second is refused while the first holds the lock", async () => {
    const store = memoryPlanStorage(), plan = launchlabPlan([bundle("AYE")]), log: string[] = [];
    let release!: () => void; const slow = new Promise<void>((r) => { release = r; });
    const key = planStorageKey(plan);
    const one = withPlanLock(key, () => signAndSendPlan(plan, CREATOR, { ...deps(log, { slowWallet: slow }), storage: store }));
    const two = await withPlanLock(key, () => signAndSendPlan(plan, CREATOR, { ...deps(log), storage: store }));
    assert.equal(two.ran, false, "the second run never started");
    release();
    const r1 = await one;
    assert.equal(r1.ran, true);
    assert.equal(log.filter((x) => x.startsWith("send")).length, 2, "one run's two steps, sent once");
    assert.equal((await withPlanLock(key, async () => 1)).ran, true, "the lock is released when the run ends");
    await assert.rejects(withPlanLock(key, async () => { throw new Error("boom"); }));
    assert.equal((await withPlanLock(key, async () => 1)).ran, true, "and when it throws");
  });
  test("the card and the recovery notice both take the lock", () => {
    assert.match(code(read("src/app/burnticker/launch/SignCard.tsx")), /withPlanLock\(planStorageKey\(plan\)/);
    assert.match(code(read("src/app/burnticker/launch/LaunchRecovery.tsx")), /withPlanLock\(s\.key/);
  });
});

test("the stored record never holds a key (the plan's mint keys stay in memory)", async () => {
  const store = memoryPlanStorage(), b = bundle("AYE"), plan = launchlabPlan([b]);
  await signAndSendPlan(plan, CREATOR, { ...deps([], { refuseAt: 1 }), storage: store });
  assert.ok(!store.get(planStorageKey(plan))!.includes(b.mintSecretKey!));
  assert.ok(loadPlanRecord(store, plan));
});
