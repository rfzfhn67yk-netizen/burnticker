// 2026-10-14: the first Launch press registers the draft; when the launch check then refuses it, pressing Launch again sends the SAME
// draft (same mint) and was refused as "already registered". A creator's own unfinished draft is dropped and registered afresh.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { CREATOR, makeWorld, type World } from "./burntickerApiHelpers.ts";

describe("a creator's own unfinished draft is reused on a retry (registry.ownDraft)", () => {
  let w: World;
  before(async () => { w = await makeWorld(); });
  const draftOf = (mint: string, creator = CREATOR) => {
    const live = w.registry.tokens("live")[0];
    return w.registry.register({ mint, ticker: "RETRY", name: "Retry coin", creator, description: "", imageUrl: null, links: [], rulesText: live.rulesJson, feePda: live.feePda, vault: null, tokenConfig: live.tokenConfig, poolId: null, launchTx: null, cluster: live.cluster, platformId: live.platformId, baselineAt: live.baselineAt, status: "draft" } as Parameters<World["registry"]["register"]>[0]);
  };
  test("same mint, same creator, still a draft: found; the handler reuses the row instead of inserting again", () => {
    const mint = Keypair.generate().publicKey.toBase58();
    draftOf(mint);
    assert.equal(w.registry.ownDraft(mint, CREATOR)?.mint, mint);
    assert.equal(w.registry.ownDraft(mint, CREATOR)?.status, "draft");
  });
  test("another creator's draft, a live coin, or an unknown mint: not an own draft", () => {
    const mint = Keypair.generate().publicKey.toBase58();
    draftOf(mint, Keypair.generate().publicKey.toBase58());
    assert.equal(w.registry.ownDraft(mint, CREATOR), null);
    const live = w.registry.tokens("live")[0];
    assert.equal(w.registry.ownDraft(live.mint, live.creator), null);
    assert.equal(w.registry.ownDraft(Keypair.generate().publicKey.toBase58(), CREATOR), null);
  });
  test("the handler's refusal sentence for a changed draft passes the copy lint", async () => {
    const { lintCopy } = await import("@/lib/launch/copyLint");
    const src = (await import("node:fs")).readFileSync(new URL("../src/lib/burnticker/api/handlers.ts", import.meta.url), "utf8");
    const m = src.match(/const OWN_DRAFT_CHANGED = "([^"]+)"/);
    assert.ok(m, "the constant exists");
    assert.deepEqual(lintCopy(m![1]).hits, []);
  });
});

describe("the anti-clone guard lets a creator's own draft through on a retry", () => {
  let w: World;
  before(async () => { w = await makeWorld(); });
  test("own draft: no refusal; another creator's draft: refused as already registered", async () => {
    const { launchGuardRefusal } = await import("@/lib/burnticker/launchGuards");
    const live = w.registry.tokens("live")[0];
    const mint = Keypair.generate().publicKey.toBase58();
    w.registry.register({ mint, ticker: "RETRY2", name: "Retry coin", creator: CREATOR, description: "", imageUrl: null, links: [], rulesText: live.rulesJson, feePda: live.feePda, vault: null, tokenConfig: live.tokenConfig, poolId: null, launchTx: null, cluster: live.cluster, platformId: live.platformId, baselineAt: live.baselineAt, status: "draft" } as Parameters<World["registry"]["register"]>[0]);
    const own = await launchGuardRefusal(w.p, { ticker: "RETRY2", name: "Retry coin", rule: null, mint, creator: CREATOR });
    assert.ok(!own || !/already registered/.test(own.error), own?.error);
    const other = await launchGuardRefusal(w.p, { ticker: "RETRY2", name: "Retry coin", rule: null, mint, creator: Keypair.generate().publicKey.toBase58() });
    assert.match(other?.error ?? "", /already registered/);
  });
});

describe("while a launch is being prepared the page says so (owner, 2026-10-14)", () => {
  test("the notice passes the copy lint and the review card renders it only while busy", async () => {
    const { LAUNCHING_NOTICE } = await import("@/lib/burnticker/mintAddressCopy");
    const { lintCopy } = await import("@/lib/launch/copyLint");
    assert.deepEqual(lintCopy(LAUNCHING_NOTICE).hits, []);
    assert.match(LAUNCHING_NOTICE, /Keep this tab open/);
    const src = (await import("node:fs")).readFileSync(new URL("../src/app/burnticker/launch/ReviewCard.tsx", import.meta.url), "utf8");
    assert.match(src, /\{p\.busy && <p [^>]*data-launching>\{LAUNCHING_NOTICE\}<\/p>\}/);
  });
});

describe("an attempt that sent nothing is not an unfinished launch (2026-10-14)", () => {
  test("keys gone, nothing confirmed, nothing pending, nothing paid: archived on its own; anything sent or paid stays a notice", async () => {
    const { nothingSentAbandoned } = await import("@/lib/burnticker/launchRecovery");
    const base = { key: "bt-plan:x", rec: { v: 1 as const, mints: ["m"], confirmed: [] as string[], recorded: [] as string[], pending: null, failed: null, updatedAt: 0, paid: [] as { step: number; signature: string; lamports: number }[], confirms: [{ mint: "m", ticker: "X", step: 0 }], steps: 1 } };
    assert.equal(nothingSentAbandoned(base as never), true);
    assert.equal(nothingSentAbandoned({ ...base, rec: { ...base.rec, paid: [{ step: 0, signature: "s", lamports: 5000 }] } } as never), false);
    assert.equal(nothingSentAbandoned({ ...base, rec: { ...base.rec, pending: { step: 0, signature: "s", lastValidBlockHeight: 1, blockhash: "b", sentAt: 0 } } } as never), false);
    assert.equal(nothingSentAbandoned({ ...base, rec: { ...base.rec, confirmed: ["s"] } } as never), false);
    const src = (await import("node:fs")).readFileSync(new URL("../src/app/burnticker/launch/LaunchRecovery.tsx", import.meta.url), "utf8");
    assert.match(src, /if \(nothingSentAbandoned\(s\)\) archivePlanRecord\(storage, s\.key\)/);
  });
});

describe("the launch route demands the pair curve only for the pairs the handler would build on it (2026-10-14)", () => {
  test("a rivalry series pair and a settled-event pair are exempt; a plain binary pair is not; the flag off exempts all", async () => {
    const { pairCurveRequiredFor } = await import("@/lib/burnticker/pairVenueRule");
    const meetings = { rule: { oracle: "catalogue", series: "espn.team:nfl-PIT.23-win-m2026.BAL.33" }, pair: { ticker: "BALWIN" } };
    const binary = { rule: { oracle: "polymarket", series: null }, pair: { ticker: "CHIEFS" } };
    assert.equal(pairCurveRequiredFor(meetings, true), false);
    assert.equal(pairCurveRequiredFor(binary, true), true);
    assert.equal(pairCurveRequiredFor(binary, false), false);
    assert.equal(pairCurveRequiredFor({ rule: binary.rule }, true), false);
  });
});
