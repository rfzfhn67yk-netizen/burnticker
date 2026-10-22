// THE COPYCAT SOURCE (2026-10-09): the rule (`countCopycats`) on synthetic candidates — pattern, chain, creation day, the admission
// thresholds, dedupe by creator, the 10/day cap, our own mint excluded — the two keyless normalisers on the REAL fixtures fetched for
// "DEFICIT" on 2026-10-10 (DexScreener: 13 pairs, none on Solana, the Base DEFICIT refused as the wrong chain; GeckoTerminal: two
// Solana pools whose names contain "Deficit"), the RPC creator port on a fake RPC, and the source's honest tiering / launchability.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { copycatSourceFromConfig, loadSourceEntries, loadSourcesConfig } from "@/lib/burnticker/catalogue";
import { countCopycats, enrichWithCreator, fromDexScreenerSearch, fromGeckoTerminalSearch, fromHeliusSearchAssets, matchesPattern, readingsFromCandidates, rpcCreatorPort, type CopycatCandidate, type CopycatSourceConfig } from "@/lib/burnticker/sources/copycats";

const cfg = loadSourceEntries().find((e) => e.id === "onchain.copycats") as CopycatSourceConfig;
const fx = (f: string) => JSON.parse(fs.readFileSync(`config/burnticker/fixtures/${f}`, "utf8")) as { fetchedAt: string; url: string; body: unknown };
const DAY = "2026-10-09";
const T = Date.parse(`${DAY}T12:00:00Z`);
const cand = (o: Partial<CopycatCandidate>): CopycatCandidate => ({ mint: `M${Math.random().toString(36).slice(2, 8)}`, symbol: "DEFICIT", name: "Deficit", chain: "solana", createdAt: T, creator: null, liquidityUsd: 5000, distinctTraders: 0, via: "geckoterminal", ...o });

describe("sources.json carries the entry; the http list does not", () => {
  test("onchain.copycats is kind onchain, tier 4, not launchable, with the admission rules in its config and its note", () => {
    assert.ok(cfg); assert.equal(cfg.kind, "onchain"); assert.equal(cfg.tier, 4); assert.equal(cfg.launchable, false);
    assert.deepEqual([cfg.admission.minLiquidityUsd, cfg.admission.minDistinctTraders, cfg.admission.dedupeByCreator, cfg.admission.maxUnitsPerDay, cfg.admission.chain], [1000, 25, true, 10, "solana"]);
    assert.match(cfg.admission.note, /ANTI-GAMING, mandatory/); assert.match(cfg.unit.definition, /one per creator wallet; at most 10 per day/);
    assert.equal(cfg.indexer.primary.envKey, "HELIUS_API_KEY"); assert.equal(cfg.indexer.fallback.length, 2);
    assert.ok(loadSourcesConfig().every((c) => c.kind === "attested-http"), "the generic adapter's list stays attested-http only");
    assert.ok(loadSourcesConfig().length >= 28);
  });
  test("the pattern: symbol ^$?DEFICIT$ or name containing DEFICIT, case-insensitive", () => {
    for (const [s, n, ok] of [["DEFICIT", "x", true], ["$deficit", "x", true], ["DEFICIT2", "x", false], ["ADHD", "Attention Deficit Hamster Degen", true], ["GRASS", "Grass Deficit", true], ["DEBT", "National Debt", false]] as const) assert.equal(matchesPattern(cfg.match, { symbol: s, name: n }), ok, `${s}/${n}`);
  });
});

