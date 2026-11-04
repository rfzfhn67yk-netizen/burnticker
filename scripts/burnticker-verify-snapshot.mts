// VERIFY A PINNED REGISTRY SNAPSHOT (trust-ops item 1, 2026-10-10 night). Anyone can run this from the public tree; it needs no key and
// trusts nothing on our server unless you ask it to compare with it.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-verify-snapshot.mts <txid> [flags]
//
//   <txid>                 the snapshot's Arweave / Irys transaction id (GET /api/burnticker/v1/snapshots lists them; the daily post's footer
//                          and the status page show the latest)
//   --cluster mainnet      fetch from https://arweave.net/<txid> (default devnet: https://devnet.irys.xyz/<txid>)
//   --gateway <url>        another gateway (https://<gateway>/<txid>)
//   --file <path>          verify a local copy instead of downloading
//   --api <origin>         also fetch <origin>/api/burnticker/v1/snapshots and compare the recorded sha256, date and row counts
//   --sha256 <hex>         compare with this hash (e.g. the one in a post) without asking our API
//   --db <registry copy>   APPEND-ONLY CHECK: every row of the snapshot must still be in this (later) registry copy, unchanged (a backup made
//                          with sqlite3 .backup, or the auditor's copy) — readings / pairs / ends / pins exactly, rules on their identity and
//                          rule columns, receipts on their facts (in full once final)
//   --json                 one JSON document on stdout
//
// What it does: downloads the bytes, recomputes sha256, re-checks the header, that every line is canonical JSON (sorted keys, no
// whitespace), that tables come in the fixed order and rows in primary-key order, and counts the rows per table. Exit 0 = every check
// passed; 1 = a check failed; 2 = usage or download error.
import fs from "node:fs";
import { openRegistry } from "../src/lib/burnticker/registry.ts";
import { appendOnlyProblems, gatewayUrl, verifySnapshotBytes, type RowCounts } from "../src/lib/burnticker/ops/snapshot.ts";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined; };
const txid = args[0] && !args[0].startsWith("--") ? args[0] : null;
const file = opt("file");
if (!txid && !file) { console.error(fs.readFileSync(new URL(import.meta.url)).toString().split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n")); process.exit(2); }

let text: string, source: string;
try {
  if (file) { text = fs.readFileSync(file, "utf8"); source = file; }
  else {
    source = gatewayUrl(txid!, opt("cluster") === "mainnet" ? "mainnet" : "devnet", opt("gateway"));
    const r = await fetch(source, { signal: AbortSignal.timeout(60_000), headers: { "user-agent": "burnticker-verify-snapshot/1" } });
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${source}`);
    text = await r.text();
  }
} catch (e) { console.error(`verify-snapshot: ${(e as Error).message}`); process.exit(2); }

let expect: { sha256?: string | null; rowCounts?: RowCounts | null; date?: string | null } = { sha256: opt("sha256") ?? null };
const apiNotes: string[] = [];
const api = opt("api");
if (api && txid) {
  try {
    const r = await fetch(`${api.replace(/\/$/, "")}/api/burnticker/v1/snapshots`, { signal: AbortSignal.timeout(20_000) });
    const j = (await r.json()) as { snapshots?: { date: string; sha256: string; arweaveTxId: string; rowCounts: RowCounts }[] };
    const rec = j.snapshots?.find((s) => s.arweaveTxId === txid);
    if (!rec) apiNotes.push(`the API at ${api} lists no snapshot with transaction ${txid}`);
    else expect = { sha256: expect.sha256 ?? rec.sha256, rowCounts: rec.rowCounts, date: rec.date };
  } catch (e) { apiNotes.push(`the API at ${api} could not be read: ${(e as Error).message.slice(0, 120)}`); }
}
const check = verifySnapshotBytes(text, expect);
const problems = [...apiNotes, ...check.problems];
let appendOnly: string[] | null = null;
const dbPath = opt("db");
if (dbPath) {
  if (!fs.existsSync(dbPath)) { console.error(`no registry copy at ${dbPath}`); process.exit(2); }
  const reg = openRegistry(dbPath);
  try { appendOnly = appendOnlyProblems(text, reg); } finally { reg.close(); }
  problems.push(...appendOnly);
}
const ok = problems.length === 0;
if (flag("json")) console.log(JSON.stringify({ ok, source, sha256: check.sha256, date: check.date, bytes: check.bytes, rowCounts: check.rowCounts, problems, appendOnlyChecked: appendOnly !== null }, null, 2));
else {
  console.log(`${ok ? "SNAPSHOT VERIFIED" : "SNAPSHOT CHECK FAILED"} — ${source}`);
  console.log(`  date ${check.date ?? "?"} · ${check.bytes} bytes · sha256 ${check.sha256}`);
  console.log(`  rows: ${Object.entries(check.rowCounts).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  if (expect.sha256) console.log(`  recorded sha256 ${expect.sha256} ${expect.sha256 === check.sha256 ? "(matches)" : "(DIFFERS)"}`);
  if (appendOnly !== null) console.log(`  append-only against ${dbPath}: ${appendOnly.length ? `${appendOnly.length} problem(s)` : "every row still present, unchanged"}`);
  for (const p of problems) console.log(`  ✗ ${p}`);
}
process.exit(ok ? 0 : 1);
