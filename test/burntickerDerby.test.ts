// BURN DERBY (2026-10-10): the coin-vs-coin selector end to end on fixtures — Pyth boundary picks (synthetic Hermes bodies in the
// documented v2 shape: keyless Hermes answered 401 that day; the real Pyth Solana accounts fetched that day), ties, cross-read
// withholds, the pool-TWAP fallback, the one-shot flippening, the single-asset selector, refusals (platform coins, the refuse list,
// liquidity, index proxies), the keeper path into the program (proof= in the signed message), the pair page block and the day post.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { lockRule, validateRule, ruleStatement, type BurnRule } from "@/lib/burnticker/rules";
import { rulesSha256 } from "@/lib/burnKeeper/rules";
import { runCycle } from "@/lib/burnticker/multiKeeper";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { coinvsHashInput, derbySentence, derbySeriesId, derbySpecProblems, INDEX_PROXY_SYMBOLS, seasonWindows, windowAt, type CoinVsSpec, type PriceSpec } from "@/lib/burnticker/derby/spec";
import { decodePriceUpdateV2, hermesBoundaryUrl, HERMES_URL, pointFromHermes, pythFeedAccount, pythSnapshotFromAccount, searchPyth, loadPythCatalogue } from "@/lib/burnticker/derby/pyth";
import { quoteFromDexscreener, quoteFromJupiter, quoteFromRedstone, handleFromLink } from "@/lib/burnticker/derby/cross";
import { decideFlip, decideWindow, pctChange } from "@/lib/burnticker/derby/measure";
import { samplePool, twap, decodePoolFor } from "@/lib/burnticker/derby/pools";
import { derbyAdmission } from "@/lib/burnticker/derby/admission";
import { derbyPairJson } from "@/lib/burnticker/derby/page";
import { derbyDayText } from "@/lib/burnticker/derby/post";
import { derbyProofHash, DERBY_PROOF_PREFIX } from "@/lib/burnticker/derby/adapter";
import { tileRule, tileHashInput, defaultTicker } from "@/lib/burnticker/derby/tile";
import { ruleOneLiner } from "@/lib/burnticker/coinCard";
import { openRegistry } from "@/lib/burnticker/registry";
import { selectorKeyOf } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildReceiptsJson } from "@/lib/burnticker/tokenPage";
import { B, BONK, BONK_FEED, BONK_MINT, CREATOR, GIGA, GIGA_MINT, GIGA_POOL, SHIB, SHIB_FEED, SOL_FEED, WIF, WIF_FEED, WIF_MINT, coinvsRule, cpmmAccounts, derbyWorld, fixtureFetch, fixturePort, fjson, launchSingle, seedCross, fixtureHermes } from "./burntickerDerbyHelpers.ts";

/** Event receipts only (the end-of-rule wind-down / drain / sweep receipts are tested on their own). */
const ev = <T extends { kind: string }>(rs: T[]): T[] => rs.filter((r) => !["winddown", "drain", "sweep"].includes(r.kind));
const lint = (t: string) => lintCopy(t, loadCopyLintConfig()).hits.map((h) => `${h.phrase}:${h.rule}`);
const SEASON: CoinVsSpec = { selector: "coinvs", a: WIF, b: SHIB, window: "daily", measure: "pct", season: { start: "2026-10-05", days: 7 }, flip: false };

