// V0 TRANSACTIONS + A PER-NETWORK LOOKUP TABLE (ChatGPT re-check 2026-10-11, "known oversized single launch"). The browser built each
// launch step as a LEGACY transaction; a real single coin (initialize_token + the SDK's LaunchLab initialize_v2) is over the 1,232-byte
// packet limit that way, so `serialize()` threw "Transaction too large" and a creator launch could not be delivered. These tests build the
// REAL bundles offline (test/burntickerLutFixtures.ts — the F3 construction with the network's real ids), push them through the
// production signing path (signPlan.ts signAndSendPlan, the table verified by lookupTable.ts), and measure what reaches sendRaw.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AddressLookupTableAccount, Keypair, PublicKey, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { getPdaPlatformVault } from "@raydium-io/raydium-sdk-v2";
import { base58ToBytes, buildStepTx, launchlabPlan, pairCurvePlan, signAndSendPlan, PACKET_LIMIT, type SignPlan } from "@/lib/burnticker/signPlan";
import { expectedLookupTable, LOOKUP_TABLE_ENTRIES, LOOKUP_TABLE_MISMATCH, lookupTableKeys, lookupTableProblems, planNetwork, planSizeProblems, v0WireSize, verifiedLookupTable, type LookupTableReader } from "@/lib/burnticker/lookupTable";
import { LOOKUP_TABLES, NETWORKS, PROGRAM_IDS, type Network } from "@/lib/burnticker/networks";
import { BURNTICKER_PLATFORM, LAUNCHLAB_PROGRAM_ID, LAUNCHLAB_VAULT_AUTH, NATIVE_MINT, OPERATOR_TREASURY, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, MEMO_PROGRAM_ID } from "@/lib/burnReceipts/constants";
import { feeKeysPda } from "@/lib/burnReceipts/pda";
import { cpiEventAuthority, DEFAULT_SOL_CONFIG } from "@/lib/burnKeeper/launch";
import { DEFAULT_CP_CONFIG } from "@/lib/burnticker/pairCurveLaunch";
import { CPMM_MAINNET_TIER_9, CPMM_MAINNET_TIER_14 } from "@/lib/burnticker/cpmmTier";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import fs from "node:fs";
import path from "node:path";
import { everyBundleKind, launchlabPair, pairCurveSet, singleCoin } from "./burntickerLutFixtures.ts";

const ROOT = path.join(import.meta.dirname, "..");
const U64_MAX = BigInt("18446744073709551615");
const BH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";
const keysOf = (ixs: { programId: string; keys: { pubkey: string }[] }[]) => new Set(ixs.flatMap((i) => [i.programId, ...i.keys.map((k) => k.pubkey)]));
const toIx = (s: { programId: string; keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; dataBase64: string }) => new TransactionInstruction({ programId: new PublicKey(s.programId), keys: s.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })), data: Buffer.from(s.dataBase64, "base64") });

/** An on-chain table as getAddressLookupTable returns it (frozen unless `authority`). */
const table = (key: PublicKey, addresses: string[], o: { authority?: PublicKey; deactivationSlot?: bigint } = {}) =>
  new AddressLookupTableAccount({ key, state: { deactivationSlot: o.deactivationSlot ?? U64_MAX, lastExtendedSlot: 1, lastExtendedSlotStartIndex: 0, authority: o.authority, addresses: addresses.map((a) => new PublicKey(a)) } });
const reader = (acc: AddressLookupTableAccount | null): LookupTableReader & { calls: number } => { const r = { calls: 0, async getAddressLookupTable() { r.calls++; return { value: acc }; } }; return r; };

/** The production path: the plan → signAndSendPlan with the table verified → what reaches sendRaw (bytes per step). */
async function sendThroughPlan(plan: SignPlan, creator: Keypair, network: Network) {
  const lutKey = Keypair.generate().publicKey;
  const pin = { address: lutKey.toBase58(), authority: null };
  const raws: Uint8Array[] = [];
  const r = await signAndSendPlan(plan, creator.publicKey.toBase58(), {
    latestBlockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 100 }),
    simulate: async () => null,   // a passing dry run (the runner requires one since Phantom's second review)
    signTransaction: async (tx) => { tx.sign([creator]); return tx; },
    lookupTable: () => verifiedLookupTable(reader(table(lutKey, lookupTableKeys(network))), network, pin),
    sendRaw: async (raw) => { raws.push(raw); return `sig${raws.length}`; },
    confirm: async () => ({ err: null }),
  });
  return { r, raws };
}
/** The pre-fix construction: a legacy Transaction of the same instructions, signed by its signers (the auditor's reproduction). */
function legacyWireSize(ixs: TransactionInstruction[], signers: Keypair[]): number {
  const t = new Transaction({ feePayer: signers[0].publicKey, recentBlockhash: BH }).add(...ixs);
  t.sign(...signers);
  return t.serializeMessage().length + 1 + 64 * t.signatures.length;
}

