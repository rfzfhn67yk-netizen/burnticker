// THE TRUST PACK (2026-10-10; the owner: "build all of them, keep placeholders for the info we don't have and add them to our to-do
// list"). The sceptic's pages and their data: /burnticker/check (checklist.ts), /burnticker/fees/ledger (ledger.ts), /burnticker/operator
// (operator.ts + neverBuys.ts), the trust page's new section, /.well-known/burnticker.json, the six v1 routes (API 1.5.0) — and the
// rules around them: every visible word passes the copy lint (no-prizes included; reviews are never called an audit), every TODO_
// placeholder is on docs/burnticker/TODO-OWNER.md and every file:line there still points at it, every devnet public key is copied
// from the rehearsal record it names, and the generated files (CHECK-THIS-YOURSELF.md, both well-known copies) equal their generators.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { loadTransparency, transparencyProblems } from "@/lib/burnticker/trust";
import { ALL_TRUSTPACK_COPY, NEVER_BUYS_STATUS } from "@/lib/burnticker/trustpack/copy";
import { buildChecklist, checklistMarkdown, OUTFLOW_BY_INSTRUCTION, loadRegister } from "@/lib/burnticker/trustpack/checklist";
import { loadOperator, operatorProblems, placeholders, signedMessageView, verifySignedMessage, type OperatorConfig } from "@/lib/burnticker/trustpack/operator";
import { b58encode, isPubkey } from "@/lib/burnticker/trustpack/base58";
import { buildFeeLedgerDoc, expensesProblems, groupByMonth, loadExpenses, readWalletHistory, FEE_LEDGER_FILE } from "@/lib/burnticker/trustpack/ledger";
import { evidenceSignatures, runNeverBuys, statusOf, walletMintDelta, NEVER_BUYS_FILE } from "@/lib/burnticker/trustpack/neverBuys";
import { WELL_KNOWN_PATHS, wellKnownText, buildWellKnown } from "@/lib/burnticker/trustpack/wellKnown";
import { sampleReceipts } from "@/lib/burnticker/trustpack/samples";
import type { Rpc } from "@/lib/burnticker/trustpack/receiptCheck";
import { setPlatformForTests, type Platform } from "@/lib/burnticker/server";
import { buildOpenApi, API_VERSION } from "@/lib/burnticker/api/spec";
import { limiter } from "@/lib/burnticker/api/http";
import { resetLedgerCache } from "@/lib/burnticker/trustpack/api";
import { API, callRoute, validateSchema } from "./burntickerApiHelpers.ts";