describe("the selector and its rule", () => {
  test("the derby block validates, the series is derived and locked, a wrong series or a bad block is refused", () => {
    assert.deepEqual(derbySpecProblems(SEASON), []);
    const r = coinvsRule(SEASON);
    assert.match(r.series!, /^coinvs:WIF-SHIB:daily:pct:[0-9a-f]{10}$/);
    assert.equal(r.series, `coinvs:WIF-SHIB:daily:pct:${rulesSha256(coinvsHashInput(SEASON)).slice(0, 10)}`);
    assert.equal(selectorKeyOf(r), `derby:${r.series}`);
    assert.throws(() => validateRule({ ...r, series: "coinvs:WIF-SHIB:daily:pct:0000000000" }), /series must be coinvs:WIF-SHIB/);
    assert.throws(() => validateRule({ ...r, derby: { ...SEASON, b: WIF } }), /distinct/);
    assert.throws(() => validateRule({ ...r, kind: "scalar", binary: null, scalar: { unit: 1, perUnit: { fractionOfPool: 0.01 }, baseline: 0, direction: "up" } }), /coin-vs-coin rule is "binary"/);
    assert.throws(() => validateRule({ ...r, derby: { ...SEASON, flip: true } }), /mcap measure/);
    assert.throws(() => validateRule({ ...r, derby: { ...SEASON, measure: "mcap" } }), /both coins need a mint/);
    assert.throws(() => validateRule({ ...r, oracle: "kalshi" }), /only an oracle "derby" rule carries a derby block/);
    // Two pairs on the same matchup with different seasons share one reading stream (the season is not in the hash unless it is a flippening).
    assert.equal(coinvsRule({ ...SEASON, season: { start: "2026-11-01", days: 30 } }).series, r.series);
    assert.notEqual(coinvsRule({ ...SEASON, a: WIF, b: BONK, measure: "mcap", flip: true }).series, coinvsRule({ ...SEASON, a: WIF, b: BONK, measure: "mcap", flip: true, season: { start: "2026-11-01", days: 30 } }).series);
    // A rule without the derby block keeps its exact canonical bytes (nothing changes for other oracles).
    assert.ok(!("derby" in lockRule({ schema: "burnticker.rules/v1", oracle: "catalogue", series: "treasury.debt", market: null, filter: {}, kind: "scalar", scalar: { unit: 1e9, perUnit: { fractionOfPool: 0.05 }, baseline: "previousSettlement", direction: "up" }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null }).rule));
  });

  test("the review sentence (the owner's example), the statement and the coin card are lint-clean", () => {
    const s = derbySentence(SEASON, "TEAMWIF", "TEAMSHIB", 0.01);
    assert.equal(s, "$TEAMWIF burns 1% every day WIF out-gains SHIB (Pyth, 00:00 UTC). $TEAMSHIB burns when SHIB wins. Runs for 7 days, then winds down.");
    assert.deepEqual(lint(s), []);
    const flip = derbySentence({ ...SEASON, a: WIF, b: BONK, measure: "mcap", flip: true }, "TEAMWIF", "TEAMBONK", 0.02);
    assert.deepEqual(lint(flip), [], flip);
    const r = coinvsRule(SEASON);
    assert.deepEqual(lint(ruleStatement(r)), [], ruleStatement(r));
    assert.equal(ruleOneLiner(r), "burns every day WIF out-gains SHIB");
    assert.deepEqual(lint(ruleOneLiner(r)), []);
    // Our own coins' moves still fail the lint: the allowance never matches a $TICKER.
    assert.ok(lint("$TEAMWIF out-gains $TEAMSHIB").length > 0);
  });

  test("seasons: daily windows 00:00 → 00:00 UTC, the reading's time is the window's last second", () => {
    const ws = seasonWindows(SEASON);
    assert.equal(ws.length, 7); assert.equal(ws[0].id, "2026-10-05"); assert.equal(windowAt(ws[0]), "2026-10-05T23:59:59Z");
    assert.equal(seasonWindows({ window: "weekly", season: { start: "2026-10-05", days: 14 } }).length, 2);
    assert.match(derbySpecProblems({ ...SEASON, window: "weekly", season: { start: "2026-10-06", days: 14 } }).join(";"), /Monday/);
  });
});

describe("Pyth: the boundary pick and the keyless Solana accounts", () => {
  const fx = fjson("derby/hermes.synthetic.json").updates;
  const e = B(13) / 1000;
  test("the first update at/after the boundary within 60 s; late, early and wide-confidence updates withhold; the proof is the update bytes' sha256", () => {
    const ok = pointFromHermes(fx[`${WIF_FEED}@${B(5) / 1000}`], WIF_FEED, B(5) / 1000, "u");
    assert.ok(ok.ok); assert.equal(ok.ok && ok.point.value, "0.2"); assert.equal(ok.ok && ok.point.publishTime, B(5) / 1000 + 1); assert.match(ok.ok ? ok.point.updateSha256 : "", /^[0-9a-f]{64}$/);
    const late = pointFromHermes(fx[`${WIF_FEED}@${e}`], WIF_FEED, e, "u"); assert.equal(late.ok, false); assert.match(!late.ok ? late.reason : "", /within 60 s/);
    const early = pointFromHermes(fx[`${SHIB_FEED}@${e}`], SHIB_FEED, e, "u"); assert.match(!early.ok ? early.reason : "", /before the boundary/);
    const wide = pointFromHermes(fx[`${SOL_FEED}@${e}`], SOL_FEED, e, "u"); assert.match(!wide.ok ? wide.reason : "", /confidence/);
    assert.equal(hermesBoundaryUrl(HERMES_URL, WIF_FEED, 1791504000), `https://hermes.pyth.network/v2/updates/price/1791504000?ids[]=${WIF_FEED}&encoding=base64&parsed=true`);
  });
  test("the real WIF account (fetched 2026-10-10): PDA, owner, Full verification, value; SHIB has no sponsored account", () => {
    const acc = fjson("derby/pyth.solana.accounts.json").accounts;
    assert.equal(pythFeedAccount(WIF_FEED), acc.WIF.address);
    const m = decodePriceUpdateV2(Buffer.from(acc.WIF.dataBase64, "base64"));
    assert.equal(m.feed, WIF_FEED); assert.equal(m.verification, "full"); assert.equal(m.expo, -8);
    const s = pythSnapshotFromAccount(WIF_FEED, { owner: acc.WIF.owner, data: Buffer.from(acc.WIF.dataBase64, "base64") }, 1, acc.WIF.address);
    assert.ok(Number(s.value) > 0.1 && Number(s.value) < 1, s.value);
    assert.throws(() => pythSnapshotFromAccount(SOL_FEED, { owner: acc.WIF.owner, data: Buffer.from(acc.WIF.dataBase64, "base64") }, 1, acc.WIF.address), /carries feed/);
    assert.equal(acc.SHIB.owner, null);
  });
  test("the catalogue search: crypto by default, financial assets on request, US index proxies only behind the flag", () => {
    assert.equal(searchPyth("wif")[0].id, WIF_FEED);
    assert.ok(searchPyth("aapl").every((h) => h.assetType === "Crypto"), "crypto only by default (tokenised-stock coins may match)");
    assert.equal(searchPyth("aapl", 5, loadPythCatalogue(), { assetTypes: ["Equity"] })[0].symbol, "Equity.US.AAPL/USD");
    const us = (env: Record<string, string>) => searchPyth("US500", 5, loadPythCatalogue(), { assetTypes: ["Equity"], env }).map((h) => h.symbol);
    assert.ok(!us({}).some((s) => (INDEX_PROXY_SYMBOLS as readonly string[]).includes(s)));
    assert.ok(us({ BURNTICKER_INDEX_PROXIES_ENABLED: "1" }).includes("Equity.Index.US500/USD"));
  });
});

