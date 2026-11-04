// SWITCHBOARD ATTESTER (2026-10-09): the job for the Treasury row, its hashes against the pinned SDK (recomputed with the real
// @switchboard-xyz/common, no network), the account → attestation conversion, the env contract. Nothing here talks to a cluster.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { attestedFromPullFeed, attesterConfigFromEnv, canonicalQuotePubkey, feedHashFor, jobHash, parseAttesterEnv, SWITCHBOARD, SWITCHBOARD_VERSIONS, switchboardAttester, switchboardJobFor, TREASURY_DEBT_JOB_SPEC, TREASURY_DEBT_PINNED, treasuryDebtJob, type PullFeedDataLike } from "@/lib/burnKeeper/attesters/switchboard";
import { TREASURY_DEBT_URL } from "@/lib/burnKeeper/feeds/treasury";

describe("the job", () => {
  test("is the keeper's own Treasury URL (newest row) and the path to tot_pub_debt_out_amt", () => {
    assert.ok(TREASURY_DEBT_JOB_SPEC.url.startsWith(`${TREASURY_DEBT_URL}?fields=record_date,tot_pub_debt_out_amt&sort=-record_date&page[size]=1`));
    assert.deepEqual(treasuryDebtJob(), { tasks: [{ httpTask: { url: TREASURY_DEBT_JOB_SPEC.url } }, { jsonParseTask: { path: "$.data[0].tot_pub_debt_out_amt" } }] });
  });
  test("the generic builder: POST, headers, body; refuses http and a path without $", () => {
    assert.deepEqual(switchboardJobFor({ url: "https://x.example/api", jsonPath: "$.v", method: "POST", headers: { accept: "application/json" }, body: "{}" }),
      { tasks: [{ httpTask: { url: "https://x.example/api", method: 2, headers: [{ key: "accept", value: "application/json" }], body: "{}" } }, { jsonParseTask: { path: "$.v" } }] });
    assert.throws(() => switchboardJobFor({ url: "http://x.example", jsonPath: "$.v" }), /https/);
    assert.throws(() => switchboardJobFor({ url: "https://x.example", jsonPath: "data.v" }), /\$/);
  });
  test("hashes recompute from the pinned SDK (job sha256, feed hash per queue, v2 quote account)", async () => {
    const job = treasuryDebtJob();
    assert.equal(await jobHash(job), TREASURY_DEBT_PINNED.jobSha256);
    assert.equal(await feedHashFor(SWITCHBOARD.devnet.queue, [job]), TREASURY_DEBT_PINNED.feedHash.devnet);
    assert.equal(await feedHashFor(SWITCHBOARD["mainnet-beta"].queue, [job]), TREASURY_DEBT_PINNED.feedHash["mainnet-beta"]);
    assert.equal(await canonicalQuotePubkey(SWITCHBOARD.devnet.queue, TREASURY_DEBT_PINNED.feedHash.devnet), TREASURY_DEBT_PINNED.quotePubkey.devnet);
    assert.notEqual(await jobHash(switchboardJobFor({ ...TREASURY_DEBT_JOB_SPEC, jsonPath: "$.data[0].record_date" })), TREASURY_DEBT_PINNED.jobSha256, "a different path is a different job");
  });
  test("the pinned addresses and versions are the installed SDK's", async () => {
    const sb = await import("@switchboard-xyz/on-demand");
    assert.equal(sb.ON_DEMAND_DEVNET_PID.toBase58(), SWITCHBOARD.devnet.programId);
    assert.equal(sb.ON_DEMAND_DEVNET_QUEUE.toBase58(), SWITCHBOARD.devnet.queue);
    assert.equal(sb.ON_DEMAND_MAINNET_PID.toBase58(), SWITCHBOARD["mainnet-beta"].programId);
    assert.equal(sb.ON_DEMAND_MAINNET_QUEUE.toBase58(), SWITCHBOARD["mainnet-beta"].queue);
    const { createRequire } = await import("node:module");
    const req = createRequire(import.meta.url);
    assert.equal(req("@switchboard-xyz/on-demand/package.json").version, SWITCHBOARD_VERSIONS.onDemand);
    assert.equal(req("@switchboard-xyz/common/package.json").version, SWITCHBOARD_VERSIONS.common);
  });
});

