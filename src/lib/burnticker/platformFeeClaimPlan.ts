import { PublicKey } from "@solana/web3.js";
import type { SerializedIx } from "@/lib/burnticker/program";
import { signAndSendPlan, type SendDeps, type SendResult, type SignPlan } from "@/lib/burnticker/signPlan";

/**
 * CLAIMING THE PLATFORM FEE (owner, 2026-10-16). Burnticker's LaunchLab platform (94x5qDDJ… on mainnet) collects its 0.25% curve fee in
 * the platform fee vault for wrapped SOL, getPdaPlatformVault(LaunchLab, platform, WSOL). Raydium's own site offers no claim for a
 * third-party platform, so /burnticker/operator/claim-fees builds it: the server (platformFeeClaim.ts, which can load the Raydium SDK)
 * reads the platform config and the vault and hands over three instructions; this client-safe module checks them, turns them into a
 * one-step signing plan and runs it through signPlan.ts, the launch's own signing path (dry run before the wallet is asked, wallet
 * signs first, the returned transaction checked against what was handed, then send and confirm).
 *
 *   1. ATA CreateIdempotent    the claim wallet's wrapped-SOL account (payer and owner: the claim wallet)
 *   2. claim_platform_fee_from_vault   the vault's balance moves to that account (signer: the platform's claim fee wallet)
 *   3. Token CloseAccount      the account is closed into the claim wallet, so the fee lands as plain SOL, rent included
 *
 * The only signer anywhere is the claim wallet; nothing else may sign, pay or receive. A connected wallet that is not the claim wallet is
 * refused before anything is built.
 */

export const LAUNCHLAB_PROGRAMS: Record<"mainnet" | "devnet", string> = { mainnet: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj", devnet: "DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6" };
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
/** One signature's network fee. */
export const NETWORK_FEE_LAMPORTS = BigInt(5_000);
/**
 * Rent for a 165-byte token account when the chain cannot be asked (the classic figure; mainnet asked 1,488,440 on 2026-10-16). Held for a
 * moment while the wrapped-SOL account is open, then handed back when it is closed. The server asks the chain for the current figure.
 */
export const TOKEN_ACCOUNT_RENT_LAMPORTS = BigInt(2_039_280);

export interface PlatformFeesView {
  cluster: "mainnet" | "devnet" | "localnet";
  launchLabProgram: string;
  platformId: string;
  /** PlatformConfig.platformClaimFeeWallet, read from chain */
  claimWallet: string;
  /** true when the claim wallet is the operator treasury compiled into this build */
  claimWalletIsTreasury: boolean;
  /** PlatformConfig.feeRate, parts per million of each curve trade */
  feeRatePpm: number;
  quoteMint: string;
  vault: string;
  vaultAuthority: string;
  /** the vault's wrapped-SOL amount in lamports, or null when the vault could not be read */
  vaultLamports: string | null;
  /** the claim wallet's wrapped-SOL account (the claim's recipient) */
  recipient: string;
  recipientExists: boolean;
  /** the claim wallet's SOL, or null when it could not be read */
  claimWalletLamports: string | null;
  /** what the claim wallet must hold before the claim (the network fee, plus the account rent when the account is opened) */
  neededLamports: string;
  instructions: SerializedIx[];
  readAt: string;
}

/** SOL from lamports, all nine places kept so a reader can match it to the explorer. */
export function solFromLamports(l: bigint | string | number): string {
  const n = BigInt(l), neg = n < BigInt(0), a = neg ? -n : n, base = BigInt(1_000_000_000);
  return `${neg ? "-" : ""}${a / base}.${(a % base).toString().padStart(9, "0")}`;
}
/** An explorer link for a transaction or an address on the view's cluster. */
export const claimExplorerUrl = (cluster: string, id: string, kind: "tx" | "address" = "tx"): string => `https://explorer.solana.com/${kind}/${id}${cluster === "mainnet" ? "" : cluster === "devnet" ? "?cluster=devnet" : "?cluster=custom"}`;
export const feeRatePercent = (ppm: number): string => `${(ppm / 10_000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
export const neededLamports = (recipientExists: boolean, rent: bigint = TOKEN_ACCOUNT_RENT_LAMPORTS): bigint => NETWORK_FEE_LAMPORTS + (recipientExists ? BigInt(0) : rent);

export const CLAIM_COPY = {
  title: "Claim the platform fee",
  intro: "Burnticker's LaunchLab platform collects its curve fee in one vault for wrapped SOL. Only the platform's claim wallet can move it out, and Raydium's site does not offer that for a platform it does not run, so this page builds the claim for that wallet to sign.",
  pin: "Operator PIN",
  open: "Open the claim page",
  pinNote: "The PIN stays in this tab's memory and is forgotten on reload. This page answers only on the operator's own network.",
  lands: "The fee lands in the claim wallet as plain SOL. The transaction opens the wallet's wrapped-SOL account, moves the vault's balance into it and closes it again, which unwraps everything in it, the account's rent included.",
  button: "Claim",
  busy: "Checking the claim, then asking the wallet.",
  connect: "Connect the claim wallet to claim.",
  empty: "The vault holds nothing to claim right now.",
  done: "The claim is confirmed on chain.",
  ledger: "The claim shows up in the fee ledger by itself, because the ledger reads the claim wallet's history from chain.",
} as const;

/** A claim that was sent but whose confirmation could not be read. */
export const claimSentSentence = (sig: string): string => `The claim was sent as ${sig}, but its confirmation could not be read. Look it up on the explorer before pressing Claim again; the vault balance above is read again either way.`;

/** The one sentence for a connected wallet that is not the claim wallet; null when it is the claim wallet. */
export function claimWalletProblem(connected: string | null | undefined, claimWallet: string): string | null {
  if (!connected) return null;
  return connected === claimWallet ? null : `The connected wallet is not the platform's claim wallet, so it cannot claim this fee; connect ${claimWallet} instead.`;
}

