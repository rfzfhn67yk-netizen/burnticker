import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { decodeType, encodeInstruction } from "@/lib/burnReceipts/idlCoder";
import { LOCK_FEE_BURN_BPS, LOCK_FEE_OPERATOR_BPS, POOL_POLICY_PAIR_CURVE } from "@/lib/burnReceipts/constants";
import { CPMM_CONFIG_ID, CPMM_TIER, postGraduationBps } from "@/lib/burnticker/cpmmTier";
import { END_SINK_PAIR_WINNER } from "@/lib/burnReceipts/endSink";
import { linkPairIx } from "@/lib/burnReceipts/pairs";
import { pairPda, vaultPda } from "@/lib/pairCurve/accounts";
import { createPairMintIxs, initPairIx, type InitPairArgs } from "@/lib/pairCurve/client";
import { DEFAULT_CURVE_SUPPLY, DEFAULT_MIN_SIDE_SHARE_BPS, DEFAULT_TARGET_RAISE_LAMPORTS, DEFAULT_VIRTUAL_SOL_LAMPORTS, DEFAULT_VIRTUAL_TOKEN_AMOUNT, initParamProblems, TOTAL_SUPPLY } from "@/lib/pairCurve/pricing";
import { pairCurveEnabled, PAIR_CURVE_FLAG } from "@/lib/burnKeeper/pairCurveCrank";
import type { PairBundles } from "@/lib/burnticker/launchBundle";
import type { SerializedIx } from "@/lib/burnticker/program";

/**
 * THE PAIR-CURVE LAUNCH PATH (2026-10-10; docs/burnticker/PAIR-CURVE.md). With BURNTICKER_PAIR_CURVE_ENABLED=1 (default OFF) a
 * "Matchup pair" / "Election pair" launches through the pair_curve program instead of two LaunchLab curves: both coins graduate
 * together or neither does. This module only turns the two LaunchLab bundles buildPairBundles already made (the locked rules, the
 * TokenConfig instructions, the two fresh mint keypairs) into the pair-curve bundle:
 *
 *   tx 1 / tx 2  create mint A (resp. B) — a classic SPL mint, 6 decimals, NO freeze authority, mint authority = the pair's SOL vault PDA —
 *                and its burn_receipts initialize_token, re-encoded with registration policy 2 (POOL_POLICY_PAIR_CURVE) and the pinned
 *                LaunchLab platform (signers: creator + that mint)
 *   tx 3         pair_curve.init_pair — mints both supplies into the vaults, revokes the mint authority, fixes the parameters (creator)
 *
 * The LaunchLab create instructions are dropped. Nothing is sent from here; the wizard signs. The UI agent owns the screens; this module
 * exports the badge they show (PAIR_CURVE_BADGE). Metadata: the bundle carries no Metaplex instruction yet (pending, listed).
 */

export { pairCurveEnabled, PAIR_CURVE_FLAG };

export const PAIR_CURVE_BADGE = { id: "pair-curve", label: "Pair curve", text: "Both coins graduate together, or neither does. One launch program runs the pair." } as const;

/** The Raydium CPMM AmmConfig the platform points at, per cluster (cpmmTier.ts: mainnet tier 9, devnet index 0). init_pair re-checks it against the TokenConfigs' pin. */
/** A pair coin's pool after graduation: mainnet tier 9 opened by the public initialize, so the creator fee is off (fees string below). */
const PAIR_POST = postGraduationBps({ ...CPMM_TIER.mainnet, creatorFeeRate: 0 }, LOCK_FEE_BURN_BPS);
export const DEFAULT_CP_CONFIG: Record<"mainnet" | "devnet" | "localnet", string> = CPMM_CONFIG_ID;

export interface PairCurveParams {
  virtualSolLamports: bigint;
  virtualTokenAmount: bigint;
  curveSupply: bigint;
  targetRaiseLamports: bigint;
  minSideShareBps: number;
  /** Unix seconds. */
  deadline: number;
}

export interface PairCurveLaunchDeps {
  cluster: "mainnet" | "devnet" | "localnet";
  /** burn_receipts program id (the TokenConfigs' owner). */
  burnReceiptsProgramId: string;
  /** The cpConfigId the LaunchLab platform names (BURNTICKER_CP_CONFIG_ID; default: DEFAULT_CP_CONFIG[cluster]). */
  cpConfigId?: string;
  /** The create-pool fee of that AmmConfig, for the parameter check (0.15 SOL on mainnet and devnet). */
  createPoolFeeLamports?: bigint;
  params?: Partial<PairCurveParams>;
  now?: number;
  mintRentLamports?: number;
}

export interface PairCurveLaunchBundle {
  version: "burnticker.pair-curve-launch/v1";
  ready: boolean;
  pending: string[];
  badge: typeof PAIR_CURVE_BADGE;
  pairId: string;
  pair: string;
  vault: string;
  mints: { a: string; b: string };
  params: { virtualSolLamports: string; virtualTokenAmount: string; curveSupply: string; reserveSupply: string; targetRaiseLamports: string; minSideShareBps: number; deadline: number };
  fees: string;
  transactions: { label: string; signers: ("creator" | "mintA" | "mintB")[]; instructions: SerializedIx[] }[];
  notes: string[];
}

