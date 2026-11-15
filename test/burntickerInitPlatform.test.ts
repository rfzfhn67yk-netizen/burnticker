// initialize_token must carry the LaunchLab platform (2026-10-11 review-2 fix): for registration policies 0 and 2 the program refuses
// unless launchlab_platform == BURNTICKER_PLATFORM compiled into the build. ProgramBurnClient.initializeToken passes the cluster's pinned
// platform (or the host's BURNTICKER_PLATFORM_ID when given).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ProgramBurnClient } from "@/lib/burnticker/programClient";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { BURNTICKER_PLATFORM } from "@/lib/burnReceipts/constants";
import { lockRule } from "@/lib/burnticker/rules";
import { BRONCOS } from "./burntickerHelpers.ts";

const programId = new PublicKey("AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM");
const def = BURN_RECEIPTS_IDL.instructions.find((i) => i.name === "initialize_token")!;
const slot = (keys: { pubkey: string }[]) => keys[def.accounts.findIndex((a) => a.name === "launchlab_platform")].pubkey;
const input = () => {
  const locked = lockRule({ ...BRONCOS, pair: null });
  const creator = Keypair.generate().publicKey.toBase58();
  return { mint: Keypair.generate().publicKey.toBase58(), creator, ticker: "BRONCOS", rulesSha256: locked.sha256, selectorKey: "kalshi:KXNFLGAME:-DEN", mode: "buyback" as const, attesters: [creator], quorum: 1, vault: null, rule: locked.rule };
};

for (const cluster of ["devnet", "mainnet"] as const) test(`${cluster}: initialize_token names the pinned LaunchLab platform (the program refuses policies 0/2 without it)`, async () => {
  const client = new ProgramBurnClient({ connection: {} as never, programId, cluster, payer: null, admin: Keypair.generate().publicKey, solUsd: async () => 150, allowMainnet: true });
  const ix = (await client.initializeToken(input())).instructions[0];
  assert.notEqual(slot(ix.keys), programId.toBase58(), "launchlab_platform must not be the omitted-account placeholder");
  assert.equal(slot(ix.keys), BURNTICKER_PLATFORM[cluster].toBase58());
});

test("the host's BURNTICKER_PLATFORM_ID (launchLabPlatform) is passed when given", async () => {
  const p = Keypair.generate().publicKey;
  const client = new ProgramBurnClient({ connection: {} as never, programId, cluster: "devnet", payer: null, admin: Keypair.generate().publicKey, solUsd: async () => 150, launchLabPlatform: p });
  assert.equal(slot((await client.initializeToken(input())).instructions[0].keys), p.toBase58());
});
