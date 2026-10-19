// Second prelaunch audit 2026-10-18 A-19: the launch page chose some sentences by status, not code. Every prepare 429 read "Too many
// launch requests from this connection", although the server sends the daily upload limits (upload-budget, upload-budget-client,
// upload-budget-creator) and upload-busy with its own sentence; the launch route's per-connection confirm limit read as the coin's
// signature ceiling; a 422 for an account the server's RPC had not shown yet (`missing`) read as final. Each is now chosen by code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { launchedErrorMessage, launchErrorMessage, LAUNCH_NOT_SEEN_YET_SENTENCE, UPLOAD_LIMIT_CODES } from "@/lib/burnticker/pairLaunchClient";
import { confirmPlan, type SignPlan } from "@/lib/burnticker/signPlan";
import { markLaunched, resetConfirmGuards, UPLOAD_BUSY_SENTENCE, UNSIGNED_UPLOADS_SENTENCE, unfundedUploadsSentence } from "@/lib/burnticker/api/handlers";
import { openRegistry } from "@/lib/burnticker/registry";
import { lockRule } from "@/lib/burnticker/rules";
import { limiter } from "@/lib/burnticker/api/http";
import { RATE_LIMITS } from "@/lib/burnticker/api/spec";
import type { Platform } from "@/lib/burnticker/server";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { CREATOR } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const cfg = loadCopyLintConfig();
const plain = (s: string) => { assert.deepEqual(lintCopy(s, cfg).hits.map((h) => h.rule), [], s); assert.doesNotMatch(s, /→|\bbuy|\bprice\b|\bwill\b|coming soon|payout/i, s); return s; };

test("prepare 429: each upload limit shows the server's own sentence; only the connection limit says 'too many launch requests'", () => {
  const sentences: Record<string, string> = {
    "upload-budget": "This site has used up its daily upload limit of 50 coins. Please try again after midnight UTC.",
    "upload-budget-client": "This connection has saved the details of 6 coins on this site today, which is the daily limit. Please try again after midnight UTC.",
    "upload-budget-creator": "This wallet has saved the details of 6 coins on this site today, which is the daily limit for one wallet. Please try again after midnight UTC.",
    "upload-busy": UPLOAD_BUSY_SENTENCE,
    // prelaunch audit 2026-10-18 A-3: the unsigned share of the day's uploads is used up
    "upload-budget-unsigned": UNSIGNED_UPLOADS_SENTENCE,
    // A-3 follow-up: a signed wallet without the launch's cost, once the unsigned share is used up
    "upload-budget-unfunded": unfundedUploadsSentence(57_000_000),
    // review of block M: one proven wallet's own daily count, across connections
    "upload-budget-wallet": "This wallet has saved the details of 6 coins on this site today, which is the daily limit for one wallet. Please try again after midnight UTC.",
  };
  assert.deepEqual([...UPLOAD_LIMIT_CODES].sort(), Object.keys(sentences).sort());
  for (const [code, error] of Object.entries(sentences)) {
    const s = plain(launchErrorMessage(429, { code, error, retryAfterSec: 60 }, "60"));
    assert.equal(s, error, code);
    assert.doesNotMatch(s, /Too many launch requests/, code);
    assert.match(plain(launchErrorMessage(429, { code }, null)), /daily limit/, `${code} without a sentence: a plain fallback`);
  }
  assert.match(plain(launchErrorMessage(429, { code: "rate-limited", retryAfterSec: 120 }, "120")), /^Too many launch requests from this connection\. Try again in about 2 minutes\.$/);
});

test("confirm 429: the route's connection limit (confirm-busy) is not the coin's signature ceiling (rate-limited)", () => {
  const busy = plain(launchedErrorMessage(429, { code: "confirm-busy", retryAfterSec: 20 }, "20"));
  assert.match(busy, /This connection sent many launch records/); assert.match(busy, /20 seconds/);
  assert.doesNotMatch(busy, /too many different transactions/);
  assert.match(plain(launchedErrorMessage(429, { code: "rate-limited", retryAfterSec: 900 })), /too many different transactions/);
});

