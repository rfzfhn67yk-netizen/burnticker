import { PublicKey } from "@solana/web3.js";
import { burnTargetPda, decodeBurnTarget } from "@/lib/burnReceipts/burnTarget";
import { decodeEndSink, END_SINK_FLAGSHIP, END_SINK_INCINERATOR, END_SINK_MINT, END_SINK_PAIR_WINNER, endSinkKindCode, endSinkPda } from "@/lib/burnReceipts/endSink";
import { loadExpectedConfig } from "@/lib/burnticker/admission";
import type { BurnProgramClient, ExpectedTokenConfig } from "@/lib/burnticker/program";
import type { Registry } from "@/lib/burnticker/registry";

/**
 * ADMISSION OF THE END SINK AND THE BURN TARGET (audit 2026-10-19 second pass, I-14). The TokenConfig check (admission.ts
 * configMismatch) never sees two accounts initialize_token writes beside it:
 *
 *   ["end_sink", mint]     pin_end_sink (end.rs) accepts any mint other than the coin itself, and forward_on_end pays whatever is
 *                          written there, so an edited first transaction could send a losing coin's leftover pool to the creator's
 *                          own coin instead of the advertised flagship or pair winner.
 *   ["burn_target", mint]  pin_burn_target writes the token, the pool and the Pyth feed the coin's cranks buy and burn.
 *
 * Both are compared here with what the host encoded at prepare (program.ts ExpectedTokenConfig: endSink, burnTargetKind, burnTarget),
 * at confirm (launchVerify.ts) and in the keeper before any forward or target crank (endSinkKeeper.ts, multiKeeper.ts). A sentence is
 * returned for the first difference (keys shortened, never on-chain text), or null when the accounts match.
 *
 * Rules: an expectation that names an end sink needs the EndSink account, and one that names none refuses an EndSink on chain (a
 * fallback expectation, rebuilt without the prepare's record, leaves the end sink unknown and skips it). The same holds for the
 * BurnTarget against burnTargetKind. A repinned target pool (propose_target_pool, the vault's timelocked change) is legitimate later
 * governance, so the keeper passes `allowRepinnedPool`; the confirm step compares the pool strictly.
 */

export interface EndSinkFacts { kind: number; sinkMint: string; minForwardLamports: bigint }
export interface BurnTargetFacts { mint: string; targetMint: string; pool: string; feedId: string; repins: number }
export interface AdmissionContext {
  /** The coin itself (a BurnTarget must name it). */
  mint: string;
  /** The flagship mint on this cluster, when known (the program forces it for a flagship sink, so the kind alone already decides). */
  flagship?: string | null;
  /** The pair partner, when known (a pair-winner sink must be the partner). */
  pairPartner?: string | null;
  /** Keeper: a pool changed by a later repin is the vault's legitimate change, not an admission difference. */
  allowRepinnedPool?: boolean;
}

const short = (k: string): string => `${k.slice(0, 8)}…`;
const KIND_WORDS: Record<number, string> = { [END_SINK_FLAGSHIP]: "the flagship", [END_SINK_MINT]: "a named coin", [END_SINK_PAIR_WINNER]: "the pair winner", [END_SINK_INCINERATOR]: "the incinerator" };
const kindWord = (k: number): string => KIND_WORDS[k] ?? `kind ${k}`;
const feedHex = (s: string): string => s.toLowerCase().replace(/^0x/, "");

/** The EndSink kind code for the keeper's view ("flagship", "pair-winner"...), or null for a kind this host never pins. */
export function endSinkKindOf(k: string): number | null {
  return k === "flagship" || k === "pair-winner" || k === "mint" || k === "incinerator" ? endSinkKindCode(k) : null;
}

/** The pair partner a launch venue names for `mint` (a pair-curve side), else null. */
export function pairPartnerOf(venue: { kind: string; mintA?: string; mintB?: string } | null | undefined, mint: string): string | null {
  if (!venue || venue.kind !== "pair-curve" || !venue.mintA || !venue.mintB) return null;
  return venue.mintA === mint ? venue.mintB : venue.mintB === mint ? venue.mintA : null;
}

