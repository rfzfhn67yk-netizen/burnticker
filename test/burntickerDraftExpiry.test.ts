// DRAFTS EXPIRE AFTER 24 h (2026-10-09): a launch bundle's DRAFT reserves its ticker only for DRAFT_TTL_MS. After that it becomes
// "expired" (the row stays — append-only), its ticker is free for a new launch, confirming it is refused, and the expiry is final
// (SQL triggers). Live tokens never expire. Older registries with a UNIQUE ticker column are migrated in place, rows and triggers kept.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Keypair } from "@solana/web3.js";
import { openRegistry, DRAFT_TTL_MS, type Registry } from "@/lib/burnticker/registry";
import { lockRule } from "@/lib/burnticker/rules";
import { API, CREATOR, POST_HEADERS, callRoute, makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS, DENVER_HIGH } from "./burntickerHelpers.ts";

const T0 = Date.parse("2026-10-09T12:00:00Z");
const draft = (reg: Registry, ticker: string, at: number, rule: unknown = BRONCOS) => {
  const mint = Keypair.generate().publicKey.toBase58();
  return reg.register({ mint, ticker, name: `${ticker} coin`, creator: CREATOR, description: "", imageUrl: null, links: [], rulesText: lockRule(rule).text, feePda: "F", vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: new Date(at).toISOString(), status: "draft" }, at);
};

describe("draft expiry", () => {
  test("a draft holds its ticker for 24 h, then expires: the ticker is free, the old row stays, confirming it is refused", () => {
    const reg = openRegistry(":memory:");
    const a = draft(reg, "SQUAT", T0);
    assert.equal(reg.tickerTaken("SQUAT", T0 + DRAFT_TTL_MS - 60_000), true);
    { const other = openRegistry(":memory:"); draft(other, "SQUAT", T0); assert.doesNotThrow(() => draft(other, "SQUAT", T0 + 3_600_000), "tickers are not unique (owner 2026-10-12)"); assert.equal(other.tokensByTicker("SQUAT").length, 2); }
    assert.equal(reg.tickerTaken("SQUAT", T0 + DRAFT_TTL_MS + 1), false);
    assert.equal(reg.token(a.mint)!.status, "expired", "the row stays, marked expired");
    const b = draft(reg, "SQUAT", T0 + DRAFT_TTL_MS + 2);
    assert.equal(reg.tokenByTicker("SQUAT")!.mint, b.mint, "the ticker now resolves to the new holder");
    assert.throws(() => reg.markLaunched(a.mint, "5".repeat(88), null, new Date().toISOString()), /expired/);
    assert.equal(reg.tokens().length, 2);
  });
  test("expiry is final and only drafts expire (SQL triggers); a live token never expires", () => {
    const reg = openRegistry(":memory:");
    const a = draft(reg, "OLD", T0);
    const live = draft(reg, "LIVE", T0, DENVER_HIGH);
    reg.markLaunched(live.mint, "4".repeat(88), null, new Date(T0).toISOString());
    assert.equal(reg.expireDrafts(T0 + 2 * DRAFT_TTL_MS), 1);
    assert.equal(reg.token(live.mint)!.status, "live");
    assert.throws(() => reg.setTokenStatus(a.mint, "draft"), /stays expired/);
    assert.throws(() => reg.db.prepare("UPDATE tokens SET status='live' WHERE mint=?").run(a.mint), /stays expired/);
    assert.throws(() => reg.setTokenStatus(live.mint, "expired"), /only a draft can expire/);
    assert.throws(() => reg.db.prepare("DELETE FROM tokens WHERE mint=?").run(a.mint), /append-only/);
  });
  test("a registry created with the old UNIQUE ticker column is migrated in place: rows and triggers kept, expiry works", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-mig-")); const file = path.join(dir, "burnticker.db");
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE tokens (
  mint TEXT PRIMARY KEY, ticker TEXT NOT NULL UNIQUE, name TEXT NOT NULL, creator TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', image_url TEXT, links_json TEXT NOT NULL DEFAULT '[]',
  oracle TEXT NOT NULL, selector_key TEXT NOT NULL, rules_json TEXT NOT NULL, rules_sha TEXT NOT NULL, mode TEXT NOT NULL, fee_pda TEXT NOT NULL, vault TEXT,
  token_config TEXT, pool_id TEXT, launch_tx TEXT, cluster TEXT NOT NULL, platform_id TEXT, baseline_at TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL);`);
    const l = lockRule(BRONCOS);
    old.prepare("INSERT INTO tokens VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("MintOld1111111111111111111111111111111111111", "STALE", "stale", CREATOR, "", null, "[]", "kalshi", "kalshi:KXNFLGAME:binary", l.text, l.sha256, "buyback", "F", null, null, null, null, "devnet", null, "2026-10-01T00:00:00Z", T0, "draft");
    old.close();
    const reg = openRegistry(file);
    const idx = reg.db.prepare("PRAGMA index_list('tokens')").all() as { origin: string }[];
    assert.ok(!idx.some((i) => i.origin === "u"), "the column-level UNIQUE is gone");
    assert.equal(reg.token("MintOld1111111111111111111111111111111111111")!.ticker, "STALE", "rows copied verbatim");
    assert.throws(() => reg.db.prepare("DELETE FROM tokens").run(), /append-only/, "triggers re-created");
    assert.equal(reg.tickerTaken("STALE", T0 + DRAFT_TTL_MS + 1), false);
    draft(reg, "STALE", T0 + DRAFT_TTL_MS + 2);
    reg.close();
    const again = openRegistry(file); assert.equal(again.tokens().length, 2, "reopening is a no-op"); again.close();
  });
  test("through the public API: a ticker held by a fresh draft launches again (tickers are not unique); a 24 h old draft expires on the next launch", async () => {
    const w = await makeWorld();
    const held = draft(w.registry, "HELD", Date.now() - DRAFT_TTL_MS + 3_600_000);
    const body = (mint: string) => JSON.stringify({ creator: CREATOR, mint, ticker: "HELD", name: "held", rule: DENVER_HIGH, acknowledgements: { ruleLocked: true, noReturns: true } });
    assert.equal((await callRoute(`${API}/launch/bundle`, { method: "POST", headers: POST_HEADERS, body: body(Keypair.generate().publicKey.toBase58()) })).status, 200);
    assert.equal(w.registry.tokensByTicker("HELD").length, 2);
    const stale = draft(w.registry, "STALE2", Date.now() - DRAFT_TTL_MS - 1);
    const r = await callRoute(`${API}/launch/bundle`, { method: "POST", headers: POST_HEADERS, body: body(Keypair.generate().publicKey.toBase58()).replace('"HELD"', '"STALE2"') });
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()).slice(0, 200));
    assert.equal(w.registry.token(stale.mint)!.status, "expired");
    const list = await (await callRoute(`${API}/tokens?status=expired`)).json() as { tokens: { ticker: string }[] };
    assert.deepEqual(list.tokens.map((t) => t.ticker), ["STALE2"]);
    // AUDIT A C1: an expired draft is judged on the chain, not on when the sweep ran. This world's verifier answers that the launch
    // landed (its create and TokenConfig on chain), so the coin exists and is taken live through the append-only revival row.
    const confirm = await callRoute(`${API}/launch/confirm`, { method: "POST", headers: POST_HEADERS, body: JSON.stringify({ mint: stale.mint, signature: "6".repeat(88) }) });
    assert.equal(confirm.status, 200);
    assert.equal(w.registry.token(stale.mint)!.status, "live");
    assert.equal(w.registry.draftRevivals()[0].mint, stale.mint);
    void held;
  });
});
