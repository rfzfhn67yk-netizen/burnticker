import { Buffer } from "buffer";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { fromLegacyTransactionInstruction } from "@solana/compat";
import { address, appendTransactionMessageInstructions, compileTransaction, createKeyPairFromBytes, createTransactionMessage, getCompiledTransactionMessageDecoder, getTransactionDecoder, getTransactionEncoder, partiallySignTransaction, pipe, setTransactionMessageConfig, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash, type Blockhash, type Instruction, type Transaction } from "@solana/kit";
import type { SerializedIx } from "@/lib/burnticker/program";
import { base58ToBytes, bytesToBase58, simulationFailureText, WALLET_GUARD_PROGRAMS, type SignPlan, type SignStep, type StepFormat } from "@/lib/burnticker/signPlan";
import { isVersionRefusal } from "@/lib/burnticker/walletTxVersion";

/**
 * A LAUNCH STEP AS A VERSION-1 TRANSACTION (Phantom's dApp review, ticket 438485; docs/burnticker/phantom-v1-scope-2026-10-19.md,
 * step 1). The same plan signPlan.ts builds for version 0 is carried here as a v1 transaction built with @solana/kit 8 (web3.js 1.99.0
 * can read a v1 envelope but cannot build, sign or serialize one), behind the one runner's StepFormat so the deadline, lock, reconcile
 * and recovery rules stay single-sourced in signAndSendPlan:
 *
 *   convert    the plan's SerializedIx list becomes kit instructions through @solana/compat (the devnet spike's proven path); no SDK
 *              code runs in the browser, so the SDK's web3.js 1.x pin is irrelevant
 *   build      a v1 message with the creator as fee payer, the blockhash lifetime, the instructions, and a GENEROUS config (the maximum
 *              1,400,000 compute units and 64 MiB of loaded accounts); the mint key is a required signer of the compiled message from the
 *              start (its instructions mark it a signer), checked here before anything is simulated
 *   size       one simulation of the generous build (sigVerify off, the blockhash replaced) reads unitsConsumed and loadedAccountsDataSize;
 *              the step is compiled again with computeUnitLimit = used × 1.2 and loadedAccountsDataSizeLimit rounded up to the next
 *              32 KiB page plus one page (the block cost model charges in pages; accounts the step creates between simulate and send fit
 *              in the spare page). A failed simulation stops the step before the wallet sees it, like the v0 dry run
 *   bounds     4,096 bytes on the wire and 64 static accounts (v1 has no lookup tables; signers and programs are always static)
 *   sign       the wallet signs the wire bytes FIRST through the wallet-standard feature (walletTxVersion.ts), the page checks what came
 *              back byte for byte (walletReturnProblemV1: the same rule as walletReturnProblem, over kit's decoded transaction), then the
 *              mint key's signature is added with partiallySignTransaction over the SAME message bytes, never a rebuild
 *   send       the signed bytes go through signAndSendPlan's sendRaw as they are (web3.js only base64-encodes them), and every later read
 *              is by signature, so storage, reconcile and recovery need nothing new
 *
 * Client-safe: kit, compat, web3.js types only; no fs, no env.
 */

/** The wire limit of a version-1 transaction (SIMD-0296: 4,096 bytes). */
export const V1_PACKET_LIMIT = 4_096;
/** The most static accounts a version-1 transaction may name (no lookup tables). */
export const V1_ACCOUNT_LIMIT = 64;
/** The most compute units a transaction may request. */
export const MAX_COMPUTE_UNITS = 1_400_000;
/** The most loaded-accounts data a transaction may request (64 MiB), and the page the limit is charged in (32 KiB). */
export const MAX_LOADED_ACCOUNTS_BYTES = 64 * 1024 * 1024;
export const LOADED_ACCOUNTS_PAGE = 32 * 1024;
/** The margin on the measured compute units (Phantom's recipe sizes from a generous simulation; the spike used the same factor). */
export const COMPUTE_UNIT_MARGIN = 1.2;

