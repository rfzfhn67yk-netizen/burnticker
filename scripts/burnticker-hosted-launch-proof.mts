// HOSTED LAUNCH PROOF (launch-10, 2026-10-12) — READ-ONLY. Builds the launch a browser would get from THIS checkout's real server wiring
// (server.ts platform() + api/handlers.ts prepareLaunch, register:false) and reports whether it could be signed: the LaunchLab client in
// use, the platform settings it read, ready/pending, every step's v0 size against the lookup table, and the table pin this host serves.
// It reads no key file, signs nothing and sends nothing. With --simulate it asks the RPC to SIMULATE (sigVerify off) each instruction on
// its own and, when a table is pinned and verifies, the whole step as v0; a simulation never lands on chain.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-hosted-launch-proof.mts \
//     --creator <the creator wallet's PUBLIC key> [--cluster devnet] [--rpc <url>] [--simulate]
//
// Environment: the same names the app reads (BURNTICKER_PROGRAM_ID, BURNTICKER_PLATFORM_ID, BURNTICKER_ADMIN, BURNTICKER_KEEPER_PUBKEY,
// BURNTICKER_FEE_WALLET, BURNTICKER_LOOKUP_TABLE). On devnet the public defaults below fill any that are unset. Mainnet is refused here:
// this proof is for devnet only.
import { Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { platform } from "../src/lib/burnticker/server.ts";
import { prepareLaunch } from "../src/lib/burnticker/api/handlers.ts";
import { ChainLaunchLab } from "../src/lib/burnticker/launchLabChain.ts";
import { lookupTablePin, PROGRAM_IDS } from "../src/lib/burnticker/networks.ts";
import { planNetwork, planSizeProblems, v0WireSize, verifiedLookupTable } from "../src/lib/burnticker/lookupTable.ts";
import { launchlabPlan } from "../src/lib/burnticker/signPlan.ts";
import { hostedSigning } from "../src/lib/burnticker/hostedLaunch.ts";
import { BURNTICKER_PLATFORM } from "../src/lib/burnReceipts/constants.ts";

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined; };
const creator = opt("creator") ?? "";
const cluster = opt("cluster") ?? "devnet";
if (cluster !== "devnet") { console.error("this proof runs on devnet only"); process.exit(2); }
if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(creator)) { console.error("usage: --creator <public key> [--rpc <url>] [--simulate]"); process.exit(2); }
const rpc = opt("rpc") ?? process.env.BURNTICKER_RPC_URL?.trim() ?? "https://api.devnet.solana.com";

// the devnet public facts (REHEARSAL-RUNSHEET A5, A10; networks.ts); every one may be overridden by the environment
const DEVNET_DEFAULTS: Record<string, string> = {
  BURNTICKER_CLUSTER: "devnet", BURNTICKER_RPC_URL: rpc, BURNTICKER_DB: ":memory:", BURNTICKER_PREFLIGHT_STRICT: "0",
  BURNTICKER_PROGRAM_ID: PROGRAM_IDS.devnet.burn_receipts, BURNTICKER_PLATFORM_ID: BURNTICKER_PLATFORM.devnet.toBase58(),
  BURNTICKER_ADMIN: "A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD", BURNTICKER_KEEPER_PUBKEY: "D8seUoC1RZUs7918Atcc7TbFwRf1khqFvPdjkB4qktbn",
  BURNTICKER_FEE_WALLET: "3s97xfWwH5qwPjqrmjHwPobZ3Z6oxWMQm2CDVQoA5pZp",
};
for (const [k, v] of Object.entries(DEVNET_DEFAULTS)) if (!(process.env[k] ?? "").trim()) process.env[k] = v;
process.env.BURNTICKER_CLUSTER = "devnet";

