// LA7 fix B (2026-10-20): the Phantom version-1 launch path had no fallback. A version-1 step whose dry run the node refuses for a
// version reason (it cannot read version 1) is now built again as version 0 against the lookup table, before the wallet is asked, and
// the run carries on in version 0 (pinned in the plan record; the format of each create is recorded from its bytes by the launch
// route). Any other dry-run failure stops the step as before, and nothing ever falls back once the wallet has signed. The host switch
// BURNTICKER_WALLET_TX_V1=0 turns version 1 off for everyone (docs/burnticker/runbook.md).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { createKeyPairFromBytes, getTransactionDecoder, getTransactionEncoder, partiallySignTransaction } from "@solana/kit";
import { v1Format, type V1SimulateResult } from "@/lib/burnticker/signPlanV1";
import { bytesToBase58, formatFallbackAllowed, launchlabPlan, loadPlanRecord, memoryPlanStorage, signAndSendPlan, v0Format, type LaunchlabBundleLike, type SignPlan } from "@/lib/burnticker/signPlan";
import { FORMAT_SETTING_READING, isVersionRefusal, V0_FALLBACK_NOTICE, walletTxV1Enabled, withoutV1 } from "@/lib/burnticker/walletTxVersion";
import { sentTxFormat } from "@/lib/burnticker/launchPending";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const BH = { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 100 };
const SPIKE = { unitsConsumed: 110_136, loadedAccountsDataSize: 2_681_927 };
const SYSTEM = "11111111111111111111111111111111";
const creatorKp = Keypair.generate(), CREATOR = creatorKp.publicKey.toBase58();
const transferIx = (signer: string) => ({ programId: SYSTEM, label: "test", dataBase64: Buffer.from([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]).toString("base64"), keys: [{ pubkey: CREATOR, isSigner: true, isWritable: true }, { pubkey: signer, isSigner: true, isWritable: true }] });
const bundle = (): LaunchlabBundleLike => {
  const mintKp = Keypair.generate();
  return { mint: mintKp.publicKey.toBase58(), ticker: "FALL", ready: true, pending: [], mintSecretKey: bytesToBase58(mintKp.secretKey), transactions: [{ label: "create", signers: ["creator", "mint"], instructions: [transferIx(mintKp.publicKey.toBase58())] }, { label: "first buy", signers: ["creator"], instructions: [transferIx(CREATOR)] }] };
};
const empty = { confirmed: [] as string[], pending: null, failed: null, paid: [] as { step: number; signature: string; lamports: number }[] };

/** The production runner, version 1 first, with a version-0 fallback wired; `v1Sim` answers the version-1 dry runs in order. */
async function run(plan: SignPlan, v1Sim: (n: number) => Promise<V1SimulateResult>, o: { fallback?: boolean } = {}) {
  const pair = await createKeyPairFromBytes(creatorKp.secretKey);
  const log: string[] = [], sent: Uint8Array[] = [], store = memoryPlanStorage(), fallbacks: string[] = [];
  let v1Sims = 0;
  const res = await signAndSendPlan({ ...plan, format: 1 }, CREATOR, {
    latestBlockhash: async () => BH,
    format: v1Format({
      signBytes: async (bytes) => { log.push("v1 wallet signs"); return new Uint8Array(getTransactionEncoder().encode(await partiallySignTransaction([pair], getTransactionDecoder().decode(bytes)))); },
      simulate: async () => v1Sim(v1Sims++),
    }, plan),
    ...(o.fallback === false ? {} : {
      fallback: v0Format({ lookupTable: async () => { log.push("v0 table read"); return null; }, simulate: async () => { log.push("v0 dry run"); return null; }, signTransaction: async (tx) => { log.push("v0 wallet signs"); tx.sign([creatorKp]); return tx; } }),
      onFormatFallback: ({ step, why }: { step: number; why: string }) => { fallbacks.push(`${step}: ${why}`); },
    }),
    sendRaw: async (raw) => { sent.push(raw); return "x"; },
    confirm: async () => ({ err: null }),
    storage: store,
  });
  return { res, log, sent, store, fallbacks };
}
const ok = async (): Promise<V1SimulateResult> => ({ err: null, logs: [], ...SPIKE });

