// zkTLS PROTOTYPE (2026-10-09): Reclaim's published sample proof verifies by hand (identifier recomputed, signer recovered, in the
// attestor registry); every tampering is caught; the Box Office Mojo regex selects the rank-1 row of the saved page; the provider's
// prove→verify round trip works with a fake SDK and a locally signed claim. No network, no credentials.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { BOM_WEEKEND_TOP, bomWeekKey, canonicalJson, PINNED_RECLAIM_ATTESTORS, reclaimClaimIdentifier, reclaimProvider, reclaimSignedMessage, verifyReclaimProof, ZKTLS_SOURCES, zkTlsAttestedReading, type ReclaimProof } from "@/lib/burnKeeper/attesters/zktls";

const FIX = path.resolve(import.meta.dirname, "fixtures");
const sample = (): ReclaimProof => (JSON.parse(fs.readFileSync(path.join(FIX, "reclaim-sample-proof.json"), "utf8")) as { proof: ReclaimProof }).proof;
const ROW1 = fs.readFileSync(path.join(FIX, "bom-weekend-2026W40-row1.html"), "utf8");

describe("Reclaim's published sample proof", () => {
  test("verifies: identifier recomputed, signer recovered = the named witness, which is in the pinned registry", async () => {
    const v = await verifyReclaimProof(sample(), { attestors: PINNED_RECLAIM_ATTESTORS, expect: { provider: "http", url: "https://www.kaggle.com/api/i/users.UsersService/GetCurrentUser" } });
    assert.equal(v.ok, true, v.problems.join("; "));
    assert.equal(v.identifier, "0xbb5c63656a650276728d3cb9ce3f90361223c7814fd94f6582b682dfc96e4ba8");
    assert.deepEqual(v.signers, ["0x244897572368eadf65bfbc5aec98d8e5443a9072"]);
    assert.deepEqual(v.attestingSigners, v.signers);
    assert.equal(v.request?.method, "POST");
    assert.deepEqual(v.extracted, { DYNAMIC_GEO: "IN", username: "srivatsanqb" });
    assert.equal(v.checks.length, 4);
  });
  test("the signed message and identifier follow reclaim-js-sdk witness.ts exactly", () => {
    const p = sample();
    assert.equal(reclaimClaimIdentifier(p.claimData), p.identifier);
    assert.equal(reclaimSignedMessage({ identifier: p.identifier, owner: p.claimData.owner, timestampS: p.claimData.timestampS, epoch: p.claimData.epoch }), `${p.identifier}\n${p.claimData.owner}\n1774346626\n1`);
    assert.equal(canonicalJson({ b: 2, a: [1, { d: null, c: "x" }] }), '{"a":[1,{"c":"x","d":null}],"b":2}');
  });
  test("tampering is caught: an edited extracted value, an edited url, a signer outside the registry, a wrong expected url", async () => {
    const edited = sample();
    edited.claimData.context = edited.claimData.context.replace('"username":"srivatsanqb"', '"username":"someoneelse"');
    const v1 = await verifyReclaimProof(edited, { attestors: PINNED_RECLAIM_ATTESTORS });
    assert.equal(v1.ok, false); assert.match(v1.problems.join(" | "), /identifier mismatch/);
    const url = sample(); url.claimData.parameters = url.claimData.parameters.replace("www.kaggle.com", "www.kaggle.evil");
    const v2 = await verifyReclaimProof(url, { attestors: PINNED_RECLAIM_ATTESTORS });
    assert.equal(v2.ok, false); assert.match(v2.problems.join(" | "), /identifier mismatch/);
    const v3 = await verifyReclaimProof(sample(), { attestors: ["0x0000000000000000000000000000000000000001"] });
    assert.equal(v3.ok, false); assert.match(v3.problems.join(" | "), /no signer is a registered attestor \(signers: 0x2448/);
    const v4 = await verifyReclaimProof(sample(), { attestors: PINNED_RECLAIM_ATTESTORS, expect: { url: "https://www.boxofficemojo.com/weekend/2026W40/" } });
    assert.equal(v4.ok, false); assert.match(v4.problems.join(" | "), /not the expected source/);
    const v5 = await verifyReclaimProof(sample(), { attestors: PINNED_RECLAIM_ATTESTORS, now: Date.UTC(2026, 9, 9), maxAgeS: 3600 });
    assert.equal(v5.ok, false); assert.match(v5.problems.join(" | "), /old, ceiling 3600s/);
    assert.equal((await verifyReclaimProof({} as ReclaimProof, { attestors: [] })).problems[0], "not a Reclaim proof (claimData/signatures missing)");
  });
});

describe("Box Office Mojo weekend #1", () => {
  test("the regex selects rank 1's title and weekend gross on the saved 2026W40 row", () => {
    const x = BOM_WEEKEND_TOP.extract(ROW1);
    assert.deepEqual(x, { release: "rl2486730753", title: "Verity", gross: "32,031,011" });
    assert.deepEqual(BOM_WEEKEND_TOP.valueOf(x!), { value: "32031011", unit: "USD", label: "Verity (rl2486730753)" });
    assert.equal(BOM_WEEKEND_TOP.extract(ROW1.replace('mojo-sort-column">1<', 'mojo-sort-column">2<')), null, "rank 2 is not rank 1");
    assert.equal(BOM_WEEKEND_TOP.urlFor("2026W40"), "https://www.boxofficemojo.com/weekend/2026W40/");
  });
  test("the week key is the ISO week (2026-10-04 Sunday → 2026W40; 2026-10-09 Friday → 2026W41; year edge)", () => {
    assert.equal(bomWeekKey(new Date(Date.UTC(2026, 9, 4))), "2026W40");
    assert.equal(bomWeekKey(new Date(Date.UTC(2026, 9, 9))), "2026W41");
    assert.equal(bomWeekKey(new Date(Date.UTC(2027, 0, 3))), "2026W53");
    assert.equal(bomWeekKey(new Date(Date.UTC(2027, 0, 4))), "2027W01");
  });
});

describe("the provider round trip (fake SDK, local attestor key)", () => {
  const key = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";   // a well-known test key, nothing real
  const attestor = privateKeyToAccount(key);
  const fakeSdk = async () => ({
    ReclaimClient: class {
      constructor(appId: string, appSecret: string) { if (!appId || !appSecret) throw new Error("no creds"); }
      async zkFetch(url: string, _init: Record<string, unknown>, rules: { responseMatches: { value: string }[] }) {
        const x = new RegExp(rules.responseMatches[0].value).exec(ROW1)!.groups!;
        const claim = { provider: "http", parameters: JSON.stringify({ url, method: "GET", responseMatches: rules.responseMatches, responseRedactions: [], body: "" }), owner: attestor.address.toLowerCase(), timestampS: 1_760_000_000, context: JSON.stringify({ extractedParameters: { release: x.release, title: x.title, gross: x.gross }, providerHash: "0x00" }), epoch: 1, identifier: "" };
        claim.identifier = reclaimClaimIdentifier(claim);
        const signature = await attestor.signMessage({ message: reclaimSignedMessage(claim) });
        return { identifier: claim.identifier, claimData: claim, signatures: [signature], witnesses: [{ id: attestor.address.toLowerCase(), url: "wss://fake" }], extractedParameterValues: { gross: x.gross } };
      }
    },
  });
  test("prove reads credentials by name, never echoes them; verify extracts the gross; the attested reading is cents-exact", async () => {
    const p = reclaimProvider({ env: { RECLAIM_APP_ID: "app-id-x", RECLAIM_APP_SECRET: "secret-y" }, loadSdk: fakeSdk, now: () => 1_760_000_100_000 });
    const bundle = await p.prove(ZKTLS_SOURCES["bom.weekend.top"], "2026W40");
    assert.equal(bundle.url, "https://www.boxofficemojo.com/weekend/2026W40/");
    assert.ok(!JSON.stringify(bundle).includes("secret-y") && !JSON.stringify(bundle).includes("app-id-x"), "credentials never enter the bundle");
    const v = await p.verify(bundle, { attestors: [attestor.address] });
    assert.equal(v.ok, true, v.verification.problems.join("; "));
    assert.deepEqual(v.value, { value: "32031011", unit: "USD", label: "Verity (rl2486730753)" });
    assert.ok(v.trusted.some((t) => t.includes(attestor.address.toLowerCase())));
    const a = zkTlsAttestedReading(v);
    assert.equal(a.attester, "zktls:reclaim:bom.weekend.top"); assert.equal(a.cents, BigInt(3_203_101_100)); assert.equal(a.observedAt, 1_760_000_000_000);
    assert.deepEqual(a.oracles, [attestor.address.toLowerCase()]);
    const bad = await p.verify(bundle, { attestors: PINNED_RECLAIM_ATTESTORS });
    assert.equal(bad.ok, false, "a key outside the registry proves nothing");
    assert.throws(() => zkTlsAttestedReading(bad), /not verified/);
  });
  test("without credentials or the SDK, prove explains and refuses", async () => {
    await assert.rejects(reclaimProvider({ env: {}, loadSdk: fakeSdk }).prove(ZKTLS_SOURCES["bom.weekend.top"], "2026W40"), /set RECLAIM_APP_ID and RECLAIM_APP_SECRET/);
    await assert.rejects(reclaimProvider({ env: { RECLAIM_APP_ID: "a", RECLAIM_APP_SECRET: "b" } }).prove(ZKTLS_SOURCES["bom.weekend.top"], "2026W40"), /@reclaimprotocol\/zk-fetch is not installed/);
  });
});