export interface V1Limits { computeUnitLimit: number; loadedAccountsDataSizeLimit: number }
/** The first build, before the simulation sizes it. */
export const V1_GENEROUS: V1Limits = { computeUnitLimit: MAX_COMPUTE_UNITS, loadedAccountsDataSizeLimit: MAX_LOADED_ACCOUNTS_BYTES };

/** What the sizing simulation answered (simulateTransaction's `value`): the error, the logs, and the two readings the limits come from. */
export interface V1SimulateResult { err: unknown; logs?: string[] | null; unitsConsumed?: number | null; loadedAccountsDataSize?: number | null }

/** The deps a version-1 run adds to signPlan.ts SendDeps (the rest — send, confirm, status reads, storage — is shared). */
export interface V1SendDeps {
  /** the wallet signs the wire bytes and hands back the signed wire bytes (walletTxVersion.ts signWithStandardWallet) */
  signBytes(bytes: Uint8Array): Promise<Uint8Array>;
  /**
   * simulateTransaction over the base64 wire bytes with `encoding: "base64"`, `sigVerify: false`, `replaceRecentBlockhash: true`,
   * `commitment: "confirmed"` (simulateBase64 below builds exactly that call). A throw stops the step before the wallet is asked.
   */
  simulate(base64: string): Promise<V1SimulateResult>;
}

/** The plan's SerializedIx list as kit instructions (through @solana/compat, byte for byte the web3.js instruction the server built). */
export function kitInstructions(ixs: readonly SerializedIx[]): Instruction[] {
  return ixs.map((ix) => fromLegacyTransactionInstruction(new TransactionInstruction({ programId: new PublicKey(ix.programId), keys: ix.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })), data: Buffer.from(ix.dataBase64, "base64") })));
}

/**
 * The limits from the generous simulation's readings: compute units used × 1.2 (capped at the maximum); the loaded-accounts size rounded
 * up to the next 32 KiB page plus one spare page (capped at 64 MiB). A reading the RPC did not give keeps the generous value for that limit.
 */
export function sizedLimits(sim: Pick<V1SimulateResult, "unitsConsumed" | "loadedAccountsDataSize">): V1Limits {
  const units = typeof sim.unitsConsumed === "number" && sim.unitsConsumed > 0 ? Math.min(MAX_COMPUTE_UNITS, Math.ceil(sim.unitsConsumed * COMPUTE_UNIT_MARGIN)) : MAX_COMPUTE_UNITS;
  const loaded = typeof sim.loadedAccountsDataSize === "number" && sim.loadedAccountsDataSize >= 0 ? Math.min(MAX_LOADED_ACCOUNTS_BYTES, (Math.ceil(sim.loadedAccountsDataSize / LOADED_ACCOUNTS_PAGE) + 1) * LOADED_ACCOUNTS_PAGE) : MAX_LOADED_ACCOUNTS_BYTES;
  return { computeUnitLimit: units, loadedAccountsDataSizeLimit: loaded };
}

const wireOf = (tx: Transaction): Uint8Array => new Uint8Array(getTransactionEncoder().encode(tx));
const toBase64 = (b: Uint8Array): string => Buffer.from(b).toString("base64");
const sameBytes = (a: Uint8Array | undefined, b: Uint8Array | undefined) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);
const hasSignature = (s: Uint8Array | null | undefined): s is Uint8Array => !!s && s.some((b) => b !== 0);
/** The public key of a 64-byte secret key (its last 32 bytes), base58. */
const publicKeyOfSecret = (secretBase58: string): string => bytesToBase58(base58ToBytes(secretBase58).slice(32));

/** Compiles the step as a version-1 transaction with the given limits; no signature on it. */
export function compileV1(ixs: readonly Instruction[], creator: string, bh: { blockhash: string; lastValidBlockHeight: number }, limits: V1Limits): Transaction {
  const message = pipe(
    createTransactionMessage({ version: 1 }),
    (m) => setTransactionMessageFeePayer(address(creator), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: bh.blockhash as Blockhash, lastValidBlockHeight: BigInt(bh.lastValidBlockHeight) }, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
    (m) => setTransactionMessageConfig(limits, m),
  );
  return compileTransaction(message);
}

