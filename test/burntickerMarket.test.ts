// THE COIN CARD'S MARKET DATA (2026-10-10, launchpad conventions): the LaunchLab PoolState decoder pinned against the Raydium SDK's own
// layout AND three real mainnet pool accounts (config/burnticker/fixtures/launchlab/pools.mainnet.json), curve progress / graduation,
// the trade deep links and chart embed (mainnet only; drafts and devnet say why), the top-holder reader with its labels, the rule's
// one-liner, and the status.json / index / API fields that carry them ("—" when not read, never a guess).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { LaunchpadPool } from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import { buildMarketJson, chartFor, clearMarketCache, curveProgress, decodeLaunchLabPool, LAUNCHLAB_POOL_SIZE, readMarket, roundDec, tradeLinks, type MarketReader } from "@/lib/burnticker/market";
import { ruleOneLiner } from "@/lib/burnticker/coinCard";
import { launchLabVault, LAUNCHLAB_PROGRAM } from "@/lib/burnKeeper/launchlab";
import { tokenPageData } from "@/lib/burnticker/server";
import { buildPlatformIndex } from "@/lib/burnticker/tokenPage";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import type { BurnRule } from "@/lib/burnticker/rules";
import { BRONCOS, DEBT_RULE, DENVER_HIGH, NOW, ONE_SHOT, fx } from "./burntickerHelpers.ts";
import { API, callRoute, makeWorld } from "./burntickerApiHelpers.ts";

const FX = fx("launchlab/pools.mainnet.json") as { accounts: Record<string, { owner: string; dataBase64: string }> };
const CURVE_62 = "2RfJmqvLv69fZ1FrNm4jg2owJ7AEsYCDc6tthgtGEeuz", GRADUATED = "7uhcGDFZVQ2Xg3ai66K5xf6sadpAD1zEJ8YE7r4MuMLf", CURVE_1 = "28hkE85JYTw3TtNX9reGnuWW2RypbHWAaH2313PpPdSQ";
const bytes = (id: string) => new Uint8Array(Buffer.from(FX.accounts[id].dataBase64, "base64"));

describe("the LaunchLab PoolState decoder", () => {
  test("matches the Raydium SDK's LaunchpadPool layout field by field on three real mainnet accounts", () => {
    for (const id of [CURVE_62, GRADUATED, CURVE_1]) {
      const raw = bytes(id);
      assert.equal(raw.length, LAUNCHLAB_POOL_SIZE); assert.equal(LaunchpadPool.span, LAUNCHLAB_POOL_SIZE);
      assert.equal(FX.accounts[id].owner, LAUNCHLAB_PROGRAM.mainnet.toBase58());
      const sdk = LaunchpadPool.decode(Buffer.from(raw)) as unknown as Record<string, BN | number | PublicKey>;
      const v = decodeLaunchLabPool(raw)!;
      assert.equal(v.status, sdk.status); assert.equal(v.decimalsA, sdk.mintDecimalsA); assert.equal(v.decimalsB, sdk.mintDecimalsB);
      for (const [mine, theirs] of [["supplyRaw", "supply"], ["totalSellRaw", "totalSellA"], ["realARaw", "realA"], ["realBRaw", "realB"], ["totalFundRaisingRaw", "totalFundRaisingB"]] as const) assert.equal(v[mine].toString(), (sdk[theirs] as BN).toString(), `${id} ${theirs}`);
      for (const k of ["mintA", "mintB", "vaultA", "vaultB", "creator", "platformId", "configId"] as const) assert.equal(v[k], (sdk[k] as PublicKey).toBase58(), `${id} ${k}`);
    }
    assert.equal(decodeLaunchLabPool(new Uint8Array(100)), null, "wrong size → null");
  });

  test("an encode → decode round trip through the SDK's encoder", () => {
    const fields = LaunchpadPool.decode(Buffer.from(bytes(CURVE_62))) as unknown as Record<string, unknown>;
    const buf = Buffer.alloc(LAUNCHLAB_POOL_SIZE);
    LaunchpadPool.encode({ ...fields, status: 1, realB: new BN("85000000000"), totalFundRaisingB: new BN("85000000000") } as never, buf);
    const v = decodeLaunchLabPool(new Uint8Array(buf))!;
    assert.equal(v.status, 1); assert.equal(v.realBRaw, BigInt("85000000000"));
    assert.equal(curveProgress(v, "P").phase, "migrating");
  });

  test("curve progress: SOL raised of the raise that completes the curve; status 2 = graduated", () => {
    const c = curveProgress(decodeLaunchLabPool(bytes(CURVE_62))!, CURVE_62);
    assert.equal(c.phase, "curve"); assert.equal(c.quote, "SOL"); assert.equal(c.threshold, "24"); assert.equal(roundDec(c.raised, 2), "14.81");
    assert.ok(c.progressPct > 61 && c.progressPct < 62, String(c.progressPct)); assert.equal(roundDec(c.remaining, 2), "9.19");
    const g = curveProgress(decodeLaunchLabPool(bytes(GRADUATED))!, GRADUATED);
    assert.equal(g.phase, "graduated"); assert.equal(g.progressPct, 100); assert.equal(g.threshold, "85"); assert.equal(g.remaining, "0");
    const one = curveProgress(decodeLaunchLabPool(bytes(CURVE_1))!, CURVE_1);
    assert.ok(one.progressPct < 1.5 && one.progressPct > 0.5);
    assert.equal(roundDec("14.8103", 2), "14.81"); assert.equal(roundDec("0.995", 2), "1"); assert.equal(roundDec("7", 2), "7");
  });
});

