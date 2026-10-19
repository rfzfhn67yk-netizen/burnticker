// The synthetic creator and the deploy smoke (2026-10-15; owner, 2026-10-14 night: "can you write a program that will catch all these
// bugs?"): the test wallet's modes against the page's own integrity check, the launch route's dryRun, the synthetic flag that hides the
// creator's coins, the bt-synthetic-failed push and its copy, the deploy-window sentence, and the source pins on publish-and-deploy.sh.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AddressLookupTableAccount, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { walletReturnProblem, type SignStep } from "@/lib/burnticker/signPlan";
import { openRegistry } from "@/lib/burnticker/registry";
import { registryTestCoins, testCoinKeys, withoutTestCoins } from "@/lib/burnticker/testCoins";
import { PUSH_KIND_OF_ALERT, PUSH_LEAD, PUSH_TITLE, planPushes, pushSyntheticFailed } from "@/lib/burnticker/push";
import { launchErrorMessage, LAUNCH_DURING_UPDATE_SENTENCE } from "@/lib/burnticker/pairLaunchClient";
import { limiter, limitsFromEnv } from "@/lib/burnticker/api/http";
import { DEFAULT_PIN_CREATOR_DAILY_CAP, pinCreatorDailyCapFromEnv } from "@/lib/burnticker/api/handlers";
import { RATE_LIMITS } from "@/lib/burnticker/api/spec";
import { applyWalletMode, COMPUTE_BUDGET_PROGRAM, ed25519Verify, LIGHTHOUSE_PROGRAM, REJECT_MESSAGE, SyntheticWallet, walletShimSource } from "../scripts/burnticker-synth/wallet.mts";
import { fabricatedLookupTableData } from "../scripts/burnticker-synth/stubChain.mts";
import { CREATOR, makeWorld, testMintBank } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const cfg = loadCopyLintConfig();
const clean = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); };

// a launch-shaped step: the creator pays, a mint co-signs, two instructions, one account from a lookup table
const creator = Keypair.generate(), mint = Keypair.generate();
const tableKey = new PublicKey("HdM5qyA2qY2YthTFRqYwkEtiR7Qv38goMz3bCKjxPWW6");
const fromTable = Keypair.generate().publicKey;
const lut = new AddressLookupTableAccount({ key: tableKey, state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: [fromTable] } });
const P1 = new PublicKey("AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM"), P2 = new PublicKey("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj");
function built(): VersionedTransaction {
  const ixs = [
    new TransactionInstruction({ programId: P1, keys: [{ pubkey: creator.publicKey, isSigner: true, isWritable: true }, { pubkey: mint.publicKey, isSigner: true, isWritable: true }, { pubkey: fromTable, isSigner: false, isWritable: false }], data: Buffer.from([1, 2, 3, 4]) }),
    new TransactionInstruction({ programId: P2, keys: [{ pubkey: mint.publicKey, isSigner: true, isWritable: true }, { pubkey: fromTable, isSigner: false, isWritable: false }], data: Buffer.from([9, 8, 7]) }),
  ];
  return new VersionedTransaction(new TransactionMessage({ payerKey: creator.publicKey, recentBlockhash: "11111111111111111111111111111111", instructions: ixs }).compileToV0Message([lut]));
}
const step = { label: "create", signers: ["creator", "mint"], instructions: [] } as unknown as SignStep;
const plan = { expect: { mint: mint.publicKey.toBase58() }, labels: { mint: "the mint key" } };
const handed = (tx: VersionedTransaction) => ({ message: tx.message.serialize(), signatures: tx.signatures.map((s) => Uint8Array.from(s)) });
const programsOf = (tx: VersionedTransaction) => { const keys = tx.message.getAccountKeys({ addressLookupTableAccounts: [lut] }); return tx.message.compiledInstructions.map((ix) => keys.get(ix.programIdIndex)!.toBase58()); };