/** Why a compiled version-1 transaction cannot be sent as one (the bounds), or null when it fits. */
export function v1BoundsProblem(tx: Transaction): string | null {
  const m = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  if (m.version !== 1) return "is not a version-1 transaction";
  const accounts = m.staticAccounts;
  if (new Set(accounts).size !== accounts.length) return "names the same account twice, which a version-1 transaction refuses";
  if (accounts.length > V1_ACCOUNT_LIMIT) return `names ${accounts.length} accounts, over the ${V1_ACCOUNT_LIMIT} a version-1 transaction allows`;
  const size = wireOf(tx).length;
  if (size > V1_PACKET_LIMIT) return `is ${size.toLocaleString("en-US")} bytes, over the ${V1_PACKET_LIMIT.toLocaleString("en-US")}-byte limit of a version-1 transaction`;
  return null;
}

/** The required signers of a compiled transaction, in message order (the fee payer first). */
export const requiredSigners = (tx: Transaction): string[] => Object.keys(tx.signatures);

/** A built (unsigned) step: the generous build first, then the sized one once the dry run has answered. */
export interface V1Built { step: SignStep; creator: string; bh: { blockhash: string; lastValidBlockHeight: number }; ixs: Instruction[]; limits: V1Limits; tx: Transaction }
/** What the wallet handed back: the bytes, and kit's decoding of them (null when they do not decode as a transaction). */
export interface V1Returned { bytes: Uint8Array; tx: Transaction | null }

/**
 * Builds the step as a version-1 transaction with `limits` (the generous ones before the dry run), checks the bounds and that every key
 * the step names is a required signer of the compiled message (Phantom's rule: the mint key is a signer from the start, never added).
 * Throws a plain sentence, like buildStepTx.
 */
export function buildStepV1(step: SignStep, creator: string, expect: Readonly<Record<string, string>>, bh: { blockhash: string; lastValidBlockHeight: number }, limits: V1Limits = V1_GENEROUS): V1Built {
  const ixs = kitInstructions(step.instructions);
  // the account bound, before kit compiles (kit refuses the same count with its own words): the creator, every program, every key
  const distinct = new Set([creator, ...step.instructions.flatMap((ix) => [ix.programId, ...ix.keys.map((k) => k.pubkey)])]).size;
  if (distinct > V1_ACCOUNT_LIMIT) throw new Error(`${step.label}: the transaction names ${distinct} accounts, over the ${V1_ACCOUNT_LIMIT} a version-1 transaction allows`);
  let tx: Transaction;
  try { tx = compileV1(ixs, creator, bh, limits); } catch (e) { throw new Error(`${step.label}: the transaction could not be built as version 1 (${String((e as Error)?.message ?? e).slice(0, 120)})`); }
  const why = v1BoundsProblem(tx);
  if (why) throw new Error(`${step.label}: the transaction ${why}`);
  const signers = requiredSigners(tx);
  if (signers[0] !== creator) throw new Error(`${step.label}: the creator is not the fee payer of the compiled transaction`);
  for (const s of step.signers) if (s !== "creator" && !signers.includes(expect[s] ?? "")) throw new Error(`${step.label}: ${expect[s] ?? s} is not a required signer of the compiled transaction`);
  return { step, creator, bh, ixs, limits, tx };
}

/**
 * Steps that cannot be sent as a version-1 transaction, measured before anything is signed (the v1 twin of lookupTable.ts
 * planSizeProblems): built with the generous limits and a placeholder blockhash, which encode the same size as the sized build.
 */
export function v1StepProblems(steps: readonly SignStep[], creator: string | null, expect: Readonly<Record<string, string>> = {}): string[] {
  if (!creator) return [];
  const out: string[] = [];
  steps.forEach((st, i) => {
    try { buildStepV1(st, creator, expect, { blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 0 }); }
    catch (e) { out.push(`step ${i + 1} of ${steps.length} cannot be sent as a version-1 transaction: ${String((e as Error)?.message ?? e).replace(/^[^:]*: /, "").slice(0, 200)}`); }
  });
  return out;
}

