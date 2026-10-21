// THE TRUST PACK'S CLI (2026-10-10). Read-only: it reads public files and public RPCs; it never reads a key and never sends a transaction.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-trustpack.mts <command>
//
//   check-doc [--write|--check]      docs/burnticker/CHECK-THIS-YOURSELF.md from the checklist (the page's object)
//   well-known [--write|--check]     public/.well-known/burnticker.json + site/burnticker/.well-known/burnticker.json
//   fees-ledger                      <publish dir>/fees-ledger.json: the pinned developer fee wallet's ledger from chain (monthly is enough)
//   never-buys                       <publish dir>/never-buys.json: the operator-wallet monitor (run with the hourly audit on the keeper host)
//   verify <signature>               the receipt checks of /burnticker/check, in the terminal (devnet)
//   hash <file.so ...>               solana-verify's executable hash of a built or dumped program
//   fixtures                         re-capture test/fixtures/burnticker-trustpack/devnet-receipts.json from devnet
//
// Environment: BURNTICKER_PUBLISH_DIR (default data/burnticker-site), BURNTICKER_CLUSTER (devnet), BURNTICKER_RPC_URL (else the
// cluster's public endpoint).
import fs from "node:fs";
import path from "node:path";
import { buildChecklist, checklistMarkdown } from "../src/lib/burnticker/trustpack/checklist.ts";
import { WELL_KNOWN_PATHS, wellKnownText } from "../src/lib/burnticker/trustpack/wellKnown.ts";
import { buildFeeLedgerDoc, FEE_LEDGER_FILE, loadExpenses, readWalletHistory } from "../src/lib/burnticker/trustpack/ledger.ts";
import { evidenceSignatures, NEVER_BUYS_FILE, neverBuysExceptions, neverBuysWallets, runNeverBuys } from "../src/lib/burnticker/trustpack/neverBuys.ts";
import { loadOperator, pinnedDevFeeWallet, type Cluster } from "../src/lib/burnticker/trustpack/operator.ts";
import { checkReceiptTx, jsonRpc, PUBLIC_RPC } from "../src/lib/burnticker/trustpack/receiptCheck.ts";
import { sampleReceipts, DEVNET_PROGRAM_ID } from "../src/lib/burnticker/trustpack/samples.ts";
import { executableHash } from "../src/lib/burnticker/trustpack/verifiedBuild.ts";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (f: string) => rest.includes(f);
const ROOT = process.cwd();
const SITE = process.env.BURNTICKER_PUBLISH_DIR?.trim() || path.join("data", "burnticker-site");
const CLUSTER: Cluster = process.env.BURNTICKER_CLUSTER === "mainnet" ? "mainnet" : "devnet";
const RPC_URL = process.env.BURNTICKER_RPC_URL?.trim() || PUBLIC_RPC[CLUSTER];
export const CHECK_DOC = path.join("docs", "burnticker", "CHECK-THIS-YOURSELF.md");
export const FIXTURE = path.join("test", "fixtures", "burnticker-trustpack", "devnet-receipts.json");

function writeOrCheck(file: string, text: string): void {
  const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (flag("--check")) { if (cur !== text) { console.error(`${file} is out of date: run with --write`); process.exit(1); } console.log(`${file}: up to date`); return; }
  if (flag("--write")) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); console.log(`wrote ${file}`); return; }
  process.stdout.write(text);
}
function publish(name: string, body: unknown): void {
  fs.mkdirSync(SITE, { recursive: true });
  const f = path.join(SITE, name), tmp = `${f}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`);
  fs.renameSync(tmp, f);
  console.log(`wrote ${f}`);
}