describe("the lookup table holds every fixed account the real bundles reference", () => {
  for (const network of NETWORKS) test(`${network}: every account common to two independent builds of every bundle kind is in the table, at most once`, async () => {
    const a = await everyBundleKind(network), b = await everyBundleKind(network);
    const ka = keysOf(a.flatMap((t) => t.instructions)), kb = keysOf(b.flatMap((t) => t.instructions));
    const fixed = [...ka].filter((k) => kb.has(k));
    const lut = new Set(lookupTableKeys(network));
    assert.deepEqual(fixed.filter((k) => !lut.has(k)), [], "a fixed account the bundles reference is missing from the table");
    assert.equal(lut.size, lookupTableKeys(network).length, "no duplicate entries");
    assert.ok(lut.size <= 256);
    // and nothing per launch is in it: the creator, the mints and their PDAs stay in the message
    const perLaunch = [...ka].filter((k) => !kb.has(k));
    assert.deepEqual(perLaunch.filter((k) => lut.has(k)), []);
  });

  test("each entry is the value the code derives (program ids, PDAs, the pinned platform, configs, treasury)", () => {
    const ev = (p: string) => PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], new PublicKey(p))[0].toBase58();
    const operator = JSON.parse(fs.readFileSync(path.join(ROOT, "config/burnticker/operator.json"), "utf8")) as { clusters: Record<Network, { programs: { burn_receipts: string; pair_curve: string }; launchlabPlatform: string }> };
    for (const n of NETWORKS) {
      const ll = LAUNCHLAB_PROGRAM_ID[n];
      const want = [
        PROGRAM_IDS[n].burn_receipts, ev(PROGRAM_IDS[n].burn_receipts), PROGRAM_IDS[n].pair_curve, ev(PROGRAM_IDS[n].pair_curve),
        ll.toBase58(), DEFAULT_SOL_CONFIG[n].toBase58(), BURNTICKER_PLATFORM[n].toBase58(), LAUNCHLAB_VAULT_AUTH[n].toBase58(), cpiEventAuthority(ll).toBase58(),
        // mainnet index 10 stays the 2026-10-12 tier (9): the frozen table's prefix; the new-coin tier (14) is appended at index 21
        getPdaPlatformVault(ll, BURNTICKER_PLATFORM[n], NATIVE_MINT).publicKey.toBase58(), n === "mainnet" ? CPMM_MAINNET_TIER_9.id : DEFAULT_CP_CONFIG[n], feeKeysPda(new PublicKey(PROGRAM_IDS[n].burn_receipts)).toBase58(), OPERATOR_TREASURY[n].toBase58(),
        "11111111111111111111111111111111", TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), "SysvarRent111111111111111111111111111111111", "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s", NATIVE_MINT.toBase58(), MEMO_PROGRAM_ID.toBase58(),
        ...(n === "mainnet" ? [CPMM_MAINNET_TIER_14.id] : []),
      ];
      assert.deepEqual(lookupTableKeys(n), want, `${n}: the table's order and values`);
      assert.equal(operator.clusters[n].launchlabPlatform, BURNTICKER_PLATFORM[n].toBase58(), "operator.json's platform is the table's");
      assert.deepEqual(operator.clusters[n].programs, PROGRAM_IDS[n]);
    }
  });

  test("the plan's network is read from its fixed accounts; none or both → unknown (nothing is signed)", async () => {
    for (const n of NETWORKS) {
      const { bundle } = await singleCoin(n);
      assert.equal(planNetwork(bundle.transactions.map((t) => t.instructions)), n);
      const { pc } = await pairCurveSet(n);
      assert.equal(planNetwork(pc.transactions.map((t) => t.instructions)), n, "a pair-curve set (no LaunchLab instruction) is placed by its platform and AmmConfig");
    }
    const d = await singleCoin("devnet"), m = await singleCoin("mainnet");
    assert.equal(planNetwork([...d.bundle.transactions, ...m.bundle.transactions].map((t) => t.instructions)), null);
    assert.equal(planNetwork([[{ programId: "11111111111111111111111111111111", keys: [] }]]), null);
  });
});