const out: Record<string, unknown> = { cluster, rpc: rpc.replace(/api[-_]?key=[^&\s]+/gi, "api-key=…"), creator, hostedSigning: hostedSigning(process.env) };
const p = platform(process.env);
out.launchLabClient = p.launchLab instanceof ChainLaunchLab ? "ChainLaunchLab (real)" : "FakeLaunchLab (placeholder)";
if (p.launchLab instanceof ChainLaunchLab) {
  try { const v = await p.launchLab.views(); out.platform = { id: p.launchLab.platformId, name: v.platform.name, feeRatePpm: v.platform.feeRate.toString(), creatorFeeRatePpm: v.platform.creatorFeeRate.toString(), lpScalesPpm: [v.platform.platformScale, v.platform.creatorScale, v.platform.burnScale].map(String), lockNftWallet: v.platform.platformLockNftWallet.toBase58(), cpConfigId: v.platform.cpConfigId.toBase58(), globalConfig: v.configId.toBase58(), lpLockPins: "pass" }; }
  catch (e) { out.platform = { error: (e as Error).message }; }
}
const ticker = `PRF${String(Date.now()).slice(-6)}`;
const r = await prepareLaunch(p, { creator, ticker, name: "Hosted launch proof", description: "", firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true },
  rule: { schema: "burnticker.rules/v1", oracle: "catalogue", series: "fred.UNRATE", market: null, filter: {}, kind: "scalar", scalar: { unit: 0.1, perUnit: { fractionOfPool: 0.02 }, baseline: "previousSettlement", direction: "abs" }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null } },
  { register: false, preflight: { strict: false } });
if ("error" in r) { out.refused = r.error.body; console.log(JSON.stringify(out, null, 2)); process.exit(1); }
if (!("ok" in r)) { console.log("unexpected pair result"); process.exit(1); }
const b = r.ok.bundle;
const plan = launchlabPlan([b]);
const network = planNetwork(plan.steps.map((s) => s.instructions));
out.bundle = { ticker, mint: b.mint, ready: b.ready, pending: b.pending, feePda: b.addresses.feePda, poolId: b.addresses.poolId, platformId: b.addresses.platformId, configId: b.addresses.configId, metadataUri: b.metadataUri,
  steps: b.transactions.map((t) => ({ label: t.label, signers: t.signers, instructions: t.instructions.map((ix) => ix.label ?? ix.programId), v0BytesWithTable: v0WireSize(t.instructions, creator, "devnet") })) };
out.plan = { network, pending: plan.pending, sizeProblems: planSizeProblems(plan.steps, creator, network) };
const pin = lookupTablePin("devnet");
out.lookupTable = { pin };
const connection = new Connection(rpc, "confirmed");
let lut = null;
if (pin.address) { try { lut = await verifiedLookupTable(connection, "devnet", pin); out.lookupTable = { pin, verified: true }; } catch (e) { out.lookupTable = { pin, verified: false, error: (e as Error).message }; } }
if (args.includes("--simulate")) {
  const toIx = (s: (typeof b.transactions)[number]["instructions"][number]) => new TransactionInstruction({ programId: new PublicKey(s.programId), keys: s.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })), data: Buffer.from(s.dataBase64, "base64") });
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const sim = async (ixs: TransactionInstruction[], tables = lut ? [lut] : []) => {
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(creator), recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(tables));
    const v = (await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" })).value;
    return { err: v.err ? JSON.stringify(v.err) : null, unitsConsumed: v.unitsConsumed ?? null, lastLogs: (v.logs ?? []).slice(-4) };
  };
  const ixs = b.transactions[0].instructions.map(toIx);
  const each: Record<string, unknown> = {};
  for (const [i, ix] of ixs.entries()) { try { each[b.transactions[0].instructions[i].label ?? `instruction ${i + 1}`] = await sim([ix], []); } catch (e) { each[`instruction ${i + 1}`] = { error: (e as Error).message.slice(0, 160) }; } }
  out.simulation = { eachInstructionAlone: each, ...(lut ? { wholeStepV0WithTable: await sim(ixs).catch((e) => ({ error: (e as Error).message.slice(0, 160) })) } : { wholeStep: "not simulated: no lookup table is pinned and verified, and without one the step is over the 1,232-byte limit" }) };
}
console.log(JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
process.exit(0);