/** The sentence when the claim wallet holds too little SOL to pay for the claim; null when it holds enough (or it could not be read). */
export function fundingProblem(v: Pick<PlatformFeesView, "claimWalletLamports" | "neededLamports">): string | null {
  if (v.claimWalletLamports === null) return null;
  const have = BigInt(v.claimWalletLamports), need = BigInt(v.neededLamports);
  return have >= need ? null : `The claim wallet holds ${solFromLamports(have)} SOL and the claim needs ${solFromLamports(need)} SOL in it first: the network fee, plus the wrapped-SOL account's rent, which comes back in the same transaction. Move at least that much SOL into the claim wallet, then reload this page.`;
}

const ata = (owner: string, mint: string): string => PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(), new PublicKey(TOKEN_PROGRAM).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(ATA_PROGRAM))[0].toBase58();
const keyOk = (k: SerializedIx["keys"][number] | undefined, pubkey: string, signer: boolean, writable: boolean) => !!k && k.pubkey === pubkey && k.isSigner === signer && k.isWritable === writable;

/**
 * What is wrong with the three instructions the server handed over, or [] when they are exactly the claim this page means: the pinned
 * LaunchLab program for the cluster, the vault named in the view, the claim wallet's own wrapped-SOL account as the recipient, the
 * account closed into the claim wallet, and the claim wallet as the only signer.
 */
