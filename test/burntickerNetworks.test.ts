// WEBSITE AUDIT 4 (2026-10-11), BT-01 + BT-04: one per-network program configuration for every verifier, on-chain registration kept
// apart from catalogue membership, an unavailable chain read is "Unable to verify" (never "not registered"), and a server read of a
// network uses the host's RPC only when the host reads that network (the bounty wallet's mainnet balance used to be read from devnet).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NETWORKS, PROGRAM_IDS, PUBLIC_RPC_URLS, hostNetwork, rpcUrlFor, explorerUrl } from "@/lib/burnticker/networks";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { PAIR_CURVE_PROGRAM_ID } from "@/lib/burnReceipts/constants";
import { DEVNET_PROGRAM_ID, sampleReceipts } from "@/lib/burnticker/trustpack/samples";
import { PUBLIC_RPC, jsonRpc } from "@/lib/burnticker/trustpack/receiptCheck";
import { serverRpcUrl, v1Bounty } from "@/lib/burnticker/trustpack/api";
import { decodeRegistration, disclosedCoins, readRegistration, type RegistrationReader } from "@/lib/burnticker/mintRegistration";
import { discriminatorOf } from "@/lib/burnticker/trustpack/idlReader";
import { verifyMint, type MintFacts, type MintNetworkRead } from "@/lib/burnticker/verifyMint";
import { clearVerifyMintMemo, setRegistrationReaderForTests, verifyMintOn } from "@/lib/burnticker/verifyMintServe";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { makeWorld } from "./burntickerApiHelpers.ts";

const ROOT = path.join(import.meta.dirname, "..");
const json = (rel: string) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const FEATURED_MINT = "4QnwyiBMm2Caz5tJr9hNGzT2wqZcMipZjFHiSBu7AM4F";   // the devnet $DEFICIT rehearsal (deficit.devnet.rules.json)
const PLACEHOLDER = "8AttuQ6XgVePXHvNhsga3PVYGiJdxjTTAkXp4cUGMqEE";     // the fake client's id the live verifier showed before the fix
const NOW = Date.parse("2026-10-11T23:00:00Z");

describe("one per-network program configuration", () => {
  test("networks.ts equals verified-build.json (deployed rows), operator.json, the IDL address and the program constants", () => {
    const vb = json("config/burnticker/verified-build.json") as { programs: { library: "burn_receipts" | "pair_curve"; programId: string; deployed: Record<string, unknown> }[] };
    const op = json("config/burnticker/operator.json") as { clusters: Record<string, { programs: Record<string, string> }> };
    for (const n of NETWORKS) {
      for (const p of vb.programs) {
        assert.ok(p.deployed[n], `${p.library} has a deployed row for ${n}`);
        assert.equal(PROGRAM_IDS[n][p.library], p.programId, `${p.library} on ${n}: networks.ts vs verified-build.json`);
        assert.equal(op.clusters[n].programs[p.library], p.programId, `${p.library} on ${n}: operator.json`);
      }
    }
    assert.equal((BURN_RECEIPTS_IDL as unknown as { address: string }).address, PROGRAM_IDS.devnet.burn_receipts);
    assert.equal(PAIR_CURVE_PROGRAM_ID.toBase58(), PROGRAM_IDS.mainnet.pair_curve);
    assert.equal(DEVNET_PROGRAM_ID, PROGRAM_IDS.devnet.burn_receipts, "the receipt verifier reads the same id");
    assert.equal(sampleReceipts(ROOT).programId, PROGRAM_IDS.devnet.burn_receipts);
    assert.deepEqual(PUBLIC_RPC_URLS, PUBLIC_RPC);
  });
  test("no page or verifier hard-codes the burn_receipts id or reads the fake client's placeholder id", () => {
    for (const f of ["src/app/burnticker/check/ReceiptVerifier.tsx", "src/app/burnticker/verify/page.tsx", "src/lib/burnticker/verifyMintServe.ts", "src/lib/burnticker/trustpack/samples.ts"]) {
      const s = fs.readFileSync(path.join(ROOT, f), "utf8");
      assert.doesNotMatch(s, /AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM/, `${f}: use networks.ts`);
      assert.doesNotMatch(s, /p\.program\.programId/, `${f}: never the host's program client id`);
    }
  });
  test("a server read uses BURNTICKER_RPC_URL only for the network the host reads (BT-04: the bounty's mainnet read)", () => {
    const env = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_RPC_URL: "https://devnet-rpc.example" };
    assert.equal(hostNetwork(env), "devnet");
    assert.equal(rpcUrlFor("devnet", env), "https://devnet-rpc.example");
    assert.equal(rpcUrlFor("mainnet", env), PUBLIC_RPC.mainnet);
    assert.equal(serverRpcUrl("mainnet", env), PUBLIC_RPC.mainnet, "the bounty and every mainnet read go to a mainnet RPC");
    const main = { BURNTICKER_CLUSTER: "mainnet", BURNTICKER_RPC_URL: "https://mainnet-rpc.example" };
    assert.equal(rpcUrlFor("mainnet", main), "https://mainnet-rpc.example");
    assert.equal(rpcUrlFor("devnet", main), PUBLIC_RPC.devnet);
    assert.equal(rpcUrlFor("mainnet", {}), PUBLIC_RPC.mainnet);
    assert.equal(explorerUrl("tx", "abc", "devnet"), "https://explorer.solana.com/tx/abc?cluster=devnet");
    assert.equal(explorerUrl("address", "abc", "mainnet"), "https://explorer.solana.com/address/abc");
  });
  test("v1Bounty reads the live balance through the injected mainnet RPC and keeps the recorded funding and its transaction apart", async () => {
    let asked: unknown[] = [];
    const r = await v1Bounty({ root: ROOT, rpc: { call: async <T,>(m: string, p: unknown[]) => { asked = [m, ...p]; return { value: 5_000_000_000 } as T; } } });
    const b = r.body as { balanceLamports: string; recordedFunding: { sol: number; transaction: string | null } | null; wallet: string };
    assert.equal(asked[0], "getBalance"); assert.equal(asked[1], b.wallet);
    assert.equal(b.balanceLamports, "5000000000");
    assert.ok(b.recordedFunding, "the recorded funding is a separate field");
  });
});

