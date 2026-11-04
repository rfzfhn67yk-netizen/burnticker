// SECOND INDEPENDENT AUDIT OF 2026-10-19 (burnticker-prelaunch-audit-2026-10-19-second.md), the findings fixed here:
//   I-16 an expired draft whose create landed in time was revived even after another creator took its ticker: two live coins, one ticker.
//   I-17 an older build opening a registry file a newer build migrated did not notice (a rollback reopened the ticker race).
//   I-11 reading, pair, config-mismatch and revival alerts were recorded but never pushed to the phone.
// I-15 (the fallback expectation) is tested in burntickerAdmissionIntegrity.test.ts; I-12 (the wizard's two revisions) in
// burntickerReviewRequester.test.ts.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  openRegistry, DRAFT_TTL_MS, REGISTRY_NEWER_ALERT_KIND, REGISTRY_SCHEMA_VERSION, REVIVAL_TICKER_HELD_ALERT_KIND, RegistrySchemaNewerError, RevivalTickerHeldError,
  type Registry, type TokenRow,
} from "@/lib/burnticker/registry";
import { lockRule } from "@/lib/burnticker/rules";
import { markLaunched, prepareLaunch, resetConfirmGuards } from "@/lib/burnticker/api/handlers";
import type { Platform } from "@/lib/burnticker/server";
import type { LaunchExpectation, LaunchVerifier } from "@/lib/burnticker/launchVerify";
import { configPda, feePda } from "@/lib/burnReceipts/pda";
import { reconcileDrafts, reviveDraft, SCAN_STATUS_PREFIX, type DraftChainReader } from "@/lib/burnticker/draftReconciler";
import { PUSH_KIND_OF_ALERT, PUSH_LEAD, PUSH_TITLE, PUSH_URGENT, planPushes, runPushCheck, type PushState } from "@/lib/burnticker/push";
import { limiter } from "@/lib/burnticker/api/http";
import { lintCopy } from "@/lib/launch/copyLint";
import { CREATOR, makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const T0 = Date.parse("2026-10-14T12:00:00Z");
const OTHER = Keypair.generate().publicKey.toBase58();
const PROGRAM = Keypair.generate().publicKey.toBase58();
const sig = (c: string) => c.repeat(88);
const draft = (reg: Registry, ticker: string, at: number, creator = CREATOR): TokenRow => {
  const mint = Keypair.generate().publicKey.toBase58();
  return reg.register({ mint, ticker, name: `${ticker} coin`, creator, description: "", imageUrl: null, links: [], rulesText: lockRule(BRONCOS).text, feePda: "F", vault: null, tokenConfig: null, poolId: "Pool111111111111111111111111111111111111111", launchTx: null, cluster: "devnet", platformId: null, baselineAt: new Date(at).toISOString(), status: "draft" }, at);
};
function tableVerifier(table: Map<string, { mint: string; blockTimeMs: number }>): LaunchVerifier {
  return { async verify(s: string, e: LaunchExpectation) { const x = table.get(s); return x && x.mint === e.mint ? { ok: true, blockTimeMs: x.blockTimeMs } : { ok: false, status: 422, reason: "not this coin's launch" }; } } as LaunchVerifier;
}
const revivalAlerts = (reg: Registry) => reg.alertsSince(0).filter((a) => a.kind === REVIVAL_TICKER_HELD_ALERT_KIND);
beforeEach(() => resetConfirmGuards());

describe("I-16: an expired draft is not revived onto a ticker another creator holds now", () => {
  /** Draft A at T0, expired at 24 h; its create landed at 23 h 59 m (in its window). */
  const setupA = () => {
    const reg = openRegistry(":memory:");
    const a = draft(reg, "TWICE", T0);
    const landed = T0 + DRAFT_TTL_MS - 60_000;
    assert.equal(reg.expireDrafts(T0 + DRAFT_TTL_MS + 1), 1);
    return { reg, a, landed };
  };

  test("B (another creator) registers the ticker after A expired; A's create confirms in the window: refused, alerted, A stays expired", () => {
    const { reg, a, landed } = setupA();
    const b = draft(reg, "TWICE", T0 + DRAFT_TTL_MS + 60_000, OTHER);
    assert.throws(() => reg.takeLiveFromChain(a.mint, sig("5"), a.poolId, landed, { source: "confirm" }, T0 + DRAFT_TTL_MS + 120_000), (e: unknown) => e instanceof RevivalTickerHeldError && e.ticker === "TWICE" && e.heldBy === b.mint);
    assert.equal(reg.token(a.mint)!.status, "expired");
    assert.equal(reg.token(a.mint)!.launchTx, null);
    assert.equal(reg.draftRevivals().length, 0, "no revival row is written");
    const al = revivalAlerts(reg);
    assert.equal(al.length, 1); assert.match(al[0].text, /TWICE/); assert.match(al[0].text, /another creator's draft/);
    // the same refusal again (another sweep, the same Denver day) is one alert
    assert.throws(() => reg.takeLiveFromChain(a.mint, sig("5"), a.poolId, landed, { source: "reconciler" }, T0 + DRAFT_TTL_MS + 180_000), RevivalTickerHeldError);
    assert.equal(revivalAlerts(reg).length, 1);
    // B's coin going live is unaffected: one live coin holds the ticker
    reg.markLaunched(b.mint, sig("6"), null, new Date(T0 + DRAFT_TTL_MS + 200_000).toISOString());
    assert.deepEqual(reg.tokens().filter((t) => t.ticker === "TWICE" && t.status === "live").map((t) => t.mint), [b.mint]);
  });

  test("with no other holder A is revived as before; the same creator's newer draft does not block it", () => {
    { const { reg, a, landed } = setupA();
      assert.deepEqual(reg.takeLiveFromChain(a.mint, sig("5"), a.poolId, landed, { source: "confirm" }, T0 + DRAFT_TTL_MS + 120_000), { changed: true, revived: true, withinWindow: true });
      assert.equal(reg.token(a.mint)!.status, "live"); assert.equal(revivalAlerts(reg).length, 0); }
    { const { reg, a, landed } = setupA();
      draft(reg, "TWICE", T0 + DRAFT_TTL_MS + 60_000, CREATOR);
      assert.equal(reg.takeLiveFromChain(a.mint, sig("5"), a.poolId, landed, { source: "confirm" }, T0 + DRAFT_TTL_MS + 120_000).revived, true);
      assert.equal(revivalAlerts(reg).length, 0); }
    { const { reg, a, landed } = setupA();
      const b = draft(reg, "TWICE", T0 + DRAFT_TTL_MS + 60_000, OTHER);
      reg.expireDrafts(T0 + 3 * DRAFT_TTL_MS);   // B's draft expired in turn: the ticker is free again
      assert.equal(reg.token(b.mint)!.status, "expired");
      assert.equal(reg.takeLiveFromChain(a.mint, sig("5"), a.poolId, landed, { source: "reconciler" }, T0 + 3 * DRAFT_TTL_MS).revived, true); }
  });

  test("the confirm route answers 409 revival-ticker-held; the operator's revive is refused with a reason", async () => {
    const { reg, a, landed } = setupA();
    draft(reg, "TWICE", T0 + DRAFT_TTL_MS + 60_000, OTHER);
    const verifier = tableVerifier(new Map([[sig("5"), { mint: a.mint, blockTimeMs: landed }]]));
    const r = await markLaunched({ registry: reg, launchVerifier: verifier } as unknown as Platform, a.mint, sig("5"), T0 + DRAFT_TTL_MS + 120_000);
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal((r.body as { code?: string }).code, "revival-ticker-held");
    assert.deepEqual(lintCopy(String((r.body as { error?: string }).error)).hits, []);
    const op = await reviveDraft(reg, verifier, { mint: a.mint, launchTx: sig("5"), note: "the creator asked", late: false, apply: true });
    assert.equal(op.ok, false); if (!op.ok) assert.match(op.reason, /held by another creator's coin/);
    assert.equal(reg.token(a.mint)!.status, "expired");
  });

  test("the keeper's reconciler logs the refusal and backs off; the owner hears once", async () => {
    const { reg, a, landed } = setupA();
    draft(reg, "TWICE", T0 + DRAFT_TTL_MS + 60_000, OTHER);
    const reader: DraftChainReader = {
      async getMultipleAccountsInfo(keys: PublicKey[]) { return keys.map((k) => (configPda(new PublicKey(PROGRAM), new PublicKey(a.mint)).equals(k) ? { owner: new PublicKey(PROGRAM), data: new Uint8Array(8) } : null)); },
      async getSignaturesForAddress(addr: PublicKey) { return feePda(new PublicKey(PROGRAM), new PublicKey(a.mint)).equals(addr) ? [{ signature: sig("5"), err: null, blockTime: Math.floor(landed / 1000) }] : []; },
    } as unknown as DraftChainReader;
    const lines: string[] = [];
    const now = T0 + DRAFT_TTL_MS + 3_600_000;
    const r = await reconcileDrafts({ registry: reg, reader, verifier: tableVerifier(new Map([[sig("5"), { mint: a.mint, blockTimeMs: landed }]])), burnProgramId: PROGRAM, now: () => now, log: (l) => lines.push(l), dryRun: false, env: {} });
    assert.equal(r.takenLive.length, 0);
    assert.ok(r.errors.some((e) => /TWICE/.test(e)), JSON.stringify(r.errors));
    assert.ok(lines.some((l) => /its ticker is held by another creator's coin now/.test(l)), lines.join("\n"));
    assert.equal(reg.token(a.mint)!.status, "expired");
    assert.equal(revivalAlerts(reg).length, 1);
    const st = JSON.parse(reg.getStatus(SCAN_STATUS_PREFIX + a.mint) ?? "{}") as { nextAt?: number; done?: boolean };
    assert.ok(st.nextAt && st.nextAt > now, "asked again after a backoff, not every sweep"); assert.notEqual(st.done, true);
  });
});

describe("I-17: a registry file newer than this build refuses new launches and alerts", () => {
  test("a file stamped version 99: reads keep working, reserveTicker and a new draft throw, the owner is alerted once a day", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-schema-newer-"));
    try {
      const file = path.join(dir, "r.db");
      const r = openRegistry(file);
      assert.equal(r.newerSchemaVersion, null);
      const live = draft(r, "KEEP", T0);
      r.markLaunched(live.mint, sig("4"), null, new Date(T0).toISOString());
      r.db.prepare("INSERT INTO schema_version (version, applied_at, note) VALUES (99, ?, 'a newer build')").run(Date.now());
      r.db.close();
      const old = openRegistry(file);
      assert.equal(old.newerSchemaVersion, 99);
      assert.ok(REGISTRY_SCHEMA_VERSION < 99);
      assert.equal(old.token(live.mint)!.status, "live", "reads keep working");
      assert.equal(old.tokens().length, 1);
      assert.throws(() => old.reserveTicker("NEWONE", CREATOR, null), (e: unknown) => e instanceof RegistrySchemaNewerError && e.recorded === 99);
      assert.throws(() => draft(old, "NEWONE", Date.now()), RegistrySchemaNewerError);
      assert.equal(old.tokens().length, 1, "nothing was registered");
      const al = old.alertsSince(0).filter((a) => a.kind === REGISTRY_NEWER_ALERT_KIND);
      assert.equal(al.length, 1); assert.match(al[0].text, /schema version 99/);
      old.db.close();
      const again = openRegistry(file);
      assert.equal(again.alertsSince(0).filter((a) => a.kind === REGISTRY_NEWER_ALERT_KIND).length, 1, "one alert per Denver day");
      again.db.close();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test("the prepare route answers 503 registry-newer for a registering prepare; a dry run still answers", async () => {
    const w = await makeWorld(); limiter.reset();
    Object.defineProperty(w.registry, "newerSchemaVersion", { value: 99 });
    const before = w.registry.tokens().length;
    const body = { creator: CREATOR, ticker: "ROLLBK", name: "Rollback", rule: { ...BRONCOS, pair: null }, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } };
    const r = await prepareLaunch(w.p, body, { register: true, mint: Keypair.generate().publicKey.toBase58() });
    assert.ok("error" in r);
    if ("error" in r) { assert.equal(r.error.status, 503); assert.equal((r.error.body as { code?: string }).code, "registry-newer"); assert.deepEqual(lintCopy(String((r.error.body as { error?: string }).error)).hits, []); }
    assert.equal(w.registry.tokens().length, before, "nothing was registered");
    const dry = await prepareLaunch(w.p, body, { register: false, dryRun: true });
    assert.ok(!("error" in dry) || (dry.error.body as { code?: string }).code !== "registry-newer", "a dry run is a read");
  });
});

describe("I-11: every recorded alert kind that needs the owner reaches the push path, once", () => {
  const DAWN = Date.parse("2026-10-19T15:00:00Z");   // 09:00 Denver: the daily line is due, filtered out below
  const settled = (now: number): PushState => ({ cursor: now - 3_600_000, lastByKind: {}, sent: [], held: {}, heldToday: 0, lastDaily: new Date(now).toLocaleDateString("en-CA", { timeZone: "America/Denver" }), pending: [], undelivered: [], dailyRetry: null, delivered: [] });
  const NEW_KINDS = ["reading-unresolved", "race-held", "revised-reading", "late-reading", "pair-result-conflict", "pair-result-missing", "pair-result-unservable", "pair-forward-impossible", "pair-forward-pending", "pair-forward-missing", "pair-unmatched", "pair-unlink-drift", "config-mismatch", REVIVAL_TICKER_HELD_ALERT_KIND, REGISTRY_NEWER_ALERT_KIND];

  test("each kind alone: exactly one push of its mapped kind, with a plain title and lead", () => {
    for (const k of NEW_KINDS) {
      const kind = PUSH_KIND_OF_ALERT[k];
      assert.ok(kind, `${k} is mapped`);
      assert.ok(PUSH_TITLE[kind] && PUSH_LEAD[kind], k);
      assert.deepEqual(lintCopy(PUSH_LEAD[kind]).hits, [], `${k}: ${JSON.stringify(lintCopy(PUSH_LEAD[kind]).hits)}`);
      assert.deepEqual(lintCopy(PUSH_TITLE[kind]).hits, [], k);
      assert.doesNotMatch(`${PUSH_TITLE[kind]} ${PUSH_LEAD[kind]}`, /→|\bwill\b|\d{4}-\d{2}-\d{2}/);
      const { messages } = planPushes({ now: DAWN, state: settled(DAWN), alerts: [{ ts: DAWN - 60_000, kind: k, key: `${k}:x`, text: `text of ${k}` }] });
      const pushes = messages.filter((m) => m.kind !== "daily");
      assert.equal(pushes.length, 1, k);
      assert.equal(pushes[0].kind, kind);
      assert.match(pushes[0].body, new RegExp(`text of ${k}`));
    }
    assert.equal(PUSH_KIND_OF_ALERT["revised-reading"], PUSH_KIND_OF_ALERT["bt-reading-conflict"], "the same trouble shares one kind and one hourly slot");
    assert.ok(PUSH_URGENT.has("config-mismatch"), "a halted coin is never held by the six-per-hour cap");
  });

  test("dedupe: two alerts of one kind in an hour are one push and one held; the pair alerts share three kinds", () => {
    const { messages, state } = planPushes({ now: DAWN, state: settled(DAWN), alerts: [
      { ts: DAWN - 3000, kind: "pair-result-missing", key: "a", text: "a" }, { ts: DAWN - 2000, kind: "pair-result-conflict", key: "b", text: "b" }, { ts: DAWN - 1000, kind: "config-mismatch", key: "c", text: "c" },
    ] });
    assert.deepEqual(messages.filter((m) => m.kind !== "daily").map((m) => m.kind), ["pair-result", "config-mismatch"]);
    assert.equal(state.heldToday, 1, "the second pair-result alert is held by the kind's hourly slot");
    assert.match(messages.find((m) => m.kind === "config-mismatch")!.body, /One more alert was held back/);
  });

  test("end to end: a config-mismatch and a revival alert recorded in the registry go out through runPushCheck once", async () => {
    const reg = openRegistry(":memory:");
    const sent: string[] = [];
    const fetchImpl = (async (_u: string, init: { headers: Record<string, string> }) => { sent.push(init.headers.tags); return new Response("ok", { status: 200 }); }) as unknown as typeof fetch;
    const now = Date.now();
    await runPushCheck({ registry: reg, env: { BURNTICKER_PUSH_URL: "https://push.example/t" }, now: now - 10_000, fetchImpl });
    sent.length = 0;
    reg.recordAlert({ kind: "config-mismatch", key: "config-mismatch:m", text: "held", meta: null }, now - 5000);
    reg.recordAlert({ kind: REVIVAL_TICKER_HELD_ALERT_KIND, key: "revival-ticker-held:m", text: "not revived", meta: null }, now - 4000);
    await runPushCheck({ registry: reg, env: { BURNTICKER_PUSH_URL: "https://push.example/t" }, now, fetchImpl });
    assert.deepEqual(sent.filter((t) => t !== "daily").sort(), ["config-mismatch", "revival-ticker-held"]);
    sent.length = 0;
    await runPushCheck({ registry: reg, env: { BURNTICKER_PUSH_URL: "https://push.example/t" }, now: now + 1000, fetchImpl });
    assert.deepEqual(sent.filter((t) => t !== "daily"), [], "pushed once");
  });
});
