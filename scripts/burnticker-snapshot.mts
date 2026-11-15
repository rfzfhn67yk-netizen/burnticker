// THE REGISTRY SNAPSHOT BY HAND (trust-ops item 1, 2026-10-10 night). The keeper takes one snapshot per UTC day by itself
// (src/lib/burnticker/ops/snapshot.ts: canonical JSONL of rules, readings, receipts, pairs, pair outcomes, rule ends and launch pins
// → Arweave through Irys → the write-once `snapshots` table). This script is the same job on demand. THIS FILE HOLDS NO KEY: the Irys
// payer is BURNTICKER_UPLOAD_PAYER from the environment (the ops wallet that pays for uploads, never the keeper signer); without it the
// upload is REFUSED (exit 3) — there is no server-hosted fallback and nothing claims a snapshot that is not on Arweave.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-snapshot.mts --now
//        take today's (UTC) snapshot now if it has not been taken; prints the record (an existing one is printed as is, exit 0)
//   … --list                 every recorded snapshot, newest first
//   … --export <file>        write the canonical JSONL to a local file and print its sha256 (no upload, nothing recorded)
//
//   BURNTICKER_DB (data/burnticker.db) · BURNTICKER_CLUSTER (devnet → Irys devnet; mainnet → Arweave) · BURNTICKER_UPLOAD_PAYER
import fs from "node:fs";
import { openRegistry, REGISTRY_FILE } from "../src/lib/burnticker/registry.ts";
import { uploaderFromEnv } from "../src/lib/burnticker/pin.ts";
import { exportLedger, listSnapshots, SnapshotRefused, takeSnapshot, utcDay } from "../src/lib/burnticker/ops/snapshot.ts";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined; };
const DB = process.env.BURNTICKER_DB?.trim() || REGISTRY_FILE;
const cluster = process.env.BURNTICKER_CLUSTER?.trim() === "mainnet" ? "mainnet" : "devnet";

if (!flag("now") && !flag("list") && !opt("export")) {
  console.error(fs.readFileSync(new URL(import.meta.url)).toString().split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(2);
}
if (!fs.existsSync(DB)) { console.error(`no registry at ${DB}`); process.exit(2); }
const registry = openRegistry(DB);
try {
  if (flag("list")) { console.log(JSON.stringify(listSnapshots(registry), null, 2)); process.exit(0); }
  const out = opt("export");
  if (out) {
    const ex = exportLedger(registry, utcDay(Date.now()));
    fs.writeFileSync(out, ex.text);
    console.log(JSON.stringify({ file: out, sha256: ex.sha256, bytes: ex.bytes, rowCounts: ex.rowCounts, note: "local export only: not uploaded, not recorded" }, null, 2));
    process.exit(0);
  }
  const r = await takeSnapshot({ registry, uploader: uploaderFromEnv(process.env, cluster), now: Date.now(), cluster, log: (s) => console.error(s) });
  console.log(JSON.stringify({ ...r.record, status: r.status, verify: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-verify-snapshot.mts ${r.record.arweaveTxId} --cluster ${cluster}` }, null, 2));
} catch (e) {
  console.error(`snapshot: ${(e as Error).message}`);
  process.exit(e instanceof SnapshotRefused ? 3 : 1);
} finally { registry.close(); }
