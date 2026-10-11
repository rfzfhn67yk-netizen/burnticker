import { type Connection, PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import { ed25519SharedMessageInstruction, signAttestation } from "@/lib/burnReceipts/attestation";
import { MEMO_PROGRAM_ID, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@/lib/burnReceipts/constants";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { decodeAccount } from "@/lib/burnReceipts/idlCoder";
import { buildIx } from "@/lib/burnReceipts/instructions";
import { formatDate, validDate } from "@/lib/burnReceipts/math";
import { associatedTokenAddress, configPda, feePda, pairLinkPda, pairOrder, pairResultPda, readingPda } from "@/lib/burnReceipts/pda";

/**
 * LAUNCHPAD-PATH §40 — WINNER TAKES THE BURN (owner decision 2026-10-11). The low-level client for the program side:
 *
 *   PairLink   ["pair_link", mint]                               the coin's one partner (TokenConfig.pair_state says 0 / 1 / 2)
 *   PairResult ["pair_result", mint_lo, mint_hi, record_date LE] one period's winner (Pubkey.default = draw), signed by a quorum of
 *                                                                EACH coin's attesters over pairResultMessage()
 *   link_pair            the pair_curve Pair is the witness (policy 2; register_pair_pool requires it)
 *   submit_pair_result   the dated result
 *   forward_to_winner    the loser's fuel for the period → the winner's fee PDA (exact formula: the loser's buyback_spend)
 *   crank_buyback        a paired coin passes its PairLink + the period's PairResult (crankBuybackIx `partner`)
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
// the signed message
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * The bytes a quorum of EACH coin's attesters signs (program: attest.rs canonical_pair_message):
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
 * a quorum of EACH coin's set; on devnet the keeper key is both coins' attester). Two signatures fit a legacy transaction.
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

/** submit_pair_result — mints in any order (sorted here). `winner` null = draw. */
export function submitPairResultIx(o: { programId: PublicKey; payer: PublicKey; mintA: PublicKey; mintB: PublicKey; recordDate: number; winner: PublicKey | null; sourceUrlHash: Uint8Array; proofHash?: Uint8Array }): TransactionInstruction {
  const [lo, hi] = pairOrder(o.mintA, o.mintB);
  return buildIx(o.programId, "submit_pair_result", {
    payer: o.payer,
    config_lo: configPda(o.programId, lo),
    config_hi: configPda(o.programId, hi),
    link_lo: pairLinkPda(o.programId, lo),
    link_hi: pairLinkPda(o.programId, hi),
    pair_result: pairResultPda(o.programId, lo, hi, o.recordDate),
    system_program: SystemProgram.programId,
  }, {
    record_date: o.recordDate,
    winner: o.winner ?? PublicKey.default,
    source_url_hash: o.sourceUrlHash,
    proof_hash: o.proofHash ?? new Uint8Array(32),
  });
}

/** forward_to_winner — the loser's fuel for `recordDate` → the winner's fee PDA. Permissionless (cranker allowlist during the cap). */
export function forwardToWinnerIx(o: { programId: PublicKey; cranker: PublicKey; loserMint: PublicKey; winnerMint: PublicKey; recordDate: number }): TransactionInstruction {
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
    winner_reading: readingPda(o.programId, wc, o.recordDate),
    pair_result: pairResultPda(o.programId, o.loserMint, o.winnerMint, o.recordDate),
    token_program: TOKEN_PROGRAM_ID,
    system_program: SystemProgram.programId,
    memo_program: MEMO_PROGRAM_ID,
  }, { record_date: o.recordDate });
}

/** The forward receipt memo: `<PREFIX>|forward|from=<12>|to=<12>|period=<YYYY-MM-DD>|lamports=N|v1`. */
export function parseForwardMemo(memo: string): { prefix: string; from12: string; to12: string; period: string; lamports: bigint } | null {
  const m = /^([A-Z0-9]{2,12})\|forward\|from=([1-9A-HJ-NP-Za-km-z]{1,12})\|to=([1-9A-HJ-NP-Za-km-z]{1,12})\|period=(\d{4}-\d{2}-\d{2})\|lamports=(\d+)\|v1$/.exec(memo.trim());
  return m ? { prefix: m[1], from12: m[2], to12: m[3], period: m[4], lamports: BigInt(m[5]) } : null;
}
