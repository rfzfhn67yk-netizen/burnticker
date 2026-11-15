// Review of the prelaunch audit 2026-10-18 F09 fix: a pair request carrying only one of its two mints (side A's `mint` without side B's,
// or the reverse) must be refused before anything is uploaded or charged, never after both sides' files were paid for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { prepareLaunch } from "@/lib/burnticker/api/handlers";
import { FakePinUploader } from "@/lib/burnticker/pin";
import { CREATOR, makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const LOSE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } } };
const body = { creator: CREATOR, ticker: "DENVER", name: "Denver", description: "", imageUrl: null, links: [], rule: LOSE, acknowledgements: { ruleLocked: true, noReturns: true }, pair: { ticker: "CHIEFS", name: "Chiefs" } };
const pk = () => Keypair.generate().publicKey.toBase58();
const day = () => new Date().toISOString().slice(0, 10);

for (const [what, opts] of [
  ["side A's mint only", () => ({ mint: pk() })],
  ["side B's mint only", () => ({ mintB: pk() })],
  ["side A's mint and only side B's bank key", () => ({ mint: pk(), mintKeypairB: Keypair.generate() })],
  ["side A's bank key and side B's mint", () => ({ mintKeypair: Keypair.generate(), mintB: pk() })],
] as const) {
  test(`a pair with ${what} is refused before any upload or charge`, async () => {
    const w = await makeWorld(); const up = new FakePinUploader(); w.p.uploader = up;
    const r = await prepareLaunch(w.p, body, { register: true, client: "x", ...opts() });
    assert.ok("error" in r, JSON.stringify(r).slice(0, 200));
    assert.equal(r.error.status, 400);
    assert.equal(up.uploads.length, 0, "nothing uploaded");
    assert.equal(w.registry.getStatus(`pin.budget.${day()}`), null, "nothing charged");
  });
}
