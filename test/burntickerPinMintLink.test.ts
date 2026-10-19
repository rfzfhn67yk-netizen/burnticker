// Prelaunch audit 2026-10-18 F09: the prepare handler pinned the metadata without the coin's mint, so the immutable external_url was
// /burnticker/t/<TICKER>, which can open another coin with the same ticker, or the chooser. The mint is now chosen before anything is
// pinned on every path (the caller's mint, a bank key, a fresh keypair, both sides of a pair, the pair curve), and each uploaded JSON
// links to its own bundle's mint.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { prepareLaunch } from "@/lib/burnticker/api/handlers";
import { FakePinUploader, pinCoin } from "@/lib/burnticker/pin";
import { lockRule } from "@/lib/burnticker/rules";
import { CREATOR, makeWorld, type World } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const RULE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
const LOSE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } } };
const ORIGIN = "https://burnticker.com";
type R = Awaited<ReturnType<typeof prepareLaunch>>;
const single = (ticker: string, name: string) => ({ creator: CREATOR, ticker, name, rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } });
const pairBody = () => ({ creator: CREATOR, ticker: "DENVER", name: "Denver", description: "", imageUrl: null, links: [], rule: LOSE, acknowledgements: { ruleLocked: true, noReturns: true }, pair: { ticker: "CHIEFS", name: "Chiefs" } });
const bankKeys = (tickers: string[]) => ({ keys: tickers.map(() => Keypair.generate()) });

/** The metadata JSON files the fake uploader received, newest last. */
const jsons = (up: FakePinUploader) => up.uploads.filter((u) => u.contentType === "application/json").map((u) => JSON.parse(new TextDecoder().decode(u.bytes)) as { symbol: string; name: string; external_url: string });
/** The JSON the registry keeps for `mint`, read back from the uploader by its transaction id. */
function keptJson(w: World, up: FakePinUploader, mint: string) {
  const meta = w.registry.tokenMeta(mint);
  assert.ok(meta?.metadataTx, `a pinned file is recorded for ${mint}`);
  return JSON.parse(new TextDecoder().decode(up.get(meta.metadataTx)!)) as { external_url: string };
}
const okBundle = (r: R) => { assert.ok("ok" in r, JSON.stringify("error" in r ? r.error.body : r).slice(0, 300)); return r.ok; };
const okPair = (r: R) => { assert.ok("pair" in r, JSON.stringify("error" in r ? r.error.body : r).slice(0, 300)); return r.pair; };
const linkOf = (mint: string) => `${ORIGIN}/burnticker/t/${mint}`;