type Compiled = ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]>;
type CompiledV1 = Extract<Compiled, { version: 1 }>;
const decodeV1 = (bytes: Uint8Array): CompiledV1 | null => { try { const m = getCompiledTransactionMessageDecoder().decode(bytes); return m.version === 1 ? m : null; } catch { return null; } };
const signersOf = (m: CompiledV1): string[] => m.staticAccounts.slice(0, m.header.numSignerAccounts);

/** One instruction in resolved form (program, accounts with their flags, data), comparable across two compilations; v1 has no tables. */
function resolvedV1(m: CompiledV1): { program: string; accounts: string[]; data: string }[] {
  const n = m.staticAccounts.length, signers = m.header.numSignerAccounts;
  const isSigner = (i: number) => i < signers;
  const isWritable = (i: number) => (i < signers ? i < signers - m.header.numReadonlySignerAccounts : i < n - m.header.numReadonlyNonSignerAccounts);
  return m.instructionHeaders.map((h, i) => ({
    program: m.staticAccounts[h.programAccountIndex] ?? "?",
    accounts: m.instructionPayloads[i].instructionAccountIndices.map((j) => `${m.staticAccounts[j] ?? "?"}:${isSigner(j) ? "s" : "-"}${isWritable(j) ? "w" : "-"}`),
    data: toBase64(new Uint8Array(m.instructionPayloads[i].instructionData)),
  }));
}

/**
 * Why the returned message is not "ours plus the wallet's own guard instructions", or null when it is exactly that: the same rule as
 * signPlan.ts appendedGuardProblem, over kit's decoded v1 messages. Compute-budget instructions are ignored on both sides (they are no-ops
 * in version 1, where the limits live in the config block), Lighthouse ones on the wallet's side, and what remains must equal ours.
 */
export function appendedGuardProblemV1(before: CompiledV1, after: CompiledV1): string | null {
  const COMPUTE = "ComputeBudget111111111111111111111111111111";
  const ours = resolvedV1(before).filter((ix) => ix.program !== COMPUTE), theirs = resolvedV1(after).filter((ix) => !WALLET_GUARD_PROGRAMS.includes(ix.program));
  const same = (a: { program: string; accounts: string[]; data: string }, b: typeof a) => a.program === b.program && a.data === b.data && a.accounts.join("|") === b.accounts.join("|");
  if (theirs.length !== ours.length) return `the wallet changed the transaction's instructions or accounts (${ours.length} sent, ${theirs.length} came back after its own guard instructions were set aside)`;
  for (let i = 0; i < ours.length; i++) if (!same(ours[i], theirs[i])) return `the wallet changed the transaction's instructions or accounts (instruction ${i + 1} differs: ${ours[i].program === theirs[i].program ? (ours[i].data === theirs[i].data ? "accounts or flags" : "data") : "program"})`;
  return null;
}

/**
 * What is wrong with the version-1 transaction a wallet hands back, or null when it is the one built here plus the wallet's signature
 * (signPlan.ts walletReturnProblem, for v1). The message bytes must equal what was handed over, except for the wallet's own appended
 * guard instructions and its config block (the v1 twin of a compute-budget instruction: a wallet may raise a limit or add a priority
 * fee from its own pocket); the signer list must be the same, in the same order; every key signature this page had already added must
 * still be there, byte for byte. The wallet's own signature is checked only for presence, by the runner.
 */
export function walletReturnProblemV1(handed: { message: Uint8Array; signatures: Uint8Array[] }, returned: Transaction | null, step: SignStep, plan: Pick<SignPlan, "expect" | "labels">): string | null {
  if (!returned) return "the wallet returned something that is not a transaction";
  const before = decodeV1(handed.message);
  if (!before) return "the wallet changed the transaction";
  if (!sameBytes(new Uint8Array(returned.messageBytes), handed.message)) {
    const after = decodeV1(new Uint8Array(returned.messageBytes));
    if (!after) return "the wallet changed the transaction's version";
    if (before.staticAccounts[0] !== after.staticAccounts[0]) return "the wallet changed who pays the fee";
    if (before.lifetimeToken !== after.lifetimeToken) return "the wallet changed the transaction's blockhash";
    if (signersOf(before).join(",") !== signersOf(after).join(",")) return "the wallet changed who signs the transaction";
    const why = appendedGuardProblemV1(before, after);
    if (why) return why;
  }
  const want = signersOf(before), got = requiredSigners(returned);
  if (got.length !== want.length || got.join(",") !== want.join(",")) return "the wallet changed who signs the transaction";
  for (const s of step.signers) {
    if (s === "creator") continue;
    const at = got.indexOf(plan.expect[s] ?? "");
    if (at < 0) return `the wallet removed or changed ${plan.labels[s] ?? s}'s signature`;
    if (!hasSignature(handed.signatures[at])) continue; // not signed yet: the key signs after the wallet
    const back = returned.signatures[got[at] as keyof typeof returned.signatures];
    if (!back || !sameBytes(new Uint8Array(back), handed.signatures[at])) return `the wallet removed or changed ${plan.labels[s] ?? s}'s signature`;
  }
  return null;
}

