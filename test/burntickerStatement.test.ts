// OPS-2 (2026-10-12): the operator statement — its text, the owner's signing script (keypair file or a signature made with the Solana
// CLI / a Ledger), the site's check (raw text or a Solana off-chain message) and the self-contained verifier anyone can run.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { loadOperator, signedMessageView, statementSignatureFormat, offchainMessageV0, walletOf } from "@/lib/burnticker/trustpack/operator";
import { b58encode } from "@/lib/burnticker/trustpack/base58";
import { lintCopy } from "@/lib/launch/copyLint";

const ROOT = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const run = (args: string[], cwd: string): Promise<{ code: number; out: string }> => new Promise((resolve) => {
  execFile(process.execPath, args, { cwd, env: { PATH: process.env.PATH ?? "", HOME: os.tmpdir(), NODE_ENV: "test" as const }, timeout: 60_000 }, (err: Error | null, so: string, se: string) => resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: `${so}${se}` }));
});
const SIGN = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", path.join(ROOT, "test/alias-hook.mjs"), path.join(ROOT, "scripts/burnticker-sign-statement.mts")];

/** A throwaway ed25519 key as a Solana CLI keypair file (seed ‖ public key) and its base58 public key. */
function throwawayKey(dir: string): { file: string; pub: string; priv: crypto.KeyObject } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(16);
  const pub = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  const file = path.join(dir, "key.json");
  fs.writeFileSync(file, JSON.stringify([...seed, ...pub]));
  return { file, pub: b58encode(pub), priv: privateKey };
}
/** The real file was signed on 2026-10-14; this puts the template back (status, {DATE}, no signature; the file keeps {PUBKEY}, the page fills it) so the signing tests run from the unsigned state. */
const SIGNED_AT = "2026-10-14";
function unsigned(real: string): string {
  return real.replace(`"status": "${SIGNED_AT}"`, '"status": "TODO_SIGNED_MESSAGE"').replace(`Date: ${SIGNED_AT}.`, "Date: {DATE}.").replace(/"signature": "[1-9A-HJ-NP-Za-km-z]{80,96}"/, '"signature": null');
}
/** A copy of operator.json in a temp root whose mainnet dev-fee wallet is `pub`. */
function tempRoot(pub: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-stmt-"));
  fs.mkdirSync(path.join(dir, "config/burnticker"), { recursive: true });
  const real = unsigned(read("config/burnticker/operator.json"));
  fs.writeFileSync(path.join(dir, "config/burnticker/operator.json"), real.replace(/("role": "dev-fee", "label": "Developer fee wallet \(also the operator treasury\)", "pubkey": ")[^"]+/, `$1${pub}`));
  return dir;
}

