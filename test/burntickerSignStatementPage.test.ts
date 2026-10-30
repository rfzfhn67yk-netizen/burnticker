// THE STATEMENT SIGNING PAGE (owner, 2026-10-18; /burnticker/operator/sign-statement). The developer fee wallet is a plain Phantom wallet,
// so the statement is signed in the browser with signMessage. Held here: the gate is the claim page's; the page's text is the script's
// --print-text for the same day (signed and template states); a wallet that is not the signer is refused before it is asked; the
// signature's base58 round trip and the browser check agree with the site's; the page imports no key and no environment value.
// Throwaway keys and temp copies of operator.json only; nothing reaches a network and the real operator.json is never written.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { v1OpsStatementText } from "@/lib/burnticker/trustpack/statementOps";
import { v1OpsPlatformFees } from "@/lib/burnticker/platformFeeClaim";
import { SIGN_STATEMENT_COPY, isStatementDate, signStatement, statementCommands, statementSignatureFormatInBrowser, statementTemplate, statementText, todayUtc, wrongSignerProblem, type StatementTextView } from "@/lib/burnticker/trustpack/statement";
import { loadOperator, offchainMessageV0, statementSignatureFormat } from "@/lib/burnticker/trustpack/operator";
import { b58decode, b58encode } from "@/lib/burnticker/trustpack/base58";
import { lintCopy } from "@/lib/launch/copyLint";
import { API, callRoute } from "./burntickerApiHelpers.ts";

const ROOT = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const ENV = { BURNTICKER_OPS_PIN: "1234", BURNTICKER_CLUSTER: "mainnet" };
const req = (o: { host?: string; pin?: string; date?: string } = {}) => new Request(`http://localhost/api/burnticker/v1/ops/statement-text${o.date ? `?date=${o.date}` : ""}`, { headers: { host: o.host ?? "localhost", ...(o.pin ? { "x-action-pin": o.pin } : {}) } });
const feeReq = (o: { host?: string; pin?: string } = {}) => new Request("http://localhost/api/burnticker/v1/ops/platform-fees", { headers: { host: o.host ?? "localhost", ...(o.pin ? { "x-action-pin": o.pin } : {}) } });
const noChain = { calls: 0, async getMultipleAccountsInfo() { noChain.calls++; return []; } };
const SIGN = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", path.join(ROOT, "test/alias-hook.mjs"), path.join(ROOT, "scripts/burnticker-sign-statement.mts")];
const run = (args: string[], cwd: string): Promise<{ code: number; out: string }> => new Promise((resolve) => {
  execFile(process.execPath, args, { cwd, env: { PATH: process.env.PATH ?? "", HOME: os.tmpdir(), NODE_ENV: "test" as const }, timeout: 60_000 }, (err: Error | null, so: string, se: string) => resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: `${so}${se}` }));
});

/** A throwaway ed25519 key: its base58 public key and a signMessage that signs the raw bytes, as Phantom does. */
function throwaway() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const pub = b58encode(Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url"));
  return { pub, priv: privateKey, signMessage: async (bytes: Uint8Array) => new Uint8Array(crypto.sign(null, bytes, privateKey)) };
}
/** A temp root holding operator.json with the mainnet dev-fee wallet set to `pub`; `template` puts {DATE} back and clears the signature. */
function tempRoot(pub: string, template = false): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-signpage-"));
  fs.mkdirSync(path.join(dir, "config/burnticker"), { recursive: true });
  const j = JSON.parse(read("config/burnticker/operator.json"));
  const w = j.clusters.mainnet.wallets.find((x: { role: string }) => x.role === "dev-fee"); w.pubkey = pub;
  if (template) { j.signedMessage.message = j.signedMessage.message.replace(`Date: ${j.signedMessage.status}.`, "Date: {DATE}."); j.signedMessage.status = "TODO_SIGNED_MESSAGE"; j.signedMessage.signature = null; }
  fs.writeFileSync(path.join(dir, "config/burnticker/operator.json"), JSON.stringify(j, null, 2));
  return dir;
}

