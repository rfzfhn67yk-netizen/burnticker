// Third prelaunch audit 2026-10-19 F04: two prepares for one unused ticker from DIFFERENT creators (different mints) both passed the
// ticker guard, because the prepare lock is per mint and the check just before register() read only the mint; both uploaded and both
// registered a draft for the ticker. The registry now holds the ticker for a prepare (ticker_reservations) and refuses a second
// creator's draft in the same transaction as the insert.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { prepareLaunch } from "@/lib/burnticker/api/handlers";
import { FakePinUploader, type PinUploader } from "@/lib/burnticker/pin";
import { DRAFT_TTL_MS, openRegistry, REGISTRY_SCHEMA_VERSION, TickerTakenError, type Registry } from "@/lib/burnticker/registry";
import { lintCopy } from "@/lib/launch/copyLint";
import { makeWorld, type World } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const RULE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
const wallet = () => Keypair.generate().publicKey.toBase58();
type R = Awaited<ReturnType<typeof prepareLaunch>>;
const code = (r: R) => ("error" in r ? (r.error.body as { code?: string }).code : "ok");
const said = (r: R) => ("error" in r ? String((r.error.body as { error?: string }).error) : "");
const today = () => new Date().toISOString().slice(0, 10);
const body = (ticker: string, creator: string, name = `${ticker} coin`) => ({ creator, ticker, name, rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } });
const pairBody = (a: string, b: string, creator: string) => ({ ...body(a, creator), pair: { ticker: b, name: `${b} side`, description: "", imageUrl: null, links: [] } });
const bankKeys = { takeMintKeys: (t: string[]) => ({ keys: t.map(() => Keypair.generate()) }) };
const draftsFor = (w: World, ticker: string) => w.registry.db.prepare("SELECT mint, creator, status FROM tokens WHERE ticker = ?").all(ticker) as { mint: string; creator: string; status: string }[];

/** Holds every upload until `want` uploads are waiting (or `ms` passes), so concurrent prepares all get past their checks first. */
class BarrierUploader implements PinUploader {
  readonly name = "barrier";
  readonly inner = new FakePinUploader();
  private waiting: (() => void)[] = [];
  private want: number; private ms: number;
  constructor(want: number, ms = 250) { this.want = want; this.ms = ms; }
  async upload(b: Uint8Array, contentType: string) {
    await new Promise<void>((res) => {
      this.waiting.push(res);
      if (this.waiting.length >= this.want) { for (const r of this.waiting.splice(0)) r(); }
      else setTimeout(res, this.ms);
    });
    return this.inner.upload(b, contentType);
  }
}

function assertTickerTaken(r: R, ticker: string) {
  assert.equal(code(r), "ticker-taken", said(r));
  assert.equal((r as { error: { status: number } }).error.status, 409);
  assert.match(said(r), new RegExp(`\\$${ticker} is already the ticker of another Burnticker coin\\.`));
  assert.deepEqual(lintCopy(said(r)).hits, [], "the refusal passes the copy lint");
}

