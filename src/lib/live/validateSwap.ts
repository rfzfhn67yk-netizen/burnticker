import { PublicKey, VersionedTransaction } from "@solana/web3.js";

// Verifies that a transaction does what the trade request said, BEFORE
// anything signs it.
//
// This is the security boundary of the live path. The transaction is built by
// Jupiter — a third party, reached over the network — and the whole point of
// not accepting raw transactions from a caller is undone if the one you did
// build is signed unexamined. A compromised response, a hijacked DNS answer,
// or simply the wrong mint pasted into a request all look identical at the
// point of signing unless something checks.
//
// WHAT THIS CAN AND CANNOT PROVE, stated plainly, because a validator that
// overstates its reach is worse than none:
//
//   CAN verify, from the serialised transaction alone:
//     * every program invoked is on the allowlist
//     * the fee payer is the expected wallet
//     * exactly one signature is required, and it is that wallet's
//     * no program is hidden behind an address lookup table
//     * the instruction count is within a sane bound
//
//   CANNOT verify without resolving address lookup tables over RPC:
//     * the individual destination token accounts
//     * exact transfer amounts inside the swap
//
// A real Jupiter swap carries 2 lookup tables and 18 static keys; the pool
// accounts live in the tables. Resolving them needs a network round trip and
// is left to the caller. What this rules out is the class of attack that
// matters most here: a transaction that invokes some OTHER program — a
// delegate approval, an authority change, a bare SOL transfer — under cover
// of looking like a swap.

/**
 * JUPITER'S TRIGGER PROGRAM (2026-09-19) — on-chain limit orders. NOT in ALLOWED_PROGRAMS: a swap has no business
 * touching it, and widening the swap allowlist to fit one new feature is how a security boundary stops meaning
 * anything. The escrow path passes it explicitly through `allowPrograms`, so the transaction that is permitted to
 * invoke it is the one this app deliberately asked Jupiter to build.
 */
export const JUPITER_TRIGGER_PROGRAM = "j1o2qRpjcyUwEvwtcfhEQefh773ZgjxcVRry7LDqg5X";
/** What a Trigger createOrder / cancelOrder transaction is allowed to touch, on top of the shared list. */
export const TRIGGER_PROGRAMS: Record<string, string> = { [JUPITER_TRIGGER_PROGRAM]: "Jupiter Trigger (on-chain limit orders)" };

/** Programs a swap is allowed to touch. Anything else is rejected. */
export const ALLOWED_PROGRAMS: Record<string, string> = {
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter aggregator v6",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "SPL Token-2022",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token Account",
  ComputeBudget111111111111111111111111111111: "Compute Budget",
  "11111111111111111111111111111111": "System",
};

// Observed: a SOL->USDC swap with an ATA creation is 8. Headroom for
// multi-hop routes, well short of a transaction stuffed with extras.
const MAX_INSTRUCTIONS = 24;

export interface ExpectedTrade {
  /** Base58 address of the wallet that will sign and pay. */
  ownerAddress: string;
  // Optional because the signer checks a transaction it did not request: it
  // knows which key is about to pay, but not which mints the decision named.
  // Omitting them skips the expectation check below and nothing else — no
  // check on the TRANSACTION is weakened by their absence.
  inputMint?: string;
  outputMint?: string;
  /**
   * EXTRA PROGRAMS THIS ONE TRANSACTION MAY INVOKE, on top of ALLOWED_PROGRAMS (2026-09-19, for Jupiter's Trigger
   * program). Every other check — fee payer, one signature, no program hidden in a lookup table, instruction count —
   * is unchanged and still applies, so this widens exactly one thing, for exactly the caller that asked for it.
   */
  allowPrograms?: Record<string, string>;
}

export interface ValidationResult {
  ok: boolean;
  /** Every reason the transaction was refused. Empty when ok. */
  violations: string[];
  /** What the transaction was found to contain, for logging and audit. */
  summary: {
    feePayer: string | null;
    requiredSignatures: number;
    instructionCount: number;
    programs: string[];
    lookupTables: number;
    /** True when account-level checks would need the tables resolved. */
    needsLookupResolution: boolean;
  };
}