/**
 * Room a wallet's appended checks need (Phantom's Lighthouse, program L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95; encodings from its
 * generated client, clients/js/src/generated): the program id as one more static key (32 bytes, invoked programs never come from a
 * table) and per assertion 1 program index + 1 account count + its account indexes + 1 data length + data. assertAccountInfo Lamports
 * on the fee payer is data 1 discriminator + 1 log level + 1 variant + 8 u64 + 1 operator = 12 bytes, so 16 bytes on the wire with the
 * payer already a key; a token-balance or delta check is about the same plus 32 bytes when it names an account the transaction does not.
 * Three or four assertions with one new account is about 32 + 64 + 32 = 128 bytes, so the steps kept at least 130 (2026-10-14).
 * 2026-10-15: a synthetic creator measured two assertions plus a compute-budget instruction at the front taking the single coin's one
 * transaction (1,031 to 1,095 bytes) to 1,234, over the limit, so the single coin is two steps too and every step now keeps at least
 * 330 bytes: room for a wordier wallet guard than the one measured.
 */
const WALLET_HEADROOM = 330;

describe("the measured wire size: every real step fits 1,232 bytes as v0 + the table; the legacy construction does not", () => {
  for (const network of NETWORKS) test(`${network}: single coin (the F3 fixture), the LaunchLab pair, the pair-curve set`, async () => {
    const report: string[] = [];
    const single = await singleCoin(network), worst = await singleCoin(network, { worst: true });
    const lp = await launchlabPair(network), lpWorst = await launchlabPair(network, Keypair.generate(), true), pcs = await pairCurveSet(network);
    const cases: [string, SignPlan, Keypair][] = [
      ["single coin", launchlabPlan([single.bundle]), single.creator], ["single coin, longest name/ticker/URI", launchlabPlan([worst.bundle]), worst.creator],
      ["LaunchLab pair, longest names/tickers/URI", launchlabPlan([lpWorst.pair.a, lpWorst.pair.b]), lpWorst.creator],
      ["LaunchLab pair", launchlabPlan([lp.pair.a, lp.pair.b]), lp.creator], ["pair-curve set", pairCurvePlan(pcs.pc, pcs.keys), pcs.creator],
    ];
    for (const [name, plan, creator] of cases) {
      const { r, raws } = await sendThroughPlan(plan, creator, network);
      assert.equal(r.error, null, `${name}: ${r.error}`);
      assert.equal(raws.length, plan.steps.length);
      raws.forEach((raw, i) => {
        const vt = VersionedTransaction.deserialize(raw);
        assert.equal(vt.version, 0, `${name} step ${i + 1} is a version-0 transaction`);
        assert.ok(raw.length <= PACKET_LIMIT, `${name} step ${i + 1}: ${raw.length} bytes > ${PACKET_LIMIT}`);
        // Phantom review ticket 438485 (2026-10-14): a wallet that appends Lighthouse assertions needs room, so every step keeps at
        // least WALLET_HEADROOM bytes free (the pair used to be 1,191 and 1,223 bytes; it is now four steps of at most 829 bytes; the
        // single coin used to be one step of 1,031 to 1,095 bytes and is now two, its rule locked and then the coin created)
        assert.ok(raw.length <= PACKET_LIMIT - WALLET_HEADROOM, `${name} step ${i + 1}: ${raw.length} bytes leaves less than ${WALLET_HEADROOM} bytes for the wallet's own checks`);
        const signerKeys = vt.message.staticAccountKeys.slice(0, vt.message.header.numRequiredSignatures);
        assert.ok(vt.signatures.every((s) => s.some((b) => b !== 0)), `${name} step ${i + 1}: every required signature present (${signerKeys.length})`);
        const legacy = legacyWireSize(plan.steps[i].instructions.map(toIx), [creator, ...plan.steps[i].signers.filter((s) => s !== "creator").map((s) => Keypair.fromSecretKey(base58ToBytes(plan.keys[s]!)))]);
        report.push(`${network} ${name} step ${i + 1}: legacy ${legacy} B → v0+table ${raw.length} B`);
      });
    }
    console.log(report.join("\n"));
    // the pair's four steps: each coin locks its rule, then is created; the create is the step that confirms the coin
    const lpPlan = launchlabPlan([lp.pair.a, lp.pair.b]);
    assert.deepEqual(lpPlan.steps.map((st) => st.label), ["$PAIRA: Lock in $PAIRA's rule", "$PAIRA: Create $PAIRA (LaunchLab create)", "$PAIRB: Lock in $PAIRB's rule and link the two coins", "$PAIRB: Create $PAIRB (LaunchLab create)"]);
    assert.deepEqual(lpPlan.confirms.map((c) => [c.mint, c.step]), [[lp.pair.a.mint, 1], [lp.pair.b.mint, 3]]);
    assert.deepEqual(lpPlan.steps.map((st) => st.signers), [["creator", "mint0"], ["creator", "mint0"], ["creator", "mint1"], ["creator", "mint1"]]);
    // the single coin's two steps (2026-10-15): its rule locked, then the coin created; the create is the step that confirms it
    const sPlan = launchlabPlan([single.bundle]);
    assert.deepEqual(sPlan.steps.map((st) => st.label), [`Lock in $${single.bundle.ticker}'s rule`, `Create $${single.bundle.ticker} (LaunchLab create)`]);
    assert.deepEqual(sPlan.confirms.map((c) => [c.mint, c.step]), [[single.bundle.mint, 1]]);
    assert.deepEqual(sPlan.steps.map((st) => st.signers), [["creator", "mint"], ["creator", "mint"]]);
    // the auditor's reproduction, kept in reverse: the single coin's old one-transaction shape as a legacy transaction is over the limit
    // and cannot be serialized — reverting buildStepTx to `new Transaction(...)` makes the size assertions above fail
    const ixs = single.bundle.transactions.flatMap((t) => t.instructions).map(toIx);
    assert.ok(legacyWireSize(ixs, [single.creator, single.mint]) > PACKET_LIMIT, "the legacy single coin is over 1,232 bytes");
    const t = new Transaction({ feePayer: single.creator.publicKey, recentBlockhash: BH }).add(...ixs); t.sign(single.creator, single.mint);
    assert.throws(() => t.serialize(), /Transaction too large/);
    // and the production builder is the v0 one
    const built = buildStepTx(launchlabPlan([single.bundle]).steps[0], single.creator.publicKey.toBase58(), { mint: single.bundle.mintSecretKey }, BH, table(Keypair.generate().publicKey, lookupTableKeys(network)));
    assert.ok(built instanceof VersionedTransaction); assert.equal(built.message.addressTableLookups.length, 1);
  });

  /** The single coin's old one-transaction shape (before 2026-10-15): initialize_token + create (+ first buy) in one step. */
  const joined = (b: Awaited<ReturnType<typeof singleCoin>>["bundle"]) => ({ ...b, transactions: [{ label: "initialize_token + LaunchLab create", signers: ["creator", "mint"], instructions: b.transactions.flatMap((t) => t.instructions) }] });

  test("RESIDUAL (reported to the owner): since the split a create WITH the opening purchase fits 1,232 bytes but not with the wallet headroom, so the hosted path still carries none; an over-limit step is flagged before signing, refused before the wallet", async () => {
    for (const network of NETWORKS) for (const o of [{ firstBuySol: "0.5" }, { firstBuySol: "0.5", vault: true }]) {
      const s = await singleCoin(network, o), plan = launchlabPlan([s.bundle]), creator = s.creator.publicKey.toBase58();
      const sizes = plan.steps.map((st) => v0WireSize(st.instructions, creator, network)!);
      console.log(`${network} ${o.vault ? "vault + first buy" : "single + first buy"}: v0+table ${sizes.join(" + ")} B`);
      assert.equal(plan.steps.length, 2); assert.ok(sizes.every((x) => x <= PACKET_LIMIT), "each step fits the packet");
      assert.ok(sizes[1] > PACKET_LIMIT - WALLET_HEADROOM, "if the create with a purchase now keeps the wallet headroom, the hosted refusal (hostedLaunch.ts) can be revisited");
      assert.deepEqual(planSizeProblems(plan.steps, creator, network), []);
      // the old one-transaction shape is over the limit: flagged before signing and refused before the wallet sees it
      const old = launchlabPlan([joined(s.bundle)]);
      const problems = planSizeProblems(old.steps, creator, network);
      assert.equal(problems.length, 1); assert.match(problems[0], /over the 1,232-byte limit, so it cannot be sent as one transaction$/);   // launch-10: the site never builds this shape (hostedLaunch.ts)
      assert.ok(lintCopy(problems[0], loadCopyLintConfig()).ok, problems[0]);
      let walletCalls = 0;
      const r = await signAndSendPlan(old, creator, { simulate: async () => null, latestBlockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 100 }), lookupTable: async () => expectedLookupTable(network), signTransaction: async (tx) => { walletCalls++; return tx; }, sendRaw: async () => "x", confirm: async () => ({ err: null }) });
      assert.equal(walletCalls, 0); assert.equal(r.state, "not-sent"); assert.match(r.error!, /over the 1,232-byte limit/);
    }
    // every step of the plans that fit is clear of the pre-sign check
    const ok = await singleCoin("devnet");
    assert.deepEqual(planSizeProblems(launchlabPlan([ok.bundle]).steps, ok.creator.publicKey.toBase58(), "devnet"), []);
  });

  test("without the table the single coin's old one-transaction shape does not fit: the builder refuses before the wallet sees it", async () => {
    const s = await singleCoin("devnet");
    let walletCalls = 0;
    const r = await signAndSendPlan(launchlabPlan([joined(s.bundle)]), s.creator.publicKey.toBase58(), {
      latestBlockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 100 }), lookupTable: async () => null,
      simulate: async () => null,   // a passing dry run (the runner requires one since Phantom's second review)
      signTransaction: async (tx) => { walletCalls++; return tx; }, sendRaw: async () => "x", confirm: async () => ({ err: null }),
    });
    assert.equal(walletCalls, 0); assert.equal(r.state, "not-sent"); assert.match(r.error!, /1,232-byte limit/);
  });
});