describe("F04: two creators, one unused ticker, at once", () => {
  test("same ticker and name, different mints: one ok, one 409 ticker-taken, one draft; the loser pinned nothing and holds nothing (before: both ok, two drafts)", async () => {
    const w = await makeWorld(); const up = new BarrierUploader(2); w.p.uploader = up;
    const [c1, c2] = [wallet(), wallet()];
    const results = await Promise.all([
      prepareLaunch(w.p, body("TWINS", c1, "Twin Coin"), { register: true, mint: wallet(), client: "one" }),
      prepareLaunch(w.p, body("TWINS", c2, "Twin Coin"), { register: true, mint: wallet(), client: "two" }),
    ]);
    const codes = results.map(code);
    assert.equal(codes.filter((c) => c === "ok").length, 1, codes.join(", "));
    const loserAt = codes.indexOf("ticker-taken");
    assert.ok(loserAt >= 0, codes.join(", "));
    assertTickerTaken(results[loserAt], "TWINS");
    const rows = draftsFor(w, "TWINS");
    assert.equal(rows.length, 1, "one tokens row for the ticker");
    assert.equal(rows[0].creator, loserAt === 0 ? c2 : c1, "the row is the winner's");
    // the loser was refused before its upload: nothing charged to its connection, nothing counted as an orphan
    const loserClient = loserAt === 0 ? "one" : "two", winnerClient = loserAt === 0 ? "two" : "one";
    assert.equal(Number(w.registry.getStatus(`pin.budget.${today()}.client.${loserClient}`) ?? 0), 0, "the loser's connection was charged nothing");
    assert.ok(Number(w.registry.getStatus(`pin.budget.${today()}.client.${winnerClient}`) ?? 0) >= 1, "the winner's pin is charged");
    assert.equal(Number(w.registry.getStatus(`pin.orphans.${today()}`) ?? 0), 0);
    assert.equal(up.inner.uploads.length > 0, true);
    // neither reservation is left: the winner's draft holds the ticker now, the loser never held it
    assert.equal(w.registry.tickerReservation("TWINS"), null);
  });

  test("the registry is the arbiter when the hold lapsed: another creator's draft written during the upload refuses this prepare with ticker-taken; its upload is an orphan", async () => {
    const w = await makeWorld();
    const me = wallet(), other = wallet(), inner = new FakePinUploader();
    const live = w.registry.tokens("live")[0];
    let raced = false;
    w.p.uploader = { name: "racer", upload: async (b: Uint8Array, c: string) => {
      if (!raced) {
        raced = true;
        assert.equal(w.registry.tickerReservation("LAPSE")?.creator, me, "this prepare holds the ticker while it uploads");
        // the hold lapses (another process, a long upload) and the other creator's draft lands first
        w.registry.db.prepare("DELETE FROM ticker_reservations WHERE ticker = 'LAPSE'").run();
        w.registry.register({ mint: wallet(), ticker: "LAPSE", name: "Other", creator: other, description: "", imageUrl: null, links: [], rulesText: live.rulesJson, feePda: live.feePda, vault: null, tokenConfig: live.tokenConfig, poolId: null, launchTx: null, cluster: live.cluster, platformId: live.platformId, baselineAt: live.baselineAt, status: "draft" });
      }
      return inner.upload(b, c);
    } };
    const r = await prepareLaunch(w.p, body("LAPSE", me), { register: true, mint: wallet(), client: "lapse" });
    assertTickerTaken(r, "LAPSE");
    assert.deepEqual(draftsFor(w, "LAPSE").map((x) => x.creator), [other], "only the other creator's draft");
    assert.ok(Number(w.registry.getStatus(`pin.orphans.${today()}`) ?? 0) >= 1, "the uploaded files are counted as orphans");
    assert.equal(Number(w.registry.getStatus(`pin.budget.${today()}.client.lapse`) ?? 0) >= 1, true, "the real upload stays charged");
    assert.equal(w.registry.tickerReservation("LAPSE"), null);
  });

  test("a pair taking X and Y against a single taking Y at once: one winner per ticker", async () => {
    const w = await makeWorld(); w.p.uploader = new BarrierUploader(3);
    const [cp, cs] = [wallet(), wallet()];
    const [pair, single] = await Promise.all([
      prepareLaunch(w.p, pairBody("PAIRX", "PAIRY", cp), { register: true, client: "pr", ...bankKeys }),
      prepareLaunch(w.p, body("PAIRY", cs), { register: true, client: "sg", mint: wallet() }),
    ]);
    const codes = [code(pair), code(single)];
    assert.equal(codes.filter((c) => c === "ok").length, 1, codes.join(", "));
    assert.ok(codes.includes("ticker-taken"), codes.join(", "));
    const y = draftsFor(w, "PAIRY"), x = draftsFor(w, "PAIRX");
    assert.equal(y.length, 1, "one draft holds Y");
    if (code(pair) === "ok") { assert.equal(y[0].creator, cp); assert.equal(x.length, 1); }
    else { assert.equal(y[0].creator, cs); assert.equal(x.length, 0, "a refused pair leaves no half"); assert.match(said(pair), /^Side B is refused\. /); }
    assert.equal(w.registry.tickerReservation("PAIRX"), null, "the refused or finished pair gave X back");
    assert.equal(w.registry.tickerReservation("PAIRY"), null);
  });
});