/** The signature slots of a transaction in signer order, 64 zero bytes where a slot is empty (what walletReturnProblemV1 compares). */
export const signatureSlots = (tx: Transaction): Uint8Array[] => Object.values(tx.signatures).map((s) => (s ? Uint8Array.from(s) : new Uint8Array(64)));

/**
 * Adds the step's own key signatures (the mint keys) to the transaction the wallet has already signed, over the same message bytes
 * (partiallySignTransaction never rebuilds the message). `pairs` are the keys as WebCrypto key pairs (keyPairsOf).
 */
export async function signStepKeysV1(tx: Transaction, step: SignStep, pairs: ReadonlyMap<string, CryptoKeyPair>): Promise<Transaction> {
  const keys = step.signers.filter((s) => s !== "creator").map((s) => { const k = pairs.get(s); if (!k) throw new Error(`${step.label} needs the ${s} key`); return k; });
  if (!keys.length) return tx;
  const signed = await partiallySignTransaction(keys, tx);
  if (!sameBytes(new Uint8Array(signed.messageBytes), new Uint8Array(tx.messageBytes))) throw new Error("the message changed while the key signed it");
  return signed;
}

/**
 * The plan's keys as WebCrypto key pairs, checked against the public key each must have (planProblems checks the same before the run).
 * Throws when the browser cannot import an Ed25519 key (no WebCrypto Ed25519): the run stops before anything is signed.
 */
export async function keyPairsOf(plan: Pick<SignPlan, "steps" | "keys" | "expect">): Promise<Map<string, CryptoKeyPair>> {
  const out = new Map<string, CryptoKeyPair>();
  for (const name of new Set(plan.steps.flatMap((s) => s.signers).filter((s) => s !== "creator"))) {
    const k = plan.keys[name];
    if (!k) throw new Error(`the ${name} key is missing`);
    const secret = base58ToBytes(k);
    if (secret.length !== 64) throw new Error(`the ${name} key is not a 64-byte key`);
    if (publicKeyOfSecret(k) !== plan.expect[name]) throw new Error(`the ${name} key does not match ${plan.expect[name]}`);
    let pair: CryptoKeyPair;
    try { pair = await createKeyPairFromBytes(secret); } catch (e) { throw new Error(`this browser cannot sign with the ${name} key (${String((e as Error)?.message ?? e).slice(0, 80)})`); }
    out.set(name, pair);
  }
  return out;
}

/**
 * The version-1 StepFormat for signAndSendPlan: build generous → one sizing simulation → sized build → the wallet signs the bytes →
 * byte-level check → the key signatures appended → the wire bytes to sendRaw. `plan` supplies the keys and the public keys they must match.
 */