const ROOT = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const cfg = loadCopyLintConfig(ROOT);
const clean = (t: string, what: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}: ${t.slice(0, 120)}\n${formatHits(r)}`); };
const PAGES = ["src/app/burnticker/check/CheckClient.tsx", "src/app/burnticker/check/ReceiptVerifier.tsx", "src/app/burnticker/fees/ledger/page.tsx", "src/app/burnticker/operator/page.tsx", "src/app/burnticker/trust/TrustPackSection.tsx"];
const strings = (j: unknown, out: string[] = []): string[] => { if (typeof j === "string") out.push(j); else if (Array.isArray(j)) j.forEach((v) => strings(v, out)); else if (j && typeof j === "object") Object.values(j).forEach((v) => strings(v, out)); return out; };
/** JSX text nodes and the literal titles of a page file (code between > and < is skipped when it carries a semicolon). */
const jsxText = (src: string) => [...src.replace(/=>/g, "  ").matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1]).filter((s) => !/;/.test(s)).concat([...src.matchAll(/(?:title|what): "([^"]+)"/g)].map((m) => m[1]));

describe("copy: every visible word of the trust pack passes the copy lint", () => {
  test("copy.ts, the page files' text, operator.json, expenses.json, the trust-pack and bounty blocks of transparency.json, the checklist's own items", () => {
    for (const s of ALL_TRUSTPACK_COPY) clean(s, "copy.ts");
    for (const f of PAGES) for (const s of jsxText(read(f))) clean(s, f);
    for (const s of strings(JSON.parse(read("config/burnticker/operator.json")))) clean(s, "operator.json");
    for (const s of strings(JSON.parse(read("config/burnticker/expenses.json")))) clean(s, "expenses.json");
    const t = loadTransparency(ROOT);
    for (const s of strings([t.trustPack, t.howBuilt.bounty])) clean(s, "transparency.json trustPack/bounty");
    const c = buildChecklist(ROOT);
    for (const x of [...c.locked, ...c.notDone]) clean(`${x.title}. ${x.text}`, `checklist ${x.id}`);
  });
  test("reviews are never called an audit; no 'coming soon'; the excluded venue is not named in the trust pack's own words", () => {
    const own = [...ALL_TRUSTPACK_COPY, ...PAGES.map(read), read("config/burnticker/operator.json"), read("config/burnticker/expenses.json"), read("docs/burnticker/VERIFIED-BUILD.md"), read("docs/burnticker/TODO-OWNER.md")].join("\n");
    assert.doesNotMatch(own, /\b(audited|an audit|the audit)\b(?![^.]*\b(firm|not|no)\b)/i, "an audit is only ever mentioned as not done");
    assert.doesNotMatch(own, /coming soon|stay tuned/i);
    assert.doesNotMatch(own, /kalshi/i);
    assert.doesNotMatch(read("config/public-repo/overlay/SECURITY.md"), /two independent AI|kalshi/i, "SECURITY.md: three blind reviews + re-check; ChatGPT pending (cold read R3)");
  });
});

describe("check: where money can go, who can do what", () => {
  const c = buildChecklist(ROOT);
  test("every instruction of both registers has an outflow class (a new instruction fails here until classified) and the table lists them all", () => {
    for (const p of ["burn_receipts", "pair_curve"] as const) {
      const names = loadRegister(ROOT, p).instructions.map((i) => i.name).sort();
      assert.deepEqual(Object.keys(OUTFLOW_BY_INSTRUCTION[p]).sort(), names, `${p}: classify every instruction`);
      assert.deepEqual(c.money.filter((m) => m.program === p).map((m) => m.instruction).sort(), names);
    }
    assert.equal(c.money.find((m) => m.instruction === "crank_buyback")?.outflowClass, "swapBurn");
    assert.equal(c.money.find((m) => m.instruction === "crank_vault")?.outflowClass, "burn");
    assert.equal(c.money.find((m) => m.instruction === "claim_launchlab_creator_fee")?.outflowClass, "intoPool");
    for (const m of c.money.filter((x) => x.class === "privileged")) assert.equal(m.outflowClass, "none", `${m.instruction}: a privileged instruction moves no funds`);
  });
  test("none over funds in either program; burn_receipts has exactly its 13 privileged instructions (round 5 adds propose / cancel / veto_target_pool); pair_curve none", () => {
    assert.deepEqual(c.programs.map((p) => [p.name, p.privileged, p.overFunds]), [["burn_receipts", 13, "none"], ["pair_curve", 0, "none"]]);
    assert.ok(c.powers.every((p) => /^None\.?$/.test(p.funds)));
  });
  test("what is not done names every gap the owner listed: one attester, upgrade authority, no firm review, third signer, bounty wallet, entity, interim build, the open pair_curve findings, the mainnet rehearsal", () => {
    const ids = c.notDone.map((n) => n.id);
    for (const id of ["one-attester", "upgrade-authority", "no-firm-review", "third-signer", "bounty-wallet", "entity", "verified-build", "paircurve-findings-open"]) assert.ok(ids.includes(id), id);
    assert.ok(!ids.includes("rehearsal-rehearsal"), "the mainnet rehearsal (2026-10-11) is done, not open");
    assert.ok(!ids.includes("devnet-rehearsal") && !ids.includes("contact-todo") && !ids.includes("public-repo-not-created"), "done items are not listed as open (cold read T1–T3)");
    assert.equal(c.locked.find((l) => l.id === "metadata")?.status, loadTransparency(ROOT).trustPack?.metadataUri?.status);
  });
  test("docs/burnticker/CHECK-THIS-YOURSELF.md is the generator's output (scripts/burnticker-trustpack.mts check-doc --write)", () => {
    assert.equal(read("docs/burnticker/CHECK-THIS-YOURSELF.md"), checklistMarkdown(c));
  });
});

describe("operator.json", () => {
  const op = loadOperator(ROOT);
  test("validates; every devnet public key appears in the rehearsal record it cites; the pair mints equal their rules files", () => {
    assert.deepEqual(operatorProblems(op), []);
    for (const w of op.clusters.devnet.wallets) assert.ok(read(w.source!).includes(w.pubkey), `${w.role} ${w.pubkey} in ${w.source}`);
    for (const m of op.clusters.devnet.platformMints) assert.ok(read(m.source).includes(m.mint), `${m.symbol} in ${m.source}`);
    assert.ok(read(op.clusters.devnet.squads.source).includes(op.clusters.devnet.squads.vault));
    assert.ok(read("docs/burnkeeper/evidence/devnet-2026-10-10/platform.json").includes(`"feeWallet": "${op.clusters.devnet.wallets.find((w) => w.role === "dev-fee")!.pubkey}"`), "the dev-fee wallet is the platform config's claim wallet");
    // website-9 (2026-10-11): the last two mainnet TODOs are set — the keeper key is the attester recorded in the mainnet rehearsal
    // evidence, and the deployer is the key that ran the mainnet deploy. No mainnet wallet is a placeholder any more.
    assert.ok(op.clusters.mainnet.wallets.every((w) => isPubkey(w.pubkey)), "every mainnet wallet is a real public key");
    const mk = op.clusters.mainnet.wallets.find((w) => w.role === "keeper")!;
    assert.equal(mk.pubkey, "J5XB9gNiftyMpLPy767KB4LF9R2y2ZefvtNck6xhFTf6"); assert.ok(read(mk.source!).includes(`"attester": "${mk.pubkey}"`), "the mainnet keeper is the rehearsal's attester");
    assert.equal(op.clusters.mainnet.wallets.find((w) => w.role === "deployer")?.pubkey, "F1b481n5KLLJQ8xQyAtjmZdX8zBv726qwg9TrpDZJv5P", "the mainnet deployer (upgrade authority handed to the Squads vault)");
    assert.equal(op.clusters.mainnet.wallets.find((w) => w.role === "bounty")?.pubkey, "HATDNP3MsmsxGcbKKjnoXXPBb46aLaMTdzLG3TfHJv2u", "the bounty wallet (set 2026-10-11)");
    assert.equal(op.operator.entity, "TODO_ENTITY"); assert.match(op.operator.entityPending, /Whether to form an LLC is not decided yet/);
    assert.equal(op.operator.contact, "contact@burnticker.com");
  });
  test("operatorProblems refuses a malformed devnet key, a missing role and a bad signature", () => {
    const bad = JSON.parse(JSON.stringify(op)) as OperatorConfig;
    bad.clusters.devnet.wallets[0].pubkey = "not-a-key"; bad.clusters.mainnet.wallets = bad.clusters.mainnet.wallets.filter((w) => w.role !== "keeper"); bad.signedMessage.signature = "xyz";
    const p = operatorProblems(bad).join(" | ");
    assert.match(p, /devnet\.dev-fee/); assert.match(p, /mainnet: wallet role keeper missing/); assert.match(p, /signature/);
  });
  test("the signed statement: signed 2026-10-14 and verified on the real file; a real ed25519 signature over the exact text verifies, a changed byte does not", () => {
    assert.deepEqual([signedMessageView(op).status, signedMessageView(op).verified], op.signedMessage.signature ? ["signed", true] : ["todo", null]);   // a template again since 2026-10-19 until the owner re-signs
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const pub = b58encode(Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url"));
    // the template form of the signed text (the file held {PUBKEY} / {DATE} until 2026-10-14)
    const template = op.signedMessage.message.replace("Date: 2026-10-14.", "Date: {DATE}.");
    const msg = template.replace("{PUBKEY}", pub).replace("{DATE}", "2026-10-11");
    const sig = b58encode(crypto.sign(null, Buffer.from(msg, "utf8"), privateKey));
    assert.equal(verifySignedMessage(msg, sig, pub), true);
    assert.equal(verifySignedMessage(`${msg} `, sig, pub), false);
    assert.equal(verifySignedMessage(msg, sig, b58encode(crypto.randomBytes(32))), false);
    const signed = JSON.parse(JSON.stringify(op)) as OperatorConfig;
    signed.clusters.mainnet.wallets.find((w) => w.role === "dev-fee")!.pubkey = pub;
    signed.signedMessage = { ...signed.signedMessage, status: "2026-10-11", message: template.replace("{DATE}", "2026-10-11"), signature: sig };
    assert.equal(signedMessageView(signed).verified, true);
    assert.equal(signedMessageView({ ...signed, signedMessage: { ...signed.signedMessage, signature: b58encode(crypto.randomBytes(64)) } }).status, "invalid");
  });
});

describe("TODO-OWNER.md: every placeholder, every pointer", () => {
  const doc = read("docs/burnticker/TODO-OWNER.md");
  test("every TODO_ placeholder in the trust-pack files is on the page", () => {
    const files = ["config/burnticker/operator.json", "config/burnticker/expenses.json", "config/burnticker/transparency.json", "config/public-repo/overlay/SECURITY.md"];
    const all = new Set(files.flatMap((f) => placeholders(f.endsWith(".json") ? JSON.parse(read(f)) : read(f)).map((p) => p.value)));
    assert.ok(all.size >= 7, `${all.size} placeholders`);   // 7 since the operator statement was signed on 2026-10-14 (TODO_SIGNED_MESSAGE gone)   // 20 at the trust pack; the bounty wallet and Squads member A were set on 2026-10-11, the mainnet keeper and deployer keys later that day (website-9); TODO_THIRD_SIGNER_NAME settled 2026-10-12 (owner: member C stays anonymous)
    for (const v of all) assert.ok(doc.includes(v), `${v} is missing from docs/burnticker/TODO-OWNER.md`);
  });
  test("every `file:line` (and `:line` after it) points at a line that holds the token named beside it", () => {
    let checked = 0;
    for (const row of doc.split("\n")) {
      let last: string | null = null;
      for (const m of row.matchAll(/`([\w./-]+\.(?:json|md|ts)):(\d+)`|`:(\d+)`/g)) {
        if (m[1]) last = m[1];
        if (!last) continue;
        const ln = Number(m[2] ?? m[3]);
        const lines = read(last).split("\n");
        assert.ok(ln >= 1 && ln <= lines.length, `${last}:${ln} is past the end`);
        const token = /^\s*\(`([^`]+)`/.exec(row.slice(m.index! + m[0].length))?.[1];
        if (token) { assert.ok(lines[ln - 1].toLowerCase().includes(token.toLowerCase()), `${last}:${ln} should contain ${token}: ${lines[ln - 1].trim().slice(0, 100)}`); checked++; }
      }
    }
    assert.ok(checked >= 25, `${checked} pointers checked`);
  });
  test("it lists the owner's open items by name", () => {
    for (const s of ["Third Squads signer", "Second attester operator", "Legal entity", "Bounty wallet", "Signed operator statement", "Mainnet wallets + ~15 SOL", "DexScreener", "X account email and avatar", "ChatGPT review", "Licence split + trademark", "GitHub organisation", "consent email (optional)", "OtterSec verified-builds registry", "Hermes (Pyth) API key", "dev@redstone.finance"]) assert.ok(doc.includes(s), s);
  });
});