describe("cross-reads and the decision", () => {
  test("Jupiter v3, DexScreener, RedStone parse their fixtures; X handles from links", () => {
    const j = quoteFromJupiter(fjson("derby/jupiter.price.v3.json").body, WIF_MINT, "u"); assert.ok(j && Number(j.usd) > 0.2 && (j.liquidityUsd ?? 0) > 1e6);
    const d = quoteFromDexscreener(fjson("derby/dexscreener.shib.json").body, "ethereum", "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE", "u"); assert.ok(d && d.ref?.startsWith("pair:"));
    const r = quoteFromRedstone(fjson("derby/redstone.latest.json").body, "SHIB", "u"); assert.ok(r && Number(r.usd) > 0 && /^signers:\d+@/.test(r.ref!));
    assert.equal(quoteFromRedstone(fjson("derby/redstone.latest.json").body, "NOPE", "u"), null);
    assert.equal(handleFromLink("https://x.com/dogwifcoin"), "@dogwifcoin"); assert.equal(handleFromLink("https://x.com/x/status/1"), null);
  });
  test("exact arithmetic: % change, the margin, ties, a disagreement withholds, a missing cross-read withholds", () => {
    assert.equal(pctChange("0.2", "0.21"), "5"); assert.equal(pctChange("0.0000055", "0.0000054"), "-1.818181");
    const side = (symbol: string, changePct: string) => ({ symbol, key: symbol, source: "pyth" as const, start: "1", end: "1", supplyStart: null, supplyEnd: null, changePct, proof: {} });
    const cs = (changePct: string) => ({ source: "x", start: "1", end: "1", changePct, refs: {} });
    const d1 = decideWindow(side("A", "5"), side("B", "2"), { a: cs("5.1"), b: cs("2") }); assert.equal(d1.status === "decided" && d1.result, "yes");
    const tie = decideWindow(side("A", "0"), side("B", "0"), { a: cs("0"), b: cs("0") }); assert.equal(tie.status === "decided" && tie.result, "void");
    const off = decideWindow(side("A", "2"), side("B", "1"), { a: cs("5"), b: cs("1") }); assert.equal(off.status, "withheld"); assert.match(off.status === "withheld" ? off.reason : "", /disagrees by 3 points/);
    assert.equal(decideWindow(side("A", "2"), side("B", "1"), { a: null, b: cs("1") }).status, "withheld");
    assert.equal(decideFlip("100", "120", { a: "100", b: "120" }, false).status, "pending");
    assert.equal(decideFlip("100", "120", { a: "100", b: "120" }, true).status === "decided" && "no", "no");
    const yes = decideFlip("130", "120", { a: "131", b: "120" }, false); assert.equal(yes.status === "decided" && yes.result, "yes");
  });
});

