// THE FEC ADAPTER OVER A FROZEN OPENFEC RESPONSE (Michigan Senate 2026: El-Sayed vs Rogers; fetched with the DEMO_KEY, the key stripped
// from the stored paths). Candidate search → principal committee → filed reports → the per-period "out-raised" readings; the filings
// endpoint is the (same-operator) cross-read, so the creation gate still refuses the selector (test/burntickerSearch.test.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FecClient, fecSettled, FEC_API } from "@/lib/burnticker/sources/fec";

const FILE = path.join(import.meta.dirname, "..", "config", "burnticker", "fixtures", "fec", "michigan-senate-2026.json");
const have = fs.existsSync(FILE);
const fx = have ? (JSON.parse(fs.readFileSync(FILE, "utf8")) as { responses: Record<string, unknown> }) : { responses: {} };
const client = () => new FecClient({ apiKey: "DEMO_KEY", minIntervalMs: 0, fetchImpl: async (url: string) => {
  const p = url.replace(FEC_API, "").replace(/[?&]api_key=[^&]*$/, "");
  return p in fx.responses ? { ok: true, status: 200, json: async () => fx.responses[p] } : { ok: false, status: 404, json: async () => ({}) };
} });

describe("FEC over the frozen Michigan Senate fixture", { skip: have ? false : "fixture not frozen yet (DEMO_KEY rate limit)" }, () => {
  test("candidates and principal committees resolve from the fixture", async () => {
    const c = client();
    const es = await c.searchCandidates("El-Sayed", "S", "MI");
    assert.ok(es.some((x) => x.id === "S6MI00418"));
    assert.equal(await c.principalCommittee("S6MI00418"), "C00902668");
    assert.equal(await c.principalCommittee("S4MI00595"), "C00849810");
  });
  test("per-period readings: value 1 when El-Sayed out-raised Rogers in the same report period", async () => {
    const r = await fecSettled(client(), { a: "S6MI00418", b: "S4MI00595" }, null, { cycle: 2026 });
    assert.ok(r.events.length + r.awaitingFinal + r.refusals.length > 0, "the fixture yields matched report periods");
    for (const e of r.events) { assert.match(e.id, /^\d{4}-\d{2}-\d{2}$/); assert.ok(e.value === "0" || e.value === "1"); assert.match(e.title ?? "", /C00902668 .* · C00849810 /); }
  });
});
