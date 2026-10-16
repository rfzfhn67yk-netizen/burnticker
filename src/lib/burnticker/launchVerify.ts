import { PublicKey } from "@solana/web3.js";
import { decodeTokenConfig } from "@/lib/burnReceipts/accounts";
import { POOL_POLICY_CREATOR_IS_FEE_PDA, POOL_POLICY_PAIR_CURVE } from "@/lib/burnReceipts/constants";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { configPda, feePda } from "@/lib/burnReceipts/pda";
import { decodePair, pairPda } from "@/lib/pairCurve/accounts";

/**
 * LAUNCH CONFIRMATION IS VERIFIED ON CHAIN (2026-10-10; ChatGPT/Codex PR review N1 — tightened 2026-10-11 by the second review's F3).
 * A draft goes live only when its launch transaction is a SUCCESSFUL, confirmed transaction that the coin's mint keypair AND its
 * recorded creator both signed, that landed after the draft was registered, and that is this coin's launch BY ITS CONTENT:
 *
 *   1. a top-level instruction OF the burn_receipts program carrying initialize_token's discriminator, whose mint account is the
 *      draft's mint and whose creator account is the draft's creator (an unused program key in the account list proves nothing — F3);
 *   2. the coin's TokenConfig, read from the chain after it landed: present, owned by the program, naming this mint and creator, and
 *      locking the draft's rules sha256 (so the rule the page shows is the rule the program holds);
 *   3. the venue the draft expects, completed: a LaunchLab coin — the SAME transaction carries LaunchLab's initialize_v2 for this mint
 *      under the draft's platform with the burn pool (fee PDA) as the recorded creator, and the TokenConfig's registration policy is
 *      "creator is the fee PDA"; a pair-curve coin — the TokenConfig's registration policy is the pair curve, and the pair's Pair account
 *      (init_pair, the set's last transaction) exists on chain, owned by pair_curve, naming both mints in order, this creator and this
 *      side's rules sha256.
 *
 * Anything the host cannot check (no program id, no LaunchLab program for its cluster, an unknown venue) is REFUSED: fail closed,
 * never "accept and check later". The baseline — settlements strictly after it count — is the transaction's block time, a chain fact.
 * Re-sending the same signature is a no-op (registry.markLaunched); the baseline is fixed by an SQL trigger.
 */

/** `missing`: refused because an account was not found (a lagging RPC can answer that for an account that exists): never remembered. */
export type LaunchCheck = { ok: true; blockTimeMs: number } | { ok: false; status: 404 | 409 | 422 | 502 | 503; reason: string; missing?: true };

/** The venue a draft launches on: a LaunchLab curve under `platformId`, or one side of a pair-curve pair (mint A, mint B in order). */
export type LaunchVenue = { kind: "launchlab"; platformId: string | null } | { kind: "pair-curve"; mintA: string; mintB: string } | { kind: "unknown"; why: string };

export interface LaunchExpectation {
  mint: string; creator: string; draftCreatedAtMs: number;
  /** The draft's locked rules sha256 (hex; registry rules_sha) — the TokenConfig must lock exactly this. */
  rulesSha: string;
  venue: LaunchVenue;
}

export interface LaunchVerifier {
  verify(signature: string, expect: LaunchExpectation): Promise<LaunchCheck>;
}

/** What the draft row says about its venue: a pair member with no LaunchLab pool is a pair-curve side; a row with a pool is LaunchLab. */
export function launchVenueOf(t: { poolId: string | null; platformId: string | null }, pair: { mintA: string; mintB: string } | null): LaunchVenue {
  if (pair && t.poolId === null) return { kind: "pair-curve", mintA: pair.mintA, mintB: pair.mintB };
  if (t.poolId) return { kind: "launchlab", platformId: t.platformId };
  return { kind: "unknown", why: "the draft records neither a LaunchLab pool nor a pair-curve pair" };
}

type Key = { toBase58(): string };
type CompiledIx = { programIdIndex: number; accountKeyIndexes: number[]; data: Uint8Array };

/** The slice of @solana/web3.js Connection this needs: getTransaction and getAccountInfo (tests pass a fake). */
export interface TxReader {
  getTransaction(signature: string, opts: { commitment: "confirmed" | "finalized"; maxSupportedTransactionVersion: 0 }): Promise<{
    blockTime?: number | null;
    meta: { err: unknown; loadedAddresses?: { writable: Key[]; readonly: Key[] } | null } | null;
    transaction: { message: { header: { numRequiredSignatures: number }; staticAccountKeys?: Key[]; accountKeys?: Key[]; compiledInstructions?: CompiledIx[] } };
  } | null>;
  getAccountInfo(address: PublicKey, commitment: "confirmed"): Promise<{ owner: Key; data: Uint8Array } | null>;
}

