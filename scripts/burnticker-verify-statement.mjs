#!/usr/bin/env node
// CHECK THE OPERATOR STATEMENT YOURSELF (ops-2, 2026-10-12). Self-contained on purpose: no repository code, no packages, only Node's
// built-in ed25519. It downloads the statement the site publishes (GET <site>/api/burnticker/v1/operator), takes the signer's public
// key, the exact text and the signature from it, and checks the signature two ways: over the raw text (a wallet's signMessage), and over
// the text wrapped as a Solana off-chain message, version 0 (what `solana sign-offchain-message` and a Ledger produce). Read-only.
//
//   node scripts/burnticker-verify-statement.mjs                      # https://burnticker.com
//   node scripts/burnticker-verify-statement.mjs https://burnticker.com
//   node scripts/burnticker-verify-statement.mjs --file statement.json  # a saved copy of the API answer
//
// Then compare the signer with the developer fee wallet on the operator page and on any explorer: the statement only means something
// if that wallet is the one the platform's fees go to.
import crypto from "node:crypto";
import fs from "node:fs";

const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(s) {
  let n = 0n;
  for (const c of s) { const i = A.indexOf(c); if (i < 0) return null; n = n * 58n + BigInt(i); }
  let hex = n.toString(16); if (hex.length % 2) hex = `0${hex}`;
  const body = n === 0n ? Buffer.alloc(0) : Buffer.from(hex, "hex");
  let zeros = 0; for (const c of s) { if (c === "1") zeros++; else break; }
  return Buffer.concat([Buffer.alloc(zeros), body]);
}
function verify(bytes, sigB58, pubB58) {
  const sig = b58(sigB58), pk = b58(pubB58);
  if (!sig || sig.length !== 64 || !pk || pk.length !== 32) return false;
  const key = crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: pk.toString("base64url") }, format: "jwk" });
  return crypto.verify(null, bytes, key, sig);
}
function offchainV0(text, format) {
  const t = Buffer.from(text, "utf8"), len = Buffer.alloc(2); len.writeUInt16LE(t.length);
  return Buffer.concat([Buffer.from([0xff]), Buffer.from("solana offchain", "ascii"), Buffer.from([0, format]), len, t]);
}

const args = process.argv.slice(2);
let doc;
if (args[0] === "--file") doc = JSON.parse(fs.readFileSync(args[1], "utf8"));
else {
  const site = (args[0] ?? "https://burnticker.com").replace(/\/+$/, "");
  const r = await fetch(`${site}/api/burnticker/v1/operator`, { headers: { accept: "application/json" } });
  if (!r.ok) { console.error(`${site}/api/burnticker/v1/operator answered HTTP ${r.status}`); process.exit(2); }
  doc = await r.json();
}
const s = doc.signedMessage ?? doc;
if (!s || typeof s.message !== "string") { console.error("no signedMessage in that document"); process.exit(2); }
console.log(`signer     ${s.signer ?? "(none)"}`);
console.log(`text       ${s.message}`);
console.log(`signature  ${s.signature ?? "(none)"}`);
if (!s.signature || !s.signer) { console.log("result     not signed yet"); process.exit(1); }
if (/\{DATE\}|\{PUBKEY\}/.test(s.message)) { console.log("result     the text still has a blank in it, so it cannot be a signed statement"); process.exit(1); }
const raw = verify(Buffer.from(s.message, "utf8"), s.signature, s.signer);
const off = !raw && [0, 1, 2].some((f) => verify(offchainV0(s.message, f), s.signature, s.signer));
if (raw) console.log("result     VALID: the signer signed exactly this text (raw message)");
else if (off) console.log("result     VALID: the signer signed exactly this text (as a Solana off-chain message)");
else console.log("result     INVALID: the signature does not match this text and this signer");
process.exit(raw || off ? 0 : 1);
