// THE PRODUCT BATCH (2026-10-10): search-miss telemetry (anonymous, append-only, admin-only summary, weekly rollup), time-to-launch
// (step durations sent with the launch bundle, p50 / p90 per step), the twelve templates and "launch one like this", and the
// creator dashboard's read-only API.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { anonymiseQuery, hourBucket, productStore, stepDurations } from "@/lib/burnticker/productStore";
import { rollupMarkdown } from "@/lib/burnticker/productRollup";
import { v1OpsSearchMisses } from "@/lib/burnticker/api/product";
import { TEMPLATES, TEMPLATE_START, likeHref } from "@/lib/burnticker/templates";
import { buildOpenApi, endpoint } from "@/lib/burnticker/api/spec";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { DENVER_HIGH } from "./burntickerHelpers.ts";
import { API, CREATOR, POST_HEADERS, callRoute, makeWorld, validateSchema } from "./burntickerApiHelpers.ts";

const DOC = buildOpenApi() as unknown as Record<string, unknown>;
const schemaOf = (op: string) => { const ep = endpoint(op); return (DOC.paths as Record<string, Record<string, { responses: Record<string, { content: { "application/json": { schema: Record<string, unknown> } } }> }>>)[ep.path.replace(/\{(\w+)\}/g, "{$1}")][ep.method.toLowerCase()].responses["200"].content["application/json"].schema; };

describe("search-miss telemetry", () => {
  test("queries are folded and stripped of anything identifying; hours are buckets", () => {
    assert.equal(anonymiseQuery("  Él-Sayed WINS Michigan!! "), "el sayed wins michigan");
    assert.equal(anonymiseQuery("send to me@example.com 5551234567 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU rays"), "send to rays");
    assert.equal(hourBucket(Date.parse("2026-10-10T18:42:11Z")), "2026-10-10T18:00Z");
  });

  test("a search with no card is logged by the server; a no-click report is accepted; both append-only; the summary is admin only", async () => {
    const w = await makeWorld();
    const r = await callRoute(`${API}/search?q=${encodeURIComponent("zzqx nothing matches this")}`);
    assert.equal(r.status, 200);
    const miss = await callRoute(`${API}/search/miss`, { method: "POST", headers: POST_HEADERS, body: JSON.stringify({ query: "rays world series", cards: 2 }) });
    assert.equal(miss.status, 200); assert.equal((await miss.json() as { stored: boolean }).stored, true);
    assert.equal((await callRoute(`${API}/search/miss`, { method: "POST", headers: POST_HEADERS, body: JSON.stringify({ query: "x", cards: 0 }) })).status, 400);
    const st = productStore(w.registry.db);
    const sum = st.missSummary(Date.now() - 3_600_000);
    assert.deepEqual(sum.queries.map((q) => [q.query, q.noCard, q.noClick]).sort(), [["rays world series", 0, 1], ["zzqx nothing matches this", 1, 0]]);
    assert.throws(() => w.registry.db.exec("DELETE FROM search_misses"), /append-only/);
    const cols = (w.registry.db.prepare("PRAGMA table_info(search_misses)").all() as { name: string }[]).map((c) => c.name);
    assert.deepEqual(cols, ["id", "hour", "query", "cards", "reason"], "no IP, no id, no session, no wallet column");
    // the ops summary: refused off the operator's network, refused without the PIN, answered with both
    assert.equal((await callRoute(`${API}/ops/search-misses`)).status, 403, "bt.test is not a trusted host");
    const env = { MCT_ACTION_PIN: "4321" };
    assert.equal(v1OpsSearchMisses(w.p, new Request("http://127.0.0.1:3000/api/burnticker/v1/ops/search-misses", { headers: { host: "127.0.0.1:3000" } }), new URLSearchParams(), Date.now(), env).status, 401);
    assert.equal(v1OpsSearchMisses(w.p, new Request("http://127.0.0.1:3000/x", { headers: { host: "127.0.0.1:3000", "x-action-pin": "4321" } }), new URLSearchParams(), Date.now(), {}).status, 503, "no PIN configured: closed");
    const okr = v1OpsSearchMisses(w.p, new Request("http://127.0.0.1:3000/x", { headers: { host: "127.0.0.1:3000", "x-action-pin": "4321" } }), new URLSearchParams("days=7"), Date.now(), env);
    assert.equal(okr.status, 200); assert.deepEqual(validateSchema(schemaOf("getOpsSearchMisses"), okr.body, DOC), []);
    assert.equal((okr.body as { misses: { total: number } }).misses.total, 2);
  });
});

