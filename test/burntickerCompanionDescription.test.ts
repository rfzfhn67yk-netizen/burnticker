// Ninth pre-launch audit (2026-10-21) WIZARD WZ9-6, HB-212 / HS-99 (Codex BT-COMPANION-DESCRIPTION-01): a Matchup companion's review
// returned description: null for coin B while its launch pins a full paragraph. Coin B now gets its own paragraph, from its own locked
// rule, ticker and describe context, the same one its own prepare pins (it is prepared as a single coin).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { prepareLaunch } from "@/lib/burnticker/api/handlers";
import { setNativeClients } from "@/lib/burnticker/sources/native";
import { CREATOR, makeWorld } from "./burntickerApiHelpers.ts";
import { ESPN_NOW, espnFixtureClient } from "./burntickerFirstPartyHelpers.ts";

const ENV = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" } as Record<string, string>;
const ruleOf = (series: string) => ({ schema: "burnticker.rules/v1", oracle: "catalogue", series, market: null, filter: {}, kind: "scalar", scalar: { unit: 1, perUnit: { fractionOfPool: 0.02 }, baseline: 0, direction: "up" }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null });
const A = { rule: ruleOf("espn.team:nfl-KC-win"), ticker: "KCNFLWIN", name: "Chiefs Wins", note: "", descCtx: {}, warnings: [], creatorDescription: "", links: [], raiseSol: "85" };
const B = { ticker: "DALNFLWIN", name: "Cowboys Wins", creatorDescription: "", rule: ruleOf("espn.team:nfl-DAL-win") };

test("HB-212: a companion pair's review gives coin B its own description, never null", () => {
  setNativeClients({ espn: espnFixtureClient() });
  const rv = buildLaunchReview({ ...A, companion: B } as never, { env: ENV, now: ESPN_NOW });
  assert.ok("review" in rv, "problems" in rv ? rv.problems.join(" | ") : "");
  const [a, b] = rv.review.coins;
  assert.ok(a.description && a.description.length > 40);
  assert.equal(b.side, "B");
  assert.ok(b.description, "coin B has a description");
  assert.match(b.description!, /\$DALNFLWIN/, "described with coin B's own ticker");
  assert.doesNotMatch(b.description!, /\$KCNFLWIN/, "not side A's text");
  assert.notEqual(b.description, a.description);
});

test("HB-212: coin B's review paragraph is the one its own prepare pins", async () => {
  setNativeClients({ espn: espnFixtureClient() });
  const rv = buildLaunchReview({ ...A, companion: B } as never, { env: ENV, now: ESPN_NOW });
  assert.ok("review" in rv);
  const w = await makeWorld();
  const built = await prepareLaunch(w.p, { creator: CREATOR, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, description: "", links: [], note: "", descCtx: {}, ...B }, { register: false });
  assert.ok("ok" in built, "error" in built ? String((built.error.body as { error?: string }).error) : "");
  const pinned = String((built as { ok: { description?: string; bundle?: { description?: string } } }).ok.description ?? (built as { ok: { bundle?: { description?: string } } }).ok.bundle?.description ?? "");
  assert.ok(pinned, `prepare answered keys ${Object.keys((built as { ok: object }).ok).join(",")}`);
  assert.ok(pinned.startsWith(rv.review.coins[1].description!), `review: ${rv.review.coins[1].description}\nbundle: ${pinned}`);
});
