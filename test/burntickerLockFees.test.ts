// LP LOCKED FOREVER, ITS FEES FUND THE BURN (owner decision 2026-10-10). The adapter's constants and seeds are the program's final
// interface; the split is exact at every lamport count (the odd lamport goes to the burn pool); the program's memo round-trips; the
// keeper's claim_lock_fees crank registers the Fee Key once, claims ahead of the buyback cranks, skips when nothing accrued, writes one
// append-only receipt row from the program's facts, alarms on a Fee Key held elsewhere, an unpinned treasury, a skewed split or a
// refusal, backs off, resolves a dropped send from the write-ahead signature, and signs nothing in a dry run.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { openRegistry, type Registry, type TokenRow } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { runCycle, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { claimLockFeesFor, LOCK_FEES_EVENT, type LockFeesKeeperDeps } from "@/lib/burnticker/lockFeesKeeper";
import {
  LOCK_FEES_INTERFACE, LOCK_FEE_ERRORS, BURNTICKER_PLATFORM, lockFeeErrorSentence, lpLockPolicyJson, launchLabLockerFor, LOCK_FEE_BURN_BPS, LOCK_FEE_OPERATOR_BPS, LP_LOCK_AUTHORITY, LP_LOCK_PROGRAM, LP_POLICY_LINE, OPERATOR_TREASURY, TREASURY_NOT_PINNED,
  buildLpLockJson, decodeLockedCpLiquidity, feeKeyRecordPda, feeKeysPda, formatLockFeesMemo, lockAuthorityPda, lockFeeClaimLine, lockedLiquidityPda, parseLockFeesMemo, splitLockFees, splitMatches,
} from "@/lib/burnticker/lockFees";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { checkLpLockPins } from "@/lib/burnticker/lpLockPins";
import { lpFeeLine } from "@/lib/burnticker/trustpack/ledger";
import { lpLockBlock } from "@/lib/burnticker/lpLockPage";
import * as PROGRAM from "@/lib/burnReceipts/constants";
import * as PDA from "@/lib/burnReceipts/pda";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { claimLockFeesIx, registerPoolIx } from "@/lib/burnReceipts/instructions";
import { lockFeesMemoFromLogs } from "@/lib/burnticker/lockFeesChain";
import { BRONCOS, NOW } from "./burntickerHelpers.ts";

const CREATOR = "CreatorWa11et111111111111111111111111111111";
const ATTESTER = "KeeperDataKey1111111111111111111111111111111";

describe("the split (compiled 80/20; the odd lamport goes to the burn pool)", () => {
  test("constants", () => {
    assert.equal(LOCK_FEE_BURN_BPS, 8_000);
    assert.equal(LOCK_FEE_OPERATOR_BPS, 2_000);
    assert.equal(LOCK_FEE_BURN_BPS + LOCK_FEE_OPERATOR_BPS, 10_000);
  });
  test("exact at odd lamport counts", () => {
    const cases: [bigint, bigint, bigint][] = [[BigInt(0), BigInt(0), BigInt(0)], [BigInt(1), BigInt(1), BigInt(0)], [BigInt(3), BigInt(3), BigInt(0)], [BigInt(4), BigInt(4), BigInt(0)], [BigInt(5), BigInt(4), BigInt(1)], [BigInt(7), BigInt(6), BigInt(1)], [BigInt(9), BigInt(8), BigInt(1)], [BigInt(10), BigInt(8), BigInt(2)], [BigInt(11), BigInt(9), BigInt(2)], [BigInt(12345), BigInt(9876), BigInt(2469)], [BigInt(12346), BigInt(9877), BigInt(2469)], [BigInt(12349), BigInt(9880), BigInt(2469)], [BigInt(1000000001), BigInt(800000001), BigInt(200000000)], [BigInt(999999999), BigInt(800000000), BigInt(199999999)]];
    for (const [sol, burn, op] of cases) assert.deepEqual(splitLockFees(sol), { burnPool: burn, operator: op }, `${sol}`);
  });
  test("for every count 0..5,000: parts sum to the whole, the operator never exceeds 20 %, the burn pool never falls under 80 %", () => {
    for (let i = BigInt(0); i <= BigInt(5000); i++) {
      const s = splitLockFees(i);
      assert.equal(s.burnPool + s.operator, i);
      assert.ok(s.operator * BigInt(10000) <= i * BigInt(2000));
      assert.ok(s.burnPool * BigInt(10000) >= i * BigInt(8000));
      assert.equal(s.operator, (i * BigInt(2000)) / BigInt(10000));
    }
    assert.throws(() => splitLockFees(-BigInt(1)));
  });
  test("the program builder's local mock claim (LaunchLab path): 59,456,045 lamports → 47,564,836 burn pool + 11,891,209 treasury", () => {
    assert.deepEqual(splitLockFees(BigInt(59456045)), { burnPool: BigInt(47564836), operator: BigInt(11891209) });
    const line = lockFeeClaimLine({ solLamports: BigInt(59456045), toBurnPoolLamports: BigInt(47564836), toOperatorLamports: BigInt(11891209), tokenBurnedRaw: BigInt(0) });
    assert.equal(line, "LP fees claimed: 0.059456045 SOL → 80% burn pool (0.047564836) / 20% operator (0.011891209); coin side burned");
  });
  test("splitMatches flags anything but the compiled split", () => {
    assert.equal(splitMatches({ solLamports: BigInt(7), toBurnPoolLamports: BigInt(6), toOperatorLamports: BigInt(1) }), true);
    assert.equal(splitMatches({ solLamports: BigInt(7), toBurnPoolLamports: BigInt(5), toOperatorLamports: BigInt(2) }), false);
  });
});