export function v1Format(d: V1SendDeps, plan: Pick<SignPlan, "steps" | "keys" | "expect">): StepFormat<V1Built, V1Returned> {
  let pairs: Map<string, CryptoKeyPair> | null = null;
  return {
    version: 1,
    sizeLimit: V1_PACKET_LIMIT,
    async prepare() { pairs = await keyPairsOf(plan); },
    async build(step, creator, _keys, bh) { return buildStepV1(step, creator, plan.expect, bh, V1_GENEROUS); },
    async dryRun(built) {
      // LA7 fix B: a node that cannot read version 1 (it throws, or the simulation answers UnsupportedVersion) is flagged so the runner
      // can build the same step as version 0 before the wallet is asked (signPlan.ts formatFallbackAllowed); any other failure is not
      let sim: V1SimulateResult;
      try { sim = await d.simulate(toBase64(wireOf(built.tx))); }
      catch (e) { if (isVersionRefusal(e)) return { problem: `this network's node does not accept version-1 transactions (${String((e as Error)?.message ?? e).slice(0, 160)})`, versionRefused: true }; throw e; }
      if (sim.err != null) return { problem: simulationFailureText(sim.err, sim.logs), ...(isVersionRefusal(sim.err) ? { versionRefused: true as const } : {}) };
      const limits = sizedLimits(sim);
      return { ready: buildStepV1(built.step, built.creator, plan.expect, built.bh, limits) };
    },
    handed(ready) { return { message: new Uint8Array(ready.tx.messageBytes), signatures: signatureSlots(ready.tx) }; },
    async sign(ready) {
      const bytes = await d.signBytes(wireOf(ready.tx));
      let tx: Transaction | null;
      try { tx = getTransactionDecoder().decode(bytes); } catch { tx = null; }
      return { bytes, tx };
    },
    returnProblem(handed, returned, step, p) { return walletReturnProblemV1(handed, returned.tx, step, p); },
    returnedMessageBase64(returned) { return returned.tx ? toBase64(new Uint8Array(returned.tx.messageBytes)) : toBase64(returned.bytes); },
    async signKeys(returned, step) {
      if (!returned.tx) throw new Error("the wallet returned something that is not a transaction");
      if (!pairs) pairs = await keyPairsOf(plan);
      const tx = await signStepKeysV1(returned.tx, step, pairs);
      return { bytes: wireOf(tx), tx };
    },
    serialize(signed) { return signed.tx ? wireOf(signed.tx) : signed.bytes; },
    firstSignature(signed) {
      if (!signed.tx) return null;
      const [payer] = requiredSigners(signed.tx);
      const s = payer ? signed.tx.signatures[payer as keyof typeof signed.tx.signatures] : null;
      return hasSignature(s ? new Uint8Array(s) : null) ? new Uint8Array(s!) : null;
    },
  };
}

// ---- the dry run over the proxy ----------------------------------------------------------------------------------------------------

/** A JSON-RPC caller (method, params → result); connectionRpc builds one from the wallet adapter's Connection. */
export type RpcCall = (method: string, params: unknown[]) => Promise<unknown>;

/**
 * The sizing simulation as the RPC wants it: the base64 wire bytes, signature verification off, the blockhash replaced, confirmed. The
 * same-origin proxy (rpcProxy.ts) allows simulateTransaction and passes the params through. Returns the `value` the format reads.
 */
export async function simulateBase64(call: RpcCall, base64: string): Promise<V1SimulateResult> {
  const r = (await call("simulateTransaction", [base64, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }])) as { value?: V1SimulateResult } | null;
  const v = r?.value;
  if (!v || typeof v !== "object") throw new Error("the dry run answered without a result");
  const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : typeof x === "bigint" ? Number(x) : null);
  return { err: v.err ?? null, logs: Array.isArray(v.logs) ? v.logs : null, unitsConsumed: num(v.unitsConsumed), loadedAccountsDataSize: num(v.loadedAccountsDataSize) };
}

/**
 * A raw JSON-RPC call through the adapter's Connection (its endpoint is the same-origin proxy and its fetch carries the flight token,
 * rpcProxy.ts flightFetch). web3.js keeps `_rpcRequest` on every Connection; a Connection without it falls back to a plain POST to the
 * endpoint.
 */
export function connectionRpc(connection: { rpcEndpoint: string; _rpcRequest?: (method: string, params: unknown[]) => Promise<{ result?: unknown; error?: { message?: string; code?: number } }> }): RpcCall {
  return async (method, params) => {
    const r = typeof connection._rpcRequest === "function"
      ? await connection._rpcRequest(method, params)
      : ((await (await fetch(connection.rpcEndpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()) as { result?: unknown; error?: { message?: string } });
    if (r.error) throw new Error(r.error.message ?? "the RPC refused the call");
    return r.result;
  };
}
