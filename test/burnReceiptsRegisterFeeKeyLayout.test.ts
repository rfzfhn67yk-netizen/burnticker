import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { PRE_B17_PROGRAM_HASHES, PROGRAM_DATA_HEADER, registerFeeKeyLaunchlabSlot, registerFeeKeyLaunchlabSlotOnChain } from "../src/lib/burnticker/programHash.ts";
import { executableHash, type VerifiedBuild } from "../src/lib/burnticker/trustpack/verifiedBuild.ts";

/**
 * B-17: register_fee_key carries the launchlab_pool account only when the deployed burn program is the B-17 build. The round-5 program
 * on mainnet (152929ce…) and devnet (74659afd…) has no such slot and refuses the longer account list at account validation.
 */
const ROUND5_MAINNET = "152929ce72292d2113655c09a193a15cb49443109e4db202efdbc68232520821";
const PROGRAM = new PublicKey("AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM");
const PROGRAM_DATA = new PublicKey("CqKa66TxEaqLXAuFyJdha4uosBosEEf2CBccNiE8gbKn");

const vbWith = (mainnetBuild: string): VerifiedBuild => ({
  programs: [{ library: "burn_receipts", programId: PROGRAM.toBase58(), builds: { mainnet: { hash: mainnetBuild }, devnet: { hash: "0".repeat(64) } }, deployed: { mainnet: null, devnet: null } }],
} as unknown as VerifiedBuild);

/** A program account and its ProgramData holding `code`, as getAccountInfo returns them. */
function chainWith(code: Uint8Array) {
  const prog = new Uint8Array(36); new DataView(prog.buffer).setUint32(0, 2, true); prog.set(PROGRAM_DATA.toBytes(), 4);
  const pd = new Uint8Array(PROGRAM_DATA_HEADER + code.length); new DataView(pd.buffer).setUint32(0, 3, true); pd.set(code, PROGRAM_DATA_HEADER);
  const m = new Map([[PROGRAM.toBase58(), prog], [PROGRAM_DATA.toBase58(), pd]]);
  return { accountBytes: async (a: string) => m.get(a) ?? null };
}
const b58 = (b: Uint8Array) => new PublicKey(b).toBase58();

describe("register_fee_key account list follows the deployed program (B-17)", () => {
  test("the round-5 hashes never get the launchlab_pool account, even when the table still records them as the build", () => {
    assert.ok(PRE_B17_PROGRAM_HASHES.has(ROUND5_MAINNET));
    assert.equal(registerFeeKeyLaunchlabSlot(ROUND5_MAINNET, "mainnet", vbWith(ROUND5_MAINNET)), false);
  });
  test("a chain hash equal to the recorded B-17 build gets it; any other hash or no read does not; localnet always does", () => {
    const b17 = "ab".repeat(32);
    assert.equal(registerFeeKeyLaunchlabSlot(b17, "mainnet", vbWith(b17)), true);
    assert.equal(registerFeeKeyLaunchlabSlot("cd".repeat(32), "mainnet", vbWith(b17)), false);
    assert.equal(registerFeeKeyLaunchlabSlot(null, "mainnet", vbWith(b17)), false);
    assert.equal(registerFeeKeyLaunchlabSlot(b17, "mainnet", null), false);
    assert.equal(registerFeeKeyLaunchlabSlot(null, "localnet", null), true);
  });
  test("read from chain: the upgraded program's bytes pass the account, the old bytes do not, a failed read sends the round-5 list", async () => {
    const upgraded = new Uint8Array([1, 2, 3, 4, 5, 0, 0]), old = new Uint8Array([9, 9, 9]);
    const vb = vbWith(executableHash(upgraded));
    assert.equal(await registerFeeKeyLaunchlabSlotOnChain(chainWith(upgraded), PROGRAM.toBase58(), "mainnet", b58, { vb }), true);
    assert.equal(await registerFeeKeyLaunchlabSlotOnChain(chainWith(old), PROGRAM.toBase58(), "mainnet", b58, { vb }), false);
    assert.equal(await registerFeeKeyLaunchlabSlotOnChain({ accountBytes: async () => null }, PROGRAM.toBase58(), "mainnet", b58, { vb }), false);
    assert.equal(await registerFeeKeyLaunchlabSlotOnChain({ accountBytes: async () => { throw new Error("rpc down"); } }, PROGRAM.toBase58(), "mainnet", b58, { vb }), false);
  });
  test("the checked-in verified-build table (round 5 deployed, B-17 built) sends the round-5 list now and the B-17 list once the chain holds the B-17 build", async () => {
    // the real table (2026-10-21): builds are the B-17 hashes, deployed are still round 5's with the upgrade pending, so the keeper adds
    // the account only when the bytes read from chain are the B-17 build
    const B17 = { mainnet: "b5b6e44f7c58531c9e0a62b00e42c7a359c1ae3d660aeb3465cbc1b7ea29978b", devnet: "34d7b68e21dbb3b9629d437bb309767019be406eb55352ee95915061aa0ae4ee" } as const;
    const ROUND5 = { mainnet: ROUND5_MAINNET, devnet: "74659afdbb5f63fd0fb79a3366302bd68f7a8e84eea5cf9a6d9cdab97f36785c" } as const;
    for (const cluster of ["mainnet", "devnet"] as const) {
      const { loadVerifiedBuild } = await import("../src/lib/burnticker/trustpack/verifiedBuild.ts");
      const vb = loadVerifiedBuild(process.cwd());
      const p = vb.programs.find((x) => x.library === "burn_receipts")!;
      assert.equal(p.builds[cluster].hash, B17[cluster], cluster);
      assert.equal(p.deployed[cluster]!.hash, ROUND5[cluster], cluster);
      assert.equal(p.deployed[cluster]!.matchesBuild, false, cluster);
      assert.ok(PRE_B17_PROGRAM_HASHES.has(ROUND5[cluster]) && !PRE_B17_PROGRAM_HASHES.has(B17[cluster]), cluster);
      assert.equal(registerFeeKeyLaunchlabSlot(p.deployed[cluster]!.hash, cluster, vb), false, `${cluster}: round 5 on chain`);
      assert.equal(registerFeeKeyLaunchlabSlot(B17[cluster], cluster, vb), true, `${cluster}: after the upgrade`);
    }
  });
});
