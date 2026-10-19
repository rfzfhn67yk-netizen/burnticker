// Prelaunch audit 2026-10-18 F08: pinCoin uploads the image, then the metadata JSON, and the pin caps were charged only after both
// worked. An image saved before a failed metadata upload was charged nowhere, so with a cap of one, three prepares saved three paid
// images and the counts stayed empty. Now a side's first paid upload charges its slot, every saved file is recorded by its content hash
// and reused by a retry, a timeout (which may have saved the file) is charged and counted unknown, and only unused capacity goes back.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { prepareLaunch, pinUploadKey } from "@/lib/burnticker/api/handlers";
import { FakePinUploader, sha256Hex, UploadTimeoutError, type PinUploader } from "@/lib/burnticker/pin";
import { CREATOR, makeWorld, type World } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const RULE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
const LOSE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } } };
type R = Awaited<ReturnType<typeof prepareLaunch>>;
const code = (r: R) => ("error" in r ? (r.error.body as { code?: string }).code : "ok");
const day = () => new Date().toISOString().slice(0, 10);
const count = (w: World, k: string) => Number(w.registry.getStatus(k) ?? 0) || 0;
/** The requester's count: the plain client bucket, or (CREATOR has a confirmed launch in the test world) the connection's bucket for such creators. */
const requester = (w: World) => count(w, `pin.budget.${day()}.client.x`) + count(w, `pin.budget.${day()}.client.x.real`);
const single = (ticker: string) => ({ creator: CREATOR, ticker, name: `${ticker} coin`, rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } });
const mintPk = () => Keypair.generate().publicKey.toBase58();

/** Saves images; refuses (or times out on) metadata JSON while `json` says so. Counts every file it really saved. */
class PartialUploader implements PinUploader {
  readonly name = "partial";
  readonly inner = new FakePinUploader();
  json: "refuse" | "accept" | ((text: string) => boolean) = "refuse";
  image: "accept" | "refuse" | "timeout" = "accept";
  async upload(body: Uint8Array, contentType: string) {
    if (contentType === "application/json") {
      const text = new TextDecoder().decode(body);
      const ok = this.json === "accept" || (typeof this.json === "function" && this.json(text));
      if (!ok) throw new Error("the gateway refused the file");
    } else if (this.image === "refuse") throw new Error("the gateway refused the file");
    else if (this.image === "timeout") { await this.inner.upload(body, contentType); throw new UploadTimeoutError("the Arweave upload did not finish within 30 seconds"); }
    return this.inner.upload(body, contentType);
  }
  images() { return this.inner.uploads.filter((u) => u.contentType.startsWith("image/")); }
}

const world = async (cap: number, mine: number) => { const w = await makeWorld(); const up = new PartialUploader(); w.p.uploader = up; w.p.pinDailyCap = cap; w.p.pinCreatorDailyCap = mine; return { w, up }; };