describe("the synthetic wallet's modes produce the shapes the page must handle", () => {
  test("plain and slow sign exactly what they were handed; the page's check accepts it", async () => {
    const tx = built();
    const w = new SyntheticWallet(creator, async () => undefined);
    for (const mode of ["plain", "slow"] as const) {
      w.queue = [mode];
      const back = VersionedTransaction.deserialize(Buffer.from(await w.signBase64(Buffer.from(tx.serialize()).toString("base64")), "base64"));
      assert.deepEqual(Buffer.from(back.message.serialize()), Buffer.from(tx.message.serialize()), `${mode}: the message is untouched`);
      assert.ok(ed25519Verify(back.message.serialize(), back.signatures[0], creator.publicKey.toBytes()), `${mode}: the wallet's own signature verifies`);
      assert.ok(back.signatures[1].every((b) => b === 0), `${mode}: the mint slot is left for the page`);
      assert.equal(walletReturnProblem(handed(tx), back, step, plan, [lut]), null);
    }
    assert.match(w.calls[1].note, /waited 50 s/);
  });
  test("slow waits SLOW_MS (50 s by default) before it signs", async () => {
    const waits: number[] = [];
    const w = new SyntheticWallet(creator, async (ms) => { waits.push(ms); });
    w.queue = ["slow"];
    await w.signBase64(Buffer.from(built().serialize()).toString("base64"));
    assert.deepEqual(waits, [50_000]);
  });
  test("lighthouse: ours first and unchanged, then Lighthouse assertions, no new signer, a compute-budget instruction at the front half the time; the page accepts both shapes", () => {
    const tx = built();
    for (const o of [{ guards: 1 as const, computeFront: false }, { guards: 2 as const, computeFront: true }]) {
      const r = applyWalletMode(tx, "lighthouse", o);
      const progs = programsOf(r.tx);
      assert.equal(r.tx.message.header.numRequiredSignatures, tx.message.header.numRequiredSignatures, "no new signer");
      assert.deepEqual(r.tx.message.staticAccountKeys.slice(0, 2).map((k) => k.toBase58()), [creator.publicKey.toBase58(), mint.publicKey.toBase58()]);
      const ours = progs.filter((p) => p !== LIGHTHOUSE_PROGRAM.toBase58() && p !== COMPUTE_BUDGET_PROGRAM.toBase58());
      assert.deepEqual(ours, [P1.toBase58(), P2.toBase58()], "our two instructions, in order");
      assert.equal(progs.filter((p) => p === LIGHTHOUSE_PROGRAM.toBase58()).length, o.guards);
      assert.equal(progs[0] === COMPUTE_BUDGET_PROGRAM.toBase58(), o.computeFront, "compute budget at the front only when asked");
      // the lookup-table account still resolves to the same key after the static list grew (the index remap)
      const keys = r.tx.message.getAccountKeys({ addressLookupTableAccounts: [lut] });
      const p1 = r.tx.message.compiledInstructions.find((ix) => keys.get(ix.programIdIndex)!.equals(P1))!;
      assert.ok(keys.get(p1.accountKeyIndexes[2])!.equals(fromTable));
      assert.equal(walletReturnProblem(handed(tx), r.tx, step, plan, [lut]), null, "the page's integrity check accepts the Phantom shape");
    }
  });
  test("lighthouse never hands back more than the 1,232-byte packet: what does not fit is left out (the launch-night step is ~1,100 bytes)", () => {
    const big = (n: number) => new VersionedTransaction(new TransactionMessage({ payerKey: creator.publicKey, recentBlockhash: "11111111111111111111111111111111", instructions: [new TransactionInstruction({ programId: P1, keys: [{ pubkey: creator.publicKey, isSigner: true, isWritable: true }], data: Buffer.alloc(n, 7) })] }).compileToV0Message());
    const near = big(930);   // ~1,100 bytes, like the launch step
    const two = applyWalletMode(near, "lighthouse", { guards: 2, computeFront: true });
    assert.ok(two.tx.serialize().length <= 1232, `${two.tx.serialize().length} bytes`);
    assert.equal(programsOf(two.tx).filter((p) => p === LIGHTHOUSE_PROGRAM.toBase58()).length >= 1, true, "one assertion still fits");
    const full = applyWalletMode(big(1050), "lighthouse", { guards: 2, computeFront: true });
    assert.match(full.note, /no room for a Lighthouse assertion/);
    assert.equal(Buffer.from(full.tx.serialize()).equals(Buffer.from(big(1050).serialize())), true);
  });
  test("tamper: one data byte changed is refused by the page with the integrity sentence", () => {
    const tx = built();
    const r = applyWalletMode(tx, "tamper");
    assert.match(walletReturnProblem(handed(tx), r.tx, step, plan, [lut]) ?? "", /the wallet changed the transaction's instructions or accounts \(instruction 1 differs: data\)/);
  });
  test("reject: refuses with the wallet's own words and signs nothing", async () => {
    const w = new SyntheticWallet(creator);
    w.queue = ["reject"];
    await assert.rejects(w.signBase64(Buffer.from(built().serialize()).toString("base64")), (e: Error) => e.message === REJECT_MESSAGE);
    assert.equal(w.calls[0].ok, false);
  });
  test("the browser shim registers a Wallet Standard wallet named Phantom and the legacy window.phantom.solana, with no key in it", () => {
    const src = walletShimSource(creator.publicKey.toBase58(), creator.publicKey.toBytes());
    for (const s of ["wallet-standard:register-wallet", "wallet-standard:app-ready", "standard:connect", "standard:events", "solana:signTransaction", "solana:signMessage", "window.phantom = { solana: legacy }", "window.solana = legacy", "signAllTransactions", "__btSynthSign"]) assert.ok(src.includes(s), s);
    assert.ok(!src.includes(Buffer.from(creator.secretKey).toString("base64")) && !src.includes(JSON.stringify(Array.from(creator.secretKey))), "the secret never reaches the page");
  });
  test("the stub chain's lookup table decodes to the expected entries, frozen", () => {
    const keys = [fromTable.toBase58(), P1.toBase58()];
    const st = AddressLookupTableAccount.deserialize(fabricatedLookupTableData(keys));
    assert.deepEqual(st.addresses.map((a) => a.toBase58()), keys);
    assert.equal(st.authority, undefined);
    assert.equal(st.deactivationSlot, BigInt("18446744073709551615"));
  });
});

describe("POST /api/burnticker/launch with dryRun: true", () => {
  const rule = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } } };
  const body = (extra: Record<string, unknown> = {}) => ({ creator: CREATOR, ticker: "DRYRUN", name: "Dry run", description: "", imageUrl: null, links: [], rule, acknowledgements: { ruleLocked: true, noReturns: true }, dryRun: true, ...extra });
  const post = async (b: unknown) => {
    const { POST } = await import("../src/app/api/burnticker/launch/route.ts");
    return POST(new Request("https://bt.test/api/burnticker/launch", { method: "POST", headers: { host: "bt.test", origin: "https://bt.test", "content-type": "application/json", "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.77" }, body: JSON.stringify(b) }));
  };
  test("runs the checks and answers ok, registering nothing, uploading nothing, taking no bank key, counting no pin", async () => {
    const w = await makeWorld(); limiter.reset();
    const bank = testMintBank({ refill: false }); w.p.mintBank = bank;
    const r = await post(body());
    const j = await r.json() as Record<string, unknown>;
    assert.equal(r.status, 200, JSON.stringify(j).slice(0, 300));
    assert.equal(j.ok, true); assert.equal(j.dryRun, true); assert.equal(j.registered, false); assert.equal(j.keysTaken, 0);
    assert.ok(!("bundle" in j) && !JSON.stringify(j).includes("mintSecretKey"), "no bundle and no key in the answer");
    assert.equal(w.registry.tokenByTicker("DRYRUN"), null, "no draft");
    assert.equal(bank.bank.takenPending().length, 0, "no bank key taken");
    assert.equal((w.p.uploader as unknown as { uploads: unknown[] }).uploads.length, 0, "nothing uploaded");
    assert.equal(w.registry.getStatus(`pin.budget.${new Date().toISOString().slice(0, 10)}`), null, "the pin budget is not counted");
  });
  test("a dry run still refuses what a launch refuses (here: the day's upload budget is used up)", async () => {
    const w = await makeWorld(); limiter.reset();
    w.p.pinDailyCap = 1; w.registry.setStatus(`pin.budget.${new Date().toISOString().slice(0, 10)}`, "1");
    const r = await post(body());
    const j = await r.json() as { code?: string; dryRun?: boolean };
    assert.equal(r.status, 429); assert.equal(j.code, "upload-budget"); assert.equal(j.dryRun, true);
    assert.equal(w.registry.tokenByTicker("DRYRUN"), null);
  });
  test("the route source: a dry run is handled before the bank is opened", () => {
    const src = read("src/app/api/burnticker/launch/route.ts");
    assert.ok(src.indexOf("body.dryRun === true") > 0 && src.indexOf("body.dryRun === true") < src.indexOf("bank?.take("), "dryRun returns before any bank key is taken");
  });
});

