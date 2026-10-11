/**
 * LAUNCH CONFIRMATION IS VERIFIED ON CHAIN (2026-10-10; ChatGPT/Codex PR review N1). A draft goes live only when its launch transaction
 * is a SUCCESSFUL, confirmed transaction that the coin's mint keypair AND its recorded creator both signed (the launch bundle is signed
 * by exactly those two), that touches the burn_receipts program (initialize_token is in the bundle), and that landed after the draft was
 * registered. The baseline — settlements strictly after it count — is the transaction's block time, a chain fact, never the moment
 * somebody called the API. Re-sending the same signature is a no-op (registry.markLaunched); the baseline is fixed by an SQL trigger.
 *
 * A host with no RPC cannot verify, so it refuses to confirm (503): fail closed, never "accept and check later".
 */

export type LaunchCheck = { ok: true; blockTimeMs: number } | { ok: false; status: 404 | 409 | 422 | 502; reason: string };

export interface LaunchVerifier {
  verify(signature: string, expect: { mint: string; creator: string; draftCreatedAtMs: number }): Promise<LaunchCheck>;
}

/** The slice of @solana/web3.js Connection.getTransaction this needs (tests pass a fake). */
export interface TxReader {
  getTransaction(signature: string, opts: { commitment: "confirmed" | "finalized"; maxSupportedTransactionVersion: 0 }): Promise<{
    blockTime?: number | null;
    meta: { err: unknown } | null;
    transaction: { message: { header: { numRequiredSignatures: number }; staticAccountKeys?: { toBase58(): string }[]; accountKeys?: { toBase58(): string }[] } };
  } | null>;
}

/** Checks one transaction against the draft. Pure apart from the one RPC read. */
export function connectionLaunchVerifier(reader: TxReader, o: { burnProgramId: string | null }): LaunchVerifier {
  return {
    async verify(signature, expect) {
      let tx: Awaited<ReturnType<TxReader["getTransaction"]>>;
      try { tx = await reader.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }); }
      catch (e) { return { ok: false, status: 502, reason: `the launch transaction could not be read from the RPC just now (${(e as Error).message.slice(0, 120)}); retry` }; }
      if (!tx) return { ok: false, status: 404, reason: "no confirmed transaction with this signature on this cluster (yet): send the launch, wait for confirmation, then confirm" };
      if (!tx.meta || tx.meta.err !== null) return { ok: false, status: 422, reason: "the launch transaction failed on chain: nothing launched" };
      if (typeof tx.blockTime !== "number") return { ok: false, status: 502, reason: "the launch transaction has no block time yet; retry" };
      const keys = (tx.transaction.message.staticAccountKeys ?? tx.transaction.message.accountKeys ?? []).map((k) => k.toBase58());
      const signers = new Set(keys.slice(0, tx.transaction.message.header.numRequiredSignatures));
      if (!signers.has(expect.mint)) return { ok: false, status: 422, reason: `the transaction was not signed by this coin's mint ${expect.mint}: it is not this coin's launch` };
      if (!signers.has(expect.creator)) return { ok: false, status: 422, reason: `the transaction was not signed by the draft's creator ${expect.creator}: it is not this coin's launch` };
      if (o.burnProgramId && !keys.includes(o.burnProgramId)) return { ok: false, status: 422, reason: "the transaction does not call the burn_receipts program (initialize_token): it is not this coin's launch" };
      const blockTimeMs = tx.blockTime * 1000;
      if (blockTimeMs + 60_000 < expect.draftCreatedAtMs) return { ok: false, status: 422, reason: "the transaction landed before this draft was registered: it is not this coin's launch" };
      return { ok: true, blockTimeMs };
    },
  };
}