describe("on-chain registration (mintRegistration.ts)", () => {
  const PID = PROGRAM_IDS.devnet.burn_receipts;
  const tokenConfigBytes = () => { const d = new Uint8Array(1368); d.set(discriminatorOf(BURN_RECEIPTS_IDL, "TokenConfig"), 0); return Buffer.from(d).toString("base64"); };
  test("three states: registered (owned by the program, decodes), not-registered (RPC answered: no account), unavailable (anything else)", () => {
    const reg = decodeRegistration("devnet", PID, "Cfg", { owner: PID, data: [tokenConfigBytes(), "base64"] });
    assert.equal(reg.state, "registered"); assert.equal(reg.rulesSha256, "0".repeat(64)); assert.equal(reg.readings, 0);
    assert.equal(decodeRegistration("devnet", PID, "Cfg", null).state, "not-registered");
    assert.equal(decodeRegistration("devnet", PID, "Cfg", { owner: "11111111111111111111111111111111", data: ["", "base64"] }).state, "unavailable");
    assert.equal(decodeRegistration("devnet", PID, "Cfg", { owner: PID, data: [Buffer.from(new Uint8Array(40)).toString("base64"), "base64"] }).state, "unavailable");
  });
  test("an RPC failure is unavailable with its reason, never not-registered", async () => {
    const r = await readRegistration({ call: async () => { throw new Error("fetch failed"); } }, "mainnet", PID, FEATURED_MINT);
    assert.equal(r.state, "unavailable"); assert.match(r.reason!, /mainnet RPC could not be read/);
    const ok = await readRegistration({ call: async <T,>() => ({ value: null }) as T }, "devnet", PID, FEATURED_MINT);
    assert.equal(ok.state, "not-registered"); assert.equal(ok.config, "FqfwxFKaiLRaK1HAsBsRRkXAq3nzbEt92fX9qWQTZYPh", "the TokenConfig PDA of the featured mint");
  });
  // ChatGPT re-check 2026-10-11 F1: a malformed or non-JSON-RPC answer used to decode as "no account" (HTTP 503 JSON, HTTP 200 `{}`,
  // a result without `value`) because jsonRpc checked neither the status nor the envelope and the reader took `r?.value ?? null`.
  const fetchOf = (status: number, body: string | null) => (async () => new Response(body, { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  const viaRpc = (status: number, body: string | null) => readRegistration(jsonRpc("https://rpc.invalid", fetchOf(status, body), { attempts: 1, baseMs: 1 }), "devnet", PID, FEATURED_MINT);
  test("F1: HTTP 503 with a non-envelope JSON body is unavailable, never not-registered", async () => {
    const r = await viaRpc(503, JSON.stringify({ message: "service unavailable" }));
    assert.equal(r.state, "unavailable"); assert.match(r.reason!, /HTTP 503/);
  });
  test("F1: HTTP 200 `{}` (no result member) is unavailable", async () => {
    const r = await viaRpc(200, "{}");
    assert.equal(r.state, "unavailable"); assert.match(r.reason!, /no result/);
  });
  test("F1: a result with context but no value is unavailable; an empty body and HTTP 4xx are unavailable", async () => {
    assert.equal((await viaRpc(200, JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 } } }))).state, "unavailable");
    assert.equal((await viaRpc(200, "")).state, "unavailable");
    assert.equal((await viaRpc(403, JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: null } }))).state, "unavailable", "a forbidden answer's body is not trusted");
    assert.equal((await viaRpc(200, JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: { lamports: 1 } } }))).state, "unavailable", "an account without owner/data is not an answer");
  });
  test("F1 controls: explicit result.value null is not-registered; a real TokenConfig account is registered", async () => {
    const none = await viaRpc(200, JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: null } }));
    assert.equal(none.state, "not-registered");
    const reg = await viaRpc(200, JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: { owner: PID, data: [tokenConfigBytes(), "base64"], lamports: 1, executable: false } } }));
    assert.equal(reg.state, "registered");
  });
  test("the platform's own rehearsal coins are named from their rules files (devnet $DEFICIT, the pair coins, mainnet $REHEARSAL)", () => {
    const d = disclosedCoins(ROOT);
    assert.equal(d.find((c) => c.mint === FEATURED_MINT)?.network, "devnet");
    assert.equal(d.find((c) => c.mint === "FwXiFscFSYXzvPVzV4rCw4UBcGDhT53xHDpsL3pVpzkp")?.network, "mainnet");
  });
});