describe("the synthetic flag hides the creator's coins like test coins", () => {
  test("a flagged mint is hidden from the browse surfaces and not listed on the test-coins page; an older registry gains the column", () => {
    const db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bt-synth-")), "r.db");
    const reg = openRegistry(db);
    reg.setTokenTest("TestMint1111111111111111111111111111111111", true, "a disclosed test coin");
    reg.setTokenSynthetic("SynthMint111111111111111111111111111111111", "synthetic creator run");
    const keys = testCoinKeys(ROOT, reg);
    assert.ok(keys.mints.has("SynthMint111111111111111111111111111111111"));
    assert.ok(keys.mints.has("TestMint1111111111111111111111111111111111"));
    assert.deepEqual(withoutTestCoins([{ mint: "SynthMint111111111111111111111111111111111" }, { mint: "RealMint11111111111111111111111111111111111" }], keys).map((r) => r.mint), ["RealMint11111111111111111111111111111111111"]);
    assert.deepEqual(registryTestCoins(reg).map((c) => c.mint), ["TestMint1111111111111111111111111111111111"], "the test-coins page lists disclosures, not the nightly checks");
    assert.deepEqual(reg.syntheticTokens().map((r) => r.mint), ["SynthMint111111111111111111111111111111111"]);
    // reopened: the migration is idempotent
    assert.equal(openRegistry(db).syntheticTokens().length, 1);
  });
  test("the coin list route hides by testCoinKeys with the registry (so the flag reaches it)", () => {
    assert.ok(read("src/app/api/burnticker/tokens/route.ts").includes("testCoinKeys(process.cwd(), p.registry)"));
  });
});