describe("time to launch", () => {
  test("step timestamps become durations; out-of-order or stale steps are dropped; clock times are never stored", () => {
    const t0 = Date.parse("2026-10-10T18:00:00Z");
    assert.deepEqual(stepDurations({ search: t0, card: t0 + 12_000, create: t0 + 15_000, review: t0 + 75_000, launch: t0 + 90_000 }, t0 + 100_000), { card: 12, create: 3, review: 60, launch: 15 });
    assert.deepEqual(stepDurations({ search: t0, card: t0 - 5_000 }, t0 + 1000), null, "out of order");
    assert.equal(stepDurations({ search: t0 - 3 * 86_400_000 }, t0), null, "older than a day");
    assert.equal(stepDurations("nope"), null);
  });

  test("timings sent with the launch bundle are stored with the draft and summarised as p50 / p90 per step; the rollup renders", async () => {
    const w = await makeWorld();
    const now = Date.now(), mint = Keypair.generate().publicKey.toBase58();
    const r = await callRoute(`${API}/launch/bundle`, { method: "POST", headers: POST_HEADERS, body: JSON.stringify({ creator: CREATOR, mint, ticker: "HEAT", name: "Heat", rule: DENVER_HIGH, acknowledgements: { ruleLocked: true, noReturns: true }, timings: { search: now - 100_000, card: now - 80_000, create: now - 70_000, review: now - 20_000, launch: now - 5_000 } }) });
    assert.equal(r.status, 200, await r.clone().text());
    const st = productStore(w.registry.db);
    assert.deepEqual(st.timings(mint), { card: 20, create: 10, review: 50, launch: 15 });
    for (const [i, gap] of [[1, 5], [2, 40]] as const) st.putTimings(Keypair.generate().publicKey.toBase58(), { search: now - 200_000 + i, card: now - 200_000 + i + gap * 1000 }, now);
    const sum = st.timingSummary(now - 86_400_000);
    assert.equal(sum.drafts, 3);
    const card = sum.steps.find((s) => s.step === "card")!;
    assert.deepEqual([card.n, card.p50Sec, card.p90Sec], [3, 20, 40]);
    const md = rollupMarkdown(st.missSummary(now - 86_400_000), sum, { days: 7, now });
    assert.match(md, /# Search misses and time-to-launch — last 7 days/); assert.match(md, /\| chose a card \| 3 \| 20 s \| 40 s \|/);
    assert.ok(lintCopy(md, loadCopyLintConfig()).ok);
  });
});

describe("templates and launch one like this", () => {
  test("twelve canonical shapes, each with a lint-clean example, a settlement line and a start link the wizard knows", () => {
    assert.equal(TEMPLATES.length, 12);
    assert.deepEqual(TEMPLATES.map((t) => t.id).sort(), ["bracket", "coin-vs-coin", "election-oneshot", "election-pair", "flippening", "launch-count", "matchup", "number-feed", "polymarket-oneshot", "team-oneshot", "team-season", "weather"]);
    const cfg = loadCopyLintConfig();
    for (const t of TEMPLATES) {
      for (const s of [t.title, t.example, t.settles]) assert.ok(lintCopy(s, cfg).ok, `${t.id}: ${s}`);
      assert.equal(t.href, `/burnticker/launch?template=${t.id}`); assert.ok(TEMPLATE_START[t.id], t.id);
    }
    assert.equal(likeHref("rays26"), "/burnticker/launch?like=rays26");
  });
});

describe("the creator dashboard API", () => {
  test("GET /creators/{wallet}: the wallet's coins with state, readings, receipts, wind-down and a lint-checked post; read-only; a bad wallet is 400", async () => {
    await makeWorld();
    const r = await callRoute(`${API}/creators/${CREATOR}`);
    assert.equal(r.status, 200);
    const body = await r.json() as { wallet: string; coins: { ticker: string; state: string; receipts: number; todayPost: { text: string; lintOk: boolean } }[] };
    assert.deepEqual(validateSchema(schemaOf("getCreator"), body, DOC), []);
    assert.deepEqual(body.coins.map((c) => c.ticker).sort(), ["BRONCO", "DEFICIT2"]);
    for (const c of body.coins) { assert.ok(["curve", "graduated"].includes(c.state), c.state); assert.ok(c.todayPost.text.length > 10); assert.equal(c.todayPost.lintOk, true, c.todayPost.text); }
    const other = await callRoute(`${API}/creators/${Keypair.generate().publicKey.toBase58()}`);
    assert.deepEqual((await other.json() as { coins: unknown[] }).coins, []);
    assert.equal((await callRoute(`${API}/creators/not-a-wallet`)).status, 400);
  });
});
