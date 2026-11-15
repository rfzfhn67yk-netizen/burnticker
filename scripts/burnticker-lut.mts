// BURNTICKER LOOKUP TABLE — the per-network address lookup table every browser launch step is compiled against (re-check 2026-10-11,
// "known oversized single launch"; src/lib/burnticker/lookupTable.ts holds the expected entries, networks.ts LOOKUP_TABLES pins the
// address). Four commands:
//
//   verify  --cluster devnet|mainnet [--address <table>]       READ-ONLY: fetches the table (default: the pinned one) and prints the diff
//                                                               against the expected entries; exit 1 on any difference
//   create  --cluster devnet|mainnet --keypair <file> [--send]  a new table with the payer as authority, extended with every entry
//   extend  --cluster devnet|mainnet --keypair <file> --address <table> [--send]   appends the entries the table is missing (it must be a prefix)
//   freeze  --cluster devnet|mainnet --keypair <file> --address <table> [--send]   removes the authority for good (verify first)
//
// Without --send nothing is sent: the transaction is described and the command stops. On mainnet --send also needs --mainnet. The keypair
// file is read only to sign; no key, seed or RPC URL is ever printed. RPC: --rpc, else BURNTICKER_RPC_URL when it serves --cluster
// (networks.ts rpcUrlFor), else the public endpoint. After create + freeze, pin the printed address in networks.ts LOOKUP_TABLES (authority
// null = frozen) and run verify. Since launch-10 (2026-10-12) the pin can instead be set on the host at runtime: BURNTICKER_LOOKUP_TABLE (and
// BURNTICKER_LOOKUP_TABLE_AUTHORITY while not frozen) on a host serving that network; a passing `verify` prints the exact lines to paste.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-lut.mts verify --cluster devnet
import fs from "node:fs";
import { AddressLookupTableProgram, Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import { LOOKUP_TABLE_ENTRIES, lookupTableKeys, lookupTableProblems } from "../src/lib/burnticker/lookupTable.ts";
import { lookupTablePin, rpcUrlFor, type Network } from "../src/lib/burnticker/networks.ts";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined; };
const flag = (n: string) => args.includes(`--${n}`);
const usage = "usage: burnticker-lut.mts verify|create|extend|freeze --cluster devnet|mainnet [--address <table>] [--keypair <file>] [--rpc <url>] [--send] [--mainnet]";
const clusterArg = opt("cluster");
if (!cmd || !["verify", "create", "extend", "freeze"].includes(cmd) || (clusterArg !== "devnet" && clusterArg !== "mainnet")) { console.error(usage); process.exit(2); }
const cluster = clusterArg as Network;
const connection = new Connection(opt("rpc") ?? rpcUrlFor(cluster), "confirmed");
const want = lookupTableKeys(cluster);
/** At most 24 addresses per extend instruction keeps each transaction well under the packet limit. */
const CHUNK = 24;

async function readTable(address: PublicKey) {
  try { return (await connection.getAddressLookupTable(address)).value; } catch (e) { throw new Error(`the account at ${address.toBase58()} is not a readable lookup table (${String((e as Error)?.message ?? e).slice(0, 80)})`); }
}

function printDiff(address: string, problems: string[], have: string[]) {
  console.log(`${cluster} lookup table ${address}`);
  LOOKUP_TABLE_ENTRIES[cluster].forEach((e, i) => console.log(`  ${String(i).padStart(2)} ${have[i] === e.key ? "ok  " : "DIFF"} ${e.key}  ${e.what}${have[i] && have[i] !== e.key ? `  (table holds ${have[i]})` : ""}`));
  if (have.length > want.length) console.log(`  + ${have.length - want.length} entr${have.length - want.length === 1 ? "y" : "ies"} past the expected list (ignored by the browser)`);
  console.log(problems.length ? `MISMATCH:\n  - ${problems.join("\n  - ")}` : "matches the expected entries");
}

/** sha256 over the expected entries (one base58 key per line, table order): the same on every machine for a given repository state. */
const entriesSha256 = (keys: readonly string[]) => createHash("sha256").update(keys.join("\n")).digest("hex");

async function verify(): Promise<number> {
  // launch-10 (2026-10-12): the default address is the pin the HOST serves (networks.ts lookupTablePin: BURNTICKER_LOOKUP_TABLE on the
  // host's network, else LOOKUP_TABLES), so `verify` checks exactly what the signing card will check.
  const served = lookupTablePin(cluster);
  const address = opt("address") ?? served.address;
  if (!address) { console.log(`no lookup table is pinned for ${cluster} (BURNTICKER_LOOKUP_TABLE on a ${cluster} host, or networks.ts LOOKUP_TABLES); pass --address to check one`); return 1; }
  const acc = await readTable(new PublicKey(address));
  const pin = opt("address") ? { address, authority: served.authority } : served;
  const problems = lookupTableProblems(cluster, address, acc ? acc.state : null, pin);
  printDiff(address, problems, acc ? acc.state.addresses.map((a) => a.toBase58()) : []);
  if (acc) console.log(`authority: ${acc.state.authority ? acc.state.authority.toBase58() : "none (frozen)"}; active: ${acc.isActive()}`);
  if (problems.length || !acc) return 1;
  // THE PASTE-ABLE RECORD: one line for the run-sheet or a review, then the exact pin lines (no secret is involved: a table address is public).
  const authority = acc.state.authority ? acc.state.authority.toBase58() : null;
  const slot = await connection.getSlot("confirmed").catch(() => null);
  console.log("");
  console.log("---- paste this record ----");
  console.log(`burnticker lookup table verified: ${cluster} ${address}, ${want.length} of ${want.length} entries at their index, ${authority ? `authority ${authority} (NOT frozen)` : "frozen (no authority)"}, entries sha256 ${entriesSha256(want)}, read at slot ${slot ?? "unknown"} on ${new Date().toISOString()}`);
  console.log("---- pin it on the host (no code release; restart the app after editing its environment) ----");
  console.log(`BURNTICKER_LOOKUP_TABLE=${address}`);
  console.log(authority ? `BURNTICKER_LOOKUP_TABLE_AUTHORITY=${authority}` : "# leave BURNTICKER_LOOKUP_TABLE_AUTHORITY unset: the table is frozen");
  console.log(`---- or compile it in (src/lib/burnticker/networks.ts LOOKUP_TABLES.${cluster}) ----`);
  console.log(`${cluster}: { address: "${address}", authority: ${authority ? `"${authority}"` : "null"} },`);
  return 0;
}