describe("WIF vs SHIB through the keeper and the program", () => {
  test("seven days: A, B, tie, two withheld (the cross-read disagreed), A, tie — the winner burns, ties post void receipts, withheld days post nothing; proof= is signed", async () => {
    const w = await derbyWorld(SEASON);
    // Cross-reads one minute after each boundary: close to Pyth, except WIF at 10-09 (6% off → days 4 and 5 withheld).
    const wifPyth = ["0.2", "0.21", "0.2058", "0.2058", "0.21", "0.21", "0.2205", "0.2205"], shibPyth = ["0.0000055", "0.00000561", "0.0000055", "0.0000055", "0.00000561", "0.0000055", "0.0000055", "0.0000055"];
    wifPyth.forEach((v, i) => seedCross(w, WIF, B(5 + i), i === 4 ? "0.2181" : v, "jupiter"));
    shibPyth.forEach((v, i) => seedCross(w, SHIB, B(5 + i), v, "redstone"));
    await runCycle(w.deps); await runCycle(w.deps);
    const rows = w.adapter.store.windows(`derby:${coinvsRule(SEASON).series}`);
    assert.deepEqual(rows.map((r) => [r.windowId, r.status, r.result]), [["2026-10-05", "decided", "yes"], ["2026-10-06", "decided", "no"], ["2026-10-07", "decided", "void"], ["2026-10-08", "withheld", null], ["2026-10-09", "withheld", null], ["2026-10-10", "decided", "yes"], ["2026-10-11", "decided", "void"]]);
    assert.match(rows[3].reason!, /cross-read disagrees/);
    assert.ok(w.logs.some((l) => l.startsWith("ALERT derby-withheld")), "a withheld window raises an alert");
    const ra = ev(w.registry.receipts(w.a.mint)), rb = ev(w.registry.receipts(w.b.mint));
    assert.equal(ra.length, 5); assert.equal(rb.length, 5);
    const st = (rs: typeof ra) => rs.map((r) => `${r.eventId.slice(0, 10)}:${r.status}:${r.units}`);
    assert.deepEqual(st(ra), ["2026-10-05:confirmed:1", "2026-10-06:nothing:0", "2026-10-07:void:0", "2026-10-10:confirmed:1", "2026-10-11:void:0"]);
    assert.deepEqual(st(rb), ["2026-10-05:nothing:0", "2026-10-06:confirmed:1", "2026-10-07:void:0", "2026-10-10:nothing:0", "2026-10-11:void:0"]);
    assert.ok((ra[0].burnRaw ?? BigInt(0)) > BigInt(0) && (rb[1].burnRaw ?? BigInt(0)) > BigInt(0));
    // The event id carries the proof digest; the reading carries derby:sha256:<hex>; the signed attestation's proof= is that hash.
    assert.match(ra[0].eventId, /^2026-10-05:[0-9a-f]{16}$/);
    const reading = w.registry.readings(w.a.selectorKey).find((r) => r.id === ra[0].eventId)!;
    assert.ok(reading.proof!.startsWith(DERBY_PROOF_PREFIX) && reading.proof!.slice(DERBY_PROOF_PREFIX.length).startsWith(ra[0].eventId.split(":")[1]));
    const sig = w.registry.signatures(w.a.mint, "reading:2026-10-05")[0];
    assert.ok(sig, "the 10-05 reading was attested");
    assert.ok(JSON.parse(sig.memo).message.endsWith(`proof=${Buffer.from(derbyProofHash([reading.proof])!).toString("hex")}`));
    // Every receipt recomputes from the reading and the rule.
    const page = buildReceiptsJson({ token: w.registry.token(w.a.mint)!, locked: w.registry.lockedRule(w.a), readings: w.registry.readings(w.a.selectorKey), receipts: ra, attesters: [], state: w.registry.state(w.a.mint), feedState: w.registry.feedState(w.a.selectorKey), chain: { cluster: "devnet", programId: w.program.programId, supplyRaw: null, feePdaLamports: null, vaultRaw: null }, now: w.clock.now, nextCheckAt: null, implied: null, seriesTitle: null, selectorPending: 0, operator: { can: [], cannot: [], placeholder: true }, pair: null });
    assert.deepEqual(page.flatMap((r) => r.verify.checks), []);
    // The pair page block: the running score as a receipt tally, the strip, the season end; the day post.
    const j = derbyPairJson(w.registry, w.registry.pair(w.pairId)!, page, buildReceiptsJson({ token: w.registry.token(w.b.mint)!, locked: w.registry.lockedRule(w.b), readings: w.registry.readings(w.b.selectorKey), receipts: rb, attesters: [], state: w.registry.state(w.b.mint), feedState: w.registry.feedState(w.b.selectorKey), chain: { cluster: "devnet", programId: w.program.programId, supplyRaw: null, feePdaLamports: null, vaultRaw: null }, now: w.clock.now, nextCheckAt: null, implied: null, seriesTitle: null, selectorPending: 0, operator: { can: [], cannot: [], placeholder: true }, pair: null }), w.clock.now)!;
    assert.deepEqual(j.score, { a: 2, b: 1, ties: 2, withheld: 2, dayNumber: 7 });
    assert.equal(j.season.endsOn, "2026-10-12"); assert.equal(j.days.length, 7);
    assert.ok(j.days[0].proof.some((p) => p.label.includes("Pyth update") && p.url!.startsWith("https://hermes.pyth.network/v2/updates/price/")));
    const day6 = j.days.find((d) => d.windowId === "2026-10-10")!;
    const post = derbyDayText({ pair: j, day: day6, days: j.days, tickers: { a: "TEAMWIF", b: "TEAMSHIB" }, fraction: 0.01, handles: ["@dogwifcoin", "@shibtoken"], site: "https://burnticker.com" });
    assert.match(post.split("\n")[0], /^Day 6 · WIF 2 – SHIB 1 · \$TEAMWIF burned 1% · receipt \S+…$/);
    assert.equal(post.split("\n")[1], "@dogwifcoin @shibtoken");
    assert.deepEqual(lint(post), []);
    const tiePost = derbyDayText({ pair: j, day: j.days[2], days: j.days, tickers: { a: "TEAMWIF", b: "TEAMSHIB" }, fraction: 0.01 });
    assert.match(tiePost, /^Day 3 · WIF 1 – SHIB 1 · tie · no burn/);
    assert.match(derbyDayText({ pair: j, day: j.days[3], days: j.days, tickers: { a: "TEAMWIF", b: "TEAMSHIB" }, fraction: 0.01 }), /reading withheld — the cross-read disagreed · no burn/);
    // Season over (10-12 00:00 UTC): the rule ENDED and the wind-down starts that day — 17 units of 1 % a day (≥ 99 % in 28 days).
    assert.match(w.registry.ruleEnd(w.a.mint)!.reason, /season over/);
    w.clock.now = B(13) + 3600_000;
    await runCycle(w.deps);
    const wd = w.registry.receipts(w.a.mint).filter((r) => r.kind === "winddown");
    assert.deepEqual(wd.map((r) => `${r.eventId}:${r.units}`), ["winddown-2026-10-12:17", "winddown-2026-10-13:17"]);
    assert.equal(w.registry.token(w.a.mint)!.status, "live", "still winding down");
    // Four weeks on, the pool is spent (the $1 floor stops the tail) and both coins retire.
    w.clock.now = B(12) + 31 * 86_400_000;
    for (let i = 0; i < 3; i++) await runCycle(w.deps);
    assert.equal(w.registry.token(w.a.mint)!.status, "retired"); assert.equal(w.registry.token(w.b.mint)!.status, "retired");
    assert.match(w.registry.getStatus(`rule.retired.${w.a.mint}`)!, /season over/);
    assert.ok(w.registry.receipts(w.a.mint).filter((r) => r.kind === "winddown").length >= 28);
  });

  test("a re-read never mints a second event for a window (the decision is written once, append-only)", async () => {
    const w = await derbyWorld(SEASON);
    for (let i = 0; i < 8; i++) { seedCross(w, WIF, B(5 + i), ["0.2", "0.21", "0.2058", "0.2058", "0.21", "0.21", "0.2205", "0.2205"][i]); seedCross(w, SHIB, B(5 + i), ["0.0000055", "0.00000561", "0.0000055", "0.0000055", "0.00000561", "0.0000055", "0.0000055", "0.0000055"][i]); }
    const r1 = await w.adapter.settledSince(w.registry.lockedRule(w.a).rule, null);
    const r2 = await w.adapter.settledSince(w.registry.lockedRule(w.a).rule, null);
    assert.deepEqual(r1.events.map((e) => e.id), r2.events.map((e) => e.id));
    assert.throws(() => w.registry.db.exec("UPDATE derby_windows SET result='no'"), /decided once/);
    assert.throws(() => w.registry.db.exec("DELETE FROM derby_points"), /append-only/);
  });
});

