// ANTI-IMPERSONATION (growth batch, owner-approved 2026-10-10): "is this mint a Burnticker coin?" (verifyMint.ts, GET /v1/verify-mint),
// the lookalike refusal in the launch handler (lookalike.ts: homoglyphs, 0/O, 1/l, accents, one edit, DEFICIT2-style suffixes, the
// platform's name; no adoption of an existing mint), and the clone watch + the "Not Burnticker" list (ops/cloneWatch.ts, GET /v1/clones):
// Solana only, lookalike matching, the holder-stack signal, LP pulled from the observation history, evidence lines that pass the copy
// lint and name nobody, append-only storage.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { API, POST_HEADERS, CREATOR, callRoute, makeWorld, validateSchema, type World } from "./burntickerApiHelpers.ts";
import { buildOpenApi } from "@/lib/burnticker/api/spec";
import { verifyMint, isSolanaAddress, type MintFacts } from "@/lib/burnticker/verifyMint";
import { clearVerifyMintMemo, setRegistrationReaderForTests, verifyMintOn } from "@/lib/burnticker/verifyMintServe";
import type { RegistrationReader } from "@/lib/burnticker/mintRegistration";
import { editDistance, lookalikeHits, lookalikeRefusal, mintAdoptionRefusal, skeleton } from "@/lib/burnticker/lookalike";
import { bundleSignal, cloneRows, cloneStore, cloneTerms, evidenceLines, lpState, matchTerm, poolsFromDexScreener, runCloneWatch, scanClones, type CloneObservation } from "@/lib/burnticker/ops/cloneWatch";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { teamSeries } from "@/lib/burnticker/sources/espn";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { openRegistry } from "@/lib/burnticker/registry";
import { DEBT_RULE } from "./burntickerHelpers.ts";

