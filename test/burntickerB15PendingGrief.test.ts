// B-15 / HB-55 (sixth pre-launch audit 2026-10-19, LA6-1; ported from the auditor's audit6LaunchPendingGrief.test.ts). A prepare needs
// no wallet proof, so a stranger could register a draft in another wallet's name and send dust to its mint address; the named creator's
// own prepare of that ticker was then refused 409 launch-pending ("its coin was already created on chain") for about 25 hours. Now
// "landed" is only the burn program's TokenConfig for the mint naming this creator (launchPending.ts createdOnChainBy), which needs the
// creator's own signature (initialize_token). In-memory registry, fake chain reader, no network.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { createdSideA, prepareLaunch, resetConfirmGuards } from "@/lib/burnticker/api/handlers";
import { limiter } from "@/lib/burnticker/api/http";
import { lockRule } from "@/lib/burnticker/rules";
import { configPda } from "@/lib/burnReceipts/pda";
import { LAUNCH_PENDING_CODE, createdOnChainBy, launchPendingRefusal } from "@/lib/burnticker/launchPending";
import { encodeAccount, makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const RULE = { ...BRONCOS, pair: null };
type Acct = { lamports: number; owner: PublicKey; data: Buffer };
beforeEach(() => { limiter.reset(); resetConfirmGuards(); });

/** A world with a chain reader over `accounts`, and the burn program's id the checks use. */
async function world() {
  const w = await makeWorld();
  const accounts = new Map<string, Acct>();
  (w.p as { market?: unknown }).market = { getAccountInfo: async (k: PublicKey) => accounts.get(k.toBase58()) ?? null };
  const programId = new PublicKey(w.p.program.programId);
  const dust = (addr: PublicKey | string) => accounts.set(typeof addr === "string" ? addr : addr.toBase58(), { lamports: 890_880, owner: SystemProgram.programId, data: Buffer.alloc(0) });
  /** the TokenConfig initialize_token writes for `mint`, naming `creator` (only the creator's signature makes it) */
  const tokenConfig = (mint: string, creator: string, owner = programId) => accounts.set(configPda(programId, new PublicKey(mint)).toBase58(), { lamports: 3_000_000, owner, data: encodeAccount("TokenConfig", (v) => { v.mint = new PublicKey(mint); v.creator = new PublicKey(creator); }) });
  return { w, accounts, programId, dust, tokenConfig };
}
const bodyFor = (creator: string, ticker = "TONIGHT") => ({ creator, ticker, name: "Tonight", rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } });
const statusOf = (r: Awaited<ReturnType<typeof prepareLaunch>>) => ("error" in r ? { status: r.error.status, ...(r.error.body as object) } : { status: 200 }) as { status: number; code?: string };