describe("the browser verifies the table before signing (lookup table mismatch — nothing was sent)", () => {
  const n: Network = "devnet", key = Keypair.generate().publicKey, ops = Keypair.generate().publicKey;
  const pin = { address: key.toBase58(), authority: ops.toBase58() };
  const good = lookupTableKeys(n);
  test("accepted: the pinned address, every entry at its index, frozen or the pinned operations key; extra entries past the list are ignored", async () => {
    for (const acc of [table(key, good), table(key, good, { authority: ops }), table(key, [...good, Keypair.generate().publicKey.toBase58()])]) {
      const v = await verifiedLookupTable(reader(acc), n, pin);
      assert.deepEqual(v.state.addresses.map((a) => a.toBase58()), good, "the message is compiled against exactly the verified list");
    }
  });
  test("refused: not pinned, absent, another address, an entry moved or missing, deactivated, another authority", async () => {
    const swapped = [...good]; [swapped[4], swapped[5]] = [swapped[5], swapped[4]];
    const cases: [string, AddressLookupTableAccount | null, typeof pin | { address: null; authority: null }][] = [
      ["not pinned", table(key, good), { address: null, authority: null }],
      ["absent", null, pin],
      ["another address", table(Keypair.generate().publicKey, good), pin],
      ["moved entry", table(key, swapped), pin],
      ["missing entry", table(key, good.slice(0, -1)), pin],
      ["deactivated", table(key, good, { deactivationSlot: BigInt(5) }), pin],
      ["foreign authority", table(key, good, { authority: Keypair.generate().publicKey }), pin],
    ];
    for (const [name, acc, p] of cases) await assert.rejects(verifiedLookupTable(reader(acc), n, p), new RegExp(LOOKUP_TABLE_MISMATCH), name);
    assert.ok(lookupTableProblems(n, key.toBase58(), { addresses: swapped, deactivationSlot: U64_MAX }, pin).some((x) => /index 4: expected DRay6f/.test(x)), "the diff names the index and the entry");
    await assert.rejects(verifiedLookupTable(reader(table(key, good)), null, pin), /network of this launch could not be read/);
  });
  test("a mismatch stops the run before anything reaches the wallet; the sentence says nothing was sent and passes the copy lint", async () => {
    const s = await singleCoin("devnet");
    let walletCalls = 0, sends = 0;
    const r = await signAndSendPlan(launchlabPlan([s.bundle]), s.creator.publicKey.toBase58(), {
      latestBlockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 100 }),
      simulate: async () => null,   // a passing dry run (the runner requires one since Phantom's second review)
      lookupTable: () => verifiedLookupTable(reader(table(key, good.slice(1))), n, pin),
      signTransaction: async (tx) => { walletCalls++; return tx; }, sendRaw: async () => { sends++; return "x"; }, confirm: async () => ({ err: null }),
    });
    assert.deepEqual([walletCalls, sends, r.failedAt, r.state], [0, 0, 0, "not-sent"]);
    assert.match(r.error!, /lookup table mismatch — nothing was sent/);
    assert.ok(lintCopy(LOOKUP_TABLE_MISMATCH, loadCopyLintConfig()).ok);
  });
  test("pinned per network in networks.ts; until the owner creates a table the card refuses to sign there; the card wires the verified table", () => {
    for (const x of NETWORKS) assert.ok(x in LOOKUP_TABLES && "address" in LOOKUP_TABLES[x] && "authority" in LOOKUP_TABLES[x]);
    assert.equal(LOOKUP_TABLE_ENTRIES.devnet.length, 21);
    assert.equal(LOOKUP_TABLE_ENTRIES.mainnet.length, 22, "tier 14 appended at index 21 (owner decision 2026-10-19)");
    const card = fs.readFileSync(path.join(ROOT, "src/app/burnticker/launch/SignCard.tsx"), "utf8");
    // launch-10 (2026-10-12): the pin comes from the host at runtime (GET /api/burnticker/launch); test/burntickerHostedLaunch.test.ts
    assert.match(card, /lookupTable: \(\) => verifiedLookupTable\(connection, network, pin\)/);
    assert.match(card, /lookupTablePinProblems\(network, pin\)/);
  });
});