describe("F04: what stays allowed", () => {
  test("the same creator's retry of an unfinished draft is still ok", async () => {
    const w = await makeWorld(); const c = wallet(), M = wallet();
    assert.equal(code(await prepareLaunch(w.p, body("RETRY", c), { register: true, mint: M })), "ok");
    assert.equal(code(await prepareLaunch(w.p, body("RETRY", c), { register: true, mint: M })), "ok");
    assert.equal(draftsFor(w, "RETRY").length, 1);
    // and another creator is refused while that draft is open
    assert.equal(code(await prepareLaunch(w.p, body("RETRY", wallet()), { register: true, mint: wallet() })), "ticker-taken");
  });

  test("a dry run or a prepare that registers nothing reserves nothing", async () => {
    const w = await makeWorld();
    assert.equal(code(await prepareLaunch(w.p, body("DRYRUN", wallet()), { register: true, dryRun: true })), "ok");
    assert.equal(code(await prepareLaunch(w.p, body("DRYRUN", wallet()), { register: false })), "ok");
    assert.equal(w.registry.tickerReservation("DRYRUN"), null);
    assert.equal(draftsFor(w, "DRYRUN").length, 0);
    assert.equal(code(await prepareLaunch(w.p, body("DRYRUN", wallet()), { register: true, mint: wallet() })), "ok", "the ticker is still free for a real launch");
  });

  test("a draft expired after 24 hours frees its ticker for another creator", async () => {
    const w = await makeWorld();
    const live = w.registry.tokens("live")[0], old = Date.now() - DRAFT_TTL_MS - 60_000;
    w.registry.register({ mint: wallet(), ticker: "STALE", name: "Stale", creator: wallet(), description: "", imageUrl: null, links: [], rulesText: live.rulesJson, feePda: live.feePda, vault: null, tokenConfig: live.tokenConfig, poolId: null, launchTx: null, cluster: live.cluster, platformId: live.platformId, baselineAt: live.baselineAt, status: "draft" }, old);
    assert.equal(code(await prepareLaunch(w.p, body("STALE", wallet()), { register: true, mint: wallet() })), "ok");
    assert.deepEqual(draftsFor(w, "STALE").map((x) => x.status).sort(), ["draft", "expired"]);
  });
});

