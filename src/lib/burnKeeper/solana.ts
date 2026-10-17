import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

/**
 * SOLANA PIECES OF THE BURN KEEPER (2026-10-09): the instructions, written out, and the cluster guard. No network here.
 *
 * WHY HAND-WRITTEN INSTRUCTIONS. @solana/spl-token is not a dependency of this repository, and the keeper needs exactly one SPL
 * instruction in production (BurnChecked) plus the Memo program. Each is a few bytes of documented layout; adding a package to the
 * one service that destroys tokens would add more surface than it removes. (keypair-signer.mjs made the same call for base58.)
 * The devnet demo additionally needs InitializeMint2, MintTo, SetAuthority and the associated-token-account create — also here,
 * also tiny, and exercised for real on devnet by scripts/burnkeeper-devnet-demo.mts.
 *
 * BurnChecked, not Burn: the instruction carries the mint's decimals and the token program refuses it if they disagree, so a
 * misconfigured decimals value cannot burn 1,000× the intended amount.
 *
 * THE MAINNET GUARD (the owner's two-key safety, 2026-10-09 brief): the keeper reads the cluster from the RPC's genesis hash — not
 * from the URL, which can say anything — and refuses mainnet unless BOTH BURNKEEPER_MAINNET=1 is set AND BURNKEEPER_RULES_SHA
 * equals the sha256 of the rule file it loaded. One switch flipped by accident is not enough; the second key is the published hash,
 * so the keeper can never burn on mainnet under a rule file other than the one announced.
 */

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
/** SPL mint account size (bytes) — for the devnet demo's createAccount. */
export const MINT_SIZE = 82;

export const GENESIS = {
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  testnet: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
} as const;
export type Cluster = "mainnet" | "devnet" | "testnet" | "localnet";

export function clusterOfGenesis(hash: string): Cluster {
  if (hash === GENESIS.mainnet) return "mainnet";
  if (hash === GENESIS.devnet) return "devnet";
  if (hash === GENESIS.testnet) return "testnet";
  return "localnet";
}

/** Explorer link for a transaction (or an address with kind "address"), per cluster. */
export function explorerUrl(cluster: Cluster | string, id: string, kind: "tx" | "address" = "tx"): string {
  const base = `https://explorer.solana.com/${kind}/${id}`;
  if (cluster === "mainnet") return base;
  if (cluster === "devnet" || cluster === "testnet") return `${base}?cluster=${cluster}`;
  return `${base}?cluster=custom`;
}

/**
 * May the keeper run against this cluster? Pure. `devnetFlag` = the --devnet switch, which ALSO refuses anything that is not
 * devnet/localnet (so a mainnet RPC URL left in the environment cannot be used by a devnet run).
 */
export function clusterRefusal(i: { cluster: Cluster; devnetFlag: boolean; env: Readonly<Record<string, string | undefined>>; rulesSha256: string; mode?: "buyback" | "vault"; rulesMint?: string | null }): string | null {
  if (i.devnetFlag && i.cluster !== "devnet" && i.cluster !== "localnet") return `--devnet was given but the RPC is ${i.cluster} — refusing`;
  if (i.cluster !== "mainnet") return null;
  const armed = i.env.BURNKEEPER_MAINNET === "1";
  const sha = (i.env.BURNKEEPER_RULES_SHA ?? "").trim().toLowerCase();
  if (!armed && !sha) return "the RPC is MAINNET and neither BURNKEEPER_MAINNET=1 nor BURNKEEPER_RULES_SHA is set — refusing (both are required)";
  if (!armed) return "the RPC is MAINNET and BURNKEEPER_MAINNET=1 is not set — refusing (both keys are required)";
  if (!sha) return "the RPC is MAINNET and BURNKEEPER_RULES_SHA is not set — refusing (both keys are required)";
  if (sha !== i.rulesSha256.toLowerCase()) return `the RPC is MAINNET and BURNKEEPER_RULES_SHA (${sha.slice(0, 12)}…) does not match the loaded rule file (${i.rulesSha256.slice(0, 12)}…) — refusing`;
  // BUYBACK spends real SOL buying a token: the third key is the mint itself, written into the hashed rule file before launch and
  // equal to BURNKEEPER_MINT, so the keeper can never buy (or burn) any other coin on mainnet (the owner, 10-09 evening).
  if (i.mode === "buyback") {
    const envMint = (i.env.BURNKEEPER_MINT ?? "").trim();
    if (!i.rulesMint) return "buyback on MAINNET needs the mint written into the rule file (\"mint\") — it is null; refusing";
    if (envMint !== i.rulesMint) return `buyback on MAINNET: BURNKEEPER_MINT (${envMint || "unset"}) is not the rule file's mint (${i.rulesMint}) — refusing`;
  }
  return null;
}

/**
 * base58 for transaction SIGNATURES (64 bytes — PublicKey only takes 32). Written out, as keypair-signer.mjs does, rather than
 * importing bs58, which is only a transitive dependency of web3.js here.
 */