test("confirm 422 `missing` reads as not seen yet (and is asked again), not as a final refusal", () => {
  const s = plain(launchedErrorMessage(422, { code: "launch-unverified", missing: true, error: "no TokenConfig for this mint under the burn_receipts program on chain (C): initialize_token did not complete, it is not this coin's launch" }));
  assert.equal(s, LAUNCH_NOT_SEEN_YET_SENTENCE);
  assert.doesNotMatch(s, /did not accept/);
  assert.match(plain(launchedErrorMessage(422, { code: "launch-unverified", error: "the launch transaction failed on chain: nothing launched" })), /did not accept/, "a real refusal is still said as one");
});

test("markLaunched says `missing` in its answer, and the card asks again until the account shows", async () => {
  resetConfirmGuards();
  const reg = openRegistry(":memory:");
  const T0 = Date.now();
  const t = reg.register({ mint: Keypair.generate().publicKey.toBase58(), ticker: "MISSING", name: "Missing coin", creator: CREATOR, description: "", imageUrl: null, links: [], rulesText: lockRule(BRONCOS).text, feePda: "F", vault: null, tokenConfig: null, poolId: "Pool111111111111111111111111111111111111111", launchTx: null, cluster: "devnet", platformId: "Plat111111111111111111111111111111111111111", baselineAt: new Date(T0).toISOString(), status: "draft" }, T0);
  let shown = false;
  const p = { registry: reg, launchVerifier: { async verify() { return shown ? { ok: true as const, blockTimeMs: T0 + 1_000 } : { ok: false as const, status: 422 as const, missing: true as const, belongsToExpectedSigners: true, reason: "no TokenConfig for this mint yet" }; }, async seen() { return true; } } } as unknown as Platform;
  const sig = "5".repeat(88);
  const r = await markLaunched(p, t.mint, sig, T0 + 2_000, "creator");
  assert.equal(r.status, 422); assert.equal((r.body as { missing?: boolean }).missing, true);
  // the card's record loop over the real handler: two answers `missing`, then the account shows
  let calls = 0;
  const fetchFn = async (_u: string, init: { body: string }) => {
    calls++; if (calls >= 3) shown = true;
    const b = JSON.parse(init.body) as { mint: string; launchTx: string };
    const a = await markLaunched(p, b.mint, b.launchTx, T0 + 2_000 + calls, "creator");
    return { ok: a.status === 200, status: a.status, headers: { get: () => null }, json: async () => a.body };
  };
  const plan = { confirms: [{ mint: t.mint, ticker: "MISSING", step: 0 }], steps: [{ label: "x", signers: ["creator"], instructions: [] }] } as unknown as SignPlan;
  const c = await confirmPlan(fetchFn, plan, [sig], launchedErrorMessage, { sleep: async () => {} });
  assert.equal(c.error, null, String(c.error));
  assert.deepEqual(c.confirmed, [t.mint]);
  assert.equal(reg.token(t.mint)!.status, "live");
});

test("the launch route's own confirm limit answers code confirm-busy", async () => {
  limiter.reset();
  const { POST } = await import("../src/app/api/burnticker/launch/route.ts");
  const ip = "198.51.100.77";
  let last: Response | null = null;
  const cap = RATE_LIMITS.confirm.burst;
  for (let i = 0; i <= cap; i++) last = await POST(new Request("http://bt.test/api/burnticker/launch", { method: "POST", headers: { host: "bt.test", origin: "http://bt.test", "x-forwarded-proto": "https", "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ action: "launched", mint: "nope", launchTx: "nope" }) }));
  assert.equal(last!.status, 429);
  assert.equal(((await last!.json()) as { code: string }).code, "confirm-busy");
});