describe("the program interface (final 2026-10-10)", () => {
  test("names, seeds, ids and treasuries are pinned", () => {
    assert.deepEqual(LOCK_FEES_INTERFACE.instructions, { register: "register_fee_key", claim: "claim_lock_fees", registerPool: "register_pool", pairBurnFallback: "burn_lp" });
    assert.deepEqual(LOCK_FEES_INTERFACE.seeds, { feeKeys: "fee_keys", feeKey: "fee_key", lockedLiquidity: "locked_liquidity", lockAuthority: "lock_cp_authority_seed", pairFeeNft: "fee_nft" });
    assert.equal(LOCK_FEES_INTERFACE.event, "LockFeesClaimed");
    assert.equal(LOCK_FEES_INTERFACE.interface, "r2-2026-10-11");
    assert.deepEqual(LP_LOCK_PROGRAM, { mainnet: "LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE", devnet: "DRay25Usp3YJAi7beckgpGUC7mGJ2cR1AVPxhYfwVCUX", localnet: "LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE" });
    assert.equal(OPERATOR_TREASURY.devnet, "A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD");
    assert.equal(OPERATOR_TREASURY.mainnet, null, "mainnet is not pinned until the owner compiles the vault in");
  });
  test("the lock authority PDA derives to Raydium's published authority on both clusters", () => {
    assert.equal(lockAuthorityPda(LP_LOCK_PROGRAM.mainnet).toBase58(), LP_LOCK_AUTHORITY.mainnet);
    assert.equal(lockAuthorityPda(LP_LOCK_PROGRAM.devnet).toBase58(), LP_LOCK_AUTHORITY.devnet);
  });
  test("PDAs: fee_keys is global (one per program), fee_key per mint, locked_liquidity per Fee Key", () => {
    const pid = "AuQjoSgqNcUQ1Wk6Q4uohKGjvrE4WAMSVqT6xZZbzhMM";
    const a = new PublicKey("So11111111111111111111111111111111111111112"), b = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    assert.equal(feeKeysPda(pid).toBase58(), PublicKey.findProgramAddressSync([Buffer.from("fee_keys")], new PublicKey(pid))[0].toBase58());
    assert.notEqual(feeKeyRecordPda(pid, a).toBase58(), feeKeyRecordPda(pid, b).toBase58());
    assert.equal(feeKeyRecordPda(pid, a).toBase58(), PublicKey.findProgramAddressSync([Buffer.from("fee_key"), a.toBuffer()], new PublicKey(pid))[0].toBase58());
    assert.equal(lockedLiquidityPda(LP_LOCK_PROGRAM.mainnet, a).toBase58(), PublicKey.findProgramAddressSync([Buffer.from("locked_liquidity"), a.toBuffer()], new PublicKey(LP_LOCK_PROGRAM.mainnet))[0].toBase58());
  });
  test("LockedCpLiquidityState decodes at the lock program's offsets", () => {
    const d = Buffer.alloc(256);
    d.writeBigUInt64LE(BigInt(1000), 8); d.writeBigUInt64LE(BigInt(5), 16); d.writeBigUInt64LE(BigInt(7), 24); d.writeBigUInt64LE(BigInt(990), 32); d.writeBigUInt64LE(BigInt(3), 40); d.writeBigUInt64LE(BigInt(1), 48); d.writeBigUInt64LE(BigInt(42), 56);
    const keys = [64, 96, 128, 160].map((o, i) => { const k = PublicKey.findProgramAddressSync([Buffer.from(`k${i}`)], new PublicKey(LP_LOCK_PROGRAM.mainnet))[0]; k.toBuffer().copy(d, o); return k.toBase58(); });
    const v = decodeLockedCpLiquidity(d);
    assert.deepEqual([v.lockedLp, v.claimedLp, v.unclaimedLp, v.lastLp, v.lastK, v.epoch], [BigInt(1000), BigInt(5), BigInt(7), BigInt(990), BigInt(3) + (BigInt(1) << BigInt(64)), BigInt(42)]);
    assert.deepEqual([v.pool, v.feeNftMint, v.owner, v.lpMint], keys);
  });
  test("memo v1 (devnet history) and v2 (round 2: paid / pending) both parse; anything else is refused", () => {
    const f = { solLamports: BigInt(12345), toBurnPoolLamports: BigInt(9876), toOperatorLamports: BigInt(2469), tokenBurnedRaw: BigInt(55000000) };
    const v1 = formatLockFeesMemo("RAYS26", f, "Fee1KeyNftMint1111111111111111111111111111", "v1");
    assert.equal(v1, "RAYS26|lockfees|wsol=12345|burnpool=9876|operator=2469|burned=55000000|nft=Fee1KeyNftMi|v1");
    assert.deepEqual(parseLockFeesMemo(v1), { prefix: "RAYS26", nft: "Fee1KeyNftMi", version: "v1", ...f });
    const v2 = formatLockFeesMemo("RAYS26", { ...f, paidLamports: BigInt(2000), pendingLamports: BigInt(469) }, "Fee1KeyNftMint1111111111111111111111111111");
    assert.equal(v2, "RAYS26|lockfees|wsol=12345|burnpool=9876|operator=2469|paid=2000|pending=469|burned=55000000|nft=Fee1KeyNftMi|v2");
    assert.deepEqual(parseLockFeesMemo(v2), { prefix: "RAYS26", nft: "Fee1KeyNftMi", version: "v2", ...f, paidLamports: BigInt(2000), pendingLamports: BigInt(469) });
    assert.equal(parseLockFeesMemo("RAYS26|buyback|wsol=1|v1"), null);
    assert.equal(parseLockFeesMemo(v1.replace("|v1", "|v2")), null, "a v1 body with a v2 tag");
    assert.equal(parseLockFeesMemo(v2.replace("|v2", "|v3")), null);
    assert.match(lockFeeClaimLine({ ...f, paidLamports: BigInt(2000), pendingLamports: BigInt(469) }), /0\.000000469 still owed to the operator/);
  });
  test("the receipt line and the policy line are copy-lint clean", () => {
    const cfg = loadCopyLintConfig();
    const line = lockFeeClaimLine({ solLamports: BigInt(12345678), toBurnPoolLamports: BigInt(9876543), toOperatorLamports: BigInt(2469135), tokenBurnedRaw: BigInt(1500000) });
    assert.equal(line, "LP fees claimed: 0.012345678 SOL → 80% burn pool (0.009876543) / 20% operator (0.002469135); coin side burned (1.5 tokens)");
    for (const t of [line, LP_POLICY_LINE]) assert.equal(lintCopy(t, cfg).ok, true, t);
  });
});