describe("verification states (verifyMint.ts)", () => {
  const MINT = "So11111111111111111111111111111111111111112";
  const read = (network: "devnet" | "mainnet", state: MintNetworkRead["state"]): MintNetworkRead => ({ network, programId: PROGRAM_IDS[network].burn_receipts, state, config: state === "registered" ? "Cfg" : null, rulesSha256: state === "registered" ? "c".repeat(64) : null, readings: state === "registered" ? 1 : null, burns: state === "registered" ? 2 : null, reason: state === "unavailable" ? "RPC down" : null });
  const facts = (dev: MintNetworkRead["state"], main: MintNetworkRead["state"], extra: Partial<MintFacts> = {}): MintFacts => {
    const d = read("devnet", dev);
    return { mint: MINT, cluster: "devnet", programId: PROGRAM_IDS.devnet.burn_receipts, program: dev === "registered" ? { config: "Cfg", rulesSha256: "c".repeat(64), readings: 1, burns: 2 } : dev === "not-registered" ? null : "unread", networks: [d, read("mainnet", main)], coin: null, ...extra };
  };
  const cases: [string, MintFacts, string, string][] = [
    ["registered on the host network, not in the catalogue", facts("registered", "not-registered"), "program-only", "registered"],
    ["registered on the other network only", facts("not-registered", "registered"), "program-only", "registered"],
    ["registered elsewhere while the host read failed", facts("unavailable", "registered"), "program-only", "registered"],
    ["unregistered everywhere (both reads answered)", facts("not-registered", "not-registered"), "not-registered", "not-registered"],
    ["host read failed", facts("unavailable", "not-registered"), "unavailable", "unknown"],
    ["other network read failed", facts("not-registered", "unavailable"), "unavailable", "unknown"],
    ["every read failed", facts("unavailable", "unavailable"), "unavailable", "unknown"],
  ];
  for (const [what, f, verdict, reg] of cases) test(`${what} → ${verdict} (registration ${reg})`, () => {
    const v = verifyMint(f, NOW);
    assert.equal(v.verdict, verdict); assert.equal(v.registration.state, reg); assert.equal(v.catalogue.state, "absent");
    if (verdict === "unavailable") { assert.equal(v.headline, "Unable to verify"); assert.doesNotMatch(`${v.headline} ${v.summary}`, /NOT registered|not a Burnticker coin/); }
    assert.equal(v.checks.filter((c) => c.id.startsWith("program:")).length, 2, "one check per network");
    const r = lintCopy([v.headline, v.summary, ...v.checks.map((c) => c.detail)].join("\n"), loadCopyLintConfig(ROOT)); assert.ok(r.ok, formatHits(r));
  });
  test("a disclosed rehearsal coin is named, not 'another launchpad'", () => {
    const v = verifyMint(facts("registered", "not-registered", { mint: FEATURED_MINT, disclosed: { network: "devnet", ticker: "DEFICIT", label: "Burnticker's devnet rehearsal of $DEFICIT" } }), NOW);
    assert.equal(v.verdict, "program-only"); assert.match(v.headline, /disclosed Burnticker rehearsal coin/); assert.doesNotMatch(v.summary, /another launchpad/);
  });
});