describe("the fallback paths", () => {
  test("GIGA (no Pyth feed): the pool TWAP from vault samples × Pyth SOL/USD; the CPMM decoder and a too-thin TWAP withholds", async () => {
    const accts = cpmmAccounts({ pool: GIGA_POOL, mint: GIGA_MINT, tokenRaw: BigInt(5_000_000) * BigInt(10) ** BigInt(5), solRaw: BigInt(1_000) * BigInt(10) ** BigInt(9), decimals: 5 });
    const port = fixturePort(accts);
    const s = await samplePool(port, GIGA_POOL, GIGA_MINT);
    assert.equal(s.dex, "raydium-cpmm"); assert.equal(s.priceSol, "0.0002");
    assert.throws(() => decodePoolFor(GIGA_POOL, "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB", accts[GIGA_POOL].data, GIGA_MINT), /Raydium CPMM and PumpSwap pools only/);
    assert.equal(twap([{ ts: 0, priceSol: "1" }], 1000).value, null);
    assert.equal(twap([{ ts: 0, priceSol: "1" }, { ts: 500, priceSol: "3" }, { ts: 750, priceSol: "3" }], 1000).value, "2");
    const spec: CoinVsSpec = { ...SEASON, a: GIGA, b: WIF, season: { start: "2026-10-05", days: 1 } };
    const w = await derbyWorld(spec, { tickers: ["TEAMGIGA", "TEAMWIF"] });
    // Pool samples through the hour before each boundary (GIGA +10% over the day), cross-reads for both.
    for (const [b, v] of [[B(5), "0.0002"], [B(6), "0.00022"]] as const) for (const k of [50, 30, 10]) w.adapter.store.putSample({ key: `pool:${GIGA_POOL}`, kind: "pool", ts: b - k * 60_000, slot: 1000 + k, value: v, detail: { tokenRaw: "1", solRaw: "1" } });
    seedCross(w, GIGA, B(5), "0.03"); seedCross(w, GIGA, B(6), "0.03322");
    seedCross(w, WIF, B(5), "0.2"); seedCross(w, WIF, B(6), "0.21");
    w.clock.now = B(6) + 3 * 3600_000;
    const r = await w.adapter.settledSince(w.registry.lockedRule(w.a).rule, null);
    assert.equal(r.events.length, 1, JSON.stringify(r.refusals));
    const row = w.adapter.store.windows(w.a.selectorKey)[0];
    const doc = row.proof as { a: { changePct: string; proof: { end: { source: string; samples: unknown[] } } }; b: { changePct: string } };
    // GIGA: TWAP 0.00022 SOL × 151 = 0.03322 vs 0.0002 × 150 = 0.03 → +10.733333%; WIF +5% → GIGA wins.
    assert.equal(doc.a.changePct, "10.733333"); assert.equal(doc.b.changePct, "5"); assert.equal(row.result, "yes");
    assert.equal(doc.a.proof.end.source, "twap"); assert.equal(doc.a.proof.end.samples.length, 3);
  });

  test("the keyless route: Pyth snapshots from Solana at the boundary decide the window when no Hermes key is set", async () => {
    const spec: CoinVsSpec = { ...SEASON, season: { start: "2026-10-05", days: 1 } };
    const w = await derbyWorld(spec, { hermes: null });
    const snap = (feed: string, b: number, value: string) => w.adapter.store.putSample({ key: `pyth:${feed}`, kind: "pyth", ts: b + 120_000, slot: 7, value, detail: { source: "pyth-solana", account: pythFeedAccount(feed), slot: 7, publishTime: b / 1000 + 30, accountSha256: "ab".repeat(32) } });
    snap(WIF_FEED, B(5), "0.2"); snap(WIF_FEED, B(6), "0.19"); snap(SHIB_FEED, B(5), "0.0000055"); snap(SHIB_FEED, B(6), "0.0000056");
    seedCross(w, WIF, B(5), "0.2"); seedCross(w, WIF, B(6), "0.19"); seedCross(w, SHIB, B(5), "0.0000055"); seedCross(w, SHIB, B(6), "0.0000056");
    w.clock.now = B(6) + 3600_000;
    const r = await w.adapter.settledSince(w.registry.lockedRule(w.a).rule, null);
    assert.equal(r.events.length, 1); assert.equal(r.events[0].result, "no");
    assert.match(r.events[0].sourceUrl, /^https:\/\/solscan\.io\/account\//);
    const doc = w.adapter.store.windows(w.a.selectorKey)[0].proof as { a: { proof: { end: { route: string } } } };
    assert.equal(doc.a.proof.end.route, "pyth-solana");
  });

  test("the one-shot flippening: no flip on day one, WIF passes BONK on day two → side A burns once, then both pools wind down", async () => {
    const spec: CoinVsSpec = { selector: "coinvs", a: WIF, b: BONK, window: "daily", measure: "mcap", season: { start: "2026-10-05", days: 5 }, flip: true };
    const w = await derbyWorld(spec, { tickers: ["TEAMWIF", "TEAMBONK"], hermes: null });
    const snap = (feed: string, b: number, value: string) => w.adapter.store.putSample({ key: `pyth:${feed}`, kind: "pyth", ts: b + 60_000, slot: 1, value, detail: { source: "pyth-solana", publishTime: b / 1000 + 5 } });
    const sup = (mint: string, b: number, v: string) => w.adapter.store.putSample({ key: `supply:${mint}`, kind: "supply", ts: b + 60_000, slot: 1, value: v, detail: {} });
    // WIF ~999M supply; BONK ~88T. Day 1 end (10-06): WIF 0.2 × 999M = 199.8M < BONK 0.0000025 × 88T = 220M. Day 2 end: WIF 0.25 → 249.75M > 220M.
    for (const [b, wv] of [[B(6), "0.2"], [B(7), "0.25"]] as const) { snap(WIF_FEED, b, wv); snap(BONK_FEED, b, "0.0000025"); sup(WIF_MINT, b, "999000000"); sup(BONK_MINT, b, "88000000000000"); seedCross(w, WIF, b, wv); seedCross(w, BONK, b, "0.0000025"); }
    w.clock.now = B(7) + 3 * 3600_000;
    await runCycle(w.deps); await runCycle(w.deps);
    const rows = w.adapter.store.windows(w.a.selectorKey);
    assert.deepEqual(rows.map((r) => [r.windowId, r.status, r.result]), [["2026-10-05", "withheld", null], ["2026-10-06", "decided", "yes"]]);
    assert.match(rows[0].reason!, /^noflip/);
    const ra = ev(w.registry.receipts(w.a.mint));
    assert.equal(ra.length, 1); assert.match(ra[0].eventId, /^flip-2026-10-06:/); assert.equal(ra[0].status, "confirmed");
    assert.equal(ev(w.registry.receipts(w.b.mint))[0].status, "nothing");
    // The one-shot settled: both rules ENDED (a 1 % mapping, so no drain) and the wind-down starts the next day.
    assert.match(w.registry.ruleEnd(w.a.mint)!.reason, /one-shot settled YES/); assert.equal(w.registry.ruleEnd(w.a.mint)!.mode, "winddown");
    assert.match(w.registry.ruleEnd(w.b.mint)!.reason, /one-shot settled/);
    assert.deepEqual(w.registry.receipts(w.a.mint).filter((r) => r.kind === "winddown").map((r) => r.eventId), ["winddown-2026-10-07"]);
  });

  test("a single asset (AAPL on Pyth, RedStone cross-read): the window's % change counted in units of percentage points", async () => {
    const AAPL_FEED = loadPythCatalogue().find((r) => r.symbol === "Equity.US.AAPL/USD")!.id;
    const u = { symbol: "AAPL", pyth: AAPL_FEED, mint: null, pool: null, cross: "redstone:AAPL" };
    const spec: PriceSpec = { selector: "price", u, window: "daily", season: { start: "2026-10-05", days: 2 } };
    const rule = lockRule({ schema: "burnticker.rules/v1", oracle: "derby", series: derbySeriesId(spec, rulesSha256), market: null, filter: {}, kind: "scalar", binary: null, scalar: { unit: 1, perUnit: { fractionOfPool: 0.01 }, baseline: 0, direction: "up" }, pair: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, derby: spec }).rule;
    assert.match(rule.series!, /^price:AAPL:daily:[0-9a-f]{10}$/);
    assert.deepEqual(lint(ruleStatement(rule)), []);
    const w = await derbyWorld(spec, { rule, tickers: ["AAPLUP", "AAPLDN"], hermes: null });
    // Market hours: the boundary snapshot carries the last value published by the boundary (the close).
    const snap = (b: number, value: string) => w.adapter.store.putSample({ key: `pyth:${AAPL_FEED}`, kind: "pyth", ts: b + 60_000, slot: 1, value, detail: { source: "pyth-solana", publishTime: b / 1000 - 4 * 3600 } });
    snap(B(5), "200"); snap(B(6), "204.5"); snap(B(7), "199");
    seedCross(w, u, B(5), "200.1"); seedCross(w, u, B(6), "204.6"); seedCross(w, u, B(7), "199");
    w.clock.now = B(7) + 3 * 3600_000;
    await runCycle(w.deps); await runCycle(w.deps);
    // Side A counts rises (2.25% → 2 units), side B (inverted) counts falls (−2.689% → 2 units).
    assert.deepEqual(ev(w.registry.receipts(w.a.mint)).map((r) => [r.value, r.units, r.status]), [["2.25", 2, "confirmed"], ["-2.689486", 0, "nothing"]]);
    assert.deepEqual(ev(w.registry.receipts(w.b.mint)).map((r) => [r.value, r.units, r.status]), [["2.25", 0, "nothing"], ["-2.689486", 2, "confirmed"]]);
  });
});

describe("refusals at launch", () => {
  const base = (now: number) => ({ registry: openRegistry(":memory:"), fetchImpl: fixtureFetch(), now });
  const NOW = Date.UTC(2026, 9, 10, 12);
  const SPEC: CoinVsSpec = { ...SEASON, season: { start: "2026-10-11", days: 30 } };
  test("WIF vs SHIB (both Pyth) is admitted; a platform coin, the refuse list, a non-crypto feed, a past season and thin liquidity are refused", async () => {
    assert.deepEqual(await derbyAdmission(coinvsRule(SPEC), base(NOW)), []);
    // A platform coin on the input side (registered as $WIF on Burnticker).
    const d = base(NOW);
    const program = new FakeBurnProgram("devnet");
    await launchSingle(d.registry, program, coinvsRule({ ...SPEC, a: BONK, b: SHIB }), "WIF");
    assert.match((await derbyAdmission(coinvsRule(SPEC), d)).map((r) => r.reason).join(";"), /WIF is a Burnticker platform coin/);
    // The refuse list over the symbols.
    assert.match((await derbyAdmission(coinvsRule({ ...SPEC, b: { ...SHIB, symbol: "DEATH" } }), base(NOW))).map((r) => r.reason).join(";"), /deaths/);
    // A stock is not a coin (coin-vs-coin is crypto only).
    const AAPL = loadPythCatalogue().find((r) => r.symbol === "Equity.US.AAPL/USD")!.id;
    assert.match((await derbyAdmission(coinvsRule({ ...SPEC, b: { symbol: "AAPL", pyth: AAPL, mint: null, pool: null, cross: "redstone:AAPL" } }), base(NOW))).map((r) => r.reason).join(";"), /not a Crypto\/USD feed/);
    // The season must start after launch.
    assert.match((await derbyAdmission(coinvsRule({ ...SPEC, season: { start: "2026-10-10", days: 30 } }), base(NOW))).map((r) => r.reason).join(";"), /earliest is 2026-10-11/);
    // No Pyth feed and $1,234 of liquidity.
    const thin = { ...base(NOW), fetchImpl: fixtureFetch({ "https://lite-api.jup.ag/price/v3": { [GIGA_MINT]: { usdPrice: 0.03, liquidity: 1234 } } }) };
    assert.match((await derbyAdmission(coinvsRule({ ...SPEC, a: GIGA }), thin)).map((r) => r.reason).join(";"), /needs \$250,000/);
    const deep = { ...base(NOW), fetchImpl: fixtureFetch({ "https://lite-api.jup.ag/price/v3": { [GIGA_MINT]: { usdPrice: 0.03, liquidity: 900_000 } } }) };
    assert.deepEqual(await derbyAdmission(coinvsRule({ ...SPEC, a: GIGA }), deep), []);
  });
  test("a US index proxy is refused unless BURNTICKER_INDEX_PROXIES_ENABLED is on; fund tickers pass", async () => {
    const id = (s: string) => loadPythCatalogue().find((r) => r.symbol === s)!.id;
    const price = (sym: string, feed: string): BurnRule => { const spec: PriceSpec = { selector: "price", u: { symbol: sym, pyth: feed, mint: null, pool: null, cross: `redstone:${sym}` }, window: "daily", season: { start: "2026-10-11", days: 30 } }; return lockRule({ schema: "burnticker.rules/v1", oracle: "derby", series: derbySeriesId(spec, rulesSha256), market: null, filter: {}, kind: "scalar", binary: null, scalar: { unit: 1, perUnit: { fractionOfPool: 0.01 }, baseline: 0, direction: "up" }, pair: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, derby: spec }).rule; };
    assert.match((await derbyAdmission(price("US500", id("Equity.Index.US500/USD")), base(NOW))).map((r) => r.reason).join(";"), /index proxy/);
    assert.deepEqual(await derbyAdmission(price("US500", id("Equity.Index.US500/USD")), { ...base(NOW), env: { BURNTICKER_INDEX_PROXIES_ENABLED: "1" } }), []);
    assert.deepEqual(await derbyAdmission(price("SPY", id("Equity.US.SPY/USD")), base(NOW)), []);
  });
});

describe("the Coin vs Coin tile's model", () => {
  test("two picks → the side-A rule the server validates, the sentence, default tickers", () => {
    const choice = { a: WIF, b: SHIB, window: "daily" as const, seasonDays: 30, flip: false, fraction: 0.01, now: Date.UTC(2026, 9, 10, 15) };
    const m = tileRule(choice, rulesSha256(tileHashInput(choice)), { a: defaultTicker("WIF"), b: defaultTicker("SHIB") });
    assert.deepEqual(m.problems, []);
    assert.equal(m.spec.season.start, "2026-10-11");
    assert.equal(lockRule(m.rule).rule.series, coinvsRule({ ...SEASON, season: { start: "2026-10-11", days: 30 } }).series);
    assert.equal(m.sentence, "$TEAMWIF burns 1% every day WIF out-gains SHIB (Pyth, 00:00 UTC). $TEAMSHIB burns when SHIB wins. Runs for 30 days, then winds down.");
    assert.deepEqual(lint(m.sentence), []);
    const bad = tileRule({ ...choice, flip: true }, "0".repeat(64), { a: "TEAMWIF", b: "TEAMSHIB" });
    assert.match(bad.problems.join(";"), /both coins need a mint/);
  });
});

void fixtureHermes; void CREATOR;