let reg: Registry, program: FakeBurnProgram, lines: string[], clock: number;
async function launch(ticker: string): Promise<TokenRow> {
  const b = await buildLaunchBundle({ creator: CREATOR, ticker, name: `${ticker} coin`, description: "a test", imageUrl: null, links: [], rule: BRONCOS, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  const t = reg.register({ mint: b.mint, ticker, name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: b.addresses.platformId, baselineAt: "2026-09-01T00:00:00Z", status: "draft" }, clock);
  reg.markLaunched(t.mint, `launch${ticker}`, b.addresses.poolId, "2026-09-01T00:00:00Z");
  return reg.token(t.mint)!;
}
const deps = (o: Partial<LockFeesKeeperDeps> = {}): LockFeesKeeperDeps => ({ registry: reg, lockFees: program.lockFees, log: (s) => lines.push(s), now: () => clock, dryRun: false, ...o });
const alerts = (kind: string) => reg.alertsSince(0).filter((a) => a.kind === kind);

beforeEach(() => { reg = openRegistry(":memory:"); program = new FakeBurnProgram("devnet"); clock = NOW; program.now = () => clock; lines = []; });

describe("the claim_lock_fees crank (keeper)", () => {
  test("before graduation: skipped, nothing signed", async () => {
    const t = await launch("RAYS");
    const r = await claimLockFeesFor(deps(), t);
    assert.deepEqual([r.outcome, "why" in r ? r.why : ""], ["skipped", "not graduated: no locked LP yet"]);
    assert.equal(program.lockFees.port(t.mint).sends, 0);
  });

  test("after graduation: register_fee_key once, then nothing accrued → skipped; an odd-lamport claim → one receipt row with the exact split, 80 % in the burn pool", async () => {
    const t = await launch("RAYS");
    const port = program.lockFees.port(t.mint).graduate();
    const r0 = await claimLockFeesFor(deps(), t);
    assert.deepEqual([r0.outcome, "why" in r0 ? r0.why : ""], ["skipped", "nothing accrued"]);
    assert.equal(port.registers, 1, "the Fee Key was registered with the program");
    const pool0 = await program.feePdaBalanceLamports(t.mint);
    port.accrue(BigInt(12345679), BigInt(2000000));
    const r1 = await claimLockFeesFor(deps(), t);
    assert.equal(r1.outcome, "claimed", JSON.stringify(r1));
    const rows = reg.lockFeeClaims(t.mint);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].solLamports, rows[0].toBurnPoolLamports, rows[0].toOperatorLamports, rows[0].tokenBurnedRaw], [BigInt(12345679), BigInt(9876544), BigInt(2469135), BigInt(2000000)]);
    assert.equal((await program.feePdaBalanceLamports(t.mint)) - pool0, BigInt(9876544), "the 80 % (with the odd lamport) landed in the coin's fee PDA");
    assert.equal(port.operatorLamports, BigInt(2469135));
    assert.match(port.memoOf(rows[0].signature)!, /^RAYS\|lockfees\|wsol=12345679\|burnpool=9876544\|operator=2469135\|paid=2469135\|pending=0\|burned=2000000\|nft=.*\|v2$/);
    assert.ok(lines.some((l) => l.includes("LP fees claimed: 0.012345679 SOL → 80% burn pool (0.009876544) / 20% operator (0.002469135); coin side burned (2 tokens)")));
    const sends = port.sends;
    const r2 = await claimLockFeesFor(deps(), t);
    assert.equal(r2.outcome, "skipped");
    assert.equal(port.sends, sends, "no transaction for an empty claim");
    assert.equal(port.registers, 1, "register_fee_key runs once");
    assert.throws(() => reg.db.prepare("DELETE FROM lock_fee_claims").run(), /append-only/);
    assert.throws(() => reg.db.prepare("UPDATE lock_fee_claims SET sol_lamports='0'").run(), /append-only/);
  });

  test("runCycle claims every graduated coin ahead of the buyback cranks and reports it", async () => {
    const a = await launch("RAYS"), b = await launch("LAKERS");
    program.lockFees.port(a.mint).graduate().accrue(BigInt(1001));
    const keeperDeps: KeeperDeps = { registry: reg, program, oracles: { kalshi: { settledSince: async () => ({ events: [], awaitingFinal: 0, refusals: [], settlementSourceUrl: null }) } as never, catalogue: {} as never }, attester: ATTESTER, log: (s) => lines.push(s), now: () => clock, dryRun: false };
    const rep = await runCycle(keeperDeps, { fetch: false });
    const byMint = new Map((rep.lpFees ?? []).map((x) => [x.mint, x]));
    assert.equal(byMint.get(a.mint)?.outcome, "claimed");
    assert.equal(byMint.get(b.mint)?.outcome, "skipped");
    assert.deepEqual(reg.lockFeeClaims().map((c) => [c.mint, c.toBurnPoolLamports, c.toOperatorLamports]), [[a.mint, BigInt(801), BigInt(200)]]);
  });

  test("a refusal alerts (lock-fees-failed) and backs off; the next call waits", async () => {
    const t = await launch("RAYS");
    const port = program.lockFees.port(t.mint).graduate().accrue(BigInt(5));
    port.feeKeyRegistered = true; port.poolRegistered = true;
    port.simErr = "TwapUnavailable";
    const r = await claimLockFeesFor(deps(), t);
    assert.equal(r.outcome, "error");
    assert.equal(alerts("lock-fees-failed").length, 1);
    port.simErr = null;
    const w = await claimLockFeesFor(deps(), t);
    assert.equal(w.outcome, "waiting");
    clock += 3_600_000;
    assert.equal((await claimLockFeesFor(deps(), t)).outcome, "claimed");
  });

  test("an on-chain failure alerts too and leaves the signature marked failed", async () => {
    const t = await launch("RAYS");
    const port = program.lockFees.port(t.mint).graduate().accrue(BigInt(5));
    port.feeKeyRegistered = true; port.poolRegistered = true;
    port.failOnChain = "ConstraintSeeds";
    const r = await claimLockFeesFor(deps(), t);
    assert.equal(r.outcome, "error");
    assert.match("why" in r ? r.why : "", /failed on chain: ConstraintSeeds/);
    assert.deepEqual(reg.signatures(t.mint, LOCK_FEES_EVENT).map((s) => s.status), ["failed"]);
  });

  test("a Fee Key held anywhere but the fee-keys PDA is an alarm, never a claim", async () => {
    const t = await launch("RAYS");
    const port = program.lockFees.port(t.mint).graduate().accrue(BigInt(5));
    port.feeKeyOwner = "SomeoneE1se111111111111111111111111111111111";
    const r = await claimLockFeesFor(deps(), t);
    assert.equal(r.outcome, "error");
    assert.equal(alerts("lock-fee-key-owner").length, 1);
    assert.equal(port.sends, 0);
  });

  test("an unpinned operator treasury (mainnet today): no claim, a lock-fees-treasury alert; the program would refuse TreasuryNotPinned", async () => {
    const t = await launch("RAYS");
    const port = program.lockFees.port(t.mint).graduate().accrue(BigInt(5));
    program.lockFees.treasury = null;
    const r = await claimLockFeesFor(deps(), t);
    assert.equal(r.outcome, "waiting");
    assert.equal(alerts("lock-fees-treasury").length, 1);
    assert.equal(port.registers, 1, "register_fee_key does not need the treasury");
    assert.equal(reg.lockFeeClaims().length, 0);
    const tx = await port.buildClaim();
    assert.equal((await port.simulate(tx.raw)).err, TREASURY_NOT_PINNED);
  });

  test("a split that is not the compiled 80/20 is recorded as the program did it, and alarmed", async () => {
    const t = await launch("RAYS");
    const port = program.lockFees.port(t.mint).graduate().accrue(BigInt(1000));
    port.feeKeyRegistered = true; port.poolRegistered = true;
    port.skewSplit = true;
    assert.equal((await claimLockFeesFor(deps(), t)).outcome, "claimed");
    assert.equal(alerts("lock-fees-split").length, 1);
  });

  test("a dropped send waits, then the write-ahead signature is resolved on the next cycle", async () => {
    const t = await launch("RAYS");
    const port = program.lockFees.port(t.mint).graduate().accrue(BigInt(9));
    port.feeKeyRegistered = true; port.poolRegistered = true;
    port.dropSends = true;
    const r = await claimLockFeesFor(deps(), t);
    assert.equal(r.outcome, "waiting");
    const [sig] = reg.signatures(t.mint, LOCK_FEES_EVENT);
    assert.equal(sig.status, "sent");
    port.land(sig.signature);
    const r2 = await claimLockFeesFor(deps(), t);
    assert.deepEqual([r2.outcome, r2.outcome === "claimed" ? r2.signature : ""], ["claimed", sig.signature]);
    assert.deepEqual(reg.lockFeeClaims(t.mint).map((c) => [c.toBurnPoolLamports, c.toOperatorLamports]), [[BigInt(8), BigInt(1)]]);
  });

  test("dry run signs nothing; a keeper without the client reports unbound", async () => {
    const t = await launch("RAYS");
    const port = program.lockFees.port(t.mint).graduate().accrue(BigInt(5));
    assert.equal((await claimLockFeesFor(deps({ dryRun: true }), t)).outcome, "dry-run");
    port.feeKeyRegistered = true; port.poolRegistered = true;
    assert.equal((await claimLockFeesFor(deps({ dryRun: true }), t)).outcome, "dry-run");
    assert.equal(port.sends, 0);
    assert.equal((await claimLockFeesFor(deps({ lockFees: undefined }), t)).outcome, "unbound");
  });
});

