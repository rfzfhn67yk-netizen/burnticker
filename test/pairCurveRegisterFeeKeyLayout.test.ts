import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { BURN_RECEIPTS_IDL } from "../src/lib/burnReceipts/idl.ts";
import { eventAuthority } from "../src/lib/burnReceipts/instructions.ts";
import { launchlabPoolPda } from "../src/lib/burnReceipts/pda.ts";
import { LAUNCHLAB_PROGRAM_ID } from "../src/lib/burnReceipts/constants.ts";
import { PROGRAM_DATA_HEADER } from "../src/lib/burnticker/programHash.ts";
import { executableHash, type VerifiedBuild } from "../src/lib/burnticker/trustpack/verifiedBuild.ts";
import { registerSideFeeKeyIx, sideFeeKeyLaunchlabSlot } from "../src/lib/pairCurve/client.ts";
import type { PairAccount } from "../src/lib/pairCurve/accounts.ts";

/**
 * B-17 for pair sides: register_side_fee_key (burn_receipts.register_fee_key) carries the launchlab_pool account only when the deployed
 * burn_receipts is the B-17 build; the round-5 program (mainnet 152929ce…, devnet 74659afd…) refuses the longer account list.
 */
const BR = new PublicKey("AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM");
const PROGRAM_DATA = new PublicKey("CqKa66TxEaqLXAuFyJdha4uosBosEEf2CBccNiE8gbKn");
const pairAddress = Keypair.generate().publicKey;
const pair = { mints: [Keypair.generate().publicKey, Keypair.generate().publicKey] } as unknown as PairAccount;
const order = BURN_RECEIPTS_IDL.instructions.find((i) => i.name === "register_fee_key")!.accounts.map((a) => a.name);

const vbWith = (mainnetBuild: string): VerifiedBuild => ({
  programs: [{ library: "burn_receipts", programId: BR.toBase58(), builds: { mainnet: { hash: mainnetBuild }, devnet: { hash: "0".repeat(64) } }, deployed: { mainnet: null, devnet: null } }],
} as unknown as VerifiedBuild);
/** A connection whose burn_receipts program account and ProgramData hold `code` (getAccountInfo only). */
function connWith(code: Uint8Array | null) {
  const prog = Buffer.alloc(36); prog.writeUInt32LE(2, 0); PROGRAM_DATA.toBuffer().copy(prog, 4);
  const pd = code ? Buffer.alloc(PROGRAM_DATA_HEADER + code.length) : null;
  if (pd && code) { pd.writeUInt32LE(3, 0); Buffer.from(code).copy(pd, PROGRAM_DATA_HEADER); }
  const m = new Map<string, Buffer | null>([[BR.toBase58(), prog], [PROGRAM_DATA.toBase58(), pd]]);
  return { getAccountInfo: async (k: PublicKey) => { const d = m.get(k.toBase58()); return d ? { data: d } : null; } } as never;
}

describe("pair side register_fee_key account list follows the deployed burn program (B-17)", () => {
  test("the builder: default is the round-5 list, launchlabPoolSlot adds the side mint's LaunchLab pool before system_program", () => {
    const base = { payer: Keypair.generate().publicKey, pairAddress, pair, side: 1 as const, cluster: "mainnet" as const, burnReceiptsProgramId: BR };
    const r5 = registerSideFeeKeyIx(base), b17 = registerSideFeeKeyIx({ ...base, launchlabPoolSlot: true });
    assert.equal(b17.keys.length, r5.keys.length + 1);
    const lp = order.indexOf("lp_lock_vault");
    assert.ok(b17.keys[order.indexOf("launchlab_pool")].pubkey.equals(launchlabPoolPda(LAUNCHLAB_PROGRAM_ID.mainnet, pair.mints[1])));
    assert.ok(r5.keys[lp + 1].pubkey.equals(SystemProgram.programId) && r5.keys[lp + 2].pubkey.equals(eventAuthority(BR)) && r5.keys[lp + 3].pubkey.equals(BR));
    assert.ok(!r5.keys.some((k) => k.pubkey.equals(launchlabPoolPda(LAUNCHLAB_PROGRAM_ID.mainnet, pair.mints[1]))));
    assert.deepEqual(r5.data, b17.data);
  });
  test("the decision: B-17 bytes on chain pass the account; other bytes, an absent account or a failed read do not", async () => {
    const upgraded = new Uint8Array([7, 7, 7, 1, 0, 0]), old = new Uint8Array([3, 3]);
    const verifiedBuild = vbWith(executableHash(upgraded));
    assert.equal(await sideFeeKeyLaunchlabSlot({ connection: connWith(upgraded), cluster: "mainnet", burnReceiptsProgramId: BR, verifiedBuild }), true);
    assert.equal(await sideFeeKeyLaunchlabSlot({ connection: connWith(old), cluster: "mainnet", burnReceiptsProgramId: BR, verifiedBuild }), false);
    assert.equal(await sideFeeKeyLaunchlabSlot({ connection: connWith(null), cluster: "mainnet", burnReceiptsProgramId: BR, verifiedBuild }), false);
    const throwing = { getAccountInfo: async () => { throw new Error("rpc down"); } } as never;
    assert.equal(await sideFeeKeyLaunchlabSlot({ connection: throwing, cluster: "mainnet", burnReceiptsProgramId: BR, verifiedBuild }), false);
    assert.equal(await sideFeeKeyLaunchlabSlot({ connection: throwing, cluster: "localnet", burnReceiptsProgramId: BR }), true);
  });
});