describe("trade links and the chart: deep links only, mainnet only", () => {
  const MINT = "CMHXT3ZhRQFRnZ2KbEYmGuknR9dgpBPYnJ4ikJXwgray";
  test("curve → Raydium LaunchLab + Jupiter; graduated → Raydium swap + Jupiter; devnet and drafts get no links and say why", () => {
    const curve = tradeLinks("mainnet", MINT, "curve", "live");
    assert.deepEqual(curve.links.map((l) => l.id), ["launchlab", "jupiter"]); assert.match(curve.links[0].url, /^https:\/\/raydium\.io\/launchpad\/token\/\?mint=CMHX/);
    const grad = tradeLinks("mainnet", MINT, "graduated", "live");
    assert.deepEqual(grad.links.map((l) => l.label), ["Trade on Raydium", "Open in Jupiter"]); assert.match(grad.links[0].url, /outputMint=CMHX/); assert.equal(grad.links[1].url, `https://jup.ag/swap/SOL-${MINT}`);
    assert.deepEqual(tradeLinks("devnet", MINT, "curve", "live").links, []); assert.match(tradeLinks("devnet", MINT, "curve", "live").note!, /only serve mainnet/);
    assert.match(tradeLinks("mainnet", MINT, null, "draft").note!, /not launched/);
    const cfg = loadCopyLintConfig();
    for (const l of [...curve.links, ...grad.links]) assert.ok(lintCopy(l.label, cfg).ok, l.label);
  });
  test("GeckoTerminal embed for the pool that trades now (the CPMM pool after graduation)", () => {
    assert.equal(chartFor("mainnet", CURVE_62, null, "curve").embedUrl, `https://www.geckoterminal.com/solana/pools/${CURVE_62}?embed=1&info=0&swaps=0&grayscale=0&light_chart=0`);
    assert.match(chartFor("mainnet", CURVE_62, "CpmmPoo1111111111111111111111111111111111111", "graduated").embedUrl!, /pools\/CpmmPoo1/);
    assert.equal(chartFor("devnet", CURVE_62, null, "curve").embedUrl, null);
  });
  test("buildMarketJson: nothing read → every number null with the reason; holder count always null with why", () => {
    const m = buildMarketJson({ cluster: "devnet", mint: MINT, status: "live", poolId: CURVE_62, graduatedPool: null, read: null });
    assert.equal(m.curve, null); assert.match(m.curveNote, /This site has not read the LaunchLab pool/); assert.equal(m.holders.count, null); assert.match(m.holders.countNote, /indexer/);
    const read = buildMarketJson({ cluster: "mainnet", mint: MINT, status: "live", poolId: GRADUATED, graduatedPool: null, read: { pool: decodeLaunchLabPool(bytes(GRADUATED)), top: null, readAt: NOW, error: null } });
    assert.equal(read.phase, "graduated"); assert.equal(read.curve?.progressPct, 100); assert.equal(read.readAt, new Date(NOW).toISOString());
  });
});