describe("the public lp block", () => {
  test("before graduation: policy, lock program, fee-keys PDA, 100 %, no claim, a plain note", () => {
    const j = buildLpLockJson({ cluster: "devnet", state: null, feeKeysPda: "FeeKeysPda1111111111111111111111111111111111", operatorTreasury: OPERATOR_TREASURY.devnet, claims: [] });
    assert.equal(j.policy, "locked-forever");
    assert.equal(j.lockProgram, LP_LOCK_PROGRAM.devnet);
    assert.equal(j.feeKeyOwner, "FeeKeysPda1111111111111111111111111111111111");
    assert.equal(j.lockedPct, 100);
    assert.deepEqual(j.split, { burnBps: 8000, operatorBps: 2000, coinSide: "burned", fixedInCode: true });
    assert.equal(j.lastClaim, null);
    assert.match(j.note!, /not graduated yet/);
    assert.equal(j.line, LP_POLICY_LINE);
  });
  test("after claims: the last claim and the totals, with explorer links; an unpinned treasury is said plainly", () => {
    const claims = [
      { signature: "s1", mint: "M", at: Date.UTC(2026, 9, 11), slot: 1, solLamports: BigInt(10), toBurnPoolLamports: BigInt(8), toOperatorLamports: BigInt(2), tokenBurnedRaw: BigInt(0) },
      { signature: "s2", mint: "M", at: Date.UTC(2026, 9, 12), slot: 2, solLamports: BigInt(7), toBurnPoolLamports: BigInt(6), toOperatorLamports: BigInt(1), tokenBurnedRaw: BigInt(3) },
    ];
    const state = { graduated: true, pool: "P", lpMint: "L", feeKey: "So11111111111111111111111111111111111111112", feeKeyOwner: "K", lockedLiquidity: null, feeKeyRegistered: true, lockedPct: 100, accruedSolLamports: BigInt(0), accruedTokenRaw: BigInt(0) };
    const j = buildLpLockJson({ cluster: "mainnet", state, feeKeysPda: "K", operatorTreasury: null, claims, explorer: (id, kind) => `https://solscan.io/${kind === "tx" ? "tx" : "account"}/${id}` });
    assert.equal(j.lastClaim!.signature, "s2");
    assert.equal(j.lastClaim!.txUrl, "https://solscan.io/tx/s2");
    assert.deepEqual(j.totals, { claims: 2, sol: "0.000000017", toBurnPool: "0.000000014", toOperator: "0.000000003", tokenBurnedRaw: "3" });
    assert.equal(j.lockedLiquidity, lockedLiquidityPda(LP_LOCK_PROGRAM.mainnet, state.feeKey).toBase58());
    assert.match(j.note!, /TreasuryNotPinned/);
    assert.equal(j.urls.feeKey, `https://solscan.io/account/${state.feeKey}`);
  });
});

