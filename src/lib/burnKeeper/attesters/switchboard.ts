import type { Connection } from "@solana/web3.js";
import { latestUrl } from "@/lib/burnKeeper/feeds/treasury";
import { decimalToCents, scaledToDecimalString, type Attester, type AttestedReading } from "@/lib/burnKeeper/attesters/types";

/**
 * SWITCHBOARD ON-DEMAND AS THE SECOND ATTESTER (2026-10-09). A Switchboard feed is a job (fetch URL → JSON path) that a quorum of
 * oracles runs inside confidential runtimes; each oracle signs its result; the feed account on Solana stores the median, the slot
 * and every oracle's submission. For $DEFICIT the job is the exact Treasury URL feeds/treasury.ts polls (newest row) and the path to
 * its `tot_pub_debt_out_amt` — so the keeper's figure and the oracles' figure come from the same public row, and a verifier can
 * recompute the feed hash from the job JSON published here and compare it to the account.
 *
 * SDK pinned: @switchboard-xyz/on-demand 3.10.6 + @switchboard-xyz/common 5.8.5 (the docs' pair; common 5.8.5 carries the canonical
 * prost-compatible OracleJob encoding the hashes below depend on). Loaded LAZILY — it drags in Anchor — so nothing here costs the
 * keeper anything unless BURNKEEPER_ATTESTER is set.
 *
 * STATUS, VERIFIED 2026-10-09: Switchboard Technology Labs announced on 2026-09-19 that every implementation was deprecated and all
 * oracle services would end on 2026-09-25 (X announcement; reported by solanacompass, KuCoin news, TechFlow, CryptoTicker). From this
 * machine: crossbar.switchboard.xyz no longer resolves, the mainnet gateway times out, switchboard.xyz serves nothing; the programs and
 * default queue accounts still EXIST on devnet and mainnet (checked by getAccountInfo) but nothing feeds them. So: `jobHash`,
 * `feedHashFor`, `canonicalQuotePubkey` and the account reader work (they are local or RPC-only); `create-feed --send`, `pull` and
 * `simulate` cannot succeed until an operator runs the open-source oracle/crossbar stack themselves. The module is kept as the
 * reference implementation of "an oracle network as attester" and as the shape the next network plugs into.
 */

export const SWITCHBOARD_VERSIONS = { onDemand: "3.10.6", common: "5.8.5" } as const;

export type SbCluster = "mainnet-beta" | "devnet";

/** Program and default-queue addresses, copied from the pinned SDK's utils (tests assert they still match the SDK). */
export const SWITCHBOARD = {
  "mainnet-beta": { programId: "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv", queue: "A43DyUGA7s8eXPxqEjJY6EBu1KKbNgfxF8h17VAHn13w" },
  devnet: { programId: "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2", queue: "EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7" },
  /** The v2 "quote program" that stores managed (feed-hash) updates; same id on both clusters. */
  quoteProgram: "orac1eFjzWL5R3RbbdMV68K9H6TaCVVcL6LjvQQWAbz",
  /** Feed values are i128 scaled by 1e18. */
  decimals: 18,
} as const;

// ---------------------------------------------------------------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------------------------------------------------------------