export function base58Encode(bytes: Uint8Array): string {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let zeros = 0; while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  return "1".repeat(zeros) + digits.reverse().map((d) => A[d]).join("");
}

const u64le = (v: bigint): Buffer => {
  if (v < BigInt(0) || v > BigInt("18446744073709551615")) throw new Error("amount out of u64 range");
  const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b;
};

/** SPL Token BurnChecked (instruction 15): [15, amount u64 LE, decimals u8]; accounts: source (w), mint (w), authority (signer). */
export function burnCheckedIx(i: { account: PublicKey; mint: PublicKey; authority: PublicKey; amount: bigint; decimals: number }): TransactionInstruction {
  if (i.amount <= BigInt(0)) throw new Error("burn amount must be positive");
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: i.account, isSigner: false, isWritable: true },
      { pubkey: i.mint, isSigner: false, isWritable: true },
      { pubkey: i.authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([15]), u64le(i.amount), Buffer.from([i.decimals])]),
  });
}

/** Memo v2 with the signer listed (the Memo program then verifies the signer signed — the memo is attributable to the keeper). */
export function memoIx(memo: string, signer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [{ pubkey: signer, isSigner: true, isWritable: false }], data: Buffer.from(memo, "utf8") });
}

/** The associated token account address (owner, mint) under the classic token program. */
export function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
}

/** ATA program CreateIdempotent (instruction 1). */
export function createAtaIdempotentIx(payer: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedTokenAddress(owner, mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

/** SPL Token InitializeMint2 (20): [20, decimals, mint authority (32), freeze option (0 = none)]. Devnet demo only. */
export function initializeMint2Ix(mint: PublicKey, decimals: number, mintAuthority: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [{ pubkey: mint, isSigner: false, isWritable: true }],
    data: Buffer.concat([Buffer.from([20, decimals]), mintAuthority.toBuffer(), Buffer.from([0])]),
  });
}

/** SPL Token MintTo (7). Devnet demo only. */
export function mintToIx(mint: PublicKey, dest: PublicKey, authority: PublicKey, amount: bigint): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([7]), u64le(amount)]),
  });
}

/** SPL Token TransferChecked (12): [12, u64 amount, decimals]. Devnet demo only — the STUB swap's token leg; the keeper never transfers. */
export function transferCheckedIx(source: PublicKey, mint: PublicKey, dest: PublicKey, owner: PublicKey, amount: bigint, decimals: number): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([12]), u64le(amount), Buffer.from([decimals])]),
  });
}

/** SPL Token SyncNative (17): a wrapped-SOL account picks up lamports transferred to it. The launch CLI's first buy wraps SOL this way. */
export function syncNativeIx(wsolAccount: PublicKey): TransactionInstruction {
  return new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: wsolAccount, isSigner: false, isWritable: true }], data: Buffer.from([17]) });
}

/** SPL Token CloseAccount (9): the account's lamports go to `destination` — on a WSOL account this unwraps the SOL. */
export function closeAccountIx(account: PublicKey, destination: PublicKey, owner: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [{ pubkey: account, isSigner: false, isWritable: true }, { pubkey: destination, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: true, isWritable: false }],
    data: Buffer.from([9]),
  });
}

/** SPL Token SetAuthority (6) to NONE for the mint authority (type 0) — fixed supply, as a launch would be. Devnet demo only. */
export function revokeMintAuthorityIx(mint: PublicKey, current: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [{ pubkey: mint, isSigner: false, isWritable: true }, { pubkey: current, isSigner: true, isWritable: false }],
    data: Buffer.from([6, 0, 0]),
  });
}

/**
 * The vault check before any burn (SPEC §2 "vault-only"): the configured account must be a classic SPL token account of THIS mint
 * whose owner is THIS keeper — so the keeper's key can only ever burn from the vault, and a misconfigured BURNKEEPER_VAULT pointing
 * at some other account is refused rather than "tried". Pure over the parsed account JSON.
 */
export function vaultRefusal(parsed: unknown, programOwner: string | null, expect: { mint: string; keeper: string }): string | null {
  if (!parsed) return "the vault account does not exist";
  if (programOwner !== TOKEN_PROGRAM_ID.toBase58()) return `the vault is owned by program ${programOwner ?? "?"}, not the SPL token program`;
  const info = (parsed as { parsed?: { type?: string; info?: { mint?: string; owner?: string; state?: string; delegate?: string } } }).parsed;
  if (info?.type !== "account" || !info.info) return "the vault is not a token account";
  if (info.info.mint !== expect.mint) return `the vault holds mint ${info.info.mint}, not ${expect.mint}`;
  if (info.info.owner !== expect.keeper) return `the vault's owner is ${info.info.owner}, not the keeper ${expect.keeper}`;
  if (info.info.state !== "initialized") return `the vault is ${info.info.state ?? "not initialized"}`;
  // A delegate could move vault tokens without the keeper: "only authority is the keeper" (SPEC §2) means no delegate at all.
  if (info.info.delegate) return `the vault has a delegate (${info.info.delegate}) — its only authority must be the keeper`;
  return null;
}