describe("B-15: a stranger's unsigned draft plus dust never blocks the named creator", () => {
  test("the auditor's reproduction: dust at the griefer's draft mint (and at its config address); the victim's prepare is admitted", async () => {
    const { w, dust, programId } = await world();
    const victim = Keypair.generate().publicKey.toBase58();
    // 1. the stranger: an unsigned registering prepare (as /v1/launch/bundle sends it), creator = the victim's public address
    const junk = Keypair.generate().publicKey.toBase58();
    const a = await prepareLaunch(w.p, bodyFor(victim), { register: true, mint: junk, client: "6.6.6.6" });
    assert.ok("ok" in a, "the unsigned draft registers: " + JSON.stringify("error" in a ? a.error.body : "").slice(0, 200));
    // 2. the stranger sends dust to the junk mint AND to its TokenConfig address: both accounts now exist, system-owned, with no data
    dust(junk); dust(configPda(programId, new PublicKey(junk)));
    // 3. the victim presses Launch (their own fresh mint)
    limiter.reset();
    const b = await prepareLaunch(w.p, bodyFor(victim), { register: true, mint: Keypair.generate().publicKey.toBase58(), client: "1.2.3.4" });
    assert.equal(statusOf(b).status, 200, JSON.stringify(statusOf(b)).slice(0, 300));
  });

  test("a TokenConfig at the address that names another creator, or is not the burn program's, is not the victim's coin", async () => {
    const { w, tokenConfig } = await world();
    const victim = Keypair.generate().publicKey.toBase58(), griefer = Keypair.generate().publicKey.toBase58();
    const junk = Keypair.generate().publicKey.toBase58();
    assert.ok("ok" in await prepareLaunch(w.p, bodyFor(victim), { register: true, mint: junk, client: "6.6.6.6" }));
    tokenConfig(junk, griefer);
    assert.equal(await createdOnChainBy(w.p, { mint: junk, creator: victim }), false);
    assert.equal(await launchPendingRefusal(w.p, { creator: victim, ticker: "TONIGHT", exceptMint: null }), null);
    tokenConfig(junk, victim, SystemProgram.programId);
    assert.equal(await createdOnChainBy(w.p, { mint: junk, creator: victim }), false, "owned by another program");
    limiter.reset();
    assert.equal(statusOf(await prepareLaunch(w.p, bodyFor(victim), { register: true, mint: Keypair.generate().publicKey.toBase58(), client: "1.2.3.4" })).status, 200);
  });

  test("a genuine landed create (the burn program's TokenConfig naming the creator) still yields launch-pending", async () => {
    const { w, tokenConfig } = await world();
    const creator = Keypair.generate().publicKey.toBase58();
    const m1 = Keypair.generate().publicKey.toBase58();
    assert.ok("ok" in await prepareLaunch(w.p, bodyFor(creator), { register: true, mint: m1 }));
    tokenConfig(m1, creator);
    assert.equal(await createdOnChainBy(w.p, { mint: m1, creator }), true);
    const b = await prepareLaunch(w.p, bodyFor(creator), { register: true, mint: Keypair.generate().publicKey.toBase58() });
    assert.equal(statusOf(b).status, 409); assert.equal(statusOf(b).code, LAUNCH_PENDING_CODE);
    // the same draft (same mint) is still the resume path
    assert.equal(await launchPendingRefusal(w.p, { creator, ticker: "TONIGHT", exceptMint: m1 }), null);
  });

  test("createdOnChainBy: unknown without a reader, false when the chain answers nothing, unknown (not proof) when the read fails", async () => {
    const { w } = await world();
    const t = { mint: Keypair.generate().publicKey.toBase58(), creator: Keypair.generate().publicKey.toBase58() };
    assert.equal(await createdOnChainBy({ market: null, program: w.p.program }, t), null);
    assert.equal(await createdOnChainBy(w.p, t), false);
    assert.equal(await createdOnChainBy({ market: { getAccountInfo: async () => { throw new Error("rpc down"); } }, program: w.p.program }, t), null);
    assert.equal(await createdOnChainBy({ market: { getAccountInfo: async () => ({}) }, program: null }, t), null, "no program id and no stored config address: cannot tell");
  });

  test("pair side A (createdSideA): dust is not a created side A; the creator's TokenConfig is", async () => {
    const { w, dust, tokenConfig, programId } = await world();
    const creator = Keypair.generate().publicKey.toBase58();
    const d = w.registry.register({ mint: Keypair.generate().publicKey.toBase58(), ticker: "MILEHI", name: "Mile High", creator, description: "", imageUrl: null, links: [], rulesText: lockRule(RULE).text, feePda: "F", vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: new Date().toISOString(), status: "draft" });
    dust(d.mint); dust(configPda(programId, new PublicKey(d.mint)));
    assert.equal(await createdSideA(w.p, { creator, ticker: "MILEHI", name: "Mile High" }), null);
    tokenConfig(d.mint, creator);
    assert.equal(await createdSideA(w.p, { creator, ticker: "MILEHI", name: "Mile High" }), d.mint);
  });
});
