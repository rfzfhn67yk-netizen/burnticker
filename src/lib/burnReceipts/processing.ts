import { type ParsedTransactionWithMeta, PublicKey } from "@solana/web3.js";
import { bs58decode, memoFromTransaction } from "@/lib/burnReceipts/crank";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { readingPda } from "@/lib/burnReceipts/pda";

/**
 * THE PROCESSING INSTRUCTIONS (audit 7 F05, 2026-10-19): the burn program's instructions that PROCESS one reading (set its `processed`
 * flag and write its outcome). One list for everything that recognises a processed reading on chain: the keeper's adapter
 * (programAdapter.ts findCrankTx), the reconciler / adoption path in multiKeeper.ts (step 3, "adopt"), and any audit script that matches
 * cranks by log name. Before this list the adapter matched CrankBuyback / CrankVault / CrankNoUnits / ForwardToWinner by a log regex and
 * missed crank_target_burn (round 5), so a target burn cranked by someone else, or one whose write-ahead signature was lost, was never
 * adopted and the keeper kept waiting.
 *
 * Not in the list: crank_carried spends carried lamports without a reading (no record_date, no Reading account), and forward_on_end /
 * burn_sol_on_end act on the rule's end, not on a reading. Adoption looks for the transaction that processed reading D, so none of these
 * can be that transaction.
 *
 * `readingAccount` names the IDL account that holds the processed Reading (forward_to_winner's is the loser's reading).
 */
export const PROCESSING_INSTRUCTIONS = [
  { name: "crank_buyback", logName: "CrankBuyback", readingAccount: "reading", forwards: false },
  { name: "crank_vault", logName: "CrankVault", readingAccount: "reading", forwards: false },
  { name: "crank_no_units", logName: "CrankNoUnits", readingAccount: "reading", forwards: false },
  { name: "crank_target_burn", logName: "CrankTargetBurn", readingAccount: "reading", forwards: false },
  { name: "forward_to_winner", logName: "ForwardToWinner", readingAccount: "loser_reading", forwards: true },
] as const;

export type ProcessingInstructionName = (typeof PROCESSING_INSTRUCTIONS)[number]["name"];

/** The Anchor log names ("Program log: Instruction: <name>") of the processing instructions. */
export const PROCESSING_LOG_NAMES: readonly string[] = PROCESSING_INSTRUCTIONS.map((p) => p.logName);

/** True for an Anchor instruction log line of a processing instruction. Log text alone never binds a program or a date. */
export const isProcessingLog = (line: string): boolean => {
  const m = /^Program log: Instruction: (\w+)$/.exec(line);
  return !!m && PROCESSING_LOG_NAMES.includes(m[1]);
};

interface Resolved { name: ProcessingInstructionName; forwards: boolean; discriminator: Buffer; readingIndex: number; recordDateOffset: number }

/** Resolved against the IDL once: a processing instruction the IDL lacks, or one without a u32 record_date first, fails at load. */
const RESOLVED: readonly Resolved[] = PROCESSING_INSTRUCTIONS.map((p) => {
  const ix = BURN_RECEIPTS_IDL.instructions.find((i) => i.name === p.name);
  if (!ix) throw new Error(`processing instruction ${p.name} is not in the burn program's IDL`);
  const readingIndex = ix.accounts.findIndex((a) => a.name === p.readingAccount);
  if (readingIndex < 0) throw new Error(`${p.name}: the IDL has no ${p.readingAccount} account`);
  if (ix.args[0]?.name !== "record_date" || ix.args[0].type !== "u32") throw new Error(`${p.name}: the first argument is not record_date: u32`);
  return { name: p.name, forwards: p.forwards, discriminator: Buffer.from(ix.discriminator), readingIndex, recordDateOffset: 8 };
});

/** One instruction as getParsedTransaction returns an unparsed program's (PartiallyDecodedInstruction). */
export interface RawProgramInstruction { programId: PublicKey; accounts?: readonly PublicKey[]; data?: string }