export interface HttpJobSpec {
  url: string;
  /** JSONPath to a numeric (or numeric-string) value, e.g. "$.data[0].tot_pub_debt_out_amt". */
  jsonPath: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

/** OracleJob JSON (the proto's JSON form): HttpTask → JsonParseTask. The generic builder the platform's attested-http adapter reuses. */
export function switchboardJobFor(spec: HttpJobSpec): { tasks: Record<string, unknown>[] } {
  if (!/^https:\/\//.test(spec.url)) throw new Error("switchboardJobFor: the url must be https");
  if (!spec.jsonPath.startsWith("$")) throw new Error("switchboardJobFor: jsonPath must start with $");
  const http: Record<string, unknown> = { url: spec.url };
  if (spec.method === "POST") http.method = 2;   // OracleJob.HttpTask.Method.METHOD_POST
  if (spec.headers && Object.keys(spec.headers).length) http.headers = Object.entries(spec.headers).map(([key, value]) => ({ key, value }));
  if (spec.body !== undefined) http.body = spec.body;
  return { tasks: [{ httpTask: http }, { jsonParseTask: { path: spec.jsonPath } }] };
}

/** The $DEFICIT job: Treasury's newest Debt-to-the-Penny row (the same endpoint and sort the keeper uses, page size 1). */
export const TREASURY_DEBT_JOB_SPEC: HttpJobSpec = { url: latestUrl(1), jsonPath: "$.data[0].tot_pub_debt_out_amt" };
export const treasuryDebtJob = () => switchboardJobFor(TREASURY_DEBT_JOB_SPEC);

/** Pinned on 2026-10-09 from the installed SDK; the tests recompute them. */
export const TREASURY_DEBT_PINNED = {
  jobSha256: "b6ddb2ea59f7d0df3c054c767e0bf85255cd8e44c6f7f3d43238b72934b18625",
  feedHash: { devnet: "cf7642613b1d611d69f4b4ff760e792734ff48f204cfd19d428b2a4cdc922fb9", "mainnet-beta": "b56707d200ad10801bfe738ba9312cfa8dc639a37b7473c4d0b3284ff9b37a23" },
  quotePubkey: { devnet: "3ZanDQohmEpKVCWMKqMXcbDfJVwRSXH5f6ASkgwDWTLE" },
} as const;

type Common = typeof import("@switchboard-xyz/common");
type OnDemand = typeof import("@switchboard-xyz/on-demand");
const loadCommon = (): Promise<Common> => import("@switchboard-xyz/common");
const loadOnDemand = (): Promise<OnDemand> => import("@switchboard-xyz/on-demand");

/** sha256 of the canonical (prost) serialization of one job — "what the oracles ran". Hex, no 0x. */
export async function jobHash(job: { tasks: Record<string, unknown>[] }): Promise<string> {
  const c = await loadCommon();
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(c.serializeOracleJob(c.OracleJob.fromObject(job))).digest("hex");
}

/** Switchboard's feed hash = FeedHash.compute(queue, jobs): what a feed account's `feedHash` must equal. Hex, no 0x. */
export async function feedHashFor(queue: string, jobs: { tasks: Record<string, unknown>[] }[]): Promise<string> {
  const c = await loadCommon();
  const { PublicKey } = await import("@solana/web3.js");
  return c.FeedHash.compute(new PublicKey(queue).toBuffer(), jobs.map((j) => c.OracleJob.fromObject(j))).toString("hex");
}

/** The v2 canonical quote account for (queue, feedHash) — created on first managed update, no init transaction. */
export async function canonicalQuotePubkey(queue: string, feedHashHex: string): Promise<string> {
  const sb = await loadOnDemand();
  const { PublicKey } = await import("@solana/web3.js");
  return sb.OracleQuote.getCanonicalPubkey(new PublicKey(queue), [feedHashHex])[0].toBase58();
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Reading a feed account
// ---------------------------------------------------------------------------------------------------------------------------------

/** The slice of PullFeedAccountData the attestation needs (BN/PublicKey are duck-typed so the conversion is testable without Anchor). */
export interface PullFeedDataLike {
  feedHash: Uint8Array;
  queue: { toBase58(): string };
  lastUpdateTimestamp: { toString(): string };
  result: { value: { toString(): string }; slot: { toString(): string }; minSlot: { toString(): string }; maxSlot: { toString(): string } };
  submissions: { oracle: { toBase58(): string }; slot: { toString(): string }; value: { toString(): string } }[];
  minSampleSize: number;
  maxStaleness: number;
  minResponses: number;
  maxVariance: { toString(): string };
}

/** Pure: a classic PullFeed account → AttestedReading. */
export function attestedFromPullFeed(feedPubkey: string, d: PullFeedDataLike): AttestedReading {
  const value = scaledToDecimalString(BigInt(d.result.value.toString()), SWITCHBOARD.decimals);
  const slot = Number(d.result.slot.toString());
  const minSlot = Number(d.result.minSlot.toString());
  const subs = d.submissions.filter((s) => Number(s.slot.toString()) > 0).map((s) => ({ oracle: s.oracle.toBase58(), slot: Number(s.slot.toString()), value: scaledToDecimalString(BigInt(s.value.toString()), SWITCHBOARD.decimals) }));
  const sampled = subs.filter((s) => s.slot >= minSlot);
  return {
    attester: `switchboard:${feedPubkey}`,
    value, cents: decimalToCents(value), slot,
    observedAt: Number(d.lastUpdateTimestamp.toString()) * 1000,
    jobHash: null,   // the account commits to the jobs only through feedHash; the job JSON is published beside the rule file
    feedHash: Buffer.from(d.feedHash).toString("hex"),
    oracles: sampled.map((s) => s.oracle),
    evidence: { account: feedPubkey, queue: d.queue.toBase58(), resultSlotRange: [minSlot, Number(d.result.maxSlot.toString())], submissions: subs, minSampleSize: d.minSampleSize, minResponses: d.minResponses, maxStalenessSlots: d.maxStaleness, maxVarianceScaled1e9: d.maxVariance.toString() },
  };
}

/** Reads a classic PullFeed account over RPC (no gateway, no Crossbar). The SDK's Program load fetches the IDL from the chain. */
export async function readSwitchboardFeed(connection: Connection, feedPubkey: string, programId?: string): Promise<AttestedReading> {
  const sb = await loadOnDemand();
  const { PublicKey } = await import("@solana/web3.js");
  const program = await sb.AnchorUtils.loadProgramFromConnection(connection, undefined, programId ? new PublicKey(programId) : undefined);
  const feed = new sb.PullFeed(program, new PublicKey(feedPubkey));
  const data = (await feed.loadData()) as unknown as PullFeedDataLike;
  return attestedFromPullFeed(feedPubkey, data);
}

/** The Attester: a feed account, optionally pinned to the feed hash the rule file publishes (a feed running some other job is refused). */
export function switchboardAttester(o: { connection: Connection; feedPubkey: string; expectedFeedHash?: string | null; programId?: string; read?: (connection: Connection, feed: string, programId?: string) => Promise<AttestedReading> }): Attester {
  const read = o.read ?? readSwitchboardFeed;
  return {
    id: `switchboard:${o.feedPubkey}`,
    async readAttested() {
      const a = await read(o.connection, o.feedPubkey, o.programId);
      if (o.expectedFeedHash && a.feedHash !== o.expectedFeedHash.replace(/^0x/, "").toLowerCase()) throw new Error(`feed ${o.feedPubkey} runs feed hash ${a.feedHash}, not the published ${o.expectedFeedHash} — refused`);
      if (!a.oracles.length) throw new Error(`feed ${o.feedPubkey} has no oracle submissions at its result slot`);
      return a;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------------------------

export const ATTESTER_ENV = {
  attester: "BURNKEEPER_ATTESTER",                        // "switchboard:<feedPubkey>"
  feedHash: "BURNKEEPER_ATTESTER_FEED_HASH",              // optional: the published feed hash the account must carry
  toleranceBps: "BURNKEEPER_ATTESTER_TOLERANCE_BPS",      // default 0 — the Treasury figure is exact
  maxAgeMin: "BURNKEEPER_ATTESTER_MAX_AGE_MIN",           // default 1440 — Treasury posts once a business day
  maxStalenessSlots: "BURNKEEPER_ATTESTER_MAX_STALENESS_SLOTS",   // default none
} as const;

export type AttesterSpec = { kind: "switchboard"; feedPubkey: string };

/** BURNKEEPER_ATTESTER=switchboard:<feedPubkey> → spec; unset → null; anything else → throws (a typo must not silently mean "no attester"). */
export function parseAttesterEnv(env: Record<string, string | undefined>): AttesterSpec | null {
  const raw = env[ATTESTER_ENV.attester]?.trim();
  if (!raw) return null;
  const m = /^switchboard:([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(raw);
  if (!m) throw new Error(`${ATTESTER_ENV.attester} must be "switchboard:<feedPubkey>", got ${JSON.stringify(raw.slice(0, 60))}`);
  return { kind: "switchboard", feedPubkey: m[1] };
}

export function attesterConfigFromEnv(env: Record<string, string | undefined>): { toleranceBps: number; maxAgeMs: number; maxStalenessSlots: number | null; expectedFeedHash: string | null } {
  const num = (k: string, dflt: number): number => { const v = env[k]?.trim(); if (!v) return dflt; const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error(`${k} must be a non-negative number`); return n; };
  const stale = env[ATTESTER_ENV.maxStalenessSlots]?.trim();
  return { toleranceBps: num(ATTESTER_ENV.toleranceBps, 0), maxAgeMs: num(ATTESTER_ENV.maxAgeMin, 1440) * 60_000, maxStalenessSlots: stale ? num(ATTESTER_ENV.maxStalenessSlots, 0) : null, expectedFeedHash: env[ATTESTER_ENV.feedHash]?.trim() || null };
}