describe("the featured mint through the served verifier (no RPC: an injected reader shaped like the live chain)", () => {
  // the live chain on 2026-10-11: the featured mint's TokenConfig exists on devnet, not on mainnet
  const live: RegistrationReader = async (network, programId) => network === "devnet"
    ? { network, programId, state: "registered", config: "FqfwxFKaiLRaK1HAsBsRRkXAq3nzbEt92fX9qWQTZYPh", rulesSha256: "b9ad29b48ef13548e18674dca770a554b0f96e1924fcf70fdd378225689d8884", readings: 5, burns: 2, reason: null }
    : { network, programId, state: "not-registered", config: null, rulesSha256: null, readings: null, burns: null, reason: null };
  const down: RegistrationReader = async (network, programId) => ({ network, programId, state: "unavailable", config: null, rulesSha256: null, readings: null, burns: null, reason: "RPC down" });
  test("recognised as registered on devnet (the receipt verifier's program), named as the rehearsal; never the placeholder id", async () => {
    const w = await makeWorld(); clearVerifyMintMemo();
    const v = await verifyMintOn(w.p, FEATURED_MINT, NOW, { reader: live });
    assert.equal(v.verdict, "program-only"); assert.equal(v.registration.state, "registered");
    assert.equal(v.programId, sampleReceipts(ROOT).programId); assert.notEqual(v.programId, PLACEHOLDER);
    assert.ok(v.registration.networks.every((n) => n.programId === PROGRAM_IDS[n.network].burn_receipts));
    assert.match(v.headline, /disclosed Burnticker rehearsal coin/); assert.match(v.summary, /1% of the burn pool per \$1B unit, the proposed mainnet rule is 2%/);
  });
  test("with the chain unavailable: Unable to verify — the featured mint is never a definitive negative", async () => {
    const w = await makeWorld(); clearVerifyMintMemo();
    const v = await verifyMintOn(w.p, FEATURED_MINT, NOW, { reader: down });
    assert.equal(v.verdict, "unavailable"); assert.equal(v.headline, "Unable to verify");
  });
  test("F1 two-network case: mainnet answers `value: null`, devnet's upstream answers HTTP 503 → registration unknown, Unable to verify, and the answer is not memoised", async () => {
    const w = await makeWorld(); clearVerifyMintMemo();
    const fetchFor = (status: number, body: string) => (async () => new Response(body, { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const outage: RegistrationReader = (network, programId, mint) => readRegistration(jsonRpc("https://rpc.invalid", network === "mainnet"
      ? fetchFor(200, JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: null } }))
      : fetchFor(503, JSON.stringify({ message: "service unavailable" })), { attempts: 1, baseMs: 1 }), network, programId, mint);
    try {
      setRegistrationReaderForTests(outage);
      const v = await verifyMintOn(w.p, FEATURED_MINT, NOW);
      assert.equal(v.registration.state, "unknown"); assert.equal(v.verdict, "unavailable"); assert.equal(v.headline, "Unable to verify");
      assert.doesNotMatch(v.headline + v.summary, /NOT registered/);
      assert.equal(v.registration.networks.find((n) => n.network === "mainnet")?.state, "not-registered");
      assert.equal(v.registration.networks.find((n) => n.network === "devnet")?.state, "unavailable");
      // the chain comes back: the same paste within the 60 s window re-reads the chain instead of serving a cached verdict
      setRegistrationReaderForTests(live);
      const again = await verifyMintOn(w.p, FEATURED_MINT, NOW);
      assert.equal(again.registration.state, "registered"); assert.equal(again.verdict, "program-only");
    } finally { setRegistrationReaderForTests(null); }
  });
});