/** The first difference between the EndSink on chain (null = no account) and the expectation, or null. */
export function endSinkMismatch(chain: EndSinkFacts | null, exp: ExpectedTokenConfig, ctx: AdmissionContext): string | null {
  const want = exp.endSink;
  if (!want) {
    if (exp.fallback) return null;   // rebuilt without the prepare's record: the end sink is not known, so it is not compared
    return chain ? `the coin pins an end sink on chain (${kindWord(chain.kind)}, ${short(chain.sinkMint)}) and this draft pins none` : null;
  }
  if (!chain) return `the coin has no end sink on chain; this draft sends its leftover pool to ${kindWord(want.kind)}`;
  if (chain.kind !== want.kind) return `the end sink on chain is ${kindWord(chain.kind)}; this draft sends its leftover pool to ${kindWord(want.kind)}`;
  const expectedMint = want.mint ?? (want.kind === END_SINK_PAIR_WINNER ? ctx.pairPartner ?? null : want.kind === END_SINK_FLAGSHIP ? ctx.flagship ?? null : null);
  if (expectedMint && chain.sinkMint !== expectedMint) return `the end sink on chain names another coin (${short(chain.sinkMint)}) than this draft's (${short(expectedMint)})`;
  if (chain.sinkMint === ctx.mint) return "the end sink on chain names the coin itself";
  if (chain.minForwardLamports.toString() !== want.minLamports) return `the end sink on chain sets the minimum forward to ${chain.minForwardLamports} lamports; this draft locks ${want.minLamports} lamports`;
  return null;
}

/** The first difference between the BurnTarget on chain (null = no account) and the expectation, or null. */
export function burnTargetMismatch(chain: BurnTargetFacts | null, exp: ExpectedTokenConfig, ctx: AdmissionContext): string | null {
  if (exp.burnTargetKind === 0) return chain ? `the coin pins another token to burn on chain (${short(chain.targetMint)}) and this draft burns its own token` : null;
  if (!chain) return "the coin pins no token to burn on chain; this draft burns a pinned token";
  if (chain.mint !== ctx.mint) return "the pinned token account on chain belongs to another coin";
  const want = exp.burnTarget;
  if (!want) return null;   // an expectation from before the target was recorded: the kind above is what is known
  if (chain.targetMint !== want.mint) return `the pinned token on chain is another token (${short(chain.targetMint)}) than this draft's (${short(want.mint)})`;
  if (feedHex(chain.feedId) !== feedHex(want.feedId)) return `the pinned token on chain reads another Pyth feed (${feedHex(chain.feedId).slice(0, 12)}…) than this draft's (${feedHex(want.feedId).slice(0, 12)}…)`;
  if (chain.pool !== want.pool && !(ctx.allowRepinnedPool && chain.repins > 0)) return `the pinned token on chain trades on another pool (${short(chain.pool)}) than this draft's (${short(want.pool)})`;
  return null;
}

/** The slice of a web3.js Connection this needs (launchVerify.ts TxReader has it). */
export interface AccountGetter {
  getAccountInfo(address: PublicKey, commitment: "confirmed"): Promise<{ owner: { toBase58(): string }; data: Uint8Array } | null>;
}

export type AccountsRead = { ok: true; endSink: EndSinkFacts | null; burnTarget: BurnTargetFacts | null } | { ok: false; reason: string; undecodable?: true };