describe("F09: every pinned metadata file links to its own mint", () => {
  test("pinCoin refuses to pin without a mint (no ticker fallback)", async () => {
    const locked = lockRule(RULE);
    const up = new FakePinUploader();
    await assert.rejects(pinCoin(up, { ticker: "NOMINT", name: "No Mint", description: "d", oneLiner: "o", rule: locked.rule, rulesSha256: locked.sha256, origin: ORIGIN, links: [], imageUrl: "https://example.com/x.png" } as never));
    assert.equal(up.uploads.length, 0);
  });

  test("the caller's own mint, a bank key and a fresh keypair: the uploaded external_url is the returned bundle's mint", async () => {
    for (const [what, opts] of [
      ["caller mint", { register: true, mint: Keypair.generate().publicKey.toBase58() }],
      ["bank key", { register: true, takeMintKeys: bankKeys }],
      ["fresh keypair", { register: true }],
    ] as const) {
      const w = await makeWorld(); const up = new FakePinUploader(); w.p.uploader = up;
      const t = `LINK${what.slice(0, 3).toUpperCase().replace(/\s/g, "")}`;
      const b = okBundle(await prepareLaunch(w.p, single(t, `Link ${what}`), opts));
      const [j] = jsons(up);
      assert.equal(j.external_url, linkOf(b.bundle.mint), what);
      assert.equal(keptJson(w, up, b.bundle.mint).external_url, linkOf(b.bundle.mint), what);
      assert.doesNotMatch(j.external_url, new RegExp(`/t/${t}$`), `${what}: not the ticker`);
    }
  });

  test("two coins with the same ticker (different names): each file names its own mint, never the shared ticker", async () => {
    const w = await makeWorld(); const up = new FakePinUploader(); w.p.uploader = up;
    const a = okBundle(await prepareLaunch(w.p, single("MAPLE", "Maple One"), { register: true, mint: Keypair.generate().publicKey.toBase58() }));
    const b = okBundle(await prepareLaunch(w.p, single("MAPLE", "Maple Two"), { register: true, takeMintKeys: bankKeys }));
    assert.notEqual(a.bundle.mint, b.bundle.mint);
    assert.deepEqual(jsons(up).map((j) => j.external_url), [linkOf(a.bundle.mint), linkOf(b.bundle.mint)]);
  });

  test("a retry of the same draft after a failed upload links to the same mint", async () => {
    const w = await makeWorld(); w.p.uploader = new FakePinUploader({ fail: true });
    const M = Keypair.generate().publicKey.toBase58();
    const first = await prepareLaunch(w.p, single("RETRYLNK", "Retry Link"), { register: true, mint: M });
    assert.ok("error" in first);
    const up = new FakePinUploader(); w.p.uploader = up;
    const b = okBundle(await prepareLaunch(w.p, single("RETRYLNK", "Retry Link"), { register: true, mint: M }));
    assert.equal(b.bundle.mint, M);
    assert.equal(jsons(up)[0].external_url, linkOf(M));
  });

  for (const [what, opts] of [
    ["the page's two mints", () => ({ register: true, mint: Keypair.generate().publicKey.toBase58(), mintB: Keypair.generate().publicKey.toBase58() })],
    ["two bank keys", () => ({ register: true, takeMintKeys: bankKeys })],
    ["no mints given", () => ({ register: true })],
  ] as const) {
    test(`a LaunchLab pair (${what}): side A's file names bundle A's mint, side B's names bundle B's`, async () => {
      const w = await makeWorld(); const up = new FakePinUploader(); w.p.uploader = up;
      const pr = okPair(await prepareLaunch(w.p, pairBody(), opts()));
      const bySymbol = new Map(jsons(up).map((j) => [j.symbol, j.external_url]));
      assert.equal(bySymbol.get("DENVER"), linkOf(pr.bundles.a.mint));
      assert.equal(bySymbol.get("CHIEFS"), linkOf(pr.bundles.b.mint));
      assert.equal(keptJson(w, up, pr.bundles.a.mint).external_url, linkOf(pr.bundles.a.mint));
      assert.equal(keptJson(w, up, pr.bundles.b.mint).external_url, linkOf(pr.bundles.b.mint));
    });
  }

  test("a pair through the pair curve: both files name the pair-curve set's mints", async () => {
    const was = process.env.BURNTICKER_PAIR_CURVE_ENABLED; process.env.BURNTICKER_PAIR_CURVE_ENABLED = "1";
    try {
      const w = await makeWorld(); const up = new FakePinUploader(); w.p.uploader = up;
      const pr = okPair(await prepareLaunch(w.p, pairBody(), { register: true, takeMintKeys: bankKeys }));
      assert.ok(pr.pairCurve, "the pair-curve set is built");
      const mints = (pr.pairCurve as unknown as { mints: { a: string; b: string } }).mints;
      const bySymbol = new Map(jsons(up).map((j) => [j.symbol, j.external_url]));
      assert.equal(bySymbol.get("DENVER"), linkOf(mints.a));
      assert.equal(bySymbol.get("CHIEFS"), linkOf(mints.b));
    } finally { if (was === undefined) delete process.env.BURNTICKER_PAIR_CURVE_ENABLED; else process.env.BURNTICKER_PAIR_CURVE_ENABLED = was; }
  });
});