/**
 * Decodes and checks a base64 swap transaction.
 *
 * Never throws on bad input: malformed bytes are a violation, not an
 * exception, so a caller cannot accidentally treat a parse failure as a pass.
 */
export function validateSwapTransaction(
  base64Transaction: string,
  expected: ExpectedTrade
): ValidationResult {
  const empty: ValidationResult["summary"] = {
    feePayer: null,
    requiredSignatures: 0,
    instructionCount: 0,
    programs: [],
    lookupTables: 0,
    needsLookupResolution: false,
  };

  if (typeof base64Transaction !== "string" || base64Transaction.length === 0) {
    return { ok: false, violations: ["transaction is empty"], summary: empty };
  }

  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(base64Transaction, "base64"));
  } catch (error) {
    return {
      ok: false,
      violations: [`transaction could not be decoded: ${error instanceof Error ? error.message : "unknown"}`],
      summary: empty,
    };
  }

  const message = tx.message;
  const violations: string[] = [];
  const programs: string[] = [];

  const feePayer = message.staticAccountKeys[0]?.toBase58() ?? null;
  const requiredSignatures = message.header.numRequiredSignatures;
  const lookupTables = message.addressTableLookups.length;

  // FEE PAYER. Anything else means this transaction spends a wallet the
  // request never named.
  if (feePayer !== expected.ownerAddress) {
    violations.push(`fee payer is ${feePayer ?? "absent"}, expected ${expected.ownerAddress}`);
  }

  // SIGNER COUNT. A swap needs exactly one signature — the trader's. A second
  // required signer means the transaction is party to something else.
  if (requiredSignatures !== 1) {
    violations.push(`requires ${requiredSignatures} signatures, expected exactly 1`);
  }

  // INSTRUCTION COUNT, as a blunt guard against a transaction padded with
  // extras that individually look harmless.
  if (message.compiledInstructions.length > MAX_INSTRUCTIONS) {
    violations.push(
      `${message.compiledInstructions.length} instructions exceeds the ${MAX_INSTRUCTIONS} allowed for a swap`
    );
  }
  if (message.compiledInstructions.length === 0) {
    violations.push("transaction contains no instructions");
  }

  // PROGRAM ALLOWLIST. The check that rules out the attacks worth worrying
  // about: a delegate approval, a SetAuthority, or a bare transfer riding
  // along inside something shaped like a swap.
  for (const ix of message.compiledInstructions) {
    const key = message.staticAccountKeys[ix.programIdIndex];
    if (!key) {
      // The program id itself came from a lookup table, so it cannot be read
      // here. Refused rather than assumed: an unverifiable program is exactly
      // what an attacker would want.
      violations.push(
        `instruction ${ix.programIdIndex} invokes a program that is not in the static keys ` +
          `(hidden behind an address lookup table) — cannot be verified, so refused`
      );
      continue;
    }
    const id = key.toBase58();
    programs.push(id);
    if (!(id in ALLOWED_PROGRAMS) && !(expected.allowPrograms && id in expected.allowPrograms)) {
      violations.push(`program ${id} is not on the allowlist`);
    }
  }

  // The mints are checked by the caller against the quote it requested — they
  // are not recoverable from the transaction without resolving lookup tables,
  // and claiming otherwise would be the overstatement this file warns about.
  if (expected.inputMint !== undefined && !isBase58(expected.inputMint)) {
    violations.push("expected input mint is not a valid address");
  }
  if (expected.outputMint !== undefined && !isBase58(expected.outputMint)) {
    violations.push("expected output mint is not a valid address");
  }

  return {
    ok: violations.length === 0,
    violations,
    summary: {
      feePayer,
      requiredSignatures,
      instructionCount: message.compiledInstructions.length,
      programs: [...new Set(programs)],
      lookupTables,
      needsLookupResolution: lookupTables > 0,
    },
  };
}

function isBase58(value: string): boolean {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}