switch (cmd) {
  case "check-doc": writeOrCheck(CHECK_DOC, checklistMarkdown(buildChecklist(ROOT))); break;
  case "well-known": { const t = wellKnownText(ROOT); for (const p of WELL_KNOWN_PATHS) writeOrCheck(p, t); break; }
  case "fees-ledger": {
    const op = loadOperator(ROOT), wallet = pinnedDevFeeWallet(op, CLUSTER), expenses = loadExpenses(ROOT);
    const history = wallet ? await readWalletHistory(jsonRpc(RPC_URL, fetch, { attempts: 8, minIntervalMs: 150 }), wallet) : null;
    const doc = buildFeeLedgerDoc({ cluster: CLUSTER, wallet, history, expenses });
    publish(FEE_LEDGER_FILE, doc);
    console.log(`${CLUSTER} ${wallet ?? "(no wallet)"}: ${doc.totals.transactions} transaction(s), in ${doc.totals.inLamports} lamports, out ${doc.totals.outLamports}`);
    break;
  }
  case "never-buys": {
    const op = loadOperator(ROOT), cl = op.clusters[CLUSTER];
    const exceptions = CLUSTER === "mainnet" ? neverBuysExceptions(ROOT) : [];
    const wallets = neverBuysWallets(cl.wallets, exceptions);
    const r = await runNeverBuys({ rpc: jsonRpc(RPC_URL, fetch, { attempts: 8, minIntervalMs: 150 }), cluster: CLUSTER, wallets, mints: cl.platformMints.map((m) => ({ symbol: m.symbol, mint: m.mint })), evidence: evidenceSignatures(ROOT), exceptions });
    publish(NEVER_BUYS_FILE, r);
    console.log(`${CLUSTER}: ${r.status} — ${r.line}`);
    for (const a of r.acquisitions) console.log(`  ${a.role} +${a.amountRaw} $${a.symbol} ${a.signature.slice(0, 16)}… ${a.explainedBy ? `explained by ${a.explainedBy}` : "UNEXPLAINED"}`);
    for (const e of r.errors) console.log(`  error: ${e}`);
    process.exit(r.status === "red" ? 3 : 0);
  }
  case "verify": {
    const sig = rest[0];
    const s = sampleReceipts(ROOT);
    const sample = s.receipts.find((x) => x.signature === sig);
    const r = await checkReceiptTx({ signature: sig, cluster: "devnet", programId: DEVNET_PROGRAM_ID, rpc: jsonRpc(process.env.BURNTICKER_RPC_URL?.trim() || PUBLIC_RPC.devnet), rulesText: sample ? s.rules[sample.rulesPath] ?? null : null, fetchSource: (u) => fetch(u) });
    for (const c of r.checks) console.log(`${c.ok === true ? "✓" : c.ok === false ? "✗" : "–"} ${c.label}: ${c.detail}`);
    console.log(r.verified ? "VERIFIED" : "NOT VERIFIED");
    process.exit(r.verified ? 0 : 1);
  }
  case "hash": for (const f of rest) console.log(executableHash(fs.readFileSync(f)), f); break;
  case "fixtures": {
    const rpc = jsonRpc(PUBLIC_RPC.devnet);
    const s = sampleReceipts(ROOT);
    const pick = [s.receipts.find((r) => r.ticker === "DEFICIT" && r.recordDate === "2026-10-06"), s.receipts.find((r) => r.ticker === "PCA" && r.recordDate === "2026-10-07")].filter((x) => !!x);
    const out: unknown[] = [];
    for (const r of pick) {
      const tx = await rpc.call<{ transaction: { signatures?: string[]; message: { accountKeys: string[] } }; meta: { loadedAddresses?: { writable: string[]; readonly: string[] } } }>("getTransaction", [r.signature, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
      const keys = [...tx.transaction.message.accountKeys, ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])];
      const acc = await rpc.call<{ value: ({ owner: string } | null)[] }>("getMultipleAccounts", [keys, { encoding: "base64", commitment: "confirmed" }]);
      // the signature lives in the evidence file (the leak scan exempts those by path); the fixture keys by evidence file + date
      delete tx.transaction.signatures;
      out.push({ ticker: r.ticker, recordDate: r.recordDate, evidence: r.evidence, rulesPath: r.rulesPath, tx, accounts: { value: acc.value.map((a) => (a && a.owner === DEVNET_PROGRAM_ID ? a : null)) } });
    }
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, `${JSON.stringify({ capturedAt: new Date().toISOString().slice(0, 10), cluster: "devnet", programId: DEVNET_PROGRAM_ID, note: "Frozen devnet bytes for test/burntickerTrustPackVerifier.test.ts: getTransaction (json; signatures removed — the signature is in the named evidence file) and getMultipleAccounts (accounts not owned by the burn program nulled). Re-capture: scripts/burnticker-trustpack.mts fixtures.", receipts: out }, null, 1)}\n`);
    console.log(`wrote ${FIXTURE} (${out.length} receipts)`);
    break;
  }
  default:
    console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(0, 16).join("\n"));
    process.exit(cmd ? 2 : 0);
}