describe("the launch gate's LP-lock pins (platformLockNftWallet @48 = fee_keys PDA; scales @80 = 1,000,000 / 0 / 0)", () => {
  const PID = "AuQjoSgqNcUQ1Wk6Q4uohKGjvrE4WAMSVqT6xZZbzhMM";
  const platform = (o: { wallet?: PublicKey; scales?: [bigint, bigint, bigint] } = {}) => {
    const d = Buffer.alloc(944);
    (o.wallet ?? feeKeysPda(PID)).toBuffer().copy(d, 48);
    const [p, c, b] = o.scales ?? [BigInt(1000000), BigInt(0), BigInt(0)];
    d.writeBigUInt64LE(p, 80); d.writeBigUInt64LE(c, 88); d.writeBigUInt64LE(b, 96);
    return d;
  };
  test("the policy platform passes on devnet (treasury pinned)", () => {
    const r = checkLpLockPins(platform(), { programId: PID, cluster: "devnet", requireTreasury: true });
    assert.deepEqual(r.problems, []);
    assert.equal(r.ok, true);
    assert.deepEqual(r.current.scalesPpm, ["1000000", "0", "0"]);
  });
  test("the old burn-everything platform (0 / 0 / 1,000,000) and a lock-NFT wallet that is not the PDA are refused", () => {
    assert.match(checkLpLockPins(platform({ scales: [BigInt(0), BigInt(0), BigInt(1000000)] }), { programId: PID, cluster: "devnet" }).problems.join(";"), /1,000,000 \/ 0 \/ 0/);
    assert.match(checkLpLockPins(platform({ scales: [BigInt(900000), BigInt(0), BigInt(100000)] }), { programId: PID, cluster: "devnet" }).problems.join(";"), /platform 900000/);
    assert.match(checkLpLockPins(platform({ wallet: new PublicKey(LP_LOCK_AUTHORITY.mainnet) }), { programId: PID, cluster: "devnet" }).problems.join(";"), /not the burn program's fee-keys PDA/);
    assert.match(checkLpLockPins(null, { programId: PID, cluster: "devnet" }).problems.join(";"), /does not exist/);
  });
  test("mainnet: the unpinned operator treasury is a launch-gate problem (TreasuryNotPinned)", () => {
    const r = checkLpLockPins(platform(), { programId: PID, cluster: "mainnet", requireTreasury: true });
    assert.equal(r.ok, false);
    assert.match(r.problems.join(";"), /TreasuryNotPinned/);
    assert.equal(checkLpLockPins(platform(), { programId: PID, cluster: "mainnet" }).ok, true, "without requireTreasury only the LP pins count");
  });
});

describe("the fee ledger's operator LP-fee line", () => {
  test("sums the recorded claims; says plainly when the cluster's treasury is not pinned", () => {
    const claims = [{ solLamports: BigInt(10), toBurnPoolLamports: BigInt(8), toOperatorLamports: BigInt(2) }, { solLamports: BigInt(59456045), toBurnPoolLamports: BigInt(47564836), toOperatorLamports: BigInt(11891209) }];
    const d = lpFeeLine("devnet", claims);
    assert.deepEqual([d.claims, d.solLamports, d.toOperatorLamports, d.toBurnPoolLamports, d.treasury, d.source], [2, "59456055", "11891211", "47564844", OPERATOR_TREASURY.devnet, "keeper records"]);
    assert.match(d.title, /20% of post-graduation LP fees/);
    const m = lpFeeLine("mainnet", null);
    assert.deepEqual([m.claims, m.treasury, m.treasuryPinned, m.source], [0, null, false, "none"]);
    assert.match(m.note, /TreasuryNotPinned/);
    const cfg = loadCopyLintConfig();
    for (const t of [d.title, d.note, m.note]) assert.equal(lintCopy(t, cfg).ok, true, t);
  });
});

describe("bound to the program builder's mirror (src/lib/burnReceipts)", () => {
  test("constants, PDAs and treasuries are the program's, not copies that can drift", () => {
    assert.equal(LOCK_FEE_BURN_BPS, PROGRAM.LOCK_FEE_BURN_BPS);
    assert.equal(LOCK_FEE_OPERATOR_BPS, PROGRAM.LOCK_FEE_OPERATOR_BPS);
    for (const c of ["mainnet", "devnet", "localnet"] as const) {
      assert.equal(LP_LOCK_PROGRAM[c], PROGRAM.LOCK_CPMM_PROGRAM_ID[c].toBase58(), c);
      assert.equal(LP_LOCK_AUTHORITY[c], PROGRAM.LOCK_CPMM_AUTHORITY[c].toBase58(), c);
      assert.equal(OPERATOR_TREASURY[c], PROGRAM.OPERATOR_TREASURY[c].equals(PublicKey.default) ? null : PROGRAM.OPERATOR_TREASURY[c].toBase58(), c);
    }
    const pid = new PublicKey(BURN_RECEIPTS_IDL.address), mint = new PublicKey("So11111111111111111111111111111111111111112");
    assert.equal(feeKeysPda(pid).toBase58(), PDA.feeKeysPda(pid).toBase58());
    assert.equal(feeKeyRecordPda(pid, mint).toBase58(), PDA.feeKeyRecordPda(pid, mint).toBase58());
    assert.equal(lockedLiquidityPda(LP_LOCK_PROGRAM.devnet, mint).toBase58(), PDA.lockedLiquidityPda("devnet", mint).toBase58());
    assert.equal(LOCK_FEES_INTERFACE.builders, "bound");
    assert.ok(BURN_RECEIPTS_IDL.instructions.some((x) => x.name === "claim_lock_fees") && BURN_RECEIPTS_IDL.instructions.some((x) => x.name === "register_fee_key"));
    assert.ok((BURN_RECEIPTS_IDL as { events?: { name: string }[] }).events?.some((e) => e.name === LOCK_FEES_INTERFACE.event));
  });
  test("the claim builder's accounts: the fee-keys PDA signs nothing, the treasury is the cluster's, the fee PDA is the coin's", () => {
    const pid = new PublicKey(BURN_RECEIPTS_IDL.address), mint = new PublicKey("So11111111111111111111111111111111111111112"), nft = feeKeysPda(pid);
    const pool = { pool: PublicKey.unique(), lpMint: PublicKey.unique(), token0Vault: PublicKey.unique(), token1Vault: PublicKey.unique() };
    const cranker = PublicKey.unique();
    const ix = claimLockFeesIx({ programId: pid, cranker, mint, feeNftMint: nft, pool, cluster: "devnet" });
    const keys = ix.keys.map((k) => k.pubkey.toBase58());
    assert.ok(keys.includes(OPERATOR_TREASURY.devnet!));
    assert.ok(keys.includes(PDA.feePda(pid, mint).toBase58()));
    assert.deepEqual(ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58()), [cranker.toBase58()]);
  });
  test("the real client reads the program's memo out of a simulation's logs", () => {
    const memo = "RAYS|lockfees|wsol=59456045|burnpool=47564836|operator=11891209|burned=0|nft=Fee1KeyNftMi|v1";
    assert.equal(lockFeesMemoFromLogs(["Program log: Instruction: ClaimLockFees", `Program log: Memo (len ${memo.length}): "${memo}"`, "Program success"]), memo);
    assert.equal(lockFeesMemoFromLogs(['Program log: Memo (len 5): "hello"']), null);
  });
});