describe("the gate is the claim page's", () => {
  test("off the operator's network, with no PIN configured, without the PIN and with a wrong one: the same answer as the claim page", async () => {
    const cases: [{ host?: string; pin?: string }, Record<string, string>][] = [[{ host: "burnticker.com", pin: "1234" }, ENV], [{ pin: "1234" }, { BURNTICKER_CLUSTER: "mainnet" }], [{}, ENV], [{ pin: "nope" }, ENV]];
    for (const [o, env] of cases) {
      const mine = v1OpsStatementText(req(o), env, ROOT), theirs = await v1OpsPlatformFees(feeReq(o), env, noChain);
      assert.ok(mine.status >= 400, JSON.stringify(o));
      assert.deepEqual(mine, theirs, JSON.stringify(o));
    }
    assert.equal(noChain.calls, 0);
    assert.equal(v1OpsStatementText(req({ pin: "1234" }), ENV, ROOT).status, 200);
  });
  test("the route with no PIN answers as the claim route does", async () => {
    const a = await callRoute(`${API}/ops/statement-text`), b = await callRoute(`${API}/ops/platform-fees`);
    assert.equal(a.status, 403); assert.equal(a.status, b.status);
    assert.deepEqual(await a.json(), await b.json());
  });
  test("the page shows only the PIN box until the gated read answers, keeps the PIN in memory, and carries no fact of its own", () => {
    const page = read("src/app/burnticker/operator/sign-statement/page.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.match(page, /return <SignStatement \/>/);
    assert.match(page, /robots: \{ index: false, follow: false \}/);
    assert.doesNotMatch(page, /8cwwy|signedMessage|operator\.json"/, "the server page carries no fact of its own");
    const c = read("src/app/burnticker/operator/sign-statement/SignStatement.tsx");
    assert.match(c, /"x-action-pin": p/);
    assert.match(c, /\/api\/burnticker\/v1\/ops\/statement-text\?date=/);
    assert.match(c, /!activePin \? \(/);
    assert.match(c, /\{v && \(/, "the view renders only from the gated read");
    assert.doesNotMatch(c, /localStorage|sessionStorage|document\.cookie|indexedDB/, "nothing is stored");
    assert.equal((c.match(/fetch\(/g) ?? []).length, 1, "one read; the signature is never sent");
    assert.doesNotMatch(c, /method: "POST"|sendBeacon|signTransaction|sendTransaction/);
    assert.doesNotMatch(c, /8cwwy/, "no address is baked into the client");
  });
  test("a bad date is refused; no date means today in UTC", () => {
    assert.equal(v1OpsStatementText(req({ pin: "1234", date: "2026-02-30" }), ENV, ROOT).status, 400);
    assert.equal(v1OpsStatementText(req({ pin: "1234", date: "tomorrow" }), ENV, ROOT).status, 400);
    const now = Date.parse("2026-10-18T23:59:00Z");
    assert.equal((v1OpsStatementText(req({ pin: "1234" }), ENV, ROOT, now).body as StatementTextView).date, "2026-10-18");
    assert.equal(todayUtc(now), "2026-10-18"); assert.ok(isStatementDate("2028-02-29")); assert.ok(!isStatementDate("2027-02-29"));
  });
  test("the operation is in the OpenAPI document as operator only", () => {
    assert.match(read("src/lib/burnticker/api/featuresSpec.ts"), /operationId: "getOpsStatementText".*path: "\/ops\/statement-text".*errors: \[400, 401, 403, 429, 503\]/);
    assert.ok(read("docs/burnticker/api.md").includes("/ops/statement-text"));
  });
});

describe("the page's text is the script's --print-text for the same day", () => {
  test("the real operator.json (signed or a template): the rebuilt template gives back the signed text for its own day, and other days match too", async () => {
    const op = loadOperator(ROOT), sm = op.signedMessage;
    const tpl = statementTemplate(sm);
    assert.ok(!("problem" in tpl));
    const signedNow = sm.signature !== null;
    assert.equal(tpl.signedOn, signedNow ? sm.status : null);
    for (const date of [...(signedNow ? [sm.status] : []), "2026-10-18", "2027-01-02"]) {
      const v = v1OpsStatementText(req({ pin: "1234", date }), ENV, ROOT).body as StatementTextView;
      const s = await run([...SIGN, "--date", date, "--print-text"], ROOT);
      assert.equal(s.code, 0, s.out);
      assert.equal(v.text, s.out, date);
      assert.equal(v.signedOn, tpl.signedOn);
    }
    if (!signedNow) return;
    const own = v1OpsStatementText(req({ pin: "1234", date: sm.status }), ENV, ROOT).body as StatementTextView;
    assert.equal(own.text, sm.message.replace("{PUBKEY}", own.signer), "the signed day gives back the signed text");
    assert.ok(statementSignatureFormat(own.text, sm.signature!, own.signer), "and the published signature still verifies over it");
  });
  test("a template operator.json: the same text from both, and signedOn is null", async () => {
    const k = throwaway(), dir = tempRoot(k.pub, true);
    const v = v1OpsStatementText(req({ pin: "1234", date: "2026-10-20" }), ENV, dir).body as StatementTextView;
    const s = await run([...SIGN, "--date", "2026-10-20", "--print-text"], dir);
    assert.equal(s.code, 0, s.out); assert.equal(v.text, s.out); assert.equal(v.signedOn, null); assert.equal(v.signer, k.pub);
    assert.ok(v.text.includes(k.pub) && v.text.endsWith("Date: 2026-10-20."));
  });
  test("a message that names its day twice has no template, for the page and the script alike", async () => {
    assert.match((statementTemplate({ status: "2026-10-14", message: "A 2026-10-14 B 2026-10-14" }) as { problem: string }).problem, /2 times/);
    assert.ok("problem" in statementTemplate({ status: "TODO_X", message: "no day" }));
    assert.equal(statementText("{PUBKEY} on {DATE}", "K", "2026-10-20"), "K on 2026-10-20");
  });
  test("a Phantom signature from the page goes through the script's --signature --write and the page then shows it as signed", async () => {
    const k = throwaway(), dir = tempRoot(k.pub, true);
    const v = v1OpsStatementText(req({ pin: "1234", date: "2026-10-20" }), ENV, dir).body as StatementTextView;
    const r = await signStatement(v, k.pub, k.signMessage);
    assert.ok(r.ok); assert.equal(r.format, "raw");
    const [write, wellKnown] = statementCommands(v.date, r.signature);
    assert.match(wellKnown, /scripts\/burnticker-trustpack\.mts well-known --write$/);
    const args = write.split(" ").slice(1).map((a) => (a === "./test/alias-hook.mjs" ? path.join(ROOT, "test/alias-hook.mjs") : a === "scripts/burnticker-sign-statement.mts" ? path.join(ROOT, a) : a));
    const s = await run(args, dir);
    assert.equal(s.code, 0, s.out); assert.match(s.out, /check {6}valid \(signed over the raw text\)/); assert.match(s.out, /written and re-read/);
    const after = loadOperator(dir).signedMessage;
    assert.equal(after.status, "2026-10-20"); assert.equal(after.signature, r.signature);
    // signing again for a new day needs no hand edit: the page rebuilds the template from the signed file
    const again = v1OpsStatementText(req({ pin: "1234", date: "2026-10-21" }), ENV, dir).body as StatementTextView;
    assert.equal(again.signedOn, "2026-10-20"); assert.ok(again.text.endsWith("Date: 2026-10-21."));
    const s2 = await run([...SIGN, "--date", "2026-10-21", "--print-text"], dir);
    assert.equal(again.text, s2.out);
  });
});

describe("only the signer wallet signs", () => {
  test("another wallet gets one plain sentence and its signMessage is never called", async () => {
    const k = throwaway(), other = throwaway();
    const v = { signer: k.pub, text: "Burnticker operator statement. Date: 2026-10-20." };
    let asked = 0;
    const r = await signStatement(v, other.pub, async (b) => { asked++; return other.signMessage(b); });
    assert.equal(asked, 0);
    assert.ok(!r.ok); assert.equal(r.error, wrongSignerProblem(other.pub, k.pub));
    assert.match(r.error, new RegExp(`^The connected wallet ${other.pub} is not the signer wallet ${k.pub} named in the statement, so nothing was signed\\.$`));
    assert.equal(r.error.split(/\.\s/).length, 1, "one sentence");
    assert.equal(wrongSignerProblem(k.pub, k.pub), null); assert.equal(wrongSignerProblem(null, k.pub), null);
    const none = await signStatement(v, null, k.signMessage); assert.ok(!none.ok); assert.equal(none.error, SIGN_STATEMENT_COPY.connect);
    const cannot = await signStatement(v, k.pub, undefined); assert.ok(!cannot.ok); assert.equal(cannot.error, SIGN_STATEMENT_COPY.noSignMessage);
    const c = read("src/app/burnticker/operator/sign-statement/SignStatement.tsx");
    assert.match(c, /: wrongWallet \? <p[^>]*>\{wrongWallet\}<\/p>/, "the page shows the sentence in place of the button");
  });
  test("a wallet that signs something else is caught by the browser check", async () => {
    const k = throwaway();
    const r = await signStatement({ signer: k.pub, text: "the text" }, k.pub, async () => k.signMessage(new TextEncoder().encode("other text")));
    assert.ok(r.ok); assert.equal(r.format, null);
  });
});

describe("base58 and the browser check", () => {
  test("the signature's base58 round trip, leading zero bytes included", () => {
    const k = throwaway();
    for (let i = 0; i < 50; i++) {
      const sig = new Uint8Array(crypto.sign(null, Buffer.from(`statement ${i}`), k.priv));
      if (i % 10 === 0) sig[0] = 0;
      if (i % 20 === 0) sig[1] = 0;
      const s = b58encode(sig);
      assert.deepEqual(b58decode(s), sig);
    }
  });
  test("the browser check (Web Crypto) agrees with the site's check on raw, off-chain (0, 1, 2), wrong signer and changed text", async () => {
    const k = throwaway(), other = throwaway(), text = "Burnticker operator statement. Date: 2026-10-20.";
    const raw = b58encode(crypto.sign(null, Buffer.from(text, "utf8"), k.priv));
    const cases: [string, string, string][] = [[text, raw, k.pub], [text, raw, other.pub], [`${text} `, raw, k.pub], [text, "notbase58!", k.pub]];
    for (const f of [0, 1, 2] as const) cases.push([text, b58encode(crypto.sign(null, offchainMessageV0(text, f), k.priv)), k.pub]);
    for (const [m, s, p] of cases) assert.equal(await statementSignatureFormatInBrowser(m, s, p), statementSignatureFormat(m, s, p), `${m} ${p}`);
    assert.equal(await statementSignatureFormatInBrowser(text, raw, k.pub), "raw");
    // the published statement, once signed, checks out in the browser exactly as on the server
    const op = loadOperator(ROOT); if (!op.signedMessage.signature) return;
    const v = v1OpsStatementText(req({ pin: "1234", date: op.signedMessage.status }), ENV, ROOT).body as StatementTextView;
    assert.equal(await statementSignatureFormatInBrowser(v.text, op.signedMessage.signature!, v.signer), "raw");
  });
});

describe("the page never imports a key or an environment value", () => {
  test("the client, the server page and the shared text module: no env, no key file, no Node module, no secret", () => {
    for (const f of ["src/app/burnticker/operator/sign-statement/SignStatement.tsx", "src/app/burnticker/operator/sign-statement/page.tsx", "src/lib/burnticker/trustpack/statement.ts"]) {
      const s = read(f);
      assert.doesNotMatch(s, /process[.]env|import[.]meta[.]env|NEXT_PUBLIC_|[.]env\b/, `${f}: no environment value`);
      assert.doesNotMatch(s, /keypair|secretKey|privateKey|Keypair|fromSecretKey|createPrivateKey|id\.json/i, `${f}: no key`);
      assert.doesNotMatch(s, /from\s"node:|from\s"fs"|from\s"path"|require\(/, `${f}: no Node module`);
    }
    const imports = [...read("src/app/burnticker/operator/sign-statement/SignStatement.tsx").matchAll(/from\s"([^"]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(imports, ["../../_components/WalletButton", "@/lib/burnticker/trustpack/statement", "@solana/wallet-adapter-react", "next/link", "react"]);
    assert.deepEqual([...read("src/lib/burnticker/trustpack/statement.ts").matchAll(/from\s"([^"]+)"/g)].map((m) => m[1]), ["@/lib/burnticker/trustpack/base58"]);
  });
  test("the script and the page build the text from the one shared module", () => {
    const script = read("scripts/burnticker-sign-statement.mts");
    assert.match(script, /import \{ isStatementDate, statementTemplate, statementText \} from\s"[.][.]\/src\/lib\/burnticker\/trustpack\/statement[.]ts"/);
    assert.match(script, /const text = statementText\(template, signer, date\)/);
    assert.match(read("src/lib/burnticker/trustpack/statementOps.ts"), /text: statementText\(tpl\.template, signer, date\)/);
  });
});

describe("copy", () => {
  test("every sentence passes the copy lint and avoids will, buy, price, payout and arrows", () => {
    const texts = [...Object.values(SIGN_STATEMENT_COPY), wrongSignerProblem("A".repeat(44), "B".repeat(44))!];
    for (const t of texts) { assert.deepEqual(lintCopy(t).hits, [], t); assert.doesNotMatch(t, /\bwill\b|\bbuy|\bprice|payout|→|←|->/i, t); }
    const c = read("src/app/burnticker/operator/sign-statement/SignStatement.tsx");
    assert.doesNotMatch(c.replace(/\/\*[\s\S]*?\*\//g, ""), /→|←/, "no arrows on the page");
  });
});