describe("the statement text", () => {
  const op = loadOperator();
  const m = op.signedMessage.message;
  test("plain ASCII under the off-chain message limit, signed 2026-10-14 (the template form keeps both blanks), naming the facts on the operator page", () => {
    assert.ok(/^[\x20-\x7e]+$/.test(m), "printable ASCII: a Ledger signs it as a restricted-ASCII off-chain message");
    assert.ok(Buffer.byteLength(m) <= 1212);
    assert.ok(m.includes("{PUBKEY}") && m.endsWith(`Date: ${SIGNED_AT}.`), "the file keeps {PUBKEY} (the page fills the signer) and holds the signing date");
    const t = JSON.parse(unsigned(read("config/burnticker/operator.json"))).signedMessage.message as string;
    assert.ok(t.includes("{PUBKEY}") && t.includes("{DATE}"), "the template form has both blanks");
    const main = op.clusters.mainnet;
    for (const v of [main.programs.burn_receipts, main.programs.pair_curve, main.squads.vault, walletOf(op, "mainnet", "keeper")!, op.operator.contact, "https://burnticker.com/burnticker/operator"]) assert.ok(m.includes(v), v);
    assert.match(m, /Two of its three members must approve any change\. I hold two of those member keys, and one other person holds the third\./);
    assert.match(m, /except Squads member C/, "the third signer's key is not claimed as the operator's");
    assert.doesNotMatch(m, /TODO_|Shane|Cassidy/i, "no name");
    assert.deepEqual(lintCopy(m).hits, []);
  });
  test("signed 2026-10-14: the status, text and signature sit on the lines the owner's todo names, and the signature verifies", () => {
    const lines = read("config/burnticker/operator.json").split("\n");
    assert.match(lines[83], /"status": "2026-10-14"/);
    assert.match(lines[86], /"message": "Burnticker operator statement\./);
    assert.match(lines[87], /"signature": "65w3gbP5ZBEFy9FHiWvzh5ctAGv9EbigVH6o9BF69GpsDiZxxDeasytF9s3z1uBYSwRVNNzbjqCaAQnq64FPkZwx"/);
    assert.match(read("docs/burnticker/TODO-OWNER.md"), /Signed operator statement — DONE 2026-10-14/);
    assert.match(read("config/burnticker/operator.json"), /with one exception: \$REHEARSAL, a test coin/);
  });
});

// the signature `solana sign-offchain-message` printed, kept as hex (base58 of these 64 bytes is what the CLI shows)
const CLI_SIG = b58encode(Buffer.from("50e0c5c25f0301a6c7488c424615f296efcef4d836a04db214283c2820e8a11dbe7c3b4788d854bb3b18cc385b3cc2d270a97a468d12893ce7a8821469adf40f", "hex"));
describe("the check: raw text, or a Solana off-chain message", () => {
  test("a signature made by `solana sign-offchain-message` (Agave CLI 4.3.0, throwaway key, 2026-10-12) verifies as off-chain", () => {
    assert.equal(statementSignatureFormat("Hello. Plain ASCII text.", CLI_SIG, "3k9JjUDbNXwbeq3GsMScpTWLkdrFEkEkzZ5Bbn828Bx8"), "offchain");
    assert.equal(statementSignatureFormat("Hello. Plain ASCII text!", CLI_SIG, "3k9JjUDbNXwbeq3GsMScpTWLkdrFEkEkzZ5Bbn828Bx8"), null, "one character changed");
  });
});

describe("burnticker-sign-statement.mts (in a temp copy; the real operator.json is never written)", () => {
  test("--keypair: signs the raw text, writes three single-line edits, and the page then shows it as signed", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bt-key-"));
    const k = throwawayKey(tmp); const root = tempRoot(k.pub);
    try {
      const before = fs.readFileSync(path.join(root, "config/burnticker/operator.json"), "utf8");
      const r = await run([...SIGN, "--date", "2026-10-14", "--keypair", k.file, "--write"], root);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /check {6}valid \(signed over the raw text\)/);
      assert.ok(!r.out.includes(JSON.stringify([...fs.readFileSync(k.file)]).slice(1, 40)), "no key bytes printed");
      const after = fs.readFileSync(path.join(root, "config/burnticker/operator.json"), "utf8");
      assert.equal(after.split("\n").length, before.split("\n").length);
      const changed = before.split("\n").map((l, i) => (l === after.split("\n")[i] ? -1 : i)).filter((i) => i >= 0);
      assert.deepEqual(changed, [83, 86, 87], "status, message, signature — nothing else");
      const v = signedMessageView(loadOperator(root));
      assert.equal(v.status, "signed"); assert.equal(v.verified, true); assert.match(v.message, /Date: 2026-10-14\.$/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); }
  });
  test("--keypair with a key that is not the signer wallet: refused, nothing written", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bt-key-"));
    const k = throwawayKey(tmp); const root = tempRoot("DLxTkuqMfp5D6b87SikjptfL1preaYH2WbMdMfxu6ZCJ");
    try {
      const before = fs.readFileSync(path.join(root, "config/burnticker/operator.json"), "utf8");
      const r = await run([...SIGN, "--date", "2026-10-14", "--keypair", k.file, "--write"], root);
      assert.notEqual(r.code, 0); assert.match(r.out, /Nothing was signed/);
      assert.equal(fs.readFileSync(path.join(root, "config/burnticker/operator.json"), "utf8"), before);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); }
  });
  test("--print-text then --signature (the hardware-wallet path): an off-chain signature is accepted and the page says how it was signed", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bt-key-"));
    const k = throwawayKey(tmp); const root = tempRoot(k.pub);
    try {
      const text = (await run([...SIGN, "--date", "2026-10-14", "--print-text"], root)).out;
      assert.ok(text.startsWith("Burnticker operator statement.") && text.includes(k.pub) && text.endsWith("Date: 2026-10-14."));
      const sig = b58encode(crypto.sign(null, offchainMessageV0(text, 0), k.priv));
      const bad = await run([...SIGN, "--date", "2026-10-15", "--signature", sig, "--write"], root);
      assert.equal(bad.code, 1, "a signature over another date is refused"); assert.match(bad.out, /CHECK FAILED/);
      const r = await run([...SIGN, "--date", "2026-10-14", "--signature", sig, "--write"], root);
      assert.equal(r.code, 0, r.out); assert.match(r.out, /signed as a Solana off-chain message/);
      const v = signedMessageView(loadOperator(root));
      assert.equal(v.verified, true); assert.match(v.detail, /It was signed as a Solana off-chain message/);
      // the self-contained verifier agrees, from a saved copy of what the API serves
      fs.writeFileSync(path.join(root, "op.json"), JSON.stringify({ signedMessage: v }));
      const ver = await run([path.join(ROOT, "scripts/burnticker-verify-statement.mjs"), "--file", path.join(root, "op.json")], root);
      assert.equal(ver.code, 0, ver.out); assert.match(ver.out, /VALID: the signer signed exactly this text \(as a Solana off-chain message\)/);
      fs.writeFileSync(path.join(root, "op.json"), JSON.stringify({ signedMessage: { ...v, message: v.message.replace("2026-10-14", "2026-10-15") } }));
      assert.equal((await run([path.join(ROOT, "scripts/burnticker-verify-statement.mjs"), "--file", path.join(root, "op.json")], root)).code, 1);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); }
  });
  test("the verifier is public and imports nothing from the repository; the trust page shows how to run it", () => {
    assert.ok(read("config/public-repo.allowlist").split("\n").includes("scripts/burnticker-verify-statement.mjs"));
    assert.doesNotMatch(read("scripts/burnticker-verify-statement.mjs"), /from "(?!node:)/);
    assert.match(read("src/lib/burnticker/trust.ts"), /node scripts\/burnticker-verify-statement\.mjs https:\/\/burnticker\.com/);
  });
});