describe("the version-0 fallback decision", () => {
  test("allowed only for a version-1 run refused for a version reason, with a fallback wired, before anything was signed or sent", () => {
    const base = { version: 1 as const, versionRefused: true, hasFallback: true, usedFallback: false, walletSigned: false, rec: empty };
    assert.equal(formatFallbackAllowed(base), true);
    assert.equal(formatFallbackAllowed({ ...base, versionRefused: false }), false, "a failure about the step itself never falls back");
    assert.equal(formatFallbackAllowed({ ...base, walletSigned: true }), false, "never after the wallet has signed");
    assert.equal(formatFallbackAllowed({ ...base, version: 0 }), false);
    assert.equal(formatFallbackAllowed({ ...base, hasFallback: false }), false);
    assert.equal(formatFallbackAllowed({ ...base, usedFallback: true }), false, "once per run");
    assert.equal(formatFallbackAllowed({ ...base, rec: { ...empty, confirmed: ["sig"] } }), false, "a confirmed step pins the format");
    assert.equal(formatFallbackAllowed({ ...base, rec: { ...empty, pending: { step: 0, signature: "s", tx: "AQ==", blockhash: BH.blockhash, lastValidBlockHeight: 1, sentAt: 1 } } }), false, "a sent step pins the format");
    assert.equal(formatFallbackAllowed({ ...base, rec: { ...empty, failed: { step: 0, signature: "s" } } }), false);
    assert.equal(formatFallbackAllowed({ ...base, rec: { ...empty, paid: [{ step: 0, signature: "s", lamports: 5000 }] } }), false);
  });

  test("version refusals are told apart from failures of the step", () => {
    for (const x of ["Transaction version (1) is not supported", "invalid transaction: failed to deserialize solana_transaction::versioned::VersionedTransaction", "UnsupportedVersion", { UnsupportedVersion: null }, new Error("unsupported transaction version")]) assert.equal(isVersionRefusal(x), true, JSON.stringify(x));
    for (const x of [null, "", { InstructionError: [0, { Custom: 1 }] }, "Attempt to debit an account but found no record of a prior credit.", "insufficient funds for rent", "Blockhash not found", new Error("fetch failed")]) assert.equal(isVersionRefusal(x), false, JSON.stringify(x));
  });
});

describe("the runner falls back to version 0 before the wallet is asked", () => {
  test("the node cannot read version 1 (the dry run throws a version error): the same steps go out as version 0, recorded as such", async () => {
    const r = await run(launchlabPlan([bundle()]), async () => { throw new Error("Transaction version (1) is not supported by the requesting client"); });
    assert.equal(r.res.error, null, r.res.error ?? "");
    assert.equal(r.res.format, 0);
    assert.match(r.res.fellBack ?? "", /does not accept version-1 transactions/);
    assert.equal(r.fallbacks.length, 1, "told once");
    assert.ok(!r.log.includes("v1 wallet signs"), "the wallet never saw a version-1 step");
    assert.deepEqual(r.log, ["v0 table read", "v0 dry run", "v0 wallet signs", "v0 dry run", "v0 wallet signs"]);
    assert.equal(r.sent.length, 2);
    for (const raw of r.sent) { assert.equal(sentTxFormat(raw), 0); assert.equal(VersionedTransaction.deserialize(raw).version, 0); }
    const stored = loadPlanRecord(r.store, launchlabPlan([bundle()]));
    assert.equal(stored, null, "a different plan has no record");
    const key = r.store.keys!()[0];
    assert.equal((JSON.parse(r.store.get(key)!) as { format?: number }).format, 0, "the plan record is pinned to version 0, so a resumed run keeps it");
  });

  test("the simulation itself answers UnsupportedVersion: the same fallback", async () => {
    const r = await run(launchlabPlan([bundle()]), async () => ({ err: "UnsupportedVersion", logs: [] }));
    assert.equal(r.res.error, null, r.res.error ?? "");
    assert.equal(r.res.format, 0);
    assert.equal(r.sent.length, 2);
  });

  test("a failure that is not about the version does not fall back: the step stops, nothing reaches the wallet or the chain", async () => {
    const r = await run(launchlabPlan([bundle()]), async () => ({ err: { InstructionError: [0, { Custom: 1 }] }, logs: ["Program log: custom program error: 0x1"] }));
    assert.equal(r.res.failedAt, 0); assert.equal(r.res.state, "not-sent");
    assert.match(r.res.error ?? "", /a dry run of it failed on chain/);
    assert.equal(r.res.format, undefined, "no format change"); assert.equal(r.res.fellBack, undefined);
    assert.deepEqual(r.log, [], "no version-0 build, no wallet");
    assert.equal(r.sent.length, 0);
    // a dry run that could not be run for another reason stops as before too
    const t = await run(launchlabPlan([bundle()]), async () => { throw new Error("fetch failed"); });
    assert.match(t.res.error ?? "", /its dry run could not be run just now/); assert.deepEqual(t.log, []); assert.equal(t.sent.length, 0);
  });

  test("never after the wallet has signed: step 1 went out as version 1, a version refusal on step 2 stops the run", async () => {
    const r = await run(launchlabPlan([bundle()]), (n) => (n === 0 ? ok() : Promise.reject(new Error("unsupported transaction version"))));
    assert.equal(r.sent.length, 1); assert.equal(sentTxFormat(r.sent[0]), 1);
    assert.equal(r.res.failedAt, 1); assert.equal(r.res.state, "not-sent");
    assert.equal(r.res.format, undefined); assert.equal(r.fallbacks.length, 0);
    assert.ok(!r.log.some((l) => l.startsWith("v0")), "no version-0 step after a version-1 signature");
  });

  test("with no fallback wired (a wallet that does not sign version 0, or no table pin) the run stops as before", async () => {
    const r = await run(launchlabPlan([bundle()]), async () => { throw new Error("unsupported transaction version"); }, { fallback: false });
    assert.equal(r.res.failedAt, 0); assert.equal(r.sent.length, 0); assert.equal(r.res.format, undefined);
  });
});

