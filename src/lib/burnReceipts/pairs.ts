import crypto from "node:crypto";
import { type Connection, PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, type TransactionInstruction } from "@solana/web3.js";
import { ed25519SharedMessageInstruction, signAttestation } from "@/lib/burnReceipts/attestation";
import { MEMO_PROGRAM_ID, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@/lib/burnReceipts/constants";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { decodeAccount } from "@/lib/burnReceipts/idlCoder";
import { burnTargetPda } from "@/lib/burnReceipts/burnTarget";
import { buildIx } from "@/lib/burnReceipts/instructions";
import { formatDate, validDate } from "@/lib/burnReceipts/math";
import { associatedTokenAddress, configPda, feePda, pairLinkPda, pairOrder, pairResultPda, readingPda } from "@/lib/burnReceipts/pda";

/**
 * LAUNCHPAD-PATH §40 — WINNER TAKES THE BURN (owner decision 2026-10-11). The low-level client for the program side:
 *
 *   PairLink   ["pair_link", mint]                               the coin's one partner (TokenConfig.pair_state says 0 / 1 / 2 / 3)
 *   PairResult ["pair_result", mint_lo, mint_hi, record_date LE] one period's winner (Pubkey.default = draw), signed by a quorum of
 *                                                                EACH coin's attesters over pairResultMessage()
 *   link_pair            the pair_curve Pair is the witness (policy 2; register_pair_pool requires it)
 *   submit_pair_result   the dated result
 *   forward_to_winner    the loser's fuel for the period → the winner's fee PDA (exact formula: the loser's buyback_spend)
 *   crank_buyback        a paired coin passes its PairLink + the period's PairResult (crankBuybackIx `partner`)
 *   unlink_pair          terminal on-chain evidence only (r3): Pair voided / a side refunding / a LaunchLab voidBy ended
 *   apply_paired_attester_change   a paired coin's attester change, co-signed by the partner's quorum (r3 M-1)
 *
 * Round 3 (2026-10-11): both coins of a pair share ONE attester set and quorum (pairing refuses otherwise) and every result needs both
 * quorums (= one set of signatures); a LaunchLab pair carries its locked voidBy on both coins (initializeTokenIx `pairVoidBy`);
 * periods already read when the coins paired stay unpaired (TokenConfig.pair_after_date); forward_to_winner is refused after the 72 h
 * time-out; its basis leaves the loser's carried spend.
 *
 * Every constant below is read from the IDL (the program's `#[constant]`s) so this file and the program cannot drift.
 */

function idlConstant(name: string): string {
  const c = (BURN_RECEIPTS_IDL as { constants?: { name: string; value: string }[] }).constants?.find((k) => k.name === name);
  if (!c) throw new Error(`burnReceipts IDL has no constant ${name} (re-sync the IDL)`);
  return c.value;
}
const num = (name: string): number => Number(idlConstant(name));
const seed = (name: string): Buffer => Buffer.from(JSON.parse(idlConstant(name)) as number[]);

export const PAIR_STATE_NONE = num("PAIR_STATE_NONE");
export const PAIR_STATE_PROVISIONAL = num("PAIR_STATE_PROVISIONAL");
export const PAIR_STATE_PAIRED = num("PAIR_STATE_PAIRED");
export const PAIR_WITNESS_INITIALIZE = num("PAIR_WITNESS_INITIALIZE");
export const PAIR_WITNESS_PAIR_CURVE = num("PAIR_WITNESS_PAIR_CURVE");
/** The partner's initialize_token must name this coin within this many seconds, or the coin stays plain for good. */
export const PAIRING_WINDOW_SECS = num("PAIRING_WINDOW_SECS");
/** A paired coin's crank waits this long after a reading for the period's result; then it burns as if unpaired. */
export const PAIR_RESULT_GRACE_SECS = num("PAIR_RESULT_GRACE_SECS");
export const PAIR_ATTESTATION_DOMAIN = JSON.parse(idlConstant("PAIR_ATTESTATION_DOMAIN")) as string;
/** The per-coin view of a PairResult (pairResultFor). */
export const PAIR_RESULT_NONE = num("PAIR_RESULT_NONE");
export const PAIR_RESULT_WON = num("PAIR_RESULT_WON");
export const PAIR_RESULT_LOST = num("PAIR_RESULT_LOST");
export const PAIR_RESULT_DRAW = num("PAIR_RESULT_DRAW");
/** Reading.outcome after forward_to_winner. */
export const OUTCOME_FORWARDED = num("OUTCOME_FORWARDED");
/** r3: unpaired by unlink_pair (a plain coin again; a policy-2 coin still registers its pool). */
export const PAIR_STATE_UNLINKED = num("PAIR_STATE_UNLINKED");
/** PairUnlinked.reason — terminal evidence only (r3): the Pair is Voided / a side is refunding / a LaunchLab voidBy ended without both pools. */
export const UNLINK_PAIR_VOIDED = num("UNLINK_PAIR_VOIDED");
export const UNLINK_SIDE_REFUNDING = num("UNLINK_SIDE_REFUNDING");
export const UNLINK_VOID_BY_PASSED = num("UNLINK_VOID_BY_PASSED");
/**
 * @deprecated r3 RN-1/RN-2: "no verified pool 30 days after pairing" is NO LONGER evidence — the program refuses it (PairStillLive).
 * Kept (no longer in the IDL) only so older callers compile; PairUnlinked.reason 2 appears only in r2-era history. Remove usages.
 */
export const UNLINK_NOT_LIVE = 2;
/** @deprecated r3: see UNLINK_NOT_LIVE — the program has no time-based unlink evidence any more. */
export const PAIR_UNLINK_NOT_LIVE_SECS = 30 * 24 * 60 * 60;
/** The domain of the partner's co-signature over a paired coin's attester change (pairAttesterChangeMessage). */
export const PAIR_ATTESTER_CHANGE_DOMAIN = JSON.parse(idlConstant("PAIR_ATTESTER_CHANGE_DOMAIN")) as string;
export const SEED_PAIR_LINK = seed("PAIR_LINK_SEED");
export const SEED_PAIR_RESULT = seed("PAIR_RESULT_SEED");

// ---------------------------------------------------------------------------------------------------------------------------------
// addresses
// ---------------------------------------------------------------------------------------------------------------------------------

export { pairLinkPda, pairOrder, pairResultPda } from "@/lib/burnReceipts/pda";

// ---------------------------------------------------------------------------------------------------------------------------------
// accounts
// ---------------------------------------------------------------------------------------------------------------------------------

export interface PairLinkAccount {
  version: number; bump: number; mint: PublicKey; pair_mint: PublicKey; paired: boolean; witness: number;
  created_at: bigint; pairing_deadline: bigint; paired_at: bigint;
  /** The pair's common attester-set hash at pairing (r3: equal on both links; zero for links written before r2); after a co-signed
   *  apply_paired_attester_change, this coin's new set. */
  attester_set_hash: Uint8Array;
}

export interface PairResultAccount {
  version: number; bump: number; mint_lo: PublicKey; mint_hi: PublicKey; record_date: number;
  /** Pubkey.default = a draw. */
  winner: PublicKey;
  signers_mask_lo: number; signers_mask_hi: number; source_url_hash: Uint8Array; proof_hash: Uint8Array; submitted_at: bigint;
  forwarded: boolean; forwarded_lamports: bigint; forwarded_at: bigint;
}

export function decodePairLink(data: Buffer | Uint8Array): PairLinkAccount {
  return decodeAccount<PairLinkAccount>(BURN_RECEIPTS_IDL, "PairLink", data);
}

export function decodePairResult(data: Buffer | Uint8Array): PairResultAccount {
  return decodeAccount<PairResultAccount>(BURN_RECEIPTS_IDL, "PairResult", data);
}

/** The coin's view of a result: PAIR_RESULT_WON / _LOST / _DRAW, or _NONE when there is no result or the mint is not in it. */
export function pairResultFor(r: PairResultAccount | null, mint: PublicKey): number {
  if (!r || (!mint.equals(r.mint_lo) && !mint.equals(r.mint_hi))) return PAIR_RESULT_NONE;
  if (r.winner.equals(PublicKey.default)) return PAIR_RESULT_DRAW;
  return r.winner.equals(mint) ? PAIR_RESULT_WON : PAIR_RESULT_LOST;
}

export async function fetchPairLink(connection: Connection, programId: PublicKey, mint: PublicKey): Promise<PairLinkAccount | null> {
  const info = await connection.getAccountInfo(pairLinkPda(programId, mint), "confirmed");
  return info && info.data.length > 0 ? decodePairLink(info.data) : null;
}

export async function fetchPairResult(connection: Connection, programId: PublicKey, a: PublicKey, b: PublicKey, recordDate: number): Promise<PairResultAccount | null> {
  const info = await connection.getAccountInfo(pairResultPda(programId, a, b, recordDate), "confirmed");
  return info && info.data.length > 0 ? decodePairResult(info.data) : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// attester sets (r3 M-1)
// ---------------------------------------------------------------------------------------------------------------------------------

const PAIR_ATTESTERS_DOMAIN = Buffer.from("BURNRECEIPTS-PAIR-ATTESTERS-v1", "utf8");

/** sha256("BURNRECEIPTS-PAIR-ATTESTERS-v1" ‖ quorum ‖ (kind ‖ key)…) — program pair::set_hash. Order matters: same keys, same order. */
export function pairSetHash(quorum: number, attesters: { kind: number; key: PublicKey }[]): Buffer {
  const parts = Buffer.concat([Buffer.from([quorum]), ...attesters.map((a) => Buffer.concat([Buffer.from([a.kind]), a.key.toBuffer()]))]);
  return crypto.createHash("sha256").update(PAIR_ATTESTERS_DOMAIN).update(parts).digest();
}

/** A config's CURRENT attester-set hash (program pair::attester_set_hash). Pairing needs the two coins' hashes equal. */
export function attesterSetHash(c: { quorum: number; attesters: { kind: number; key: PublicKey }[]; attester_count: number }): Buffer {
  return pairSetHash(c.quorum, c.attesters.slice(0, c.attester_count));
}

/**
 * What the PARTNER's quorum signs to let a paired coin apply its pending attester change (attest.rs
 * canonical_pair_attester_change_message): `BURNRECEIPTS-PAIR-ATTESTER-CHANGE-v1|<genesis>|<program>|<mint>|<partner>|set=<hex>|eta=<unix>`,
 * set = pairSetHash(pending_quorum, pending attesters).
 */
export function pairAttesterChangeMessage(genesisHash: string | PublicKey, programId: PublicKey, mint: PublicKey, partner: PublicKey, pendingSetHash: Uint8Array, eta: bigint | number): Buffer {
  if (pendingSetHash.length !== 32) throw new Error("pending set hash must be 32 bytes");
  const genesis = typeof genesisHash === "string" ? new PublicKey(genesisHash).toBase58() : genesisHash.toBase58();
  return Buffer.from(`${PAIR_ATTESTER_CHANGE_DOMAIN}|${genesis}|${programId.toBase58()}|${mint.toBase58()}|${partner.toBase58()}|set=${Buffer.from(pendingSetHash).toString("hex")}|eta=${eta.toString()}`, "utf8");
}

// ---------------------------------------------------------------------------------------------------------------------------------
// the signed message
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * The bytes a quorum of EACH coin's attesters signs — r3: one common set, so one set of signatures (attest.rs canonical_pair_message):
 *   BURNRECEIPTS-PAIR-v1|<cluster genesis>|<program id>|<mint_lo>|<mint_hi>|<YYYY-MM-DD>|winner=<mint or "draw">|src=<hex>|proof=<hex>
 * `genesisHash` = the TokenConfigs' `cluster_genesis` (both coins of a pair share the build). `winner` null = draw. Pack it with
 * ed25519SharedMessageInstruction (attestation.ts) before submitPairResultIx in the same transaction.
 */
export function pairResultMessage(genesisHash: string | PublicKey, programId: PublicKey, a: PublicKey, b: PublicKey, recordDate: number, winner: PublicKey | null, srcHash: Uint8Array, proofHash: Uint8Array = new Uint8Array(32)): Buffer {
  if (!validDate(recordDate)) throw new Error(`record_date ${recordDate} is not a YYYYMMDD calendar date`);
  if (srcHash.length !== 32 || Buffer.from(srcHash).equals(Buffer.alloc(32))) throw new Error("source_url_hash must be a non-zero sha256");
  if (proofHash.length !== 32) throw new Error("proof_hash must be 32 bytes");
  const [lo, hi] = pairOrder(a, b);
  if (winner && !winner.equals(lo) && !winner.equals(hi)) throw new Error("the winner must be one of the two mints (null = draw)");
  const genesis = typeof genesisHash === "string" ? new PublicKey(genesisHash).toBase58() : genesisHash.toBase58();
  const hex = (x: Uint8Array) => Buffer.from(x).toString("hex");
  const w = winner && !winner.equals(PublicKey.default) ? winner.toBase58() : "draw";
  return Buffer.from(`${PAIR_ATTESTATION_DOMAIN}|${genesis}|${programId.toBase58()}|${lo.toBase58()}|${hi.toBase58()}|${formatDate(recordDate)}|winner=${w}|src=${hex(srcHash)}|proof=${hex(proofHash)}`, "utf8");
}

/**
 * Signs the pair message with each attester key (64-byte Solana secret keys of DATA keys) and packs ONE Ed25519SigVerify instruction
 * (shared message) to place before submitPairResultIx. Each key counts for whichever coin's attester set holds it (the program needs
 * a quorum of EACH coin's set — r3: both coins share one set, so the common quorum signs once; on Burnticker that is the operator
 * keeper key alone, quorum 1). One signature with the readings fits a legacy transaction; two need v0 + a lookup table.
 */
export function attestPairResult(o: { genesisHash: string | PublicKey; programId: PublicKey; mintA: PublicKey; mintB: PublicKey; recordDate: number; winner: PublicKey | null; sourceUrlHash: Uint8Array; proofHash?: Uint8Array; signers: { publicKey: PublicKey; secretKey: Uint8Array }[] }): { message: Buffer; instruction: TransactionInstruction } {
  const message = pairResultMessage(o.genesisHash, o.programId, o.mintA, o.mintB, o.recordDate, o.winner, o.sourceUrlHash, o.proofHash);
  const signatures = o.signers.map((s) => ({ publicKey: s.publicKey, signature: signAttestation(s.secretKey, message) }));
  return { message, instruction: ed25519SharedMessageInstruction(message, signatures) };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// instructions
// ---------------------------------------------------------------------------------------------------------------------------------

/** link_pair — `pair` is the pair_curve Pair, `mintA` / `mintB` its mints[0] / mints[1]. Permissionless, idempotent. */
export function linkPairIx(o: { programId: PublicKey; payer: PublicKey; pair: PublicKey; mintA: PublicKey; mintB: PublicKey }): TransactionInstruction {
  return buildIx(o.programId, "link_pair", {
    payer: o.payer,
    pair: o.pair,
    config_a: configPda(o.programId, o.mintA),
    config_b: configPda(o.programId, o.mintB),
    link_a: pairLinkPda(o.programId, o.mintA),
    link_b: pairLinkPda(o.programId, o.mintB),
    system_program: SystemProgram.programId,
  }, {});
}

/**
 * submit_pair_result — mints in any order (sorted here). `winner` null = draw.
 * r2: a WIN carries both coins' readings for the date (reading_lo / reading_hi; the program requires both to exist and the loser's
 * to be unprocessed — pools are NOT required: a side without a verified pool makes the forward a 0-lamport FORWARDED, so the loser
 * keeps its fuel instead of burning a period it lost; never post a fallback draw for that); a DRAW omits the readings.
 * r3 M-1: EVERY result needs both coins' quorums — one common set, so the same signatures. Dates on or after the pairing day and
 * after TokenConfig.pair_after_date (PairPeriodUnpaired otherwise). */
export function submitPairResultIx(o: { programId: PublicKey; payer: PublicKey; mintA: PublicKey; mintB: PublicKey; recordDate: number; winner: PublicKey | null; sourceUrlHash: Uint8Array; proofHash?: Uint8Array }): TransactionInstruction {
  const [lo, hi] = pairOrder(o.mintA, o.mintB);
  const readings: Record<string, PublicKey> = o.winner && !o.winner.equals(PublicKey.default)
    ? { reading_lo: readingPda(o.programId, configPda(o.programId, lo), o.recordDate), reading_hi: readingPda(o.programId, configPda(o.programId, hi), o.recordDate) }
    : {};
  return buildIx(o.programId, "submit_pair_result", {
    payer: o.payer,
    config_lo: configPda(o.programId, lo),
    config_hi: configPda(o.programId, hi),
    link_lo: pairLinkPda(o.programId, lo),
    link_hi: pairLinkPda(o.programId, hi),
    pair_result: pairResultPda(o.programId, lo, hi, o.recordDate),
    system_program: SystemProgram.programId,
    ...readings,
  }, {
    record_date: o.recordDate,
    winner: o.winner ?? PublicKey.default,
    source_url_hash: o.sourceUrlHash,
    proof_hash: o.proofHash ?? new Uint8Array(32),
  });
}

/**
 * forward_to_winner — the loser's fuel for `recordDate` → the winner's fee PDA. Permissionless (the cranker allowlist was removed 2026-10-25).
 * r3: refused (ForwardWindowClosed) once PAIR_RESULT_GRACE_SECS have passed since the loser's reading was submitted — the period then
 * belongs to the loser's own crank; the basis leaves the loser's carried_spend_lamports.
 */
export function forwardToWinnerIx(o: { programId: PublicKey; cranker: PublicKey; loserMint: PublicKey; winnerMint: PublicKey; recordDate: number }): TransactionInstruction {
  // r2 H-1(b): no winner_reading account; a dead side (no verified pool) forwards 0 lamports but still processes the loser's reading.
  const [lc, wc] = [configPda(o.programId, o.loserMint), configPda(o.programId, o.winnerMint)];
  const [lf, wf] = [feePda(o.programId, o.loserMint), feePda(o.programId, o.winnerMint)];
  return buildIx(o.programId, "forward_to_winner", {
    cranker: o.cranker,
    loser_config: lc,
    loser_fee_vault: lf,
    loser_fee_wsol: associatedTokenAddress(lf, NATIVE_MINT),
    loser_reading: readingPda(o.programId, lc, o.recordDate),
    winner_config: wc,
    winner_fee_vault: wf,
    winner_fee_wsol: associatedTokenAddress(wf, NATIVE_MINT),
    pair_result: pairResultPda(o.programId, o.loserMint, o.winnerMint, o.recordDate),
    token_program: TOKEN_PROGRAM_ID,
    system_program: SystemProgram.programId,
    memo_program: MEMO_PROGRAM_ID,
    // round-5 review R5-9: each side's BurnTarget (read only for a target coin without its own verified pool; always passed)
    loser_burn_target: burnTargetPda(o.programId, o.loserMint),
    winner_burn_target: burnTargetPda(o.programId, o.winnerMint),
  }, { record_date: o.recordDate });
}

/**
 * unlink_pair — permissionless, on TERMINAL on-chain evidence only (r3 RN-1/RN-2): a pair_curve pair (either coin policy 2) needs
 * `pair` = its Pair, Voided or with a refunding side (never while Open, or Graduating without a refunding side); a LaunchLab pair needs
 * its locked voidBy day (TokenConfig.pair_void_by) to have ended, UTC, with a coin still lacking a verified pool. Both coins become
 * PAIR_STATE_UNLINKED (pair_unlinked_at); both PairLinks close (rent to each coin's fee PDA).
 */
export function unlinkPairIx(o: { programId: PublicKey; cranker: PublicKey; mintA: PublicKey; mintB: PublicKey; pair?: PublicKey }): TransactionInstruction {
  return buildIx(o.programId, "unlink_pair", {
    cranker: o.cranker,
    config_a: configPda(o.programId, o.mintA),
    config_b: configPda(o.programId, o.mintB),
    link_a: pairLinkPda(o.programId, o.mintA),
    link_b: pairLinkPda(o.programId, o.mintB),
    fee_a: feePda(o.programId, o.mintA),
    fee_b: feePda(o.programId, o.mintB),
    ...(o.pair ? { pair: o.pair } : {}),
  }, {});
}

/**
 * apply_paired_attester_change (r3 M-1) — permissionless after the 48 h timelock: a PAIRED coin's pending attester change, with a
 * quorum of the PARTNER's attesters signing pairAttesterChangeMessage (pack with ed25519SharedMessageInstruction, same transaction).
 * apply_attester_change refuses a paired coin (PairedAttesterChange).
 */
export function applyPairedAttesterChangeIx(o: { programId: PublicKey; caller: PublicKey; mint: PublicKey; partnerMint: PublicKey }): TransactionInstruction {
  return buildIx(o.programId, "apply_paired_attester_change", {
    caller: o.caller,
    config: configPda(o.programId, o.mint),
    link: pairLinkPda(o.programId, o.mint),
    partner_config: configPda(o.programId, o.partnerMint),
    // re-check P3-2: the same set lands on the partner too, and its PairLink records it
    partner_link: pairLinkPda(o.programId, o.partnerMint),
    instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
  }, {});
}

/** The forward receipt memo: `<PREFIX>|forward|from=<12>|to=<12>|period=<YYYY-MM-DD>|lamports=N|v1`. */
export function parseForwardMemo(memo: string): { prefix: string; from12: string; to12: string; period: string; lamports: bigint } | null {
  const m = /^([A-Z0-9]{2,12})\|forward\|from=([1-9A-HJ-NP-Za-km-z]{1,12})\|to=([1-9A-HJ-NP-Za-km-z]{1,12})\|period=(\d{4}-\d{2}-\d{2})\|lamports=(\d+)\|v1$/.exec(memo.trim());
  return m ? { prefix: m[1], from12: m[2], to12: m[3], period: m[4], lamports: BigInt(m[5]) } : null;
}