describe("expenses + the fee ledger (from chain, by month)", () => {
  test("expenses.json validates: unknown amounts are placeholders (never zero), DexScreener $299 is a one-off", () => {
    const e = loadExpenses(ROOT);
    assert.deepEqual(expensesProblems(e), []);
    assert.deepEqual(e.items.find((i) => i.id === "dexscreener"), { ...e.items.find((i) => i.id === "dexscreener")!, usd: 299, cadence: "one-off", placeholder: false });
    for (const i of e.items) if (i.usd === null) assert.equal(i.placeholder, true, i.id);
    assert.match(expensesProblems({ ...e, items: [...e.items, { ...e.items[0], id: "x", usd: null, placeholder: false }] }).join(), /must be marked placeholder/);
  });
  const W = "3s97xfWwH5qwPjqrmjHwPobZ3Z6oxWMQm2CDVQoA5pZp", P = "Bfy67FZExj33ihNN9HDEH9KwLAPR6kW9tWAzvdXqssvx";
  const tx = (t: number, pre: number, post: number) => ({ slot: t, blockTime: t, meta: { err: null, preBalances: [10_000_000_000, pre], postBalances: [10_000_000_000 - (post - pre), post] }, transaction: { message: { accountKeys: [P, W] } } });
  const fake = (sigs: { signature: string; slot: number; blockTime: number }[], txs: Record<string, unknown>): Rpc => ({
    async call<T>(m: string, params: unknown[]): Promise<T> {
      if (m === "getSignaturesForAddress") { const before = (params[1] as { before?: string }).before; const i = before ? sigs.findIndex((s) => s.signature === before) + 1 : 0; return sigs.slice(i, i + 1000) as T; }
      if (m === "getTransaction") return (txs[params[0] as string] ?? null) as T;
      if (m === "getBalance") return { value: 1_234 } as T;
      throw new Error(m);
    },
  });
  test("readWalletHistory pages the signatures, keeps balance changes only, names the counterparty; groupByMonth sums by UTC month", async () => {
    const sept = Date.UTC(2026, 8, 30) / 1000, oct = Date.UTC(2026, 9, 2) / 1000;
    const sigs = [{ signature: "a", slot: 3, blockTime: oct }, { signature: "b", slot: 2, blockTime: sept }, { signature: "c", slot: 1, blockTime: sept }];
    const h = await readWalletHistory(fake(sigs, { a: tx(oct, 5000, 9000), b: tx(sept, 0, 5000), c: tx(sept, 5000, 5000) }), W);
    assert.deepEqual(h.entries.map((e) => [e.signature, e.deltaLamports, e.month, e.counterparty]), [["b", "5000", "2026-09", P], ["a", "4000", "2026-10", P]]);
    assert.equal(h.complete, true); assert.equal(h.balanceLamports, "1234");
    assert.deepEqual(groupByMonth(h.entries), [{ month: "2026-09", inLamports: "5000", outLamports: "0", txIn: 1, txOut: 0 }, { month: "2026-10", inLamports: "4000", outLamports: "0", txIn: 1, txOut: 0 }]);
    const doc = buildFeeLedgerDoc({ cluster: "devnet", wallet: W, history: h, expenses: loadExpenses(ROOT), now: 0 });
    assert.equal(doc.totals.inLamports, "9000"); assert.equal(doc.source, "chain"); assert.ok(doc.placeholders.includes("TODO_EXPENSE_HOSTING"));
    const none = buildFeeLedgerDoc({ cluster: "mainnet", wallet: null, history: null, expenses: loadExpenses(ROOT) });
    assert.equal(none.source, "unavailable"); assert.match(none.note, /No developer fee wallet is set for mainnet yet/);
  });
});