/** Reads and decodes both accounts. An account not owned by the program, or empty, counts as absent; an undecodable one is reported. */
export async function readAdmissionAccounts(reader: AccountGetter, programId: string, mint: string): Promise<AccountsRead> {
  const program = new PublicKey(programId), m = new PublicKey(mint);
  let es: Awaited<ReturnType<AccountGetter["getAccountInfo"]>>, bt: Awaited<ReturnType<AccountGetter["getAccountInfo"]>>;
  try { [es, bt] = await Promise.all([reader.getAccountInfo(endSinkPda(program, m), "confirmed"), reader.getAccountInfo(burnTargetPda(program, m), "confirmed")]); }
  catch { return { ok: false, reason: "the coin's end sink and pinned token accounts could not be read from the RPC just now; retry" }; }
  const owned = (a: typeof es): a is NonNullable<typeof es> => !!a && a.owner.toBase58() === programId && a.data.length > 0;
  let endSink: EndSinkFacts | null = null, burnTarget: BurnTargetFacts | null = null;
  try {
    if (owned(es)) { const d = decodeEndSink(es.data); endSink = { kind: d.sink_kind, sinkMint: d.sink_mint.toBase58(), minForwardLamports: BigInt(d.min_forward_lamports) }; }
  } catch { return { ok: false, undecodable: true, reason: "the coin's end sink account does not decode" }; }
  try {
    if (owned(bt)) { const d = decodeBurnTarget(bt.data); burnTarget = { mint: d.mint.toBase58(), targetMint: d.target_mint.toBase58(), pool: d.pool.toBase58(), feedId: Buffer.from(d.target_feed_id).toString("hex"), repins: Number(d.repins) }; }
  } catch { return { ok: false, undecodable: true, reason: "the coin's pinned token account does not decode" }; }
  return { ok: true, endSink, burnTarget };
}

/**
 * The confirm step's check: reads both accounts and compares them. `retry` = the RPC failed (never a remembered refusal); `missing` = an
 * account the expectation names was not found (a lagging RPC can answer that, so the refusal is not remembered either).
 */
export async function admissionAccountsMismatch(reader: AccountGetter, o: AdmissionContext & { programId: string; exp: ExpectedTokenConfig }): Promise<{ reason: string; retry?: true; missing?: true } | null> {
  const r = await readAdmissionAccounts(reader, o.programId, o.mint);
  if (!r.ok) return r.undecodable ? { reason: r.reason } : { reason: r.reason, retry: true };
  const es = endSinkMismatch(r.endSink, o.exp, o);
  if (es) return { reason: es, ...(!r.endSink && o.exp.endSink ? { missing: true as const } : {}) };
  const bt = burnTargetMismatch(r.burnTarget, o.exp, o);
  if (bt) return { reason: bt, ...(!r.burnTarget && o.exp.burnTargetKind !== 0 ? { missing: true as const } : {}) };
  return null;
}

/**
 * The keeper's fence before a target crank (multiKeeper.ts executePending, step 4, for a coin whose config burns a target): the
 * BurnTarget on chain against the stored prepare expectation. Null = go on (it matches, there is no stored expectation, or the client
 * cannot read the account); otherwise the reason to hold, after one alert. An RPC failure holds this pass without an alert.
 */
export async function burnTargetHold(d: { registry: Pick<Registry, "getStatus" | "recordAlert">; program: Pick<BurnProgramClient, "burnTargetOf">; log: (line: string) => void; now: () => number }, t: { mint: string; ticker: string }): Promise<string | null> {
  if (!d.program.burnTargetOf) return null;
  const exp = loadExpectedConfig(d.registry, t.mint);
  if (!exp) return null;
  let chain: BurnTargetFacts | null;
  try { chain = await d.program.burnTargetOf(t.mint); } catch (e) { return `the coin's pinned token account could not be read (${(e as Error).message.slice(0, 80)}); the crank waits`; }
  const off = burnTargetMismatch(chain, exp, { mint: t.mint, allowRepinnedPool: true });
  if (!off) return null;
  const text = `$${t.ticker}: the token this coin burns on chain differs from the one this site built for it (${off}). Nothing is cranked for it.`;
  d.log(`  [program] $${t.ticker}: REFUSED — ${off}`);
  try { if (d.registry.recordAlert({ kind: "config-mismatch", key: `burn-target-mismatch:${t.mint}`, text, meta: { mint: t.mint, account: "burn_target" } }, d.now())) d.log(`  [alert] config-mismatch: ${text}`); } catch { /* the alert never changes the hold */ }
  return off;
}