const ser = (ix: TransactionInstruction, label: string): SerializedIx => ({ programId: ix.programId.toBase58(), label, keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), dataBase64: Buffer.from(ix.data).toString("base64") });

/**
 * A real burn_receipts initialize_token SerializedIx re-encoded for the pair curve: rule.pool_policy = 2 and the LaunchLab platform
 * in its optional slot. Null for a placeholder (the FakeBurnProgram's JSON body) — then the bundle is not ready.
 */
export function toPairCurvePolicy(ix: SerializedIx, burnReceiptsProgramId: string, launchlabPlatform: string): SerializedIx | null {
  const def = BURN_RECEIPTS_IDL.instructions.find((i) => i.name === "initialize_token")!;
  const data0 = Buffer.from(ix.dataBase64, "base64");
  if (ix.programId !== burnReceiptsProgramId || data0.length < 8 || !data0.subarray(0, 8).equals(Buffer.from(def.discriminator))) return null;
  // §45: a round-3 layout (instructions.ts initializeTokenIx "r3") has one account fewer and no end-sink args: decode it as round 4 with
  // the empty end-sink args appended, and cut them (and the slot) again below
  const r3 = ix.keys.length === def.accounts.length - 1;
  const data = r3 ? Buffer.concat([data0, Buffer.alloc(10)]) : data0;
  const args = decodeType(BURN_RECEIPTS_IDL, def.args[0].type, data, 8).value as { rule: { pool_policy: number } };
  args.rule.pool_policy = POOL_POLICY_PAIR_CURVE;
  // r3: a pair-curve coin pairs through link_pair, so initialize_token carries no pair_mint and pair_void_by must be 0
  (args as { pair_void_by?: number }).pair_void_by = 0;
  const slot = def.accounts.findIndex((a) => a.name === "launchlab_platform");
  // LAUNCHPAD-PATH §40: a pair-curve coin pairs through link_pair (the Pair is the witness), never through initialize_token's pair_mint
  // (the program refuses InvalidPairMint for policy 2) — the LaunchLab bundle's pair accounts become Anchor's "omitted" placeholder.
  const PAIR_SLOTS = new Set(["pair_mint", "pair_link", "partner_link", "partner_config"]);
  const omit = new Set(def.accounts.map((a, i) => (PAIR_SLOTS.has(a.name) ? i : -1)).filter((i) => i >= 0));
  // §45: a PAIR_WINNER EndSink names its partner through pair_mint in a LaunchLab create (end_sink_mint None); with pair_mint omitted the
  // pair-curve create names the partner in end_sink_mint instead (the program requires it for policy 2)
  const pairSlot = def.accounts.findIndex((a) => a.name === "pair_mint");
  const endSinkSlot = def.accounts.findIndex((a) => a.name === "end_sink");
  const at = (i: number): number => (r3 && i > endSinkSlot ? i - 1 : i);   // r3 lists no end_sink slot (it sits before event_authority)
  const es = args as { end_sink_kind?: number; end_sink_mint?: PublicKey | null };
  if (es.end_sink_kind === END_SINK_PAIR_WINNER && !es.end_sink_mint && pairSlot >= 0 && ix.keys[pairSlot] && ix.keys[pairSlot].pubkey !== burnReceiptsProgramId) es.end_sink_mint = new PublicKey(ix.keys[pairSlot].pubkey);
  const keys = ix.keys.map((k, i) => (i === at(slot) ? { pubkey: launchlabPlatform, isSigner: false, isWritable: false } : [...omit].some((j) => at(j) === i) ? { pubkey: burnReceiptsProgramId, isSigner: false, isWritable: false } : k));
  const enc = encodeInstruction(BURN_RECEIPTS_IDL, "initialize_token", { args });
  return { ...ix, keys, dataBase64: (r3 ? enc.subarray(0, enc.length - 10) : enc).toString("base64"), label: `${ix.label} — registration policy 2 (pair curve)` };
}

