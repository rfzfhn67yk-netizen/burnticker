// NINTH PRE-LAUNCH AUDIT B-26 / HB-206 / HS-95 / HS-104 (AP9-1, 2026-10-21): the operator's own wallet 8sJf…LvGbs bought 0.1015 SOL of
// $SEAWIN at 2026-10-15 02:46:23Z and sold all of it 24 s later, while five public sentences said it never traded a platform coin. The
// trade is listed in transparency.json `operatorTrades` with the owner's reason as one string; every sentence is built from, or checked
// against, that list; and the release check (src/lib/burnticker/operatorTradesCheck.ts) reads the wallet's history for every platform
// coin and fails on a trade the list does not hold. The chain reads are a fixture recorded from mainnet on 2026-10-21.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { OPERATOR_TRADES, OPERATOR_TRADE_REASON_MISSING, disclosedTestsClause, operatorCreatorLine, operatorTradeReason, operatorTradeReasons, feesUseWithReasons } from "@/lib/burnticker/operatorCreators";
import { runOperatorTradesCheck, tradesCheckMints, associatedTokenAccount, type TradesCheckMint } from "@/lib/burnticker/operatorTradesCheck";
import { loadTransparency, transparencyProblems } from "@/lib/burnticker/trust";
import { NEVER_TRADES_SENTENCE, TERMS_SECTIONS } from "@/lib/burnticker/legalCopy";
import { PRESS_COPY } from "@/lib/burnticker/historyCopy";
import { USE_OF_FEES } from "@/lib/burnticker/fees";
import { REHEARSAL_BUY_EXCEPTION } from "@/lib/burnticker/safeguards";
import type { Rpc } from "@/lib/burnticker/trustpack/receiptCheck";

const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); };
const OPERATOR = "8sJfoY6Xx6o2zZqmX2Vt6NRwzNPr14Ef6qqRd5YLvGbs";
const SEAWIN = "Bg545NmTcascUHGpH8HcJpTgrasUqFZEDNhYhuTbBURN";
// The owner has not written the reason down yet (2026-10-21): transparency.json holds reason "" and every surface says so.
const MISSING = "The operator has not yet written down why that test was made.";
const FIXTURE = JSON.parse(fs.readFileSync("test/fixtures/burnticker-ops/operator-trades-mainnet-2026-10-21.json", "utf8")) as { tokens: { ticker: string; mint: string; cluster: string; status: string }[]; rpc: Record<string, unknown> };
const fixtureRpc = (answers: Record<string, unknown>, fail: RegExp | null = null): Rpc => ({
  async call<T>(method: string, params: unknown[]): Promise<T> {
    const key = `${method} ${String(params[0])}`;
    if (fail && fail.test(key)) throw new Error("Failed to query long-term storage; please try again");
    if (key in answers) return answers[key] as T;
    if (method === "getSignaturesForAddress") return [] as T;
    throw new Error(`no fixture answer for ${key}`);
  },
});
const t = loadTransparency();
const mints: TradesCheckMint[] = tradesCheckMints(FIXTURE.tokens, [...t.rehearsals.flatMap((r) => (r.mint ? [{ symbol: r.symbol, mint: r.mint }] : [])), { symbol: "DEFICIT", mint: "AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj" }]);