describe("CPMM tier 14 in the mainnet table (owner decision 2026-10-19): the frozen 21-entry table cannot hold it, so a new table must be pinned first", () => {
  const key = Keypair.generate().publicKey, pin = { address: key.toBase58(), authority: null };
  const keys = lookupTableKeys("mainnet"), old21 = keys.slice(0, 21);
  test("the definition: tier 9 stays at index 10 (the frozen table's prefix), tier 14 is index 21, nothing else moved", () => {
    assert.equal(keys[10], CPMM_MAINNET_TIER_9.id);
    assert.equal(keys[21], CPMM_MAINNET_TIER_14.id);
    assert.equal(keys.indexOf(CPMM_MAINNET_TIER_14.id), 21, "once");
    assert.equal(DEFAULT_CP_CONFIG.mainnet, CPMM_MAINNET_TIER_14.id, "new pair-curve pools name tier 14");
  });
  test("the frozen 21-entry table (8DZaHFo6…) is refused by this code; a 22-entry table passes it, and the older code's 21-entry list is its prefix", async () => {
    assert.deepEqual(lookupTableProblems("mainnet", key.toBase58(), table(key, old21).state, pin), [`index 21: expected ${CPMM_MAINNET_TIER_14.id} (Raydium CPMM AmmConfig tier 14 (new coins, pair curve)), found nothing`]);
    await assert.rejects(verifiedLookupTable(reader(table(key, old21)), "mainnet", pin), /lookup table mismatch — nothing was sent \(index 21: expected 52MZUk/);
    assert.deepEqual(lookupTableProblems("mainnet", key.toBase58(), table(key, keys).state, pin), []);
    // the code released before this one checks only the first 21 entries and tolerates more: the new table passes it too
    assert.deepEqual(table(key, keys).state.addresses.slice(0, 21).map((a) => a.toBase58()), old21);
  });
  test("without the entry a pair-curve step that names tier 14 grows by 31 bytes (a static key instead of a table index); a single coin never names it", async () => {
    const { pc, creator } = await pairCurveSet("mainnet");
    const payer = creator.publicKey.toBase58();
    const size = (ixs: typeof pc.transactions[number]["instructions"], addresses: string[]) => {
      const msg = new TransactionMessage({ payerKey: creator.publicKey, recentBlockhash: BH, instructions: ixs.map(toIx) }).compileToV0Message([table(key, addresses)]);
      return 1 + 64 * msg.header.numRequiredSignatures + msg.serialize().length;
    };
    const naming = pc.transactions.filter((t) => t.instructions.some((ix) => ix.keys.some((k) => k.pubkey === CPMM_MAINNET_TIER_14.id)));
    assert.ok(naming.length > 0, "init_pair names the AmmConfig");
    for (const t of naming) assert.equal(size(t.instructions, old21) - size(t.instructions, keys), 31, t.label);
    assert.equal(v0WireSize(naming[0].instructions, payer, "mainnet"), size(naming[0].instructions, keys));
    const single = await singleCoin("mainnet");
    assert.ok(!single.bundle.transactions.some((t) => t.instructions.some((ix) => ix.programId === CPMM_MAINNET_TIER_14.id || ix.keys.some((k) => k.pubkey === CPMM_MAINNET_TIER_14.id || k.pubkey === CPMM_MAINNET_TIER_9.id))), "a LaunchLab coin reads the AmmConfig from the platform, not as an account");
  });
});