const DOC = buildOpenApi() as unknown as Record<string, unknown> & { paths: Record<string, Record<string, { responses: Record<string, { content: Record<string, { schema: Record<string, unknown> }> }> }>> };
const cfg = loadCopyLintConfig();
const lintAll = (texts: string[], what: string) => { for (const t of texts) { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}: "${t}"\n${formatHits(r)}`); } };
const NOW = Date.parse("2026-10-10T18:00:00Z");
const MINT = "So11111111111111111111111111111111111111112";
const facts = (o: Partial<MintFacts>): MintFacts => ({ mint: MINT, cluster: "devnet", programId: "Prog1111111111111111111111111111111111111111", program: null, coin: null, ...o });
const COIN = { ticker: "DEFICIT", name: "Deficit", status: "live", creator: CREATOR, launchedAt: "2026-10-12T14:00:00Z", rulesSha256: "a".repeat(64), receipts: 3, burns: 2, platformId: null };

describe("verify a mint (pure)", () => {
  test("Burnticker coin: yes — the program's TokenConfig holds the registry's rules sha", () => {
    const v = verifyMint(facts({ program: { config: "Cfg111111111111111111111111111111111111111", rulesSha256: "a".repeat(64), readings: 3, burns: 2 }, coin: COIN }), NOW);
    assert.equal(v.verdict, "burnticker"); assert.equal(v.headline, "Burnticker coin: yes");
    assert.match(v.summary, /\$DEFICIT \(Deficit\), launched 2026-10-12 by Cre…\w{4}|\$DEFICIT \(Deficit\), launched 2026-10-12 by \w{4}…\w{4}\. It has 3 receipts, and its rules sha256 starts aaaaaaaaaaaa…/);
    assert.equal(v.coin!.rulesMatch, true); assert.equal(v.links.page, "/burnticker/t/DEFICIT");
    assert.ok(v.checks.every((c) => c.ok === true));
  });
  test("NOT registered with the burn program — plain, for an unknown mint", () => {
    const v = verifyMint(facts({}), NOW);
    assert.equal(v.verdict, "not-registered"); assert.equal(v.headline, "NOT registered with the burn program");
    assert.doesNotMatch(`${v.headline} ${v.summary}`, /scam|fake|fraud|rug|beware|warning|impostor/i, "no accusation");
  });
  test("program-only, rules mismatch, a draft, an unread program, an invalid address", () => {
    assert.equal(verifyMint(facts({ program: { config: "C", rulesSha256: "b".repeat(64), readings: 0, burns: 0 } }), NOW).verdict, "program-only");
    const mm = verifyMint(facts({ program: { config: "C", rulesSha256: "b".repeat(64), readings: 0, burns: 0 }, coin: COIN }), NOW);
    assert.equal(mm.verdict, "not-registered"); assert.equal(mm.headline, "Rules do not match the program"); assert.equal(mm.coin!.rulesMatch, false);
    assert.equal(verifyMint(facts({ coin: { ...COIN, status: "draft", launchedAt: null } }), NOW).verdict, "not-launched");
    const unread = verifyMint(facts({ program: "unread", coin: COIN }), NOW);
    assert.equal(unread.verdict, "burnticker"); assert.match(unread.summary, /could not be read just now/); assert.equal(unread.checks.find((c) => c.id === "program:devnet")!.ok, null);
    // audit 4 BT-01: an unread program and no catalogue entry is "Unable to verify", never "NOT registered"
    const unknown = verifyMint(facts({ program: "unread" }), NOW);
    assert.equal(unknown.verdict, "unavailable"); assert.equal(unknown.headline, "Unable to verify"); assert.equal(unknown.registration.state, "unknown");
    assert.equal(verifyMint(facts({ mint: "not a mint" }), NOW).verdict, "invalid");
    assert.ok(isSolanaAddress(MINT)); assert.ok(!isSolanaAddress("0OIl"));
  });
  test("every headline and summary lints clean", () => {
    const all = [verifyMint(facts({}), NOW), verifyMint(facts({ program: "unread" }), NOW), verifyMint(facts({ program: { config: "C", rulesSha256: "a".repeat(64), readings: 0, burns: 0 }, coin: COIN }), NOW), verifyMint(facts({ program: { config: "C", rulesSha256: "b".repeat(64), readings: 0, burns: 0 } }), NOW), verifyMint(facts({ coin: { ...COIN, status: "expired" } }), NOW)];
    lintAll(all.flatMap((v) => [v.headline, v.summary, ...v.checks.map((c) => c.detail)]), "verify-mint copy");
  });
});

describe("verify a mint (route + platform)", () => {
  let w: World;
  // the chain reader is injected: no RPC in tests. "unavailable" for every network = a host whose RPC is down.
  const none: RegistrationReader = async (network, programId) => ({ network, programId, state: "not-registered", config: null, rulesSha256: null, readings: null, burns: null, reason: null });
  const down: RegistrationReader = async (network, programId) => ({ network, programId, state: "unavailable", config: null, rulesSha256: null, readings: null, burns: null, reason: "RPC down (test)" });
  before(async () => { w = await makeWorld(); clearVerifyMintMemo(); setRegistrationReaderForTests(down); });
  test("GET /verify-mint/<BRONCO mint>: a Burnticker coin in the catalogue; an unavailable chain read is said, not counted", async () => {
    const res = await callRoute(`${API}/verify-mint/${w.bronco.mint}`);
    assert.equal(res.status, 200);
    const v = await res.json() as Record<string, unknown> & { verdict: string; program: { read: boolean }; registration: { state: string } };
    const schema = DOC.paths["/verify-mint/{mint}"].get.responses["200"].content["application/json"].schema;
    assert.deepEqual(validateSchema(schema, v, DOC), []);
    assert.equal(v.verdict, "burnticker"); assert.equal(v.program.read, false); assert.equal(v.registration.state, "unknown");
    assert.match(res.headers.get("cache-control")!, /max-age=60/);
  });
  test("with the program read on every network: a TokenConfig-less catalogue coin is not registered; an unknown mint is a definitive no", async () => {
    const v = await verifyMintOn(w.p, w.bronco.mint, NOW, { reader: none });
    assert.equal(v.program.read, true);
    assert.equal(v.verdict, "not-registered");
    const other = await verifyMintOn(w.p, MINT, NOW, { reader: none });
    assert.equal(other.verdict, "not-registered"); assert.equal(other.registration.state, "not-registered");
  });
  test("an unknown mint and garbage: 200 with the verdict (never a 404 that reads as an error); RPC down = Unable to verify", async () => {
    const a = await (await callRoute(`${API}/verify-mint/${MINT}`)).json() as { verdict: string; headline: string };
    assert.equal(a.verdict, "unavailable"); assert.equal(a.headline, "Unable to verify");
    const b = await (await callRoute(`${API}/verify-mint/hello`)).json() as { verdict: string };
    assert.equal(b.verdict, "invalid");
  });
  test("the coin page shows 'verified by program · mint' with the copy button beside it, and links the verifier", () => {
    const page = fs.readFileSync(new URL("../src/app/burnticker/t/[ticker]/page.tsx", import.meta.url), "utf8");
    assert.match(page, /verified by program · mint \{short\(s\.mint\)\}/); assert.match(page, /\/burnticker\/verify\?mint=/);
    assert.match(page, /<CopyButton text=\{s\.mint\} label="copy address" \/>\s*\n\s*\{\/\* growth batch/);
    const check = fs.readFileSync(new URL("../src/app/burnticker/check/page.tsx", import.meta.url), "utf8");
    assert.match(check, /href="\/burnticker\/verify"/);
  });
});

describe("lookalike refusal", () => {
  const EX = [
    { ticker: "DEFICIT", name: "Deficit", status: "live", rule: DEBT_RULE as never },
    { ticker: "BRONCO", name: "Bronco Burn", status: "live", rule: null },
    { ticker: "RAYS26", name: "Rays Win", status: "live", rule: nativeRule(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 })) },
    { ticker: "GONE", name: "Gone Coin", status: "expired", rule: null },
  ];
  test("skeletons: homoglyphs, zero-O, one-l, accents, punctuation, a leading $", () => {
    for (const s of ["DEFICIT", "DEF1CIT", "DEFlCIT", "DEFІCIT", "DΕFICIT", "dé.ficit", "$DEFICIT", "D-E-F-I-C-I-T", "DEF|CIT"]) assert.equal(skeleton(s), skeleton("DEFICIT"), s);
    assert.equal(skeleton("BR0NC0"), skeleton("BRONCO"));
    assert.equal(skeleton("Burnticker"), skeleton("BURNT1CKER"));
    assert.equal(editDistance("DEFICIT", "DEFICT"), 1); assert.equal(editDistance("DEFICIT", "DEFCIIT"), 1, "a swap is one edit"); assert.equal(editDistance("ABCDEF", "UVWXYZ", 1), 2);
  });
  test("refused: same letters, one edit, copycat suffix / prefix, the platform's name; each with a clear reason", () => {
    const cases: [string, string, string][] = [["DEF1CIT", "Debt", "reads as the same letters as $DEFICIT"], ["DEFICT", "Debt", "one letter away from $DEFICIT"], ["DEFICIT2", "Debt Two", "reads as the same letters as $DEFICIT"], ["DEFICITINU", "x y", "copycat variant of $DEFICIT"], ["REALDEFICIT", "x y", "copycat variant of $DEFICIT"], ["BRONC0", "Horse", "same letters as $BRONCO"], ["ABC", "Burnticker Official", "platform's name"], ["XYZQ", "Deficit", 'reads as the same letters as "Deficit", the name of $DEFICIT'], ["QQQQ", "Def1cit", "reads as"]];
    for (const [ticker, name, why] of cases) {
      const r = lookalikeRefusal({ ticker, name }, EX);
      assert.ok(r, `${ticker} / ${name} must be refused`); assert.ok(r!.reason.includes(why), `${ticker}: ${r!.reason}`);
      assert.match(r!.reason, /Please pick a ticker and name that cannot be mistaken for it\.$/);
    }
  });
  test("allowed: different coins, short tickers that only differ by a letter, an expired draft's ticker, another window of the same team", () => {
    for (const [ticker, name] of [["EAGLES", "Eagles Win"], ["ABC", "Abc"], ["ABD", "Abd"], ["GONE", "Gone Coin"], ["DEBTX", "Debt Burn"]]) assert.equal(lookalikeRefusal({ ticker, name }, EX), null, ticker);
    const rays27 = { ticker: "RAYS27", name: "Rays Win", rule: nativeRule(teamSeries("mlb", "TB", "win", { kind: "season", year: 2027 })) };
    assert.equal(lookalikeRefusal(rays27, EX), null, "a team's next-season coin is not a lookalike of its own last-season coin");
    assert.ok(lookalikeRefusal({ ...rays27, rule: null }, EX), "the same ticker without the team rule is refused");
  });
  test("the exact same ticker is the registry's 'ticker taken', not repeated here; hits name the field", () => {
    assert.deepEqual(lookalikeHits({ ticker: "DEFICIT", name: "zzzzz" }, EX), []);
    const h = lookalikeHits({ ticker: "QQQQ", name: "Bronco Burn" }, EX);
    assert.equal(h[0].field, "name");
  });
  test("no adoption: a registered mint or one that exists on chain is refused; no RPC → left to the program", () => {
    assert.match(mintAdoptionRefusal({ inRegistry: true, onChain: null })!, /already registered/);
    assert.match(mintAdoptionRefusal({ inRegistry: false, onChain: true })!, /never adopts an existing token/);
    assert.equal(mintAdoptionRefusal({ inRegistry: false, onChain: false }), null);
    assert.equal(mintAdoptionRefusal({ inRegistry: false, onChain: null }), null);
  });
  test("the launch handler refuses a lookalike with 409 code lookalike (and still launches a clean ticker)", async () => {
    const w = await makeWorld();
    const body = (ticker: string, name: string) => JSON.stringify({ creator: CREATOR, mint: "MintPub1ic11111111111111111111111111111111", ticker, name, description: "", imageUrl: null, links: [], rule: DEBT_RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, register: false });
    const bad = await callRoute(`${API}/launch/bundle`, { method: "POST", headers: POST_HEADERS, body: body("BRONC0", "Horse Burn") });
    assert.equal(bad.status, 409);
    const j = await bad.json() as { code: string; error: string };
    assert.equal(j.code, "lookalike"); assert.match(j.error, /\$BRONC0 reads as the same letters as \$BRONCO/);
    const good = await callRoute(`${API}/launch/bundle`, { method: "POST", headers: POST_HEADERS, body: body("DEBTX", "Debt Burn") });
    assert.notEqual(good.status, 409, await good.clone().text());
    void w;
  });
});

describe("clone watch", () => {
  const pair = (o: { chain?: string; mint: string; symbol: string; name: string; pool: string; liq?: number | null; created?: number }) => ({ chainId: o.chain ?? "solana", dexId: "raydium", url: `https://dexscreener.com/solana/${o.pool}`, pairAddress: o.pool, baseToken: { address: o.mint, symbol: o.symbol, name: o.name }, priceUsd: "0.001", marketCap: 1000, fdv: 1000, volume: { h24: 5 }, liquidity: o.liq === null ? undefined : { usd: o.liq ?? 1000 }, pairCreatedAt: o.created ?? NOW - 3_600_000 });
  const TERMS = cloneTerms(["BRONCO", "RAYS26"]);

  test("terms: the platform's names plus every launched ticker", () => {
    assert.deepEqual(TERMS, ["DEFICIT", "BURNTICKER", "BRONCO", "RAYS26"]);
  });
  test("DexScreener: Solana pools only (the real fixture has none), prices and market caps dropped", () => {
    const fx = JSON.parse(fs.readFileSync(new URL("../config/burnticker/fixtures/onchain.copycats.dexscreener.json", import.meta.url), "utf8")) as { body: unknown };
    assert.deepEqual(poolsFromDexScreener(fx.body), [], "base and pulsechain pairs are not Solana");
    const hits = poolsFromDexScreener({ pairs: [pair({ mint: "M1", symbol: "DEF1CIT", name: "x", pool: "P1" }), pair({ chain: "base", mint: "M2", symbol: "DEFICIT", name: "y", pool: "P2" })] });
    assert.deepEqual(hits.map((h) => h.mint), ["M1"]);
    assert.ok(!JSON.stringify(hits).match(/price|marketCap|fdv|volume/i));
  });
  test("matching: lookalike tickers and names containing a term; unrelated tokens ignored", () => {
    assert.deepEqual(matchTerm({ symbol: "DEF1CIT", name: "x" }, TERMS), { term: "DEFICIT", how: "ticker reads as the same letters" });
    assert.deepEqual(matchTerm({ symbol: "BRONCOINU", name: "x" }, TERMS), { term: "BRONCO", how: "ticker is a copycat variant" });
    assert.deepEqual(matchTerm({ symbol: "ZZZ", name: "The Deficit Coin" }, TERMS), { term: "DEFICIT", how: "name contains it" });
    assert.deepEqual(matchTerm({ symbol: "BTKR", name: "Burn Ticker" }, TERMS), { term: "BURNTICKER", how: "name contains it" });
    assert.equal(matchTerm({ symbol: "WIF", name: "dogwifhat" }, TERMS), null);
  });
  test("holder stack: five or more of the top holders with the identical share; the pool account excluded", () => {
    const supply = "1000000000";
    const seven = Array.from({ length: 7 }, (_, k) => ({ address: `W${k}`, amount: "9700000" }));
    assert.deepEqual(bundleSignal([{ address: "POOL", amount: "800000000" }, ...seven, { address: "X", amount: "1234567" }], supply, ["POOL"]), { wallets: 7, sharePct: 0.97 });
    assert.equal(bundleSignal([{ address: "A", amount: "9700000" }, { address: "B", amount: "9700000" }, { address: "C", amount: "5000000" }], supply), null);
    assert.equal(bundleSignal(seven, "0"), null);
  });
  test("LP state: present, thin, pulled at the first observation under $50 after one at $500 or more", () => {
    assert.equal(lpState([{ at: 1, liquidityUsd: 900 }]).state, "present");
    assert.equal(lpState([{ at: 1, liquidityUsd: 100 }]).state, "thin");
    assert.equal(lpState([{ at: 1, liquidityUsd: null }]).state, "unknown");
    const t0 = Date.parse("2026-10-10T10:00:00Z"), t1 = Date.parse("2026-10-10T11:02:00Z");
    assert.deepEqual(lpState([{ at: t0, liquidityUsd: 4000 }, { at: t1, liquidityUsd: 3 }, { at: t1 + 900_000, liquidityUsd: 0 }]), { state: "pulled", pulledAt: "2026-10-10T11:02:00.000Z" });
  });
  test("a scan: our own mints skipped, one observation per lookalike (its deepest pool), errors kept; stored append-only", async () => {
    const bodies: Record<string, unknown> = {
      DEFICIT: { pairs: [pair({ mint: "Clone1", symbol: "DEFICIT", name: "Deficit", pool: "PoolA", liq: 300 }), pair({ mint: "Clone1", symbol: "DEFICIT", name: "Deficit", pool: "PoolB", liq: 4000 }), pair({ mint: "OURMINT", symbol: "DEFICIT", name: "Deficit", pool: "PoolC" })] },
      BRONCO: { pairs: [pair({ mint: "Clone2", symbol: "BR0NC0", name: "Bronco", pool: "PoolD", liq: 900 })] },
    };
    let t = Date.parse("2026-10-10T10:00:00Z");
    const deps = {
      terms: TERMS, ownMints: new Set(["OURMINT"]), now: () => t,
      fetchImpl: (async (url: string) => { const q = decodeURIComponent(new URL(url).searchParams.get("q") ?? ""); if (q === "RAYS26") return { ok: false, status: 429, json: async () => ({}) }; return { ok: true, status: 200, json: async () => bodies[q] ?? { pairs: [] } }; }) as never,
      registered: async () => false,
      holders: async (mint: string) => mint === "Clone1" ? { holders: Array.from({ length: 7 }, (_, k) => ({ address: `W${k}`, amount: "9700000" })), supply: "1000000000", exclude: [] } : null,
    };
    const s1 = await scanClones(deps);
    assert.deepEqual(s1.observations.map((o) => [o.mint, o.pool]).sort(), [["Clone1", "PoolB"], ["Clone2", "PoolD"]]);
    assert.deepEqual(s1.errors, ["search RAYS26: HTTP 429"]);
    const reg = openRegistry(":memory:");
    const store = cloneStore(reg.db);
    await runCloneWatch(store, deps);
    // 62 minutes later the clone's liquidity is gone
    t = Date.parse("2026-10-10T11:02:00Z");
    bodies.DEFICIT = { pairs: [pair({ mint: "Clone1", symbol: "DEFICIT", name: "Deficit", pool: "PoolB", liq: 2 })] };
    await runCloneWatch(store, deps);
    const rows = cloneRows(store.observations(), new Set(["OURMINT"]));
    const c1 = rows.find((r) => r.mint === "Clone1")!;
    assert.equal(c1.lp.state, "pulled"); assert.equal(c1.lp.pulledAt, "2026-10-10T11:02:00.000Z");
    assert.deepEqual(c1.evidence.slice(0, 4), ["It is not registered with the burn program (burn_receipts).", "The ticker $DEFICIT reads as the same letters as $DEFICIT.", "7 wallets each hold exactly 0.97 % of the supply.", "The liquidity was pulled at 11:02 UTC 2026-10-10."]);
    assert.equal(c1.firstSeenAt, "2026-10-10T10:00:00.000Z");
    assert.equal(store.lastScan()!.hits, 2);
    assert.throws(() => reg.db.exec("DELETE FROM clone_observations"), /append-only/);
    assert.throws(() => reg.db.exec("UPDATE clone_scans SET hits = 0"), /append-only/);
    for (const r of rows) lintAll(r.evidence, `evidence ${r.mint}`);
  });
  test("evidence never names a person; every line form lints", () => {
    const base = { mint: "M", chain: "solana" as const, symbol: "DEFICIT", name: "n", pool: null, dex: null, url: null, firstSeenAt: "2026-10-10T00:00:00.000Z", lastSeenAt: "2026-10-10T00:00:00.000Z", poolCreatedAt: "2026-10-10T09:14:00.000Z", matched: { term: "BURNTICKER", how: "name contains it" }, bundle: { wallets: 6, sharePct: 1.5 }, lp: { state: "thin" as const, pulledAt: null } };
    for (const registered of [true, false, null]) lintAll(evidenceLines({ ...base, registered }), "evidence");
    for (const [f, src] of [["cloneWatch.ts", fs.readFileSync(new URL("../src/lib/burnticker/ops/cloneWatch.ts", import.meta.url), "utf8")]]) assert.doesNotMatch(src, /creator\b.*name|deployer name|@\w+ is/i, f);
  });
  test("GET /clones: the list from the registry database, schema-valid; the page reads the same rows", async () => {
    const w = await makeWorld();
    const store = cloneStore(w.registry.db);
    const o: CloneObservation = { mint: "CloneMint111111111111111111111111111111111", at: NOW, symbol: "DEF1CIT", name: "Deficit", pool: "PoolX", dex: "raydium", url: "https://dexscreener.com/solana/poolx", poolCreatedAt: NOW - 600_000, liquidityUsd: 700, matched: { term: "DEFICIT", how: "ticker reads as the same letters" }, registered: false, bundle: null };
    store.observe(o); store.observe({ ...o, mint: w.bronco.mint });   // one of ours never lists
    store.scan(NOW, 1, []);
    const res = await callRoute(`${API}/clones`);
    assert.equal(res.status, 200);
    const j = await res.json() as { clones: { mint: string; evidence: string[] }[]; terms: string[] };
    const schema = DOC.paths["/clones"].get.responses["200"].content["application/json"].schema;
    assert.deepEqual(validateSchema(schema, j, DOC), []);
    assert.deepEqual(j.clones.map((c) => c.mint), [o.mint]);
    assert.ok(j.terms.includes("BRONCO") && j.terms.includes("DEFICIT") && j.terms.includes("BURNTICKER"));
    lintAll(j.clones.flatMap((c) => c.evidence), "api evidence");
    const page = fs.readFileSync(new URL("../src/app/burnticker/not-burnticker/page.tsx", import.meta.url), "utf8");
    assert.match(page, /clonesFor\(platform\(\)\)/);
  });
  test("ops: the timer, the service and the install script carry the clone watch; the runbook has the launch-day lines", () => {
    const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
    assert.match(read("deploy/systemd/mct-burnticker-clonewatch.timer"), /OnUnitActiveSec=15min/);
    assert.match(read("deploy/systemd/mct-burnticker-clonewatch.service"), /Type=oneshot[\s\S]*run-burnticker-clonewatch\.sh/);
    assert.match(read("scripts/ops/install-burnticker-units.sh"), /TIMERS="[^"]*mct-burnticker-clonewatch\.timer/);
    const rb = read("docs/burnticker/runbook.md");
    for (const s of ["canonical mint and the burn_receipts program id", "Pin that post", "DexScreener Enhanced Token Info", "Solscan", "Jupiter", "Impersonator accounts, the same day"]) assert.ok(rb.includes(s), s);
  });
});
