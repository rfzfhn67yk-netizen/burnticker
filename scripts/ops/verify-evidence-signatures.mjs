#!/usr/bin/env node
// THE DEVNET EVIDENCE VERIFIER (2026-10-10). The public-repo leak scan (config/public-repo.denypatterns) flags every 86–88-character
// base58 token, because a base58 64-byte SECRET KEY has the same shape as a transaction SIGNATURE. The devnet rehearsal record is full
// of signatures, so its files are exempted from that one pattern by path — and this script is what justifies the exemption:
//
//   1. every 86–88-char base58 token in the files below must base58-decode to exactly 64 bytes AND be a transaction the public devnet
//      RPC knows (getSignatureStatuses with searchTransactionHistory, then getTransaction for any it does not return). A secret key
//      can never pass: it is not a transaction id on any cluster.
//   2. the evidence directory must contain no 64-number JSON array (a solana-keygen key file's shape, even pretty-printed across
//      lines), no JSON field whose name contains "secret" or "keypair", and every JSON field whose name contains "key" must hold a
//      ≤ 44-char base58 pubkey (32 bytes), never anything longer.
//
//   node scripts/ops/verify-evidence-signatures.mjs [--rpc https://api.devnet.solana.com] [file|dir ...]
//   node scripts/ops/verify-evidence-signatures.mjs --cluster mainnet --rpc <a mainnet RPC> file ...   (2026-10-16: mainnet evidence, e.g.
//     the round-5 upgrade's Squads signatures; the RPC must answer with mainnet's genesis hash)
//   (default: both devnet run logs and every evidence directory — the 10-10 rehearsal and the pair_curve rehearsal)
//
// Exits 0 only when every token is a confirmed devnet transaction and the evidence directory is clean; prints one summary. Read-only.

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const rpcIdx = args.indexOf("--rpc");
const clIdx = args.indexOf("--cluster");
const CLUSTER = clIdx >= 0 ? args[clIdx + 1] : "devnet";
const GENESIS = { devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" }[CLUSTER];
if (!GENESIS) throw new Error("--cluster must be devnet or mainnet");
const RPC = rpcIdx >= 0 ? args[rpcIdx + 1] : CLUSTER === "devnet" ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com";
// Every directory under docs/burnkeeper/evidence/ is an evidence directory (the 10-10 rehearsal, then the pair_curve rehearsal).
const EVIDENCE_ROOT = "docs/burnkeeper/evidence/";
const DEFAULT_TARGETS = [
  "docs/burnkeeper/devnet-run.md", "docs/burnkeeper/devnet-run-log-2026-10-10.md", "docs/burnkeeper/evidence/devnet-2026-10-10",
  "docs/burnkeeper/devnet-paircurve-run-log-2026-10-10.md", "docs/burnkeeper/evidence/devnet-paircurve-2026-10-10",
  "docs/burnkeeper/devnet-lock-run-log-2026-10-10.md", "docs/burnkeeper/evidence/devnet-lock-2026-10-10",
  "docs/burnkeeper/devnet-lock-r2-run-log.md", "docs/burnkeeper/evidence/devnet-lock-r2",
  "docs/burnkeeper/devnet-pair-forward-run-log-2026-10-11.md", "docs/burnkeeper/evidence/devnet-pair-forward-2026-10-11",
  "docs/burnkeeper/devnet-pair-forward-r2-run-log.md", "docs/burnkeeper/evidence/devnet-pair-forward-r2",
  "docs/burnkeeper/devnet-pair-forward-r3-run-log.md", "docs/burnkeeper/evidence/devnet-pair-forward-r3",
];
const targets = args.filter((a, i) => !(a === "--rpc" || a === "--cluster" || (rpcIdx >= 0 && i === rpcIdx + 1) || (clIdx >= 0 && i === clIdx + 1)));
const files = (targets.length ? targets : DEFAULT_TARGETS).flatMap((t) => fs.statSync(t).isDirectory() ? fs.readdirSync(t).sort().map((f) => path.join(t, f)) : [t]);

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(s) {
  let n = 0n;
  for (const c of s) { const v = B58.indexOf(c); if (v < 0) return null; n = n * 58n + BigInt(v); }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of s) { if (c !== "1") break; bytes.unshift(0); }
  return Uint8Array.from(bytes);
}
async function rpc(method, params) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 1000 * 2 ** attempt)); continue; }
    const j = await r.json();
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result;
  }
  throw new Error(`${method}: rate-limited`);
}