/** burn_receipts initialize_token: discriminator and account slots, from the program's IDL (payer 0, creator 1, mint 2). */
const INIT_DEF = BURN_RECEIPTS_IDL.instructions.find((i) => i.name === "initialize_token")!;
/** initialize_token and round 5's initialize_token_r5 (the same accounts and arguments under another discriminator). */
const INIT_DISCS = BURN_RECEIPTS_IDL.instructions.filter((i) => i.name === "initialize_token" || i.name === "initialize_token_r5").map((i) => Buffer.from(i.discriminator));
const slot = (name: string) => { const i = INIT_DEF.accounts.findIndex((a) => a.name === name); if (i < 0) throw new Error(`burn_receipts IDL: initialize_token has no ${name} account`); return i; };
const INIT_CREATOR = slot("creator"), INIT_MINT = slot("mint");
/**
 * Raydium LaunchLab initialize_v2: sha256("global:initialize_v2")[0..8] (= the SDK's anchorDataBuf.initializeV2) and its account
 * order (SDK instrument.ts; src/lib/burnKeeper/launch.ts INIT_V2_ROLES): 0 payer, 1 creator (recorded; the burn pool), 3 platform_config, 6 base_mint.
 */
export const LAUNCHLAB_INITIALIZE_V2 = Buffer.from([67, 153, 175, 39, 218, 16, 38, 32]);
const LL_PAYER = 0, LL_CREATOR = 1, LL_PLATFORM = 3, LL_MINT = 6;

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const short = (s: string) => `${s.slice(0, 12)}…`;
const NOT_THIS = "it is not this coin's launch";