export function claimIxProblems(v: PlatformFeesView): string[] {
  const out: string[] = [];
  const ll = v.cluster === "devnet" ? LAUNCHLAB_PROGRAMS.devnet : LAUNCHLAB_PROGRAMS.mainnet;
  if (v.launchLabProgram !== ll) out.push(`the LaunchLab program is not the ${v.cluster} one`);
  if (v.quoteMint !== WSOL_MINT) out.push("the vault is not the wrapped-SOL vault");
  const recipient = ata(v.claimWallet, WSOL_MINT);
  if (v.recipient !== recipient) out.push("the recipient is not the claim wallet's wrapped-SOL account");
  const ixs = v.instructions;
  if (ixs.length !== 3) return [...out, `expected 3 instructions, got ${ixs.length}`];
  const [create, claim, close] = ixs;
  if (create.programId !== ATA_PROGRAM || create.dataBase64 !== "AQ==" || !keyOk(create.keys[0], v.claimWallet, true, true) || !keyOk(create.keys[1], recipient, false, true) || !keyOk(create.keys[2], v.claimWallet, false, false) || create.keys[3]?.pubkey !== WSOL_MINT) out.push("instruction 1 does not open the claim wallet's wrapped-SOL account");
  if (claim.programId !== ll || !keyOk(claim.keys[0], v.claimWallet, true, true) || claim.keys[1]?.pubkey !== v.vaultAuthority || claim.keys[2]?.pubkey !== v.platformId || !keyOk(claim.keys[3], v.vault, false, true) || !keyOk(claim.keys[4], recipient, false, true) || claim.keys[5]?.pubkey !== WSOL_MINT || claim.keys[6]?.pubkey !== TOKEN_PROGRAM) out.push("instruction 2 is not the platform-fee claim from this vault to that account");
  if (close.programId !== TOKEN_PROGRAM || close.dataBase64 !== "CQ==" || close.keys.length !== 3 || !keyOk(close.keys[0], recipient, false, true) || !keyOk(close.keys[1], v.claimWallet, false, true) || !keyOk(close.keys[2], v.claimWallet, true, false)) out.push("instruction 3 does not close the account into the claim wallet");
  const signers = new Set(ixs.flatMap((ix) => ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey)));
  if (signers.size !== 1 || !signers.has(v.claimWallet)) out.push("someone other than the claim wallet would sign");
  return out;
}

/**
 * Confirmation by polling the signature's status, as the swap panel does (swap/chain.ts): no websocket subscription. Resolves with the
 * chain's error (null on success) once the status is confirmed or finalized; throws once the blockhash has expired with no status, which
 * signPlan.ts settles against the chain before it says anything.
 */
export async function pollConfirm(read: { status(sig: string): Promise<{ err: unknown; confirmationStatus?: string | null } | null>; blockHeight(): Promise<number> }, sig: string, lastValidBlockHeight: number, o: { everyMs?: number; sleep?: (ms: number) => Promise<void>; maxPolls?: number } = {}): Promise<{ err: unknown }> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < (o.maxPolls ?? 120); i++) {
    const st = await read.status(sig);
    if (st && (st.err || st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return { err: st.err ?? null };
    if (!st && (await read.blockHeight()) > lastValidBlockHeight) throw new Error("the claim's blockhash expired before it was seen on chain");
    await sleep(o.everyMs ?? 1_500);
  }
  throw new Error("the claim's confirmation could not be read in time");
}

/** The claim as a one-step signing plan for signPlan.ts: the claim wallet is the "creator" (the wallet that signs and pays). */
export function platformFeeClaimPlan(v: PlatformFeesView): SignPlan {
  return {
    steps: [{ label: "Claim the platform fee", signers: ["creator"], instructions: v.instructions }],
    keys: {}, expect: {}, labels: {}, confirms: [], pending: [], missingKeys: "",
  };
}

/**
 * Runs the claim through signPlan.ts signAndSendPlan, after refusing a wallet that is not the claim wallet, instructions that are not
 * the claim, or an empty vault. A refusal touches nothing in `deps`: no read, no dry run, no wallet request.
 */
export async function claimPlatformFees(v: PlatformFeesView, connected: string | null, deps: SendDeps): Promise<SendResult> {
  const refuse = (error: string): SendResult => ({ signatures: [], failedAt: 0, error, state: "not-sent" });
  if (!connected) return refuse(CLAIM_COPY.connect);
  const who = claimWalletProblem(connected, v.claimWallet);
  if (who) return refuse(who);
  const bad = claimIxProblems(v);
  if (bad.length) return refuse(`The claim was not built as expected, so nothing was signed: ${bad.join("; ")}.`);
  if (v.vaultLamports !== null && BigInt(v.vaultLamports) <= BigInt(0)) return refuse(CLAIM_COPY.empty);
  return signAndSendPlan(platformFeeClaimPlan(v), connected, deps);
}