const problems = [];
// 1. tokens
const RUN = /[1-9A-HJ-NP-Za-km-z]+/g;
const tokens = new Map();   // token -> Set(file:line)
let longerRuns = 0;
for (const f of files) {
  fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    // a base64 "Program data:" log line or a hex "dataHex" field is not a base58 value: a run of base58-looking characters inside it is
    // a slice of base64/hex, never a key or a signature (2026-10-15, round-5 evidence)
    if (/Program data: |"dataHex"/.test(line)) return;
    for (const m of line.matchAll(RUN)) {
      const t = m[0];
      if (t.length > 88) longerRuns++;
      if (t.length < 86 || t.length > 88) continue;
      if (!tokens.has(t)) tokens.set(t, new Set());
      tokens.get(t).add(`${f}:${i + 1}`);
    }
  });
}
if ((await rpc("getGenesisHash", [])) !== GENESIS) throw new Error(`the RPC is not ${CLUSTER}`);
const all = [...tokens.keys()];
const not64 = all.filter((t) => b58decode(t)?.length !== 64);
for (const t of not64) problems.push(`not a 64-byte value: ${t.slice(0, 12)}… at ${[...tokens.get(t)][0]}`);
const candidates = all.filter((t) => !not64.includes(t));
const status = new Map();
for (let i = 0; i < candidates.length; i += 200) {
  const chunk = candidates.slice(i, i + 200);
  const res = await rpc("getSignatureStatuses", [chunk, { searchTransactionHistory: true }]);
  chunk.forEach((s, k) => status.set(s, res.value[k]));
}
let viaGetTransaction = 0, landedWithError = 0, confirmed = 0;
for (const s of candidates) {
  let st = status.get(s);
  if (!st) {
    const tx = await rpc("getTransaction", [s, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);
    if (tx) { viaGetTransaction++; st = { confirmationStatus: "confirmed", err: tx.meta?.err ?? null }; }
  }
  if (!st || !["confirmed", "finalized"].includes(st.confirmationStatus)) { problems.push(`NOT a confirmed ${CLUSTER} transaction: ${s.slice(0, 12)}… at ${[...tokens.get(s)].join(", ")}`); continue; }
  confirmed++;
  if (st.err) landedWithError++;
}

// 2. the evidence directory: no key material
const evidence = files.filter((f) => f.startsWith(EVIDENCE_ROOT));
const ARRAY64 = /\[\s*(\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/;   // multi-line too: \s matches newlines
let jsonFiles = 0;
for (const f of evidence) {
  const text = fs.readFileSync(f, "utf8");
  if (ARRAY64.test(text)) problems.push(`64-number array (key-file shape) in ${f}`);
  if (/(^|[{,\s])"?[A-Za-z_]*(secret|keypair)[A-Za-z_]*"?\s*[:=]/i.test(text) && !f.endsWith(".json")) problems.push(`a secret/keypair field in ${f}`);
  if (!f.endsWith(".json")) continue;
  jsonFiles++;
  (function walk(x, where) {
    if (Array.isArray(x)) { if (x.length === 64 && x.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) problems.push(`64-byte array at ${where}`); x.forEach((v, i) => walk(v, `${where}[${i}]`)); return; }
    if (!x || typeof x !== "object") return;
    for (const [k, v] of Object.entries(x)) {
      if (/secret|keypair/i.test(k)) problems.push(`field "${k}" at ${where}`);
      if (/key/i.test(k) && typeof v === "string" && v.length > 44) problems.push(`field "${k}" holds a ${v.length}-char value (longer than a pubkey) at ${where}`);
      walk(v, `${where}.${k}`);
    }
  })(JSON.parse(text), f);
}

const occurrences = [...tokens.values()].reduce((a, s) => a + s.size, 0);
console.log(`verify-evidence-signatures: ${files.length} files, ${all.length} distinct 86–88-char base58 tokens (${occurrences} file:line occurrences)`);
console.log(`  64-byte decodes: ${candidates.length}/${all.length} · confirmed ${CLUSTER} transactions: ${confirmed}/${all.length} (${viaGetTransaction} via getTransaction, ${landedWithError} landed with a program error)`);
console.log(`  evidence dir: ${evidence.length} files (${jsonFiles} JSON parsed) — 64-number arrays / secret|keypair fields / over-long *key* fields: ${problems.filter((p) => !p.startsWith("NOT a") && !p.startsWith("not a")).length}`);
if (longerRuns) console.log(`  note: ${longerRuns} base58 run(s) longer than 88 chars (not the key shape; not checked)`);
if (problems.length) { console.log(`FAILED (${problems.length}):`); for (const p of problems) console.log(`  ${p}`); process.exit(1); }
// Scope (review item 16): this proves each token is a confirmed devnet signature and that the key-shape heuristics above found nothing.
// It does not authenticate burn programs, mints or amounts, recompute units, or prove the absence of every possible secret.
console.log(`PASSED: every token is a confirmed ${CLUSTER} transaction signature; no key-shaped material found in the evidence directory (64-byte arrays, secret/keypair fields, over-long *key* fields — heuristics, not a proof of no secrets)`);