describe("round 2 (2026-10-11): order, lockers, no-memo claims, donations, plain-word errors, pins", () => {
  test("policy 0: register_fee_key runs BEFORE register_pool; register_pool without the FeeKeyRecord is refused (FeeKeyNotRegistered)", async () => {
    const t = await launch("RAYS");
    const port = program.lockFees.port(t.mint).graduate();
    const early = await port.buildRegisterPool();
    assert.equal((await port.simulate(early.raw)).err, "FeeKeyNotRegistered");
    const r = await claimLockFeesFor(deps(), t);
    assert.deepEqual([r.outcome, port.registers, port.poolRegisters], ["skipped", 1, 1]);
    assert.ok(program.fake(t.mint).cfg.poolRegistered, "register_pool registered the pool on the coin's program");
    const order = reg.db.prepare("SELECT event_id FROM signatures WHERE mint=? ORDER BY sent_at, rowid").all(t.mint).map((x) => (x as { event_id: string }).event_id);
    assert.deepEqual(order, ["register-fee-key", "register-pool"]);
  });
  test("policy 2 (pair coins) registers the Fee Key but never register_pool; policy 1 (a fixed pool) is skipped", async () => {
    const a = await launch("RAYS"), b = await launch("LAKERS");
    const pa = program.lockFees.port(a.mint).graduate(); pa.policy = 2;
    await claimLockFeesFor(deps(), a);
    assert.deepEqual([pa.registers, pa.poolRegisters], [1, 0]);
    const pb = program.lockFees.port(b.mint).graduate(); pb.policy = 1;
    const r = await claimLockFeesFor(deps(), b);
    assert.deepEqual([r.outcome, pb.sends], ["skipped", 0]);
  });
  test("a lock whose locker is not the policy's (LockerMismatch) is an alarm, never a registration", async () => {
    const t = await launch("RAYS");
    const port = program.lockFees.port(t.mint).graduate({ locker: "SomeoneE1se111111111111111111111111111111111" });
    assert.equal(port.expectedLocker, launchLabLockerFor("devnet"));
    const r = await claimLockFeesFor(deps(), t);
    assert.equal(r.outcome, "error");
    assert.equal(alerts("lock-fee-locker").length, 1);
    assert.match(alerts("lock-fee-locker")[0].text, /not created by the expected locker/);
    assert.equal(port.sends, 0);
  });
  test("a claim with nothing claimed and nothing paid writes no memo and counts no claim; a coin-token donation alone is burned and counted", async () => {
    const t = await launch("RAYS");
    const port = program.lockFees.port(t.mint).graduate(); port.feeKeyRegistered = true; port.poolRegistered = true;
    const empty = await port.buildClaim();
    await port.send(empty.raw);
    assert.equal((await port.confirm(empty)).status, "confirmed");
    assert.deepEqual([await port.claimFacts(empty.signature), port.claims], ["none", 0]);
    port.accrue(BigInt(0), BigInt(7_000_000));
    const r = await claimLockFeesFor(deps(), t);
    assert.equal(r.outcome, "claimed");
    assert.deepEqual(reg.lockFeeClaims(t.mint).map((c) => [c.solLamports, c.tokenBurnedRaw]), [[BigInt(0), BigInt(7_000_000)]]);
    assert.equal(port.claims, 1);
  });
  test("a refusal is alerted in plain words and lands on the coin's lp.lastError", async () => {
    const t = await launch("RAYS");
    const port = program.lockFees.port(t.mint).graduate().accrue(BigInt(5)); port.feeKeyRegistered = true; port.poolRegistered = true;
    port.simErr = "FeeKeyNotRegistered";
    await claimLockFeesFor(deps(), t);
    assert.match(alerts("lock-fees-failed")[0].text, /claim_lock_fees simulation refused: FeeKeyNotRegistered: the coin's Fee Key is not registered yet/);
    const lp = await lpLockBlock(reg, program, "devnet", t.mint);
    assert.equal(lp.lastError?.error, "claim_lock_fees: FeeKeyNotRegistered");
    assert.match(lp.lastError!.sentence, /register_fee_key must run before register_pool/);
    for (const [name, e] of Object.entries(LOCK_FEE_ERRORS)) { assert.ok(lockFeeErrorSentence(name).startsWith(`${name}: `)); assert.equal(lintCopy(e.sentence, loadCopyLintConfig()).ok, true, name); }
    assert.match(lockFeeErrorSentence("custom program error: 0x17bb"), /^LockerMismatch/, "6075 in hex");
  });
  test("register_fee_key's policy-0 pool: the LaunchLab migration pool PDA (cpConfigId + mints in byte order); the builders carry the round-2 accounts", () => {
    const cfg = PublicKey.unique(), mint = PublicKey.unique(), WSOL = new PublicKey("So11111111111111111111111111111111111111112");
    const [t0, t1] = Buffer.compare(mint.toBuffer(), WSOL.toBuffer()) < 0 ? [mint, WSOL] : [WSOL, mint];
    assert.equal(PDA.cpmmPoolPda(PROGRAM.CPMM_PROGRAM_ID.devnet, cfg, WSOL, mint).toBase58(), PublicKey.findProgramAddressSync([Buffer.from("pool"), cfg.toBuffer(), t0.toBuffer(), t1.toBuffer()], PROGRAM.CPMM_PROGRAM_ID.devnet)[0].toBase58());
    const pid = new PublicKey(BURN_RECEIPTS_IDL.address);
    const rp = registerPoolIx({ programId: pid, registrar: PublicKey.unique(), mint, pool: PublicKey.unique(), lpMint: PublicKey.unique(), cluster: "devnet" });
    assert.ok(rp.keys.some((k) => k.pubkey.equals(PDA.feeKeyRecordPda(pid, mint))), "policy 0: register_pool passes the FeeKeyRecord");
    const claim = claimLockFeesIx({ programId: pid, cranker: PublicKey.unique(), mint, feeNftMint: PublicKey.unique(), pool: { pool: PublicKey.unique(), lpMint: PublicKey.unique(), token0Vault: PublicKey.unique(), token1Vault: PublicKey.unique() }, cluster: "devnet" });
    assert.equal(claim.data.length, 8, "claim_lock_fees has no arguments");
    for (const c of ["mainnet", "devnet"] as const) assert.equal(PROGRAM.LAUNCHLAB_VAULT_AUTH[c].toBase58(), PDA.launchlabMigrationLocker(PROGRAM.LAUNCHLAB_PROGRAM_ID[c]).toBase58(), c);
  });
  test("pins: the platform compiled per cluster, the policy block never has a null fee-keys PDA", () => {
    assert.equal(BURNTICKER_PLATFORM.devnet, "GvSKpe5pwLuRzCQ56EGAA1urjtcxx554NivsGHexv3tf");
    assert.equal(BURNTICKER_PLATFORM.mainnet, null);
    const d = lpLockPolicyJson("devnet", null), m = lpLockPolicyJson("mainnet", null);
    assert.equal(d.feeKeysPda, feeKeysPda(BURN_RECEIPTS_IDL.address).toBase58(), "derived from the IDL's program id when none is configured");
    assert.deepEqual([d.platformPinned, d.platform, m.platformPinned, m.platform], [true, "GvSKpe5pwLuRzCQ56EGAA1urjtcxx554NivsGHexv3tf", false, null]);
    assert.deepEqual([d.launchLabLocker, m.launchLabLocker], ["5xqNaZXX5eUi4p5HU4oz9i5QnwRNT2y6oN7yyn4qENeq", "WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh"]);
  });
});
