import { type Connection, PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, type TransactionInstruction } from "@solana/web3.js";
import { fetchTokenConfig, type TokenConfigAccount } from "@/lib/burnReceipts/accounts";
import { ed25519SharedMessageInstruction, signAttestation } from "@/lib/burnReceipts/attestation";
import { type Cluster, MEMO_PROGRAM_ID, MODE_BUYBACK, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@/lib/burnReceipts/constants";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { decodeAccount } from "@/lib/burnReceipts/idlCoder";
import { buildIx, createAtaIdempotentIx } from "@/lib/burnReceipts/instructions";
import { formatDate, validDate } from "@/lib/burnReceipts/math";
import { fetchPairLink, fetchPairResult, PAIR_STATE_PAIRED, pairLinkPda, pairResultPda } from "@/lib/burnReceipts/pairs";
import { associatedTokenAddress, configPda, endSinkPda, feePda, platformPda, ruleEndPda } from "@/lib/burnReceipts/pda";

/**
 * LAUNCHPAD-PATH §45 — END-OF-RULE FUEL GOES TO A SINK, NOT A SELF-BURN (owner decision 2026-10-11). The low-level client:
 *
 *   EndSink ["end_sink", mint]   pinned at initialize_token (initializeTokenIx `endSink`); never changed
 *   RuleEnd ["rule_end", mint]   submit_rule_end — a quorum of the coin's attesters signs ruleEndMessage(); outcome resolved | void
 *   forward_on_end               after a RESOLVED end: the remaining fuel (and later trickle) → the sink's fee PDA; the program decides
 *                                the destination (planForwardOnEnd mirrors it)
 *
 * After a RESOLVED end no reading dated later than the end can be submitted (RuleEnded) or cranked (ForwardOnEndRequired). A VOID
 * end keeps the hashed wind-down. A coin without an EndSink (launched before §45) cannot end on chain.
 * Every constant is read from the IDL (the program's `#[constant]`s) except the flagship, which is compiled per cluster.
 */

function idlConstant(name: string): string {
  const c = (BURN_RECEIPTS_IDL as { constants?: { name: string; value: string }[] }).constants?.find((k) => k.name === name);
  if (!c) throw new Error(`burnReceipts IDL has no constant ${name} (re-sync the IDL)`);
  return c.value;
}
const num = (name: string): number => Number(idlConstant(name));
const seed = (name: string): Buffer => Buffer.from(JSON.parse(idlConstant(name)) as number[]);

export const SEED_END_SINK = seed("END_SINK_SEED");
export const SEED_RULE_END = seed("RULE_END_SEED");
export const END_STATE_LIVE = num("END_STATE_LIVE");
export const END_STATE_RESOLVED = num("END_STATE_RESOLVED");
export const END_STATE_VOID = num("END_STATE_VOID");
export const END_SINK_FLAGSHIP = num("END_SINK_FLAGSHIP");
export const END_SINK_MINT = num("END_SINK_MINT");
/** Reserved for league sets: initialize_token refuses it until they land. */
export const END_SINK_LEAGUE_SET = num("END_SINK_LEAGUE_SET");
export const END_SINK_PAIR_WINNER = num("END_SINK_PAIR_WINNER");
export const END_FORWARD_MIN_LAMPORTS_FLOOR = BigInt(idlConstant("END_FORWARD_MIN_LAMPORTS_FLOOR"));
export const END_FORWARD_MIN_LAMPORTS_CEIL = BigInt(idlConstant("END_FORWARD_MIN_LAMPORTS_CEIL"));
export const END_ATTESTATION_DOMAIN = JSON.parse(idlConstant("END_ATTESTATION_DOMAIN")) as string;

/**
 * The platform flagship ($DEFICIT) — every end sink's fall-through — as compiled into each build (constants.rs BURNTICKER_FLAGSHIP).
 * Mainnet: the owner's $DEFICIT mint (compiled 2026-10-11). Localnet = the test-pins flagship (the ed25519 keypair seeded with 0x46 × 32).
 */
export const FLAGSHIP_MINT: Record<Cluster, PublicKey> = {
  mainnet: new PublicKey("AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj"),
  devnet: new PublicKey("4QnwyiBMm2Caz5tJr9hNGzT2wqZcMipZjFHiSBu7AM4F"),
  localnet: new PublicKey("H4JcMPicKkHcxxDjkyyrLoQj7Kcibd9t815ak4UvTr9M"),
};

export { endSinkPda, ruleEndPda } from "@/lib/burnReceipts/pda";

// ---------------------------------------------------------------------------------------------------------------------------------
// accounts
// ---------------------------------------------------------------------------------------------------------------------------------

export interface EndSinkAccount {
  version: number; bump: number; mint: PublicKey;
  /** END_SINK_FLAGSHIP / _MINT / _LEAGUE_SET (reserved) / _PAIR_WINNER. */
  sink_kind: number;
  sink_mint: PublicKey;
  min_forward_lamports: bigint;
  created_at: bigint;
}

export interface RuleEndAccount {
  version: number; bump: number; mint: PublicKey; record_date: number;
  /** END_STATE_RESOLVED / END_STATE_VOID. */
  outcome: number;
  signers_mask: number; source_url_hash: Uint8Array; proof_hash: Uint8Array; submitted_at: bigint;
  forwarded_lamports: bigint; forwards: number; last_forward_at: bigint;
}

export function decodeEndSink(data: Buffer | Uint8Array): EndSinkAccount {
  return decodeAccount<EndSinkAccount>(BURN_RECEIPTS_IDL, "EndSink", data);
}

export function decodeRuleEnd(data: Buffer | Uint8Array): RuleEndAccount {
  return decodeAccount<RuleEndAccount>(BURN_RECEIPTS_IDL, "RuleEnd", data);
}

export async function fetchEndSink(connection: Connection, programId: PublicKey, mint: PublicKey): Promise<EndSinkAccount | null> {
  const info = await connection.getAccountInfo(endSinkPda(programId, mint), "confirmed");
  return info && info.data.length > 0 ? decodeEndSink(info.data) : null;
}

export async function fetchRuleEnd(connection: Connection, programId: PublicKey, mint: PublicKey): Promise<RuleEndAccount | null> {
  const info = await connection.getAccountInfo(ruleEndPda(programId, mint), "confirmed");
  return info && info.data.length > 0 ? decodeRuleEnd(info.data) : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// the signed message
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * The bytes a quorum of the coin's attesters signs to end its rule (program: attest.rs canonical_end_message):
 *   BURNRECEIPTS-END-v1|<cluster genesis>|<program id>|<mint>|<YYYY-MM-DD>|outcome=resolved|void|src=<64 hex>|proof=<64 hex>
 */
export function ruleEndMessage(genesisHash: string | PublicKey, programId: PublicKey, mint: PublicKey, recordDate: number, outcome: number, srcHash: Uint8Array, proofHash: Uint8Array = new Uint8Array(32)): Buffer {
  if (!validDate(recordDate)) throw new Error(`record_date ${recordDate} is not a YYYYMMDD calendar date`);
  if (outcome !== END_STATE_RESOLVED && outcome !== END_STATE_VOID) throw new Error("outcome must be END_STATE_RESOLVED or END_STATE_VOID");
  if (srcHash.length !== 32 || Buffer.from(srcHash).equals(Buffer.alloc(32))) throw new Error("source_url_hash must be a non-zero sha256");
  if (proofHash.length !== 32) throw new Error("proof_hash must be 32 bytes");
  const genesis = typeof genesisHash === "string" ? new PublicKey(genesisHash).toBase58() : genesisHash.toBase58();
  const hex = (x: Uint8Array) => Buffer.from(x).toString("hex");
  return Buffer.from(`${END_ATTESTATION_DOMAIN}|${genesis}|${programId.toBase58()}|${mint.toBase58()}|${formatDate(recordDate)}|outcome=${outcome === END_STATE_RESOLVED ? "resolved" : "void"}|src=${hex(srcHash)}|proof=${hex(proofHash)}`, "utf8");
}

/** Signs ruleEndMessage with each attester key and packs ONE Ed25519SigVerify instruction to place before submitRuleEndIx. */
export function attestRuleEnd(o: { genesisHash: string | PublicKey; programId: PublicKey; mint: PublicKey; recordDate: number; outcome: number; sourceUrlHash: Uint8Array; proofHash?: Uint8Array; signers: { publicKey: PublicKey; secretKey: Uint8Array }[] }): { message: Buffer; instruction: TransactionInstruction } {
  const message = ruleEndMessage(o.genesisHash, o.programId, o.mint, o.recordDate, o.outcome, o.sourceUrlHash, o.proofHash);
  const signatures = o.signers.map((s) => ({ publicKey: s.publicKey, signature: signAttestation(s.secretKey, message) }));
  return { message, instruction: ed25519SharedMessageInstruction(message, signatures) };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// instructions
// ---------------------------------------------------------------------------------------------------------------------------------

/** submit_rule_end — once per coin with an EndSink; the end date is exactly its last reading's date (blind review M-1), not in the future. */
export function submitRuleEndIx(o: { programId: PublicKey; payer: PublicKey; mint: PublicKey; recordDate: number; outcome: number; sourceUrlHash: Uint8Array; proofHash?: Uint8Array }): TransactionInstruction {
  return buildIx(o.programId, "submit_rule_end", {
    payer: o.payer,
    config: configPda(o.programId, o.mint),
    end_sink: endSinkPda(o.programId, o.mint),
    rule_end: ruleEndPda(o.programId, o.mint),
    instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
    system_program: SystemProgram.programId,
  }, { record_date: o.recordDate, outcome: o.outcome, source_url_hash: o.sourceUrlHash, proof_hash: o.proofHash ?? new Uint8Array(32) });
}

/**
 * forward_on_end — `target` must be the destination the program computes (planForwardOnEnd). `sinkMint` = the EndSink's named coin
 * (MINT / PAIR_WINNER); `pair` = the partner + end date for PAIR_WINNER (this coin's PairLink and that date's PairResult are passed).
 */
export function forwardOnEndIx(o: { programId: PublicKey; cranker: PublicKey; mint: PublicKey; target: PublicKey; sinkMint?: PublicKey; pair?: { partner: PublicKey; endDate: number } }): TransactionInstruction {
  const [f, tf] = [feePda(o.programId, o.mint), feePda(o.programId, o.target)];
  return buildIx(o.programId, "forward_on_end", {
    cranker: o.cranker,
    platform: platformPda(o.programId),
    config: configPda(o.programId, o.mint),
    fee_vault: f,
    fee_wsol: associatedTokenAddress(f, NATIVE_MINT),
    end_sink: endSinkPda(o.programId, o.mint),
    rule_end: ruleEndPda(o.programId, o.mint),
    target_config: configPda(o.programId, o.target),
    target_fee_vault: tf,
    target_fee_wsol: associatedTokenAddress(tf, NATIVE_MINT),
    token_program: TOKEN_PROGRAM_ID,
    system_program: SystemProgram.programId,
    memo_program: MEMO_PROGRAM_ID,
    ...(o.sinkMint ? { sink_config: configPda(o.programId, o.sinkMint) } : {}),
    ...(o.pair ? { pair_link: pairLinkPda(o.programId, o.mint), pair_result: pairResultPda(o.programId, o.mint, o.pair.partner, o.pair.endDate) } : {}),
  }, {});
}

// ---------------------------------------------------------------------------------------------------------------------------------
// the destination (mirrors end.rs handle_forward_on_end)
// ---------------------------------------------------------------------------------------------------------------------------------

/** Live, as the program judges a sink: a verified pool, its own rule not ended, buyback mode. */
export function sinkLive(c: TokenConfigAccount | null): boolean {
  return !!c && c.pool_verified && (c.end_state ?? END_STATE_LIVE) === END_STATE_LIVE && c.rule.mode === MODE_BUYBACK;
}

export type EndForwardPlan =
  | { status: "not-ended" | "void" | "no-end-sink" | "readings-pending" | "flagship-not-live" | "flagship-not-pinned" }
  | { status: "ready"; target: PublicKey; intended: PublicKey; sinkKind: number; instructions: TransactionInstruction[] };

/**
 * What forward_on_end will do for `mint` now: the destination exactly as the program computes it (the named coin while live — for
 * PAIR_WINNER only if the end date's PairResult names it winner and it is still paired — else the flagship), and the instructions
 * (the target fee PDA's WSOL account created idempotently first, for a WSOL leg). Amount and minimum are the program's to check.
 */
export async function planForwardOnEnd(connection: Connection, programId: PublicKey, cluster: Cluster, mint: PublicKey, cranker: PublicKey): Promise<EndForwardPlan> {
  const flagship = FLAGSHIP_MINT[cluster];
  if (flagship.equals(PublicKey.default)) return { status: "flagship-not-pinned" };
  const cfg = await fetchTokenConfig(connection, programId, mint);
  if (!cfg) throw new Error(`no TokenConfig for ${mint.toBase58()}`);
  const c = cfg.config;
  const sink = await fetchEndSink(connection, programId, mint);
  if (!sink) return { status: "no-end-sink" };
  if (c.end_state === END_STATE_VOID) return { status: "void" };
  if (c.end_state !== END_STATE_RESOLVED) return { status: "not-ended" };
  if (c.crank_cursor !== c.last_record_date && !c.cpmm_pool.equals(PublicKey.default)) return { status: "readings-pending" };
  let intended = flagship;
  let pair: { partner: PublicKey; endDate: number } | undefined;
  if (sink.sink_kind === END_SINK_MINT) intended = sink.sink_mint;
  else if (sink.sink_kind === END_SINK_PAIR_WINNER) {
    pair = { partner: sink.sink_mint, endDate: c.end_date };
    const link = c.pair_state === PAIR_STATE_PAIRED ? await fetchPairLink(connection, programId, mint) : null;
    const res = link?.paired && link.pair_mint.equals(sink.sink_mint) ? await fetchPairResult(connection, programId, mint, sink.sink_mint, c.end_date) : null;
    if (res && res.record_date === c.end_date && res.winner.equals(sink.sink_mint)) intended = sink.sink_mint;
  }
  let target = flagship;
  if (!intended.equals(flagship)) {
    const sc = (await fetchTokenConfig(connection, programId, intended))?.config ?? null;
    if (sinkLive(sc) && (sink.sink_kind !== END_SINK_PAIR_WINNER || sc?.pair_state === PAIR_STATE_PAIRED)) target = intended;
  }
  if (target.equals(flagship) && !sinkLive((await fetchTokenConfig(connection, programId, flagship))?.config ?? null)) return { status: "flagship-not-live" };
  const tf = feePda(programId, target);
  return {
    status: "ready",
    target,
    intended,
    sinkKind: sink.sink_kind,
    instructions: [
      createAtaIdempotentIx({ payer: cranker, owner: tf, mint: NATIVE_MINT, ata: associatedTokenAddress(tf, NATIVE_MINT) }),
      forwardOnEndIx({ programId, cranker, mint, target, ...(sink.sink_kind !== END_SINK_FLAGSHIP ? { sinkMint: sink.sink_mint } : {}), ...(pair ? { pair } : {}) }),
    ],
  };
}

/** The end-sink receipt memo: `<PREFIX>|endfwd|to=<12>|lamports=N|v1`. */
export function parseEndForwardMemo(memo: string): { prefix: string; to12: string; lamports: bigint } | null {
  const m = /^([A-Z0-9]{2,12})\|endfwd\|to=([1-9A-HJ-NP-Za-km-z]{1,12})\|lamports=(\d+)\|v1$/.exec(memo.trim());
  return m ? { prefix: m[1], to12: m[2], lamports: BigInt(m[3]) } : null;
}