/** Checks one transaction against the draft: the transaction read, then the TokenConfig (and for a pair, the Pair) read. */
export function connectionLaunchVerifier(reader: TxReader, o: { burnProgramId: string | null; launchLabProgramId?: string | null; pairCurveProgramId?: string | null }): LaunchVerifier {
  return {
    async verify(signature, expect) {
      if (!o.burnProgramId) return { ok: false, status: 503, reason: "this site has no address set for the burn program, so a launch cannot be checked. Drafts are not taken live." };
      const program = o.burnProgramId;
      let tx: Awaited<ReturnType<TxReader["getTransaction"]>>;
      try { tx = await reader.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }); }
      catch (e) { return { ok: false, status: 502, reason: `the launch transaction could not be read from the RPC just now (${(e as Error).message.slice(0, 120)}); retry` }; }
      if (!tx) return { ok: false, status: 404, reason: "no confirmed transaction with this signature on this cluster (yet): send the launch, wait for confirmation, then confirm" };
      if (!tx.meta || tx.meta.err !== null) return { ok: false, status: 422, reason: "the launch transaction failed on chain: nothing launched" };
      if (typeof tx.blockTime !== "number") return { ok: false, status: 502, reason: "the launch transaction has no block time yet; retry" };
      const msg = tx.transaction.message;
      const statics = (msg.staticAccountKeys ?? msg.accountKeys ?? []).map((k) => k.toBase58());
      // v0: account indexes past the static keys point into the lookup-table addresses (writable, then readonly). Program ids are always static.
      const keys = [...statics, ...(tx.meta.loadedAddresses?.writable ?? []).map((k) => k.toBase58()), ...(tx.meta.loadedAddresses?.readonly ?? []).map((k) => k.toBase58())];
      const signers = new Set(statics.slice(0, msg.header.numRequiredSignatures));
      if (!signers.has(expect.mint)) return { ok: false, status: 422, reason: `the transaction was not signed by this coin's mint ${expect.mint}: ${NOT_THIS}` };
      if (!signers.has(expect.creator)) return { ok: false, status: 422, reason: `the transaction was not signed by the draft's creator ${expect.creator}: ${NOT_THIS}` };
      const blockTimeMs = tx.blockTime * 1000;
      if (blockTimeMs + 60_000 < expect.draftCreatedAtMs) return { ok: false, status: 422, reason: `the transaction landed before this draft was registered: ${NOT_THIS}` };
      if (!Array.isArray(msg.compiledInstructions)) return { ok: false, status: 502, reason: "the RPC returned the transaction without its instructions, so it cannot be checked; retry" };
      const ixs = msg.compiledInstructions.map((ix) => ({ program: statics[ix.programIdIndex], accounts: ix.accountKeyIndexes.map((i) => keys[i]), data: Buffer.from(ix.data) }));

      // 1. initialize_token for THIS mint and creator, called as an instruction of burn_receipts (not merely a key in the list)
      const ofProgram = ixs.filter((ix) => ix.program === program);
      // round 5: a coin with a pinned token locks its rule (initialize_token + pin_burn_target) one transaction BEFORE its LaunchLab
      // create (launchBundle.ts launchTransactions), and the confirming step is that create, which calls no burn_receipts instruction.
      // Such a transaction is taken only for a LaunchLab draft whose TokenConfig is already on chain (checked below), and step 3 still
      // requires the create. Any transaction that does call burn_receipts must carry this coin's initialize_token, as before.
      const splitCreate = !ofProgram.length && expect.venue.kind === "launchlab";
      if (!ofProgram.length && !splitCreate) return { ok: false, status: 422, reason: `the transaction does not call the burn_receipts program (initialize_token): ${NOT_THIS}` };
      const inits = ofProgram.filter((ix) => ix.data.length >= 8 && INIT_DISCS.some((d) => ix.data.subarray(0, 8).equals(d)));
      if (!inits.length && !splitCreate) return { ok: false, status: 422, reason: `the transaction's burn_receipts instruction is not initialize_token: ${NOT_THIS}` };
      const forMint = inits.filter((ix) => ix.accounts[INIT_MINT] === expect.mint);
      if (!splitCreate && !forMint.length) return { ok: false, status: 422, reason: `the transaction's initialize_token is for another mint (${inits.map((ix) => ix.accounts[INIT_MINT] ?? "none").join(", ")}), not this coin's mint ${expect.mint}: ${NOT_THIS}` };
      if (!splitCreate && !forMint.some((ix) => ix.accounts[INIT_CREATOR] === expect.creator)) return { ok: false, status: 422, reason: `the transaction's initialize_token names another creator, not the draft's creator ${expect.creator}: ${NOT_THIS}` };

      // 2. the TokenConfig as the chain holds it now: the program's, this mint's, locking the draft's rule
      const mintKey = new PublicKey(expect.mint), programKey = new PublicKey(program);
      const cfgAddress = configPda(programKey, mintKey);
      let cfgInfo: Awaited<ReturnType<TxReader["getAccountInfo"]>>;
      try { cfgInfo = await reader.getAccountInfo(cfgAddress, "confirmed"); }
      catch (e) { return { ok: false, status: 502, reason: `the coin's TokenConfig could not be read from the RPC just now (${(e as Error).message.slice(0, 120)}); retry` }; }
      // a transaction without a burn_receipts call is judged only as a split launch's create: no config, the old answer
      if (splitCreate && (!cfgInfo || cfgInfo.owner.toBase58() !== program)) return { ok: false, status: 422, reason: `the transaction does not call the burn_receipts program (initialize_token): ${NOT_THIS}`, ...(!cfgInfo ? { missing: true as const } : {}) };
      if (!cfgInfo) return { ok: false, status: 422, missing: true, reason: `no TokenConfig for this mint under the burn_receipts program on chain (${cfgAddress.toBase58()}): initialize_token did not complete, ${NOT_THIS}` };
      if (cfgInfo.owner.toBase58() !== program) return { ok: false, status: 422, reason: `the account at the coin's TokenConfig address is not owned by the burn_receipts program: ${NOT_THIS}` };
      let cfg: ReturnType<typeof decodeTokenConfig>;
      try { cfg = decodeTokenConfig(cfgInfo.data); } catch (e) { return { ok: false, status: 422, reason: `the coin's TokenConfig does not decode (${(e as Error).message.slice(0, 80)}): ${NOT_THIS}` }; }
      if (cfg.mint.toBase58() !== expect.mint || cfg.creator.toBase58() !== expect.creator) return { ok: false, status: 422, reason: `the TokenConfig on chain names another mint or creator: ${NOT_THIS}` };
      // 2026-10-14 (Phantom review ticket 438485): a LaunchLab PAIR coin also locks its rule one transaction before its create, and since
      // 2026-10-15 so does every single coin (launchBundle.ts launchTransactions): a create alone is taken for any LaunchLab draft whose
      // TokenConfig is already on chain under this program, for this mint and creator, locking the draft's rule (checked here and below),
      // with step 3's create under the draft's platform. A lock step alone never passes: step 3 requires the create.
      if (hex(cfg.rules_sha256) !== expect.rulesSha.toLowerCase()) return { ok: false, status: 422, reason: `the TokenConfig on chain locks another rule (rules sha256 ${short(hex(cfg.rules_sha256))}) than this draft's (${short(expect.rulesSha)}): ${NOT_THIS}` };

      // 3. the venue the draft expects, completed
      const v = expect.venue;
      if (v.kind === "launchlab") {
        if (cfg.registration_policy !== POOL_POLICY_CREATOR_IS_FEE_PDA) return { ok: false, status: 422, reason: `the TokenConfig's registration policy is ${cfg.registration_policy}, not a LaunchLab coin's (the burn pool is LaunchLab's creator): ${NOT_THIS}` };
        if (!o.launchLabProgramId) return { ok: false, status: 503, reason: "this site does not know the LaunchLab program for its network, so the LaunchLab create step cannot be checked. Drafts are not taken live." };
        if (!v.platformId) return { ok: false, status: 422, reason: "the draft records no LaunchLab platform, so its LaunchLab create cannot be checked: it is not taken live" };
        const burnPool = feePda(programKey, mintKey).toBase58();
        const creates = ixs.filter((ix) => ix.program === o.launchLabProgramId && ix.data.length >= 8 && ix.data.subarray(0, 8).equals(LAUNCHLAB_INITIALIZE_V2) && ix.accounts[LL_MINT] === expect.mint);
        if (!creates.length && splitCreate) return { ok: false, status: 422, reason: `the transaction neither calls the burn_receipts program (initialize_token) nor creates this coin's LaunchLab curve (initialize_v2 for mint ${expect.mint}): ${NOT_THIS}` };
        if (!creates.length) return { ok: false, status: 422, reason: `the transaction does not create this coin's LaunchLab curve (initialize_v2 for mint ${expect.mint}): ${NOT_THIS}` };
        if (!creates.some((ix) => ix.accounts[LL_PAYER] === expect.creator && ix.accounts[LL_PLATFORM] === v.platformId && ix.accounts[LL_CREATOR] === burnPool)) return { ok: false, status: 422, reason: `the LaunchLab create is not under this draft's platform ${v.platformId}, paid by its creator, with the burn pool ${burnPool} as LaunchLab's creator: ${NOT_THIS}` };
        return { ok: true, blockTimeMs };
      }
      if (v.kind === "pair-curve") {
        if (cfg.registration_policy !== POOL_POLICY_PAIR_CURVE) return { ok: false, status: 422, reason: `the TokenConfig's registration policy is ${cfg.registration_policy}, not the pair curve's (${POOL_POLICY_PAIR_CURVE}): ${NOT_THIS}` };
        if (!o.pairCurveProgramId) return { ok: false, status: 503, reason: "this site does not know the pair program, so the pair cannot be checked. Drafts are not taken live." };
        const side = v.mintA === expect.mint ? "a" : v.mintB === expect.mint ? "b" : null;
        if (!side) return { ok: false, status: 422, reason: `this coin's mint is neither side of the draft's pair: ${NOT_THIS}` };
        const pairAddress = pairPda(new PublicKey(v.mintA), new PublicKey(v.mintB), new PublicKey(o.pairCurveProgramId));
        let pairInfo: Awaited<ReturnType<TxReader["getAccountInfo"]>>;
        try { pairInfo = await reader.getAccountInfo(pairAddress, "confirmed"); }
        catch (e) { return { ok: false, status: 502, reason: `the pair account could not be read from the RPC just now (${(e as Error).message.slice(0, 120)}); retry` }; }
        if (!pairInfo || pairInfo.data.length === 0) return { ok: false, status: 409, reason: `the pair is not set up on chain yet (no Pair account ${pairAddress.toBase58()}): send the set's last transaction (init_pair), then confirm — until then neither coin goes live` };
        if (pairInfo.owner.toBase58() !== o.pairCurveProgramId) return { ok: false, status: 422, reason: `the account at the pair's address is not owned by the pair_curve program: ${NOT_THIS}` };
        let pair: ReturnType<typeof decodePair>;
        try { pair = decodePair(pairInfo.data); } catch (e) { return { ok: false, status: 422, reason: `the pair account does not decode (${(e as Error).message.slice(0, 80)}): ${NOT_THIS}` }; }
        if (pair.mints[0]?.toBase58() !== v.mintA || pair.mints[1]?.toBase58() !== v.mintB || pair.creator.toBase58() !== expect.creator) return { ok: false, status: 422, reason: `the pair on chain names other mints or another creator than this draft's pair: ${NOT_THIS}` };
        const pairSha = hex(side === "a" ? pair.rules_sha256_a : pair.rules_sha256_b);
        if (pairSha !== expect.rulesSha.toLowerCase()) return { ok: false, status: 422, reason: `the pair on chain records another rule for this side (rules sha256 ${short(pairSha)}) than this draft's (${short(expect.rulesSha)}): ${NOT_THIS}` };
        return { ok: true, blockTimeMs };
      }
      return { ok: false, status: 422, reason: `the draft's venue cannot be checked (${v.why}): it is not taken live` };
    },
  };
}