export async function buildPairCurveLaunch(pair: PairBundles, creator: string, deps: PairCurveLaunchDeps): Promise<PairCurveLaunchBundle> {
  const pending: string[] = [];
  const now = deps.now ?? Math.floor(Date.now() / 1000);
  const p: PairCurveParams = {
    virtualSolLamports: DEFAULT_VIRTUAL_SOL_LAMPORTS, virtualTokenAmount: DEFAULT_VIRTUAL_TOKEN_AMOUNT, curveSupply: DEFAULT_CURVE_SUPPLY,
    targetRaiseLamports: DEFAULT_TARGET_RAISE_LAMPORTS, minSideShareBps: DEFAULT_MIN_SIDE_SHARE_BPS, deadline: now + 30 * 86_400, ...deps.params,
  };
  const problems = initParamProblems(p, now, deps.createPoolFeeLamports ?? BigInt(150_000_000));
  if (problems.length) throw new Error(`pair curve: ${problems.join("; ")}`);
  const mintA = new PublicKey(pair.a.mint), mintB = new PublicKey(pair.b.mint);
  const pairAddress = pairPda(mintA, mintB);
  const vault = vaultPda(pairAddress);
  const platform = pair.a.addresses.platformId;
  const cpConfig = deps.cpConfigId ?? DEFAULT_CP_CONFIG[deps.cluster];
  const rent = deps.mintRentLamports ?? 1_461_600;
  const creatorKey = new PublicKey(creator);
  const txs: PairCurveLaunchBundle["transactions"] = [];
  for (const [side, b, m] of [["A", pair.a, mintA], ["B", pair.b, mintB]] as const) {
    const init = b.transactions.flatMap((t) => t.instructions).find((ix) => ix.label.startsWith("burn_receipts.initialize_token"));
    const re = init ? toPairCurvePolicy(init, deps.burnReceiptsProgramId, platform) : null;
    if (!re) pending.push(`Side ${side} has only a placeholder for the initialize_token step, because this site has no real client for the burn program (burn_receipts).`);
    txs.push({
      label: `create mint ${side} (authority: the pair's SOL vault, no freeze authority) + burn_receipts.initialize_token (policy 2)`,
      signers: ["creator", side === "A" ? "mintA" : "mintB"],
      instructions: [...createPairMintIxs({ payer: creatorKey, mint: m, vault, rentLamports: rent }).map((ix, i) => ser(ix, i === 0 ? `system.create_account (mint ${side})` : `spl_token.initialize_mint2 (mint ${side}, 6 decimals, authority = vault)`)), ...(re ? [re] : init ? [init] : [])],
    });
  }
  const pairIdHash = await import("node:crypto").then(({ createHash }) => Uint8Array.from(createHash("sha256").update(pair.pairId, "utf8").digest()));
  const args: InitPairArgs = { pair_id: pairIdHash, virtual_sol_lamports: p.virtualSolLamports, virtual_token_amount: p.virtualTokenAmount, curve_supply: p.curveSupply, target_raise_lamports: p.targetRaiseLamports, min_side_share_bps: p.minSideShareBps, deadline: BigInt(p.deadline) };
  // Pair-forward round-3 re-check P3-1: link_pair rides in the SAME transaction, right after init_pair (the Pair exists inside it), so
  // no pair is ever left unlinked by a keeper outage or a later refusal.
  const link = ser(linkPairIx({ programId: new PublicKey(deps.burnReceiptsProgramId), payer: creatorKey, pair: pairAddress, mintA, mintB }), "burn_receipts.link_pair (both coins paired, the Pair as witness)");
  txs.push({ label: "pair_curve.init_pair (mint both supplies into the vaults, revoke the mint authority, fix the parameters) + burn_receipts.link_pair", signers: ["creator"], instructions: [ser(initPairIx({ payer: creatorKey, creator: creatorKey, mintA, mintB, args, launchlabPlatform: new PublicKey(platform), ammConfig: new PublicKey(cpConfig), burnReceiptsProgramId: new PublicKey(deps.burnReceiptsProgramId) }), "pair_curve.init_pair"), link] });
  pending.push("Metaplex metadata for the two mints is not in this bundle yet (create the mint with your key, add metadata, then hand the mint authority to the vault)");
  return {
    version: "burnticker.pair-curve-launch/v1", ready: pending.length === 1, pending, badge: PAIR_CURVE_BADGE, pairId: pair.pairId, pair: pairAddress.toBase58(), vault: vault.toBase58(),
    mints: { a: mintA.toBase58(), b: mintB.toBase58() },
    params: { virtualSolLamports: p.virtualSolLamports.toString(), virtualTokenAmount: p.virtualTokenAmount.toString(), curveSupply: p.curveSupply.toString(), reserveSupply: (TOTAL_SUPPLY - p.curveSupply).toString(), targetRaiseLamports: p.targetRaiseLamports.toString(), minSideShareBps: p.minSideShareBps, deadline: p.deadline },
    fees: `100 bps on every curve trade: 25 bps to the developer wallet, 75 bps to the traded coin's burn pool. After graduation the CPMM pools pay no creator fee (public initialize); the LP is locked forever (lock_lp) and its fees fund the burn: of every swap, ${PAIR_POST.lpToBurnPool} bps to the coin's burn pool and ${PAIR_POST.lpToOperator} bps to the operator (${LOCK_FEE_OPERATOR_BPS / 100}% of the locked pool's ${PAIR_POST.lpFees} bps of liquidity fees), fixed in code; Raydium keeps ${PAIR_POST.raydiumTotal} bps.`,
    transactions: txs,
    notes: [
      `both or neither: graduation needs ${p.targetRaiseLamports} lamports combined with each side ≥ ${p.minSideShareBps / 100} % of it before ${new Date(p.deadline * 1000).toISOString()}; otherwise the pair voids and every holder can sell back on the curve`,
      "sign tx 1 and tx 2 (each needs the creator and that side's mint keypair), then tx 3",
      ...pair.notes,
    ],
  };
}