describe("the bt-synthetic-failed push", () => {
  test("its own kind, plain title and lead, one push per run with the page's sentences", async () => {
    assert.equal(PUSH_KIND_OF_ALERT["bt-synthetic-failed"], "synthetic-failed");
    clean(PUSH_TITLE["synthetic-failed"]); clean(PUSH_LEAD["synthetic-failed"]);
    const db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bt-synth-push-")), "r.db");
    const reg = openRegistry(db);
    const sent: { headers: Record<string, string>; body: string }[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => { sent.push({ headers: init.headers as Record<string, string>, body: String(init.body) }); return new Response("ok"); }) as unknown as typeof fetch;
    const now = Date.parse("2026-10-15T09:31:00Z");
    const r = await pushSyntheticFailed({ registry: reg, env: { BURNTICKER_PUSH_URL: "https://push.test/x" }, now, runId: "synth-1", failures: [{ scenario: "e-tamper", sentence: "Step 1 of 1 was not sent because the wallet changed the transaction's instructions or accounts." }, { scenario: "c-deploy-window", sentence: "The launch service is not available right now." }], fetchImpl });
    const pushes = sent.filter((s) => s.headers.tags === "synthetic-failed");
    assert.equal(pushes.length, 1, "one push per run");
    assert.equal(r.delivered, true);
    assert.match(pushes[0].body, /2 checks failed\.\ne-tamper: Step 1 of 1 was not sent/);
    clean(pushes[0].body.split("\n\n")[1]);
    // the rate limit still applies to a second run inside the hour
    const plan = planPushes({ now: now + 60_000, alerts: [{ ts: now + 30_000, kind: "bt-synthetic-failed", key: "k2", text: "x" }], state: JSON.parse(reg.getStatus("push.state")!) });
    assert.equal(plan.messages.filter((m) => m.kind === "synthetic-failed").length, 0);
  });
  test("it says whether the push was delivered: not configured, a failed send and a held push are not", async () => {
    const fresh = () => openRegistry(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bt-synth-push-")), "r.db"));
    const now = Date.parse("2026-10-15T09:31:00Z"), failures = [{ scenario: "a-event", sentence: "x" }];
    const ok = (async () => new Response("ok")) as unknown as typeof fetch;
    const down = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    assert.deepEqual(await pushSyntheticFailed({ registry: fresh(), env: {}, now, runId: "s1", failures, fetchImpl: ok }), { delivered: false, why: "the push channel is not configured" });
    assert.equal((await pushSyntheticFailed({ registry: fresh(), env: { BURNTICKER_PUSH_URL: "https://push.test/x" }, now, runId: "s2", failures, fetchImpl: down })).delivered, false);
    const reg = fresh(), env = { BURNTICKER_PUSH_URL: "https://push.test/x" };
    assert.equal((await pushSyntheticFailed({ registry: reg, env, now, runId: "s3", failures, fetchImpl: ok })).delivered, true);
    const held = await pushSyntheticFailed({ registry: reg, env, now: now + 60_000, runId: "s4", failures, fetchImpl: ok });
    assert.equal(held.delivered, false, "a second run inside the hour is held by the rate limit");
  });
});

describe("the deploy window: Caddy's fallback 503 never reaches the creator as \"catching up\"", () => {
  test("app-unavailable says the site is being updated", () => {
    const s = launchErrorMessage(503, { error: "the app is catching up; receipts and the program are unaffected", code: "app-unavailable" }, "30");
    assert.equal(s, LAUNCH_DURING_UPDATE_SENTENCE);
    assert.doesNotMatch(s, /catching up/); assert.match(s, /being updated/);
    clean(s);
  });
  test("Caddy's fallback body still carries the code the page keys on", () => {
    assert.match(read("deploy/caddy/Caddyfile"), /"code":"app-unavailable"/);
  });
});

describe("the devnet instance's write bucket", () => {
  test("BURNTICKER_DEVNET_WRITE_BURST raises the write burst on devnet only; mainnet keeps the spec's limits", () => {
    assert.equal(limitsFromEnv({ BURNTICKER_CLUSTER: "devnet", BURNTICKER_DEVNET_WRITE_BURST: "60" }).write.burst, 60);
    assert.equal(limitsFromEnv({ BURNTICKER_CLUSTER: "mainnet", BURNTICKER_DEVNET_WRITE_BURST: "60" }), RATE_LIMITS);
    assert.equal(limitsFromEnv({ BURNTICKER_CLUSTER: "devnet", BURNTICKER_DEVNET_WRITE_BURST: "5" }), RATE_LIMITS, "never lower, never odd");
    assert.equal(limitsFromEnv({}), RATE_LIMITS);
    assert.match(fs.readFileSync(path.join(ROOT, "scripts/service/run-burnticker-synth.sh"), "utf8"), /BURNTICKER_CLUSTER=devnet [^"]*BURNTICKER_DEVNET_WRITE_BURST=60/);
  });
});

describe("the devnet instance's per-wallet pin cap", () => {
  test("BURNTICKER_DEVNET_PIN_CREATOR_DAILY_CAP raises the cap on devnet only; mainnet, localnet and an unset cluster keep theirs", () => {
    assert.equal(pinCreatorDailyCapFromEnv({ BURNTICKER_CLUSTER: "devnet", BURNTICKER_DEVNET_PIN_CREATOR_DAILY_CAP: "40" }), 40);
    assert.equal(pinCreatorDailyCapFromEnv({ BURNTICKER_CLUSTER: "mainnet", BURNTICKER_DEVNET_PIN_CREATOR_DAILY_CAP: "40" }), undefined, "mainnet: the default applies");
    assert.equal(pinCreatorDailyCapFromEnv({ BURNTICKER_CLUSTER: "mainnet", BURNTICKER_PIN_CREATOR_DAILY_CAP: "4", BURNTICKER_DEVNET_PIN_CREATOR_DAILY_CAP: "40" }), 4, "mainnet: its own setting, never the devnet one");
    assert.equal(pinCreatorDailyCapFromEnv({ BURNTICKER_CLUSTER: "localnet", BURNTICKER_DEVNET_PIN_CREATOR_DAILY_CAP: "40" }), undefined);
    assert.equal(pinCreatorDailyCapFromEnv({ BURNTICKER_DEVNET_PIN_CREATOR_DAILY_CAP: "40" }), undefined, "no cluster set: not devnet for this purpose");
    assert.equal(pinCreatorDailyCapFromEnv({ BURNTICKER_CLUSTER: "devnet", BURNTICKER_DEVNET_PIN_CREATOR_DAILY_CAP: String(DEFAULT_PIN_CREATOR_DAILY_CAP - 1) }), undefined, "never lower");
    assert.equal(pinCreatorDailyCapFromEnv({ BURNTICKER_CLUSTER: "devnet", BURNTICKER_DEVNET_PIN_CREATOR_DAILY_CAP: "2.5" }), undefined, "never odd");
    assert.equal(pinCreatorDailyCapFromEnv({ BURNTICKER_CLUSTER: "devnet", BURNTICKER_DEVNET_PIN_CREATOR_DAILY_CAP: "5000" }), undefined, "never past 1000");
    assert.equal(pinCreatorDailyCapFromEnv({ BURNTICKER_CLUSTER: "devnet", BURNTICKER_PIN_CREATOR_DAILY_CAP: "50", BURNTICKER_DEVNET_PIN_CREATOR_DAILY_CAP: "40" }), 50, "a higher plain setting stands");
    assert.equal(pinCreatorDailyCapFromEnv({}), undefined);
  });
  test("the server reads the cap through it, and the service script sets it on the devnet instances only", () => {
    assert.match(fs.readFileSync(path.join(ROOT, "src/lib/burnticker/server.ts"), "utf8"), /pinCreatorDailyCap: pinCreatorDailyCapFromEnv\(env\)/);
    const sh = fs.readFileSync(path.join(ROOT, "scripts/service/run-burnticker-synth.sh"), "utf8");
    assert.match(sh, /BURNTICKER_CLUSTER=devnet [^"]*BURNTICKER_DEVNET_PIN_CREATOR_DAILY_CAP=40/);
    assert.equal(sh.match(/BURNTICKER_DEVNET_PIN_CREATOR_DAILY_CAP=/g)?.length, 1, "set once, in start_web");
  });
});

describe("the synthetic creator's exit: scenario failures are the report's, not the unit's", () => {
  test("report written: 0 when nothing failed or the push went out, 3 when failures reached nobody; could not start (or crashed): 1", () => {
    const h = fs.readFileSync(path.join(ROOT, "scripts/burnticker-synthetic-creator.mts"), "utf8");
    const main = h.slice(h.indexOf("async function main()"));
    const tail = main.slice(main.indexOf("fs.writeFileSync(REPORT,"));
    assert.match(tail, /if \(!failed\.length\) \{ console\.log\([^\n]*\); return 0; \}/, "nothing failed: 0");
    assert.match(tail, /push = await pushSyntheticFailed\(/);
    assert.match(tail, /if \(push\.delivered\) \{ console\.log\([^\n]*\); return 0; \}/, "failures pushed: 0");
    assert.match(tail, /no push was delivered[^\n]*\n  return 3;\n\}/, "failures nobody was told about: 3");
    assert.doesNotMatch(main, /failed\.length \? 1 : 0/);
    assert.match(main, /const stop = async \(sentence: string\): Promise<number> => \{[\s\S]*?return 1;\n  \};/, "could not start: 1");
    assert.match(h, /process\.exit\(code\), \(e\) => \{ console\.error\(e\); process\.exit\(1\); \}/, "crashed before the report: 1");
  });
  test("the unit check: the timer is expected, and the service finished (inactive, dead) after a run with failed scenarios raises nothing", async () => {
    const { unitAlerts, parseUnitList, EXPECTED_UNITS } = await import("@/lib/burnticker/ops/unitHealth");
    assert.ok(EXPECTED_UNITS.some((u) => u.unit === "mct-burnticker-synth.timer"));
    assert.ok(!EXPECTED_UNITS.some((u) => u.unit === "mct-burnticker-synth.service"), "the oneshot service is not expected to be running");
    const list = [
      "mct-burnticker-web.service        loaded active   running Burnticker web",
      "mct-burnticker-keeper.service     loaded active   running Burnticker multi-token keeper",
      "mct-burnkeeper.service            loaded active   running Burn keeper for $DEFICIT",
      "mct-burnticker-mintbank.service   loaded active   running Burnticker mint key bank",
      "mct-burnticker-backup.timer       loaded active   waiting Burnticker backup",
      "mct-burnticker-synth.service      loaded inactive dead    Burnticker synthetic creator",
      "mct-burnticker-synth.timer        loaded active   waiting Nightly Burnticker synthetic creator",
      // publish 92: the external web check's timer is expected too (ops/unitHealth EXPECTED_UNITS)
      "mct-burnticker-web-probe.timer    loaded active   waiting Burnticker external web check",
    ].join("\n");
    assert.deepEqual(unitAlerts(parseUnitList(list), EXPECTED_UNITS), []);
  });
});