describe("F04: the registry's reservations", () => {
  const regInput = (r: Registry, ticker: string, creator: string, status: "draft" | "live" = "draft") => {
    const live = r.tokens("live")[0];
    return { mint: wallet(), ticker, name: `${ticker} coin`, creator, description: "", imageUrl: null, links: [], rulesText: live.rulesJson, feePda: live.feePda, vault: null, tokenConfig: live.tokenConfig, poolId: null, launchTx: status === "live" ? "5".repeat(87) : null, cluster: live.cluster, platformId: live.platformId, baselineAt: live.baselineAt, status };
  };

  test("reserveTicker: one creator holds it, the same creator renews, another is refused until the hold expires or is released", async () => {
    const { registry: r } = await makeWorld();
    const [a, b] = [wallet(), wallet()], now = Date.now();
    assert.deepEqual(r.reserveTicker("hold", a, null, now), { ok: true });
    assert.equal(r.tickerReservation("HOLD")?.creator, a, "upper-cased");
    assert.deepEqual(r.reserveTicker("HOLD", b, null, now + 1000), { ok: false, heldBy: "reservation" });
    assert.deepEqual(r.reserveTicker("HOLD", a, "m1", now + 2000), { ok: true }, "the same creator renews");
    assert.equal(r.tickerReservation("HOLD")?.expiresAt, now + 2000 + 15 * 60_000);
    assert.deepEqual(r.reserveTicker("HOLD", b, null, now + 2000 + 15 * 60_000 + 1), { ok: true }, "an expired hold is free");
    assert.equal(r.tickerReservation("HOLD")?.creator, b);
    r.releaseTicker("HOLD", a);
    assert.equal(r.tickerReservation("HOLD")?.creator, b, "a creator cannot release another's hold");
    r.releaseTicker("HOLD", b);
    assert.equal(r.tickerReservation("HOLD"), null);
  });

  test("reserveTicker: another creator's draft or coin refuses (heldBy token); an expired draft does not", async () => {
    const { registry: r } = await makeWorld();
    const [a, b] = [wallet(), wallet()];
    r.register(regInput(r, "HELDD", a));
    assert.deepEqual(r.reserveTicker("HELDD", b, null), { ok: false, heldBy: "token" });
    assert.deepEqual(r.reserveTicker("HELDD", a, null), { ok: true }, "the draft's own creator may hold it (a retry)");
    r.register(regInput(r, "OLDDD", a), Date.now() - DRAFT_TTL_MS - 1);
    assert.deepEqual(r.reserveTicker("OLDDD", b, null), { ok: true }, "the expired draft's ticker is free");
    assert.deepEqual(r.reserveTicker("BRONCO", b, null), { ok: false, heldBy: "token" }, "a launched coin of another creator");
  });

  test("register: a draft is refused with TickerTakenError when another creator holds the ticker; the creator's own reservation is consumed", async () => {
    const { registry: r } = await makeWorld();
    const [a, b] = [wallet(), wallet()];
    assert.deepEqual(r.reserveTicker("REGGG", a, null), { ok: true });
    assert.throws(() => r.register(regInput(r, "REGGG", b)), (e: unknown) => e instanceof TickerTakenError && e.ticker === "REGGG");
    assert.equal(r.tokensByTicker("REGGG").length, 0, "nothing was written");
    r.register(regInput(r, "REGGG", a));
    assert.equal(r.tickerReservation("REGGG"), null, "the draft holds the ticker now");
    assert.throws(() => r.register(regInput(r, "REGGG", b)), TickerTakenError, "another creator's open draft refuses");
    assert.doesNotThrow(() => r.register(regInput(r, "REGGG", a)), "the same creator's second draft is not refused here");
    // a coin already live on chain is recorded as it is (tickers of old coins are shared, owner 2026-10-12)
    assert.doesNotThrow(() => r.register(regInput(r, "REGGG", b, "live")));
    assert.equal(r.tickerTaken("REGGG"), true, "tickerTaken is unchanged");
  });

  test("register runs in its own transaction, and inside an outer one as a savepoint", async () => {
    const { registry: r } = await makeWorld();
    const [a, b] = [wallet(), wallet()];
    r.register(regInput(r, "NESTA", a));
    assert.throws(() => r.tx(() => { r.register(regInput(r, "NESTB", a)); r.register(regInput(r, "NESTA", b)); }), TickerTakenError);
    assert.equal(r.tokensByTicker("NESTB").length, 0, "the outer transaction rolled back the first draft too");
    r.tx(() => { try { r.register(regInput(r, "NESTA", b)); } catch { /* refused, the outer transaction goes on */ } r.register(regInput(r, "NESTC", b)); });
    assert.equal(r.tokensByTicker("NESTC").length, 1);
    assert.equal(r.db.isTransaction, false);
  });

  test("schema version 2 (ticker_reservations) on a fresh registry and on a version-1 file once opened", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-resv-"));
    try {
      const file = path.join(dir, "r.db");
      const r = openRegistry(file);
      assert.equal(REGISTRY_SCHEMA_VERSION, 2);
      assert.equal(r.schemaVersion()?.version, 2);
      assert.match(r.schemaVersion()!.note, /^2026-10-19: .*ticker_reservations/);
      // make it a version-1 file: no reservations table, no version-2 row
      r.db.exec("DROP TRIGGER schema_version_no_delete; DROP TABLE ticker_reservations; DELETE FROM schema_version WHERE version = 2");
      r.db.close();
      const again = openRegistry(file);
      assert.equal(again.schemaVersion()?.version, 2, "opening a version-1 file brings it to version 2");
      assert.ok(again.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ticker_reservations'").get(), "the table is added");
      assert.deepEqual(again.reserveTicker("FILE", "w", null), { ok: true });
      again.db.close();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