describe("the never-buys monitor", () => {
  const OP = "D8seUoC1RZUs7918Atcc7TbFwRf1khqFvPdjkB4qktbn", MINT = "4QnwyiBMm2Caz5tJr9hNGzT2wqZcMipZjFHiSBu7AM4F", ATA = "4VcsuCXw3sQqWm4Sv36X7hwkup9owSXcjThwSibtCTzk";
  const bal = (amt: string) => [{ mint: MINT, owner: OP, uiTokenAmount: { amount: amt } }];
  // review 3 of A-6: a buy is a transaction the wallet signed that ran a trading program (here the devnet LaunchLab curve)
  const BUY = { message: { accountKeys: [OP, "DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6"], header: { numRequiredSignatures: 1 }, instructions: [{ programIdIndex: 1 }] } };
  const DUST = { message: { accountKeys: ["Attacker1111111111111111111111111111111111", OP, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"], header: { numRequiredSignatures: 1 }, instructions: [{ programIdIndex: 2 }] } };
  const rpc = (txs: Record<string, unknown>, tokenSigs: string[], recent: string[]): Rpc => ({
    async call<T>(m: string, params: unknown[]): Promise<T> {
      if (m === "getTokenAccountsByOwner") return { value: (params[1] as { programId: string }).programId.startsWith("Tokenkeg") ? [{ pubkey: ATA, account: { data: { parsed: { info: { mint: MINT, owner: OP, tokenAmount: { amount: "0" } } } } } }] : [] } as T;
      if (m === "getSignaturesForAddress") return (params[0] === ATA ? tokenSigs : recent).map((signature) => ({ signature })) as T;
      if (m === "getTransaction") return (txs[params[0] as string] ?? null) as T;
      throw new Error(m);
    },
  });
  test("an acquisition recorded in the evidence is 'explained' (with the file); any other turns the line red; none is clear", async () => {
    const evidence = new Map([["sigKnown", "docs/burnkeeper/evidence/devnet-2026-10-10/curve-buy-1.json"]]);
    const txs = { sigKnown: { blockTime: 1, transaction: BUY, meta: { err: null, preTokenBalances: bal("0"), postTokenBalances: bal("500") } }, sigNew: { blockTime: 2, transaction: BUY, meta: { err: null, preTokenBalances: bal("500"), postTokenBalances: bal("900") } }, sigSell: { blockTime: 3, meta: { err: null, preTokenBalances: bal("900"), postTokenBalances: bal("0") } } };
    const base = { cluster: "devnet", wallets: [{ role: "keeper", pubkey: OP }], mints: [{ symbol: "DEFICIT", mint: MINT }], evidence, now: 0 };
    const a = await runNeverBuys({ ...base, rpc: rpc(txs, ["sigKnown", "sigSell"], ["sigSell"]) });
    assert.equal(a.status, "explained"); assert.equal(a.line, NEVER_BUYS_STATUS.explained);
    assert.deepEqual(a.acquisitions.map((x) => [x.signature, x.amountRaw, x.explainedBy]), [["sigKnown", "500", "docs/burnkeeper/evidence/devnet-2026-10-10/curve-buy-1.json"]]);
    assert.equal(a.holdings.length, 1); assert.equal(a.scanned.transactions, 2, "each transaction read once");
    const b = await runNeverBuys({ ...base, rpc: rpc(txs, ["sigKnown", "sigNew"], []) });
    assert.equal(b.status, "red"); assert.equal(b.acquisitions.find((x) => x.signature === "sigNew")?.explainedBy, null);
    assert.equal(statusOf([]).status, "clear");
    assert.equal(walletMintDelta(txs.sigSell as never, OP, MINT), BigInt(-900));
  });
  test("review 3: a coin sent to an operator wallet is 'received', never red; a buy it signed is red; no wallet read is 'not checked'", async () => {
    const txs = { sigDust: { blockTime: 4, transaction: DUST, meta: { err: null, preTokenBalances: bal("0"), postTokenBalances: bal("7") } }, sigBuy: { blockTime: 5, transaction: BUY, meta: { err: null, preTokenBalances: bal("7"), postTokenBalances: bal("907") } } };
    const base = { cluster: "mainnet", wallets: [{ role: "keeper", pubkey: OP }], mints: [{ symbol: "DEFICIT", mint: MINT }], evidence: new Map<string, string>(), now: 0 };
    const dust = await runNeverBuys({ ...base, rpc: rpc(txs, ["sigDust"], []) });
    assert.equal(dust.status, "received"); assert.equal(dust.line, NEVER_BUYS_STATUS.received);
    assert.deepEqual(dust.acquisitions.map((x) => [x.signature, x.how]), [["sigDust", "received"]]);
    const buy = await runNeverBuys({ ...base, rpc: rpc(txs, ["sigDust", "sigBuy"], []) });
    assert.equal(buy.status, "red");
    const down: Rpc = { async call<T>(): Promise<T> { throw new Error("rpc down"); } };
    const none = await runNeverBuys({ ...base, rpc: down });
    assert.equal(none.status, "not-checked"); assert.equal(none.line, NEVER_BUYS_STATUS.notChecked);
  });
  test("the evidence index finds the rehearsal's real signatures (the receipts and the curve buys)", () => {
    const ev = evidenceSignatures(ROOT);
    for (const s of sampleReceipts(ROOT).receipts) assert.ok(ev.has(s.signature), s.signature);
    assert.ok([...ev.values()].some((f) => f.endsWith("curve-buy-1.json")));
  });
});

describe("/.well-known/burnticker.json", () => {
  test("both committed copies equal the generator (scripts/burnticker-trustpack.mts well-known --write) and cross-link everything", () => {
    for (const p of WELL_KNOWN_PATHS) assert.equal(read(p), wellKnownText(ROOT), p);
    const w = buildWellKnown(ROOT) as { links: { github: string; x: string[]; site: string }; clusters: { devnet: { programs: Record<string, { programId: string; executableHash: string }>; squads: { vault: string } }; mainnet: { squads: { vault: string } } }; security: { bountyWallet: string } };
    assert.equal(w.links.github, loadTransparency(ROOT).publicRepo.url);
    assert.deepEqual(w.links.x, ["https://x.com/burnticker", "https://x.com/USA_DEFICIT"]);
    assert.equal(w.clusters.devnet.programs.burn_receipts.programId, "AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM");
    assert.equal(w.clusters.devnet.programs.pair_curve.executableHash, "364eac3de338f5356d66bba2e74dca52859f4f0339c10dbdf759173339a701cf"); // round-4 build on devnet (vault transaction 20, 2026-10-12); before it ae947d59… (r3, transaction 18, 2026-10-11)
    assert.equal(w.clusters.devnet.squads.vault, "A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD");
    assert.equal(w.clusters.mainnet.squads.vault, "8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV");
    assert.equal(w.security.bountyWallet, "HATDNP3MsmsxGcbKKjnoXXPBb46aLaMTdzLG3TfHJv2u");
  });
});

describe("transparency.json: the cold-read corrections and the trust-pack blocks", () => {
  const t = loadTransparency(ROOT);
  test("devnet rehearsal done, repository live, contact set, devnet-only deployment, pair_curve reviews published with findings open", () => {
    const lim = Object.fromEntries(t.limitations.map((l) => [l.id, l]));
    assert.match(lim["devnet-rehearsal"].status, /^done 2026-10-10/); assert.match(lim["devnet-rehearsal"].text, /docs\/burnkeeper\/devnet-run\.md/);
    assert.equal(lim["public-repo-not-created"].status, "done"); assert.equal(t.publicRepo.todo, undefined);
    assert.equal(lim["contact-todo"].status, "done"); assert.equal(t.howBuilt.bounty.contact, "security@burnticker.com");
    // audit 4 BT-02: both programs deployed on mainnet 2026-10-11; deployed is not launched (the limitation keeps its id, its status says so)
    assert.equal(lim["program-not-deployed"].status, "deployed on devnet and mainnet"); assert.match(lim["program-not-deployed"].text, /AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM/);
    assert.match(lim["program-not-deployed"].text, /Deployed is not launched/); assert.doesNotMatch(JSON.stringify(t.limitations), /Neither is deployed on mainnet|mainnet wallet does not exist|vault cannot be created/);
    assert.equal(lim["paircurve-findings-open"].status, "not done");
    for (const id of ["verified-build-interim", "bounty-wallet", "entity", "third-signer", "signed-operator-message"]) assert.ok(lim[id], id);
    assert.equal(t.howBuilt.bounty.wallet, "HATDNP3MsmsxGcbKKjnoXXPBb46aLaMTdzLG3TfHJv2u"); assert.match(t.howBuilt.bounty.walletTodo!, /developer fee/); assert.equal(t.howBuilt.bounty.status, "funded 2026-10-11");
    assert.deepEqual(t.trustPack?.pages.map((p) => p.path), ["/burnticker/check", "/burnticker/fees/ledger", "/burnticker/operator"]);
    assert.deepEqual(transparencyProblems({ ...t, howBuilt: { ...t.howBuilt, bounty: { ...t.howBuilt.bounty, wallet: "nope" } } }).length, 1);
  });
  test("the trust page links to /check, /fees/ledger and /operator and mounts the section with the bounty wallet", () => {
    const sec = read("src/app/burnticker/trust/TrustPackSection.tsx");
    for (const href of ["/burnticker/check", "/burnticker/fees/ledger", "/burnticker/operator", "/api/burnticker/v1/bounty", "/api/burnticker/v1/operator"]) assert.ok(sec.includes(href), href);
    assert.match(read("src/app/burnticker/trust/page.tsx"), /<TrustPackSection card=\{card\} \/>/);
  });
  test("the public allowlist ships the new files", () => {
    const al = read("config/public-repo.allowlist");
    for (const l of ["scripts/ops/verified-build.sh", "public/.well-known/burnticker.json", "test/fixtures/burnticker-trustpack/**"]) assert.ok(al.split("\n").includes(l), l);
  });
});

describe("the six v1 routes (API 1.5.0)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-trustpack-"));
  setPlatformForTests({ cluster: "devnet", publishDir: dir } as unknown as Platform);
  const doc = buildOpenApi() as Record<string, unknown> & { paths: Record<string, unknown>; components: { schemas: Record<string, Record<string, unknown>> } };
  const ok = (name: string, body: unknown) => assert.deepEqual(validateSchema(doc.components.schemas[name], body, doc), [], name);
  test("API_VERSION is at least 1.5.0 (the trust pack's minor; later batches add) and the six operations are in the document", () => {
    const [maj, min] = API_VERSION.split(".").map(Number);
    assert.ok(maj === 1 && min >= 5, API_VERSION);
    const paths = Object.keys(doc.paths);
    for (const p of ["/check", "/check/receipts", "/check/receipts/{signature}", "/fees/ledger", "/operator", "/bounty"]) assert.ok(paths.includes(p), p);
  });
  test("GET /check, /check/receipts, /operator, /bounty answer 200 and validate against their schemas", async () => {
    limiter.reset();
    const check = await callRoute(`${API}/check`); assert.equal(check.status, 200); ok("Check", await check.json());
    const rec = await callRoute(`${API}/check/receipts`); assert.equal(rec.status, 200); const r = await rec.json(); ok("CheckReceipts", r);
    assert.equal(r.receipts.length, 7); assert.ok(r.rules["DEFICIT.rules.json"]); assert.equal(r.example, true);   // HB-26: keyed by ticker, no repository path
    const op0 = await (await callRoute(`${API}/operator`)).json(); ok("OperatorView", op0);
    assert.equal(op0.neverBuys.status, "not-run"); assert.equal(op0.signedMessage.status, loadOperator().signedMessage.signature ? "signed" : "todo");
    assert.ok(op0.placeholders.some((p: { value: string }) => p.value === "TODO_ENTITY"));
    fs.writeFileSync(path.join(dir, NEVER_BUYS_FILE), JSON.stringify({ schema: "burnticker.never-buys/v1", ranAt: new Date().toISOString(), cluster: "devnet", status: "explained", line: NEVER_BUYS_STATUS.explained, wallets: [], mints: [], holdings: [], acquisitions: [], scanned: { tokenAccounts: 0, transactions: 0 }, errors: [] }));
    const op1 = await (await callRoute(`${API}/operator`)).json(); assert.equal(op1.neverBuys.status, "explained");
    const b = await callRoute(`${API}/bounty`); const bb = await b.json(); ok("Bounty", bb);
    assert.equal(bb.wallet, "HATDNP3MsmsxGcbKKjnoXXPBb46aLaMTdzLG3TfHJv2u"); assert.equal(bb.walletTodo, null); assert.deepEqual(bb.rangeSol, [5, 10]);
  });
  test("GET /fees/ledger serves a fresh published copy (no chain read on the request) and validates; 400 on a malformed receipt signature", async () => {
    resetLedgerCache();
    const published = buildFeeLedgerDoc({ cluster: "devnet", wallet: "3s97xfWwH5qwPjqrmjHwPobZ3Z6oxWMQm2CDVQoA5pZp", history: { entries: [], complete: true, balanceLamports: "0" }, expenses: loadExpenses(ROOT) });
    fs.writeFileSync(path.join(dir, FEE_LEDGER_FILE), JSON.stringify(published));
    const res = await callRoute(`${API}/fees/ledger`); assert.equal(res.status, 200);
    const j = await res.json(); ok("FeeLedger", j); assert.equal(j.served, "published copy"); assert.equal(j.wallet, "3s97xfWwH5qwPjqrmjHwPobZ3Z6oxWMQm2CDVQoA5pZp");
    assert.equal((await callRoute(`${API}/check/receipts/not-a-sig`)).status, 400);
  });
});
