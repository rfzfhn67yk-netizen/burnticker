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