describe("countCopycats — the rule", () => {
  test("counts a matching Solana mint created that day with enough liquidity or traders; refuses the rest with a reason", () => {
    const r = countCopycats(cfg, [
      cand({ mint: "ok-liq", creator: "A" }),
      cand({ mint: "ok-traders", creator: "B", liquidityUsd: 0, distinctTraders: 25 }),
      cand({ mint: "thin", creator: "C", liquidityUsd: 999, distinctTraders: 24 }),
      cand({ mint: "wrong-chain", chain: "base", creator: "D" }),
      cand({ mint: "yesterday", creator: "E", createdAt: T - 86_400_000 }),
      cand({ mint: "no-time", creator: "F", createdAt: null }),
      cand({ mint: "no-match", creator: "G", symbol: "DEBT", name: "Debt" }),
    ], DAY);
    assert.deepEqual(r.counted.map((c) => c.mint), ["ok-liq", "ok-traders"]); assert.equal(r.units, 2);
    const why = Object.fromEntries(r.refused.map((x) => [x.mint, x.why]));
    assert.match(why["thin"], /below admission: \$999 liquidity, 24 traders/); assert.match(why["wrong-chain"], /wrong chain \(base\)/); assert.match(why["yesterday"], /created 2026-10-08, not 2026-10-09/); assert.match(why["no-time"], /creation time unknown/); assert.match(why["no-match"], /do not match/);
  });
  test("one unit per creator wallet per day; unknown creators count on their own and are flagged; the cap is 10; our mint is excluded", () => {
    const same = countCopycats(cfg, [cand({ mint: "a", creator: "W" }), cand({ mint: "b", creator: "W" }), cand({ mint: "c", creator: "W" })], DAY);
    assert.equal(same.units, 1); assert.equal(same.refused.filter((x) => /same creator as a/.test(x.why)).length, 2);
    const unknown = countCopycats(cfg, [cand({ mint: "u1" }), cand({ mint: "u2" })], DAY);
    assert.equal(unknown.units, 2); assert.equal(unknown.refused.filter((x) => /creator unknown/.test(x.why)).length, 2);
    const many = countCopycats(cfg, Array.from({ length: 14 }, (_, i) => cand({ mint: `m${i}`, creator: `c${i}`, createdAt: T + i })), DAY);
    assert.equal(many.units, 10); assert.equal(many.refused.filter((x) => /over the 10\/day cap/.test(x.why)).length, 4);
    const own = countCopycats({ ...cfg, match: { ...cfg.match, excludeMints: ["OURMINT"] } }, [cand({ mint: "OURMINT", creator: "us" }), cand({ mint: "x", creator: "y" })], DAY);
    assert.equal(own.units, 1); assert.match(own.refused[0].why, /our own mint/);
    assert.equal(countCopycats({ ...cfg, admission: { ...cfg.admission, dedupeByCreator: false } }, [cand({ mint: "a", creator: "W" }), cand({ mint: "b", creator: "W" })], DAY).units, 2);
  });
  test("readingsFromCandidates: one zero-filled reading per complete UTC day, capped by plausibility.max, naming the counted mints", () => {
    const r = readingsFromCandidates(cfg, [cand({ mint: "AbCdEfGhIj", creator: "A", createdAt: Date.parse("2026-10-07T03:00:00Z") })], Date.parse("2026-10-10T02:00:00Z"), 7);
    assert.deepEqual(r.readings.map((e) => [e.id, e.value]), [["2026-10-03", "0"], ["2026-10-04", "0"], ["2026-10-05", "0"], ["2026-10-06", "0"], ["2026-10-07", "1"], ["2026-10-08", "0"], ["2026-10-09", "0"]]);
    assert.match(r.readings[4].title!, /2026-10-07 — 1 counted \(DEFICIT AbCdEf…\)/);
  });
});

describe("the keyless normalisers on the real fixtures", () => {
  test("DexScreener search for DEFICIT: 13 pairs across Base and PulseChain, no Solana candidate; the Base DEFICIT ($24.5K) is refused as the wrong chain", () => {
    const f = fx("onchain.copycats.dexscreener.json");
    const c = fromDexScreenerSearch(f.body);
    assert.ok(c.length >= 8 && c.length <= 13, `${c.length} distinct base tokens`);
    assert.equal(c.filter((x) => x.chain === "solana").length, 0);
    const base = c.find((x) => x.symbol === "DEFICIT")!;
    assert.equal(base.chain, "base"); assert.ok(base.liquidityUsd! > 24_000); assert.equal(base.createdAt, 1779389677000); assert.equal(base.creator, null); assert.equal(base.distinctTraders, null);
    const r = countCopycats(cfg, c, "2026-05-21");
    assert.equal(r.units, 0); assert.match(r.refused.find((x) => x.mint === base.mint)!.why, /wrong chain \(base\)/);
  });
  test("GeckoTerminal pool search on Solana: GRASS 'Grass Deficit' and ADHD 'Attention Deficit Hamster Degen', created 10-04 / 10-05 with $2.7K / $5.1K reserve and 0 traders — each one unit on its day under the rule (creator unknown on the keyless path)", () => {
    const f = fx("onchain.copycats.geckoterminal.json");
    const c = fromGeckoTerminalSearch(f.body);
    assert.deepEqual(c.map((x) => [x.symbol, x.name, x.chain, new Date(x.createdAt!).toISOString().slice(0, 10), Math.round(x.liquidityUsd!), x.distinctTraders]).sort(), [["ADHD", "Attention Deficit Hamster Degen", "solana", "2026-10-05", 5124, 0], ["GRASS", "Grass Deficit", "solana", "2026-10-04", 2672, 0]]);
    assert.equal(c.find((x) => x.symbol === "GRASS")!.mint, "5pNNia7c2LMFYp117zTrBZNSigiRUQ4SP8phsv5iJnVk");
    const r = readingsFromCandidates(cfg, c, Date.parse(f.fetchedAt), 7);
    assert.deepEqual(r.readings.filter((e) => e.value !== "0").map((e) => [e.id, e.value]), [["2026-10-04", "1"], ["2026-10-05", "1"]]);
    assert.ok(r.days.find((d) => d.day === "2026-10-04")!.refused.some((x) => /creator unknown/.test(x.why)), "the keyless path cannot deduplicate by creator and says so");
  });
  test("Helius DAS items normalise to candidates without liquidity or time (the pool indexers and RPC fill them)", () => {
    const c = fromHeliusSearchAssets({ result: { items: [{ id: "MintA", interface: "FungibleToken", content: { metadata: { name: "Deficit", symbol: "DEFICIT" } }, authorities: [{ address: "Auth1", scopes: ["full"] }] }, { id: "MintB", content: { metadata: { name: "x", symbol: "y" } }, creators: [{ address: "Cr1" }] }] } });
    assert.deepEqual(c.map((x) => [x.mint, x.symbol, x.creator, x.liquidityUsd, x.createdAt, x.via]), [["MintA", "DEFICIT", "Auth1", null, null, "helius-das"], ["MintB", "y", "Cr1", null, null, "helius-das"]]);
  });
});