function payer(): Keypair {
  const file = opt("keypair");
  if (!file) { console.error(`${cmd} needs --keypair <file> (the payer and table authority)`); process.exit(2); }
  // the file is read to sign only; its contents are never printed
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")) as number[]));
}

async function send(kp: Keypair, ixs: TransactionInstruction[], what: string): Promise<void> {
  const size = new VersionedTransaction(new TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: PublicKey.default.toBase58(), instructions: ixs }).compileToV0Message()).serialize().length;
  console.log(`${what}: ${ixs.length} instruction(s), ${size} bytes, payer/authority ${kp.publicKey.toBase58()}`);
  if (!flag("send")) { console.log("  dry run (no --send): nothing was sent"); return; }
  if (cluster === "mainnet" && !flag("mainnet")) { console.error("  mainnet: add --mainnet to send; nothing was sent"); process.exit(2); }
  const bh = await connection.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: bh.blockhash, instructions: ixs }).compileToV0Message());
  tx.sign([kp]);
  const sig = await connection.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
  const c = await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  if (c.value.err) { console.error(`  failed on chain: ${JSON.stringify(c.value.err)} (signature ${sig})`); process.exit(1); }
  console.log(`  confirmed: ${sig}`);
}

async function main(): Promise<number> {
  if (cmd === "verify") return verify();
  const kp = payer();
  if (cmd === "create") {
    const slot = await connection.getSlot("finalized");
    const [createIx, table] = AddressLookupTableProgram.createLookupTable({ authority: kp.publicKey, payer: kp.publicKey, recentSlot: slot });
    const first = want.slice(0, CHUNK).map((k) => new PublicKey(k));
    const extendIx = AddressLookupTableProgram.extendLookupTable({ lookupTable: table, authority: kp.publicKey, payer: kp.publicKey, addresses: first });
    console.log(`new ${cluster} table address: ${table.toBase58()}`);
    await send(kp, [createIx, extendIx], `create + extend with entries 0–${first.length - 1}`);
    if (want.length > CHUNK) console.log(`then: extend --address ${table.toBase58()} (entries ${CHUNK}–${want.length - 1}), freeze, pin the address in networks.ts, verify`);
    else console.log(`then: freeze --address ${table.toBase58()}, pin the address in networks.ts, verify`);
    return 0;
  }
  const addressS = opt("address");
  if (!addressS) { console.error(`${cmd} needs --address <table>`); return 2; }
  const address = new PublicKey(addressS);
  const acc = await readTable(address);
  if (!acc) { console.error(`no lookup table at ${addressS} on ${cluster}`); return 1; }
  const have = acc.state.addresses.map((a) => a.toBase58());
  if (cmd === "extend") {
    if (have.some((k, i) => i < want.length && k !== want[i])) { console.error("the table is not a prefix of the expected entries; it cannot be repaired by extending (create a new one)"); printDiff(addressS, lookupTableProblems(cluster, addressS, acc.state, { address: addressS, authority: null }), have); return 1; }
    const missing = want.slice(have.length);
    if (!missing.length) { console.log("nothing to add: every expected entry is present"); return 0; }
    for (let i = 0; i < missing.length; i += CHUNK) {
      const part = missing.slice(i, i + CHUNK).map((k) => new PublicKey(k));
      await send(kp, [AddressLookupTableProgram.extendLookupTable({ lookupTable: address, authority: kp.publicKey, payer: kp.publicKey, addresses: part })], `extend with entries ${have.length + i}–${have.length + i + part.length - 1}`);
    }
    return 0;
  }
  // freeze: only a table that already matches
  const problems = lookupTableProblems(cluster, addressS, acc.state, { address: addressS, authority: acc.state.authority?.toBase58() ?? null });
  if (problems.length) { console.error("refusing to freeze a table that does not match the expected entries:"); printDiff(addressS, problems, have); return 1; }
  if (!acc.state.authority) { console.log("already frozen"); return 0; }
  await send(kp, [AddressLookupTableProgram.freezeLookupTable({ lookupTable: address, authority: kp.publicKey })], "freeze (removes the authority permanently)");
  return 0;
}

main().then((code) => process.exit(code), (e) => { console.error(String((e as Error)?.message ?? e).replace(/api[-_]?key=[^&\s]+/gi, "api-key=…")); process.exit(1); });