describe("B-26 / HS-95: the $SEAWIN round trip is listed once, with the owner's reason", () => {
  test("transparency.json operatorTrades holds the two mainnet transactions and one reason string", () => {
    assert.equal(OPERATOR_TRADES.length, 1);
    const [x] = OPERATOR_TRADES;
    assert.equal(x.ticker, "SEAWIN"); assert.equal(x.mint, SEAWIN); assert.equal(x.wallet, OPERATOR);
    assert.equal(x.inSol, 0.1015); assert.equal(x.outTokens, "3484436.310353");
    assert.match(x.buyTx, /^2PWU1CBgJsxNFgvFwWbo/); assert.match(x.sellTx!, /^5ieZjtQ3pjBm5BEE79wt/);
    assert.equal(x.at, "2026-10-15T02:46:23Z");
    assert.equal(x.reason, "", "no reason until the owner writes one down; no placeholder is published");
    assert.equal(OPERATOR_TRADE_REASON_MISSING, MISSING);
    assert.deepEqual(transparencyProblems(t), []);
  });
  test("the $SEAWIN coin page names the round trip; the other six keep 'has not traded it'; no coin given says only what is true of all", () => {
    assert.equal(operatorCreatorLine(OPERATOR, SEAWIN), `Created by the operator's own wallet 8sJf…LvGbs during the soft launch. Four minutes after creating it, that wallet bought 0.10 SOL of it and sold all of it 24 seconds later, as a test; it has held none since. ${MISSING}`);
    for (const m of ["J45hvg6FYGzDMj3iYS3BJPU2pwqfoZhA7B8isnW4fin8", "EDNbkvZLKGQizGUDot1n41mF6FhXkdm6nZJFyTBzBURN", "33fGPWrMaLjfX69wsnd3ruaQtGVMU3kKcTsBTnE4ggid", "2j5CbcQ7uH2FKPUbFMbeWM66jwCgTEYj7c9jziA88Jwk", "DuaF9EE7eSFHiHVxUBgXye729VN1jj9AWD31AAJbburn", "5jtNbnTohb1YyVsSDzkWeoCMY7jAotA6qcnUxKg7burn"])
      assert.equal(operatorCreatorLine(OPERATOR, m), "Created by the operator's own wallet 8sJf…LvGbs during the soft launch. The operator holds none of it and has not traded it.");
    assert.equal(operatorCreatorLine(OPERATOR), "Created by the operator's own wallet 8sJf…LvGbs during the soft launch. The operator holds none of it.");
    clean(operatorCreatorLine(OPERATOR, SEAWIN)!);
  });
  test("terms, press, use of fees, the guardrail and the JSON prose all name both tests and carry the reason sentence", () => {
    const reason = operatorTradeReason(OPERATOR_TRADES[0]);
    assert.equal(reason, MISSING);
    assert.equal(disclosedTestsClause(), "two disclosed tests (0.1 SOL of $REHEARSAL at creation, and a 0.10 SOL purchase and immediate sale of $SEAWIN minutes after it was created)");
    assert.equal(NEVER_TRADES_SENTENCE, `Apart from two disclosed tests (0.1 SOL of $REHEARSAL at creation, and a 0.10 SOL purchase and immediate sale of $SEAWIN minutes after it was created), the platform never trades. ${reason}`);
    assert.ok(TERMS_SECTIONS.some((s) => s.paragraphs.some((p) => p.startsWith(`${NEVER_TRADES_SENTENCE} The platform never takes an order`))));
    assert.ok(PRESS_COPY.not.includes(`Burnticker is not an exchange, and it never takes an order. Apart from two disclosed tests (0.1 SOL of $REHEARSAL at creation, and a 0.10 SOL purchase and immediate sale of $SEAWIN minutes after it was created), it never trades a coin. ${reason}`));
    assert.ok(USE_OF_FEES.includes("The operator's wallets never trade a coin launched here, apart from the two disclosed tests on the test-coins page. The only buybacks"));
    assert.ok(feesUseWithReasons(USE_OF_FEES).includes(`The operator's wallets never trade a coin launched here, apart from the two disclosed tests on the test-coins page. ${reason} The only buybacks`));
    assert.doesNotMatch(USE_OF_FEES, /never trade any coin/);
    assert.ok(REHEARSAL_BUY_EXCEPTION.endsWith(reason));
    const own = t.wallets.find((w) => w.role === "operator-own")!.description;
    assert.ok(own.includes("The operator holds none of them. Apart from one test purchase and immediate sale of $SEAWIN on 2026-10-15 (0.10 SOL in, 0.098 SOL out), it has not traded them."));
    assert.ok(t.rehearsals[0].text.includes("The only other trade by an operator wallet in a platform coin was a 0.10 SOL test purchase and immediate sale of $SEAWIN on 2026-10-15."));
    const read = (p: string) => fs.readFileSync(p, "utf8");
    for (const [f, s] of [["config/burnticker/transparency.json", read("config/burnticker/transparency.json")], ["config/burnticker/expenses.json", read("config/burnticker/expenses.json")], ["config/burnticker/operator.json", read("config/burnticker/operator.json")], ["site/burnticker/whitepaper.html", read("site/burnticker/whitepaper.html")]] as const) {
      assert.ok(s.includes(reason), `${f} carries the reason sentence`);
      assert.doesNotMatch(s, /only trade from the operator's own wallets|holds none of them and has not traded them|never trades any coin|one disclosed exception/, f);
    }
    for (const s of [NEVER_TRADES_SENTENCE, feesUseWithReasons(USE_OF_FEES), REHEARSAL_BUY_EXCEPTION, own, t.rehearsals[0].text, t.policies.find((p) => p.id === "platform-never-buys")!.text, ...PRESS_COPY.not]) clean(s);
  });
  test("a changed reason that the prose does not carry is a transparency problem", () => {
    const changed = { ...t, operatorTrades: [{ ...t.operatorTrades![0], reason: "to try the swap panel" }] };
    const p = transparencyProblems(changed);
    assert.ok(p.some((x) => /wallet entry operator-own must say/.test(x)));
    assert.ok(p.some((x) => /rehearsal REHEARSAL must say/.test(x)));
    assert.ok(p.some((x) => /policy platform-never-buys must say/.test(x)));
    assert.ok(transparencyProblems({ ...t, operatorTrades: [{ ...t.operatorTrades![0], reason: "Testing." }] }).some((x) => /reason must be one string/.test(x)));
    assert.ok(transparencyProblems({ ...t, operatorTrades: [{ ...t.operatorTrades![0], reason: "  " }] }).some((x) => /reason must be one string/.test(x)));
    assert.ok(transparencyProblems({ ...t, operatorTrades: [{ ...t.operatorTrades![0], wallet: "ESyaRxd4UavQpd2KAhjZ3BvGLxeJEtLqR5jPVhpdwqFy" }] }).some((x) => /must also be listed in wallets/.test(x)));
  });
});

describe("an unwritten reason is optional and said plainly; writing one later is a JSON-only change", () => {
  const trade = t.operatorTrades![0];
  const REASON = "to check that a swap on a new coin's curve worked";
  const withReason = (reason: string) => {
    const said = `The $SEAWIN test was made ${reason}.`, swap = (x: string) => x.split(MISSING).join(said);
    return { ...t, operatorTrades: [{ ...trade, reason }], wallets: t.wallets.map((w) => ({ ...w, description: swap(w.description) })), rehearsals: t.rehearsals.map((x) => ({ ...x, text: swap(x.text) })), policies: t.policies.map((p) => ({ ...p, text: swap(p.text) })) };
  };
  test("null and \"\" both print the missing-reason sentence, on the coin page and in the joined sentences, once", () => {
    for (const reason of [null, ""]) {
      assert.equal(operatorTradeReason({ ...trade, reason }), MISSING);
      assert.ok(operatorCreatorLine(OPERATOR, SEAWIN, undefined, [{ ...trade, reason }])!.endsWith(`as a test; it has held none since. ${MISSING}`));
      assert.deepEqual(transparencyProblems({ ...t, operatorTrades: [{ ...trade, reason }] }), []);
    }
    assert.equal(operatorTradeReasons([trade, { ...trade, ticker: "OTHER" }]), MISSING);
    clean(MISSING);
  });
  test("a written reason replaces the sentence everywhere, and the JSON prose must then carry it word for word", () => {
    const set = { ...trade, reason: REASON };
    assert.equal(operatorTradeReason(set), `The $SEAWIN test was made ${REASON}.`);
    assert.ok(operatorCreatorLine(OPERATOR, SEAWIN, undefined, [set])!.endsWith(`as a test; it has held none since. The test was made ${REASON}.`));
    assert.ok(feesUseWithReasons(USE_OF_FEES, [set]).includes(`on the test-coins page. The $SEAWIN test was made ${REASON}. The only buybacks`));
    assert.deepEqual(transparencyProblems(withReason(REASON)), []);
    assert.ok(transparencyProblems({ ...withReason(REASON), operatorTrades: [{ ...trade, reason: "" }] }).some((x) => x.includes(`must say "${MISSING}"`)));
  });
});

describe("HS-104: the release check reads each operator wallet's history in every platform coin", () => {
  test("the SEAWIN account is the wallet's associated token account", () => {
    assert.equal(associatedTokenAccount(OPERATOR, SEAWIN, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), "8tyrqprxWB9wfoLmXq81ihhKaLLU4kSXZgmRAidRU7iw");
  });
  test("mainnet fixture with the listed trade: passes, two trades found, both listed, the other coins have no history", async () => {
    const r = await runOperatorTradesCheck({ rpc: fixtureRpc(FIXTURE.rpc), wallets: [OPERATOR], mints, trades: OPERATOR_TRADES, pauseMs: 0 });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(r.trades.map((x) => [x.symbol, x.side, x.amountRaw, x.listed]).sort(), [["SEAWIN", "buy", "3484436310353", true], ["SEAWIN", "sale", "3484436310353", true]]);
    assert.deepEqual(r.unlisted, []); assert.deepEqual(r.listedNotFound, []);
    assert.ok(mints.length >= 10 && mints.some((m) => m.symbol === "NEXTM6") && mints.some((m) => m.symbol === "REHEARSAL"));
  });
  test("the same chain with the trade not listed: fails and names both transactions", async () => {
    const r = await runOperatorTradesCheck({ rpc: fixtureRpc(FIXTURE.rpc), wallets: [OPERATOR], mints, trades: [], pauseMs: 0 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.unlisted.map((x) => x.signature.slice(0, 12)).sort(), ["2PWU1CBgJsxN", "5ieZjtQ3pjBm"]);
  });
  test("a listed purchase without its sale listed fails on the sale", async () => {
    const r = await runOperatorTradesCheck({ rpc: fixtureRpc(FIXTURE.rpc), wallets: [OPERATOR], mints, trades: [{ ...OPERATOR_TRADES[0], sellTx: null }], pauseMs: 0 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.unlisted.map((x) => x.side), ["sale"]);
  });
  test("a read that keeps failing is no conclusion, never a pass", async () => {
    const r = await runOperatorTradesCheck({ rpc: fixtureRpc(FIXTURE.rpc, /getSignaturesForAddress 8tyrqprx/), wallets: [OPERATOR], mints, trades: OPERATOR_TRADES, pauseMs: 0 });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /long-term storage/.test(e)));
  });
  test("a coin that only arrived (the wallet did not sign) is listed as received, not as a trade", async () => {
    const answers = JSON.parse(JSON.stringify(FIXTURE.rpc)) as Record<string, { transaction: { message: { header: { numRequiredSignatures: number }; accountKeys: string[] } } }>;
    for (const k of Object.keys(answers)) if (k.startsWith("getTransaction")) { const m = answers[k].transaction.message; const i = m.accountKeys.indexOf(OPERATOR); m.accountKeys[i] = m.accountKeys[i]; m.header.numRequiredSignatures = i; }
    const r = await runOperatorTradesCheck({ rpc: fixtureRpc(answers), wallets: [OPERATOR], mints, trades: [], pauseMs: 0 });
    assert.equal(r.trades.length, 0); assert.equal(r.received.length, 2); assert.equal(r.ok, true);
  });
});
