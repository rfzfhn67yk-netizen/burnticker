// SIGN THE OPERATOR STATEMENT (ops-2, 2026-10-12). The OWNER runs this; no agent ever does. It signs nothing on any chain and sends
// nothing anywhere: it reads config/burnticker/operator.json, fills {PUBKEY} and {DATE}, signs the exact text with a key the owner
// chooses (or checks a signature the owner made elsewhere), verifies it the same way the site does, and optionally writes the three
// single-line edits back into operator.json (status, message, signature; every line keeps its line number, so the file:line pointers in
// docs/burnticker/TODO-OWNER.md stay right). The key's bytes are never printed.
//
//   R="node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs"
//   $R scripts/burnticker-sign-statement.mts --date 2026-10-14 --print-text
//        prints only the exact text to sign (for a hardware wallet: solana sign-offchain-message -k usb://ledger "<that text>"; for a
//        browser wallet such as Phantom: /burnticker/operator/sign-statement, which shows the same text and signs it with signMessage)
//        Once signed, the message holds its day in place of {DATE}; the template is that message with the day put back (statement.ts).
//   $R scripts/burnticker-sign-statement.mts --date 2026-10-14 --signature <base58> [--write]
//        checks a signature made elsewhere (raw, or a Solana off-chain message as the CLI and a Ledger make it)
//   $R scripts/burnticker-sign-statement.mts --date 2026-10-14 --keypair <path to a Solana CLI keypair file> [--write]
//        signs the raw text with that key; refuses unless its public key is the signer wallet on the operator page
//   --role <role>   the operator.json wallet role that signs (default: signedMessage.signerRole, today dev-fee). With --write, a
//                   different role is written into signerRole too, and the page then names that wallet as the signer.
//
// After --write: node … scripts/burnticker-trustpack.mts well-known --write, then the tests (npm test), then ship. Anyone can re-check
// the published statement with scripts/burnticker-verify-statement.mjs (no repository code; it reads GET /api/burnticker/v1/operator).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadOperator, statementSignatureFormat, walletOf, OPERATOR_FILE } from "../src/lib/burnticker/trustpack/operator.ts";
import { b58encode } from "../src/lib/burnticker/trustpack/base58.ts";
import { isStatementDate, statementTemplate, statementText } from "../src/lib/burnticker/trustpack/statement.ts";

const args = process.argv.slice(2);
const opt = (n: string): string | null => { const i = args.indexOf(`--${n}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const flag = (n: string) => args.includes(`--${n}`);
const die = (s: string, code = 2): never => { console.error(s); process.exit(code); };

const date = opt("date") ?? die("--date YYYY-MM-DD is required (the date written into the statement).");
if (!isStatementDate(date)) die(`--date must be YYYY-MM-DD, not ${date}`);
const cfg = loadOperator();
const sm = cfg.signedMessage;
const role = opt("role") ?? sm.signerRole;
const signer = walletOf(cfg, sm.cluster, role) ?? die(`operator.json has no ${sm.cluster} wallet with the role ${role}.`);
// the template and the text come from statement.ts, which the signing page (/burnticker/operator/sign-statement) uses too
const tpl = statementTemplate(sm);
if ("problem" in tpl) die(tpl.problem);
const { template, signedOn } = tpl as { template: string; signedOn: string | null };
const text = statementText(template, signer, date);

if (flag("print-text")) { process.stdout.write(text); process.exit(0); }

let signature: string;
const given = opt("signature"), keyPath = opt("keypair");
if (given && keyPath) die("give --signature or --keypair, not both.");
if (keyPath) {
  const raw = JSON.parse(fs.readFileSync(path.resolve(keyPath.replace(/^~(?=\/)/, process.env.HOME ?? "~")), "utf8")) as unknown;
  if (!Array.isArray(raw) || raw.length !== 64 || !raw.every((x) => Number.isInteger(x) && x >= 0 && x < 256)) die(`${keyPath} is not a Solana CLI keypair file (a JSON array of 64 bytes). For a hardware wallet use --print-text, then --signature.`);
  const bytes = Uint8Array.from(raw as number[]);
  const pub = b58encode(bytes.subarray(32));
  if (pub !== signer) { bytes.fill(0); die(`that key is ${pub}, but the ${role} wallet on the operator page is ${signer}. Nothing was signed.`); }
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(bytes.subarray(0, 32))]);
  const key = crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  bytes.fill(0); der.fill(0);
  signature = b58encode(crypto.sign(null, Buffer.from(text, "utf8"), key));
} else if (given) {
  signature = given.trim();
} else {
  die("give --keypair <path> to sign here, or --signature <base58> to check one made elsewhere (see --print-text).");
}

const format = statementSignatureFormat(text, signature!, signer);
console.log(`signer     ${signer} (${role}, ${sm.cluster})`);
console.log(`date       ${date}`);
if (signedOn) console.log(`note       operator.json is already signed for ${signedOn}; --write replaces that signature`);
console.log(`signature  ${signature!}`);
if (!format) die("CHECK FAILED: the signature does not verify for this text and this signer. Nothing was written.", 1);
console.log(`check      valid (${format === "raw" ? "signed over the raw text" : "signed as a Solana off-chain message"})`);

const file = path.join(process.cwd(), OPERATOR_FILE);
const before = fs.readFileSync(file, "utf8");
const lines = before.split("\n");
const lineOf = (key: string, inside: string) => {
  const start = lines.findIndex((l) => l.trim().startsWith(`"${inside}": {`));
  const i = lines.findIndex((l, k) => k > start && l.trim().startsWith(`"${key}": `));
  return i < 0 ? die(`operator.json: no "${key}" line under "${inside}"`) : i;
};
const set = (i: number, key: string, value: string | null) => {
  const indent = lines[i].slice(0, lines[i].length - lines[i].trimStart().length), comma = lines[i].trimEnd().endsWith(",") ? "," : "";
  const next = `${indent}"${key}": ${JSON.stringify(value)}${comma}`;
  console.log(`  line ${i + 1}: "${key}" → ${key === "message" ? "the text above" : JSON.stringify(value)}`);
  lines[i] = next;
};
console.log(flag("write") ? `writing ${OPERATOR_FILE}:` : `the edits for ${OPERATOR_FILE} (add --write to apply them):`);
set(lineOf("status", "signedMessage"), "status", date);
if (role !== sm.signerRole) set(lineOf("signerRole", "signedMessage"), "signerRole", role);
set(lineOf("message", "signedMessage"), "message", template.replace("{DATE}", date));
set(lineOf("signature", "signedMessage"), "signature", signature!);
if (flag("write")) {
  const after = lines.join("\n");
  JSON.parse(after);
  if (after.split("\n").length !== before.split("\n").length) die("refusing: the edit would change the line count.");
  fs.writeFileSync(file, after);
  const check = loadOperator();
  const ok = statementSignatureFormat(check.signedMessage.message.replace("{PUBKEY}", signer), check.signedMessage.signature ?? "", signer);
  console.log(ok ? "written and re-read: the page will show it as signed." : "written, but the re-read does not verify. Restore the file with git checkout.");
  console.log("next: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-trustpack.mts well-known --write && npm test");
}