describe("the RPC creator port and the source", () => {
  const fakeRpc = (pages: { signature: string; blockTime: number }[][], feePayer: string) => async (_url: string, init?: { body?: string }) => {
    const req = JSON.parse(init?.body ?? "{}") as { method: string; params: unknown[] };
    const json = async () => {
      if (req.method === "getSignaturesForAddress") { const before = (req.params[1] as { before?: string }).before; const i = before ? pages.findIndex((p) => p[p.length - 1].signature === before) + 1 : 0; return { result: pages[i] ?? [] }; }
      if (req.method === "getTransaction") return { result: { blockTime: pages.flat().find((s) => s.signature === req.params[0])!.blockTime, transaction: { message: { accountKeys: [{ pubkey: feePayer }, { pubkey: "other" }] } } } };
      return { error: { message: "unknown" } };
    };
    return { ok: true, status: 200, json, text: async () => JSON.stringify(await json()) };
  };
  test("pages getSignaturesForAddress to the oldest signature, then reads the fee payer and block time; enrichWithCreator fills only what is missing", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ signature: `s${i}`, blockTime: 1_800_000_000 - i }));
    const page2 = [{ signature: "s1000", blockTime: 1_760_000_000 }, { signature: "first", blockTime: 1_759_968_000 }];
    const port = rpcCreatorPort("http://rpc", fakeRpc([page1, page2], "Creator1") as never);
    assert.deepEqual(await port.creationOf("Mint"), { creator: "Creator1", createdAt: 1_759_968_000_000 });
    const [e] = await enrichWithCreator([cand({ mint: "Mint", creator: null, createdAt: null })], port);
    assert.equal(e.creator, "Creator1"); assert.equal(e.createdAt, 1_759_968_000_000);
    const [kept] = await enrichWithCreator([cand({ mint: "Mint", creator: "K", createdAt: 5 })], port);
    assert.equal(kept.creator, "K"); assert.equal(kept.createdAt, 5);
    const empty = rpcCreatorPort("http://rpc", fakeRpc([], "x") as never);
    assert.deepEqual(await empty.creationOf("Nothing"), { creator: null, createdAt: null });
  });
  test("keyless: tier 5, not launchable with the reason; with HELIUS_API_KEY: tier 4, still not launchable (config says so); settledSince reads the fixtures through the fallback", async () => {
    const dex = fx("onchain.copycats.dexscreener.json"), gk = fx("onchain.copycats.geckoterminal.json");
    const fetchImpl = async (url: string) => { const body = url.includes("dexscreener") ? dex.body : url.includes("geckoterminal") ? gk.body : null; return { ok: body !== null, status: body ? 200 : 404, json: async () => body, text: async () => JSON.stringify(body) }; };
    const keyless = copycatSourceFromConfig({ fetchImpl: fetchImpl as never, env: {}, now: () => Date.parse(gk.fetchedAt), creatorPort: null })!;
    assert.equal(keyless.tier, 5); assert.equal(keyless.launchable.ok, false); assert.match(keyless.flags.join(" "), /keyless fallback/); assert.match(keyless.launchable.why!, /not launchable until a keyed run logs 14 days/);
    const r = await keyless.settledSince({} as never, "2026-10-03");
    assert.deepEqual(r.events.map((e) => [e.id, e.value]), [["2026-10-04", "1"], ["2026-10-05", "1"], ["2026-10-06", "0"], ["2026-10-07", "0"], ["2026-10-08", "0"], ["2026-10-09", "0"]]);
    assert.deepEqual(r.refusals, []);
    const { candidates, via } = await keyless.candidates();
    assert.deepEqual(via, ["dexscreener-search", "geckoterminal-search"]); assert.ok(candidates.some((c) => c.symbol === "GRASS") && candidates.some((c) => c.symbol === "DEFICIT"));
    const keyed = copycatSourceFromConfig({ fetchImpl: fetchImpl as never, env: { HELIUS_API_KEY: "k" }, now: () => Date.parse(gk.fetchedAt) })!;
    assert.equal(keyed.tier, 4); assert.equal(keyed.launchable.ok, false); assert.match(keyed.flags.join(" "), /Helius DAS \(key present\)/);
    const rk = await keyed.settledSince({} as never, null);
    assert.ok(rk.refusals.some((x) => /^helius-das:/.test(x)), "the keyed call fails against the fake fetch and says so; the fallback still reads");
    assert.equal(rk.events.length, 7);
    assert.equal((await keyless.impliedChance({} as never, null)).chance, null);
  });
});