describe("readMarket: one RPC round per coin, labelled holders, failures as text", () => {
  const pool = decodeLaunchLabPool(bytes(CURVE_62))!;
  const MINT = pool.mintA, FEE_PDA = "FeePda1111111111111111111111111111111111111", CREATOR = "Creator111111111111111111111111111111111111";
  const fake = (o: { failHolders?: boolean; owner?: string } = {}): MarketReader & { calls: number } => {
    const r = {
      calls: 0,
      async getAccountInfo() { r.calls++; return { data: Buffer.from(bytes(CURVE_62)), owner: new PublicKey(o.owner ?? LAUNCHLAB_PROGRAM.mainnet.toBase58()) }; },
      async getTokenLargestAccounts() {
        r.calls++; if (o.failHolders) throw new Error("429 Too Many Requests");
        const vault = launchLabVault(LAUNCHLAB_PROGRAM.mainnet, new PublicKey(CURVE_62), new PublicKey(MINT));
        return { value: [{ address: vault, amount: "600000000000000", decimals: 6 }, { address: new PublicKey("11111111111111111111111111111112"), amount: "50000000000000", decimals: 6 }, { address: new PublicKey("SysvarC1ock11111111111111111111111111111111"), amount: "1000000000000", decimals: 6 }] };
      },
      async getMultipleParsedAccounts() { r.calls++; return { value: [{ data: { parsed: { info: { owner: "Auth11111111111111111111111111111111111111" } } } }, { data: { parsed: { info: { owner: FEE_PDA } } } }, { data: { parsed: { info: { owner: CREATOR } } } }] }; },
    };
    return r;
  };
  test("labels the bonding curve, the burn pool and the creator; percentages of the supply; cached 30 s", async () => {
    clearMarketCache();
    const r = fake();
    const m = await readMarket(r, { cluster: "mainnet", mint: MINT, poolId: CURVE_62, feePda: FEE_PDA, creator: CREATOR, totalSupplyRaw: BigInt("1000000000000000"), decimals: 6 }, NOW);
    assert.equal(m.error, null); assert.equal(m.pool?.realBRaw, pool.realBRaw);
    assert.deepEqual(m.top!.map((h) => [h.label, h.pct]), [["bonding curve", 60], ["burn pool", 5], ["creator", 0.1]]);
    const calls = r.calls;
    await readMarket(r, { cluster: "mainnet", mint: MINT, poolId: CURVE_62, feePda: FEE_PDA, creator: CREATOR, totalSupplyRaw: BigInt("1000000000000000"), decimals: 6 }, NOW + 1000);
    assert.equal(r.calls, calls, "cached");
  });
  test("a holders failure keeps the curve; an account not owned by LaunchLab is refused, not decoded", async () => {
    clearMarketCache();
    const m = await readMarket(fake({ failHolders: true }), { cluster: "mainnet", mint: MINT, poolId: CURVE_62, feePda: FEE_PDA, creator: CREATOR, totalSupplyRaw: BigInt(1), decimals: 6 }, NOW);
    assert.ok(m.pool); assert.equal(m.top, null); assert.match(m.error!, /holders: rate-limited by the RPC/); assert.equal(m.poolError, null);
    clearMarketCache();
    const bad = await readMarket(fake({ owner: "11111111111111111111111111111111" }), { cluster: "mainnet", mint: MINT, poolId: CURVE_62, feePda: FEE_PDA, creator: CREATOR, totalSupplyRaw: BigInt(1), decimals: 6 }, NOW);
    assert.equal(bad.pool, null); assert.match(bad.error!, /not owned by the LaunchLab program/);
    assert.match(buildMarketJson({ cluster: "mainnet", mint: MINT, status: "live", poolId: CURVE_62, graduatedPool: null, read: bad }).curveNote, /not owned by the LaunchLab program/);
  });
});