/**
 * The processing instruction `ix` is, when it is one of THIS program's, carries `recordDate` as its record_date argument and names
 * `reading` (this reading's address) in the Reading slot; otherwise null. A crank for another reading, another program's instruction with
 * the same name, or a transaction that merely touches the Reading account is not a match.
 */
export function matchProcessingInstruction(ix: RawProgramInstruction, programId: PublicKey, recordDate: number, reading: PublicKey): { name: ProcessingInstructionName; forwards: boolean } | null {
  if (!ix.programId.equals(programId) || typeof ix.data !== "string" || !ix.accounts) return null;
  let data: Buffer;
  try { data = bs58decode(ix.data); } catch { return null; }
  for (const r of RESOLVED) {
    if (data.length < r.recordDateOffset + 4 || !data.subarray(0, 8).equals(r.discriminator)) continue;
    if (data.readUInt32LE(r.recordDateOffset) !== recordDate) return null;
    const acct = ix.accounts[r.readingIndex];
    return acct && acct.equals(reading) ? { name: r.name, forwards: r.forwards } : null;
  }
  return null;
}

/** Every instruction of a parsed transaction, top level first, then inner (a crank wrapped by another program's CPI still counts). */
function instructionsOf(tx: ParsedTransactionWithMeta): RawProgramInstruction[] {
  const top = tx.transaction.message.instructions as unknown as RawProgramInstruction[];
  const inner = (tx.meta?.innerInstructions ?? []).flatMap((g) => g.instructions as unknown as RawProgramInstruction[]);
  return [...top, ...inner];
}

/** The processing instruction in `tx` for this program and reading date, or null (failed transactions never match). */
export function processingInstructionIn(tx: ParsedTransactionWithMeta | null | undefined, programId: PublicKey, config: PublicKey, recordDate: number): { name: ProcessingInstructionName; forwards: boolean } | null {
  if (!tx?.meta || tx.meta.err) return null;
  const reading = readingPda(programId, config, recordDate);
  for (const ix of instructionsOf(tx)) {
    const m = matchProcessingInstruction(ix, programId, recordDate, reading);
    if (m) return m;
  }
  return null;
}

/** The two RPC reads discovery needs (web3.js Connection has both). */
export interface ProcessingRpc {
  getSignaturesForAddress(address: PublicKey, o: { limit?: number }, commitment?: "confirmed"): Promise<readonly { signature: string; slot?: number | null; err: unknown }[]>;
  getParsedTransaction(signature: string, o: { commitment: "confirmed"; maxSupportedTransactionVersion: number }): Promise<ParsedTransactionWithMeta | null>;
}

export interface ProcessingTx { signature: string; slot: number | null; memo: string | null; instruction: ProcessingInstructionName; forwards: boolean }

/**
 * The confirmed transaction that processed reading `recordDate` of the coin whose TokenConfig is `config`, under `programId` — anyone's
 * (cranking is permissionless) — or null. Searched among the Reading account's latest signatures; a transaction counts only when it
 * carries one of PROCESSING_INSTRUCTIONS of this program for this date and this Reading. The memo is the program's own Memo CPI for
 * that date (memoFromTransaction), never log text.
 */
export async function findProcessingTx(rpc: ProcessingRpc, o: { programId: PublicKey; config: PublicKey; recordDate: number; limit?: number }): Promise<ProcessingTx | null> {
  const sigs = await rpc.getSignaturesForAddress(readingPda(o.programId, o.config, o.recordDate), { limit: o.limit ?? 25 }, "confirmed");
  for (const s of sigs) {
    if (s.err !== null && s.err !== undefined) continue;
    const t = await rpc.getParsedTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 1 });
    const m = processingInstructionIn(t, o.programId, o.config, o.recordDate);
    if (m) return { signature: s.signature, slot: s.slot ?? null, memo: memoFromTransaction(t, o.programId, o.recordDate), instruction: m.name, forwards: m.forwards };
  }
  return null;
}