describe("F08: partial uploads stay inside the pin caps", () => {
  test("audit repro: caps of one, images saved and metadata refused: three prepares save one image, and it is charged and counted", async () => {
    const { w, up } = await world(1, 1);
    const codes: (string | undefined)[] = [];
    for (const t of ["PARTONE", "PARTTWO", "PARTTRI"]) codes.push(code(await prepareLaunch(w.p, single(t), { register: true, mint: mintPk(), client: "x" })));
    assert.equal(codes[0], "pin-failed");
    assert.ok(codes.slice(1).every((c) => c === "upload-budget" || c === "upload-budget-client"), codes.join(", "));
    assert.equal(up.images().length, 1, "one paid image, not three");
    assert.equal(count(w, `pin.budget.${day()}`), 1, "the saved image is charged against the host's cap");
    assert.equal(requester(w), 1, "and against the requester's");
    assert.equal(count(w, `pin.orphans.${day()}`), 1, "the image without a coin is counted");
    assert.ok(up.images().length <= count(w, `pin.budget.${day()}`), "no image outside the caps");
  });

  test("a retry reuses the recorded image (no second image upload) and draws on the slot its first attempt was charged", async () => {
    const { w, up } = await world(5, 5);
    const M = mintPk();
    assert.equal(code(await prepareLaunch(w.p, single("REUSEIMG"), { register: true, mint: M, client: "x" })), "pin-failed");
    const [first] = up.images();
    const rec = JSON.parse(w.registry.getStatus(pinUploadKey(sha256Hex(first.bytes))) ?? "null") as { id: string; unused: boolean } | null;
    assert.equal(rec?.id, first.id, "the saved image is recorded durably");
    assert.equal(rec?.unused, true, "its slot is held for the retry");
    up.json = "accept";
    const r = await prepareLaunch(w.p, single("REUSEIMG"), { register: true, mint: M, client: "x" });
    assert.equal(code(r), "ok");
    assert.equal(up.images().length, 1, "the retry uploaded no second image");
    const meta = w.registry.tokenMeta(M)!;
    assert.equal(meta.imageTx, first.id, "the coin uses the first attempt's image");
    assert.equal(JSON.parse(new TextDecoder().decode(up.inner.get(meta.metadataTx!)!)).image, meta.imageUri);
    assert.equal(count(w, `pin.budget.${day()}`), 1, "one coin, one slot: the retry used the held slot");
    assert.equal(requester(w), 1);
  });

  test("a retry with a new address (a fresh bank key) reuses the same image too", async () => {
    const { w, up } = await world(5, 5);
    const bank = (t: string[]) => ({ keys: t.map(() => Keypair.generate()) });
    assert.equal(code(await prepareLaunch(w.p, single("BANKIMG"), { register: true, takeMintKeys: bank, client: "x" })), "pin-failed");
    up.json = "accept";
    assert.equal(code(await prepareLaunch(w.p, single("BANKIMG"), { register: true, takeMintKeys: bank, client: "x" })), "ok");
    assert.equal(up.images().length, 1);
    assert.equal(count(w, `pin.budget.${day()}`), 1);
  });

  test("an upload that timed out may have been saved: it is charged and counted unknown", async () => {
    const { w, up } = await world(1, 1);
    up.image = "timeout";
    assert.equal(code(await prepareLaunch(w.p, single("TIMEOUTA"), { register: true, mint: mintPk(), client: "x" })), "pin-failed");
    assert.equal(count(w, `pin.budget.${day()}`), 1);
    assert.equal(count(w, `pin.unknown.${day()}`), 1);
    up.image = "accept"; up.json = "accept";
    assert.match(String(code(await prepareLaunch(w.p, single("TIMEOUTB"), { register: true, mint: mintPk(), client: "x" }))), /^upload-budget/);
  });

  test("an upload refused outright saved nothing: its slot goes back and the next prepare is not held up", async () => {
    const { w, up } = await world(1, 1);
    up.image = "refuse";
    assert.equal(code(await prepareLaunch(w.p, single("REFUSEA"), { register: true, mint: mintPk(), client: "x" })), "pin-failed");
    assert.equal(count(w, `pin.budget.${day()}`), 0);
    assert.equal(count(w, `pin.orphans.${day()}`), 0);
    up.image = "accept"; up.json = "accept";
    assert.equal(code(await prepareLaunch(w.p, single("REFUSEB"), { register: true, mint: mintPk(), client: "x" })), "ok");
    assert.equal(count(w, `pin.budget.${day()}`), 1);
  });

  test("review fix: two concurrent prepares with the same image bytes (bank keys, not serialised) are charged two slots", async () => {
    const { w, up } = await world(10, 10);
    up.json = "accept";
    // hold every metadata upload until both prepares have reached it; tell the test when the first image is saved
    let imageSaved!: () => void; const firstImage = new Promise<void>((r) => { imageSaved = r; });
    let waiting: (() => void)[] = [];
    const inner = up.upload.bind(up);
    up.upload = async (body: Uint8Array, contentType: string) => {
      if (contentType === "application/json") { await new Promise<void>((r) => { waiting.push(r); if (waiting.length >= 2) { for (const f of waiting) f(); waiting = []; } }); return inner(body, contentType); }
      const out = await inner(body, contentType); imageSaved(); return out;
    };
    const bank = (t: string[]) => ({ keys: t.map(() => Keypair.generate()) });
    const a = prepareLaunch(w.p, { ...single("SAMEART"), name: "Same art one" }, { register: true, takeMintKeys: bank, client: "x" });
    await firstImage;   // the first prepare's image is saved and recorded; its metadata is still on the way
    const b = prepareLaunch(w.p, { ...single("SAMEART"), name: "Same art two" }, { register: true, takeMintKeys: bank, client: "y" });
    assert.deepEqual([code(await a), code(await b)], ["ok", "ok"]);
    assert.equal(up.images().length, 1, "the second prepare reused the saved image");
    assert.equal(count(w, `pin.budget.${day()}`), 2, "two coins, two slots: an in-flight file holds no slot to take over");
  });

  test("review fix: a stranger presenting a victim's orphaned image reuses the file but pays its own slot", async () => {
    const { w, up } = await world(10, 10);
    assert.equal(code(await prepareLaunch(w.p, single("ORPHANED"), { register: true, mint: mintPk(), client: "victim" })), "pin-failed");
    assert.equal(count(w, `pin.budget.${day()}`), 1);
    up.json = "accept";
    const stranger = Keypair.generate().publicKey.toBase58();
    for (const [who, client, creator] of [["another connection, same wallet", "stranger", CREATOR], ["the same connection, another wallet", "victim", stranger]] as const) {
      const before = count(w, `pin.budget.${day()}`);
      assert.equal(code(await prepareLaunch(w.p, { ...single("ORPHANED"), creator, name: `Orphaned ${client} ${creator.slice(0, 4)}` }, { register: true, mint: mintPk(), client })), "ok", who);
      assert.equal(count(w, `pin.budget.${day()}`), before + 1, `${who}: charged its own slot`);
    }
    assert.equal(up.images().length, 1, "the public file itself is reused");
    const rec = JSON.parse(w.registry.getStatus(pinUploadKey(sha256Hex(up.images()[0].bytes)))!) as { unused: boolean };
    assert.equal(rec.unused, true, "the victim's held slot is still the victim's");
  });

  test("a pair whose side B metadata fails: side A's coin and side B's image are each charged", async () => {
    const { w, up } = await world(10, 10);
    up.json = (text) => !text.includes('"symbol":"CHIEFS"');
    const body = { creator: CREATOR, ticker: "DENVER", name: "Denver", description: "", imageUrl: null, links: [], rule: LOSE, acknowledgements: { ruleLocked: true, noReturns: true }, pair: { ticker: "CHIEFS", name: "Chiefs" } };
    assert.equal(code(await prepareLaunch(w.p, body, { register: true, mint: mintPk(), mintB: mintPk(), client: "x" })), "pin-failed");
    assert.equal(up.images().length, 2);
    assert.equal(count(w, `pin.budget.${day()}`), 2, "both sides saved paid files");
    assert.equal(count(w, `pin.orphans.${day()}`), 1, "side B's image has no coin yet");
  });
});