describe("the host switch BURNTICKER_WALLET_TX_V1 and the wiring", () => {
  test("default on; 0 forces version 0; the launch route hands it to the card", async () => {
    assert.equal(walletTxV1Enabled({}), true);
    assert.equal(walletTxV1Enabled({ BURNTICKER_WALLET_TX_V1: "1" }), true);
    assert.equal(walletTxV1Enabled({ BURNTICKER_WALLET_TX_V1: " 0 " }), false);
    assert.deepEqual([...withoutV1(new Set([0, 1, "legacy"] as const))!], [0, "legacy"]);
    assert.equal(withoutV1(null), null);
    const { GET } = await import("../src/app/api/burnticker/launch/route.ts");
    const before = process.env.BURNTICKER_WALLET_TX_V1;
    try {
      process.env.BURNTICKER_WALLET_TX_V1 = "0";
      assert.equal(((await (await GET()).json()) as { walletTxV1: boolean }).walletTxV1, false);
      delete process.env.BURNTICKER_WALLET_TX_V1;
      assert.equal(((await (await GET()).json()) as { walletTxV1: boolean }).walletTxV1, true);
    } finally { if (before === undefined) delete process.env.BURNTICKER_WALLET_TX_V1; else process.env.BURNTICKER_WALLET_TX_V1 = before; }
    assert.match(read("docs/burnticker/runbook.md"), /BURNTICKER_WALLET_TX_V1=0/);
  });

  test("the sign card wires the version-0 fallback, reads the switch, and keeps the format the run ended in", () => {
    const card = read("src/app/burnticker/launch/SignCard.tsx");
    assert.match(card, /fallback: v0Format\(v0\)/);
    assert.match(card, /const v0Ready = !!versions\?\.has\(0\) && !!network && !!pin && lookupTablePinProblems\(network, pin\)\.length === 0 && planSizeProblems\(plan\.steps, creator, network\)\.length === 0;/);
    assert.match(card, /const versions = txV1 === false \? withoutV1\(advertised\) : advertised;/);
    assert.match(card, /setTxV1\(j \? j\.walletTxV1 !== false : false\)/);
    assert.match(card, /if \(r\.format !== undefined && r\.format !== chosen\) setFormat\(r\.format\);/);
    assert.match(card, /formatFallback: fallbackWhy\.slice\(0, 200\)/);
    assert.match(read("src/app/api/burnticker/launch/route.ts"), /markCreateSent\(platform\(\), String\(body\.mint \?\? ""\), body\.sentTx, Date\.now\(\), \{ formatFallback: body\.formatFallback \}\)/);
  });

  test("the card's new sentences pass the copy lint", () => {
    const cfg = loadCopyLintConfig();
    for (const s of [V0_FALLBACK_NOTICE, FORMAT_SETTING_READING]) assert.deepEqual(lintCopy(s, cfg).hits, [], s);
  });
});