const bn = (s: string | number) => ({ toString: () => String(s) });
const pk = (s: string) => ({ toBase58: () => s });
const feedData = (over: Partial<PullFeedDataLike> = {}): PullFeedDataLike => ({
  feedHash: Buffer.from(TREASURY_DEBT_PINNED.feedHash.devnet, "hex"), queue: pk(SWITCHBOARD.devnet.queue), lastUpdateTimestamp: bn(1_760_000_000),
  result: { value: bn("40305316210829720000000000000000"), slot: bn(400_000_010), minSlot: bn(400_000_000), maxSlot: bn(400_000_010) },
  submissions: [{ oracle: pk("Oracle1111111111111111111111111111111111111"), slot: bn(400_000_010), value: bn("40305316210829720000000000000000") }, { oracle: pk("Oracle2222222222222222222222222222222222222"), slot: bn(399_000_000), value: bn("40284036147367190000000000000000") }, { oracle: pk("Empty"), slot: bn(0), value: bn(0) }],
  minSampleSize: 1, maxStaleness: 1000, minResponses: 1, maxVariance: bn(0), ...over,
});

describe("the account → attestation", () => {
  test("value from the i128, slot, feed hash, only the oracles that sampled the result", () => {
    const a = attestedFromPullFeed("FEED", feedData());
    assert.equal(a.attester, "switchboard:FEED");
    assert.equal(a.value, "40305316210829.72"); assert.equal(a.cents, BigInt("4030531621082972"));
    assert.equal(a.slot, 400_000_010); assert.equal(a.observedAt, 1_760_000_000_000);
    assert.equal(a.feedHash, TREASURY_DEBT_PINNED.feedHash.devnet);
    assert.deepEqual(a.oracles, ["Oracle1111111111111111111111111111111111111"], "the stale second oracle and the empty slot are not samples of this result");
    assert.equal((a.evidence.submissions as unknown[]).length, 2);
  });
  test("the attester refuses a feed running another job, and a feed with no samples", async () => {
    const read = async () => attestedFromPullFeed("FEED", feedData());
    const conn = {} as never;
    const good = switchboardAttester({ connection: conn, feedPubkey: "FEED", expectedFeedHash: TREASURY_DEBT_PINNED.feedHash.devnet, read });
    assert.equal((await good.readAttested()).value, "40305316210829.72");
    const other = switchboardAttester({ connection: conn, feedPubkey: "FEED", expectedFeedHash: TREASURY_DEBT_PINNED.feedHash["mainnet-beta"], read });
    await assert.rejects(other.readAttested(), /runs feed hash cf7642.*not the published b56707/);
    const empty = switchboardAttester({ connection: conn, feedPubkey: "FEED", read: async () => attestedFromPullFeed("FEED", feedData({ submissions: [] })) });
    await assert.rejects(empty.readAttested(), /no oracle submissions/);
  });
});

describe("the env contract", () => {
  test("BURNKEEPER_ATTESTER parses, is optional, and a typo is an error rather than quorum 1", () => {
    assert.equal(parseAttesterEnv({}), null);
    assert.deepEqual(parseAttesterEnv({ BURNKEEPER_ATTESTER: "switchboard:EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7" }), { kind: "switchboard", feedPubkey: "EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7" });
    assert.throws(() => parseAttesterEnv({ BURNKEEPER_ATTESTER: "switchboard" }), /must be "switchboard:<feedPubkey>"/);
    assert.throws(() => parseAttesterEnv({ BURNKEEPER_ATTESTER: "pyth:abc" }), /must be/);
  });
  test("defaults: exact agreement, one business day of age, no slot ceiling, no pinned feed hash", () => {
    assert.deepEqual(attesterConfigFromEnv({}), { toleranceBps: 0, maxAgeMs: 1440 * 60_000, maxStalenessSlots: null, expectedFeedHash: null });
    assert.deepEqual(attesterConfigFromEnv({ BURNKEEPER_ATTESTER_TOLERANCE_BPS: "1", BURNKEEPER_ATTESTER_MAX_AGE_MIN: "90", BURNKEEPER_ATTESTER_MAX_STALENESS_SLOTS: "2000", BURNKEEPER_ATTESTER_FEED_HASH: "0xab" }), { toleranceBps: 1, maxAgeMs: 90 * 60_000, maxStalenessSlots: 2000, expectedFeedHash: "0xab" });
    assert.throws(() => attesterConfigFromEnv({ BURNKEEPER_ATTESTER_TOLERANCE_BPS: "-1" }), /non-negative/);
  });
});