describe("the card's one-liner, from the locked rule", () => {
  const rule = (r: unknown) => r as BurnRule;
  test("team coin, one game, binary, scalar, feed — and every line passes the copy lint", () => {
    const eaglesLose = rule({ ...BRONCOS, filter: { tickerIncludes: "-PHI" }, binary: { onYes: null, onNo: { fractionOfPool: 0.01 } } });
    assert.equal(ruleOneLiner(eaglesLose), "burns when the Eagles lose");
    assert.equal(ruleOneLiner(rule(BRONCOS)), "burns when the Broncos win");
    assert.equal(ruleOneLiner(rule(ONE_SHOT)), "burns if the Broncos win this game");
    assert.equal(ruleOneLiner(rule({ ...BRONCOS, filter: {}, series: "KXFEDDECISION" }), "Fed meeting"), "burns when Fed meeting settles YES");
    assert.equal(ruleOneLiner(rule(DENVER_HIGH), "Highest temperature in Denver"), "burns for every 1 above 80 (Highest temperature in Denver)");
    assert.equal(ruleOneLiner(rule(DEBT_RULE), "U.S. national debt"), "burns on the U.S. national debt feed");
    const cfg = loadCopyLintConfig();
    for (const r of [eaglesLose, BRONCOS, ONE_SHOT, DENVER_HIGH, DEBT_RULE]) { const t = ruleOneLiner(rule(r), null); assert.ok(lintCopy(t, cfg).ok, t); }
  });
});

describe("status.json, the index and the API carry the card fields", () => {
  test("profile + market in status.json; the index card; '—' (null) without an RPC; v1 /tokens has imageUrl + lastBurnAt", async () => {
    const w = await makeWorld();
    const d = await tokenPageData(w.p, w.bronco, NOW);
    assert.equal(d.status.profile.oneLiner, "burns when the Broncos win");
    assert.equal(d.status.market.curve, null, "no RPC in the test world → not read"); assert.match(d.status.market.curveNote, /This site has not read the LaunchLab pool/);
    assert.deepEqual(d.status.market.trade.links, [], "devnet: no swap links"); assert.ok(d.status.burned.lastAt === null || /^\d{4}-/.test(d.status.burned.lastAt));
    const ix = buildPlatformIndex([d.status], NOW);
    const card = ix.tokens[0];
    assert.equal(card.oneLiner, "burns when the Broncos win"); assert.equal(card.raised, null, "the curve was not read");
    // the (fake) program reports a registered CPMM pool → graduated by the program's record, 100 %; otherwise unknown
    const graduated = d.status.program?.pool.registered === true;
    assert.equal(card.phase, graduated ? "graduated" : null); assert.equal(card.progressPct, graduated ? 100 : null);
    assert.equal(card.lastBurnAt, d.status.burned.lastAt);
    const r = await callRoute(`${API}/tokens`); const j = await r.json() as { tokens: { ticker: string; imageUrl: string | null; lastBurnAt: string | null }[] };
    assert.ok(j.tokens.every((t) => "imageUrl" in t && "lastBurnAt" in t));
  });

  test("with a market reader on the platform the curve and holders are read for a live coin", async () => {
    const w = await makeWorld();
    clearMarketCache();
    const pool = decodeLaunchLabPool(bytes(CURVE_62))!;
    let asked: string | null = null;
    w.p.market = {
      async getAccountInfo(pk) { asked = pk.toBase58(); return null; },
      async getTokenLargestAccounts() { return { value: [] }; },
      async getMultipleParsedAccounts() { return { value: [] }; },
    };
    const d = await tokenPageData(w.p, w.bronco, NOW);
    assert.equal(asked, w.bronco.poolId, "the registry's pool id is read");
    assert.match(d.status.market.curveNote, /not found/);
    assert.deepEqual(d.status.market.holders.top, []);
    assert.ok(pool.realBRaw > BigInt(0));
    w.p.market = null;
  });
});

describe("plainSentence (the review screen, any rule)", () => {
  test("binary, scalar and feed sentences read plainly and pass the copy lint", async () => {
    const { plainSentence } = await import("@/lib/burnticker/coinCard");
    const cfg = loadCopyLintConfig();
    const b = plainSentence(BRONCOS as unknown as BurnRule, "BRONCO", "Pro football game");
    assert.equal(b, "When Pro football game settles YES, $BRONCO spends 2% of its burn pool buying $BRONCO back with its own trading fees and burns it. A voided market burns nothing.");
    const sc = plainSentence(DENVER_HIGH as unknown as BurnRule, "HOTDEN", "Highest temperature in Denver");
    assert.match(sc, /^Each time Highest temperature in Denver settles, every full 1 above 80 is one step, and each step \$HOTDEN spends 1% of its burn pool/);
    const f = plainSentence(DEBT_RULE as unknown as BurnRule, "DEBT", "U.S. national debt");
    assert.match(f, /^Each time U\.S\. national debt publishes a complete reading/);
    for (const t of [b, sc, f]) assert.ok(lintCopy(t, cfg).ok, t);
  });
});
