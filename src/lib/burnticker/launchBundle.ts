import { Keypair, PublicKey } from "@solana/web3.js";
import { LAUNCHLAB_PROGRAM, launchLabPoolId, WSOL_MINT } from "@/lib/burnKeeper/launchlab";
import { base58Encode } from "@/lib/burnKeeper/solana";
import { buildCreateTx, buildVestingTx, planLaunch, type DescribedIx, type GlobalConfigView, type LaunchInput as SdkLaunchInput, type PlatformView } from "@/lib/burnKeeper/launch";
import { CURVE_FEES, POST_GRADUATION_FEES, CREATOR_FEE_SLICE_BPS, LP_BURNED_PCT, burnPoolAddresses, feeSplitSentence, type FeeSplit } from "@/lib/burnticker/fees";
import { DECIMALS, descriptionFooter, invertMapping, lockRule, pairIdFor, ruleStatement, TOTAL_SUPPLY, validateRule, type LockedRule } from "@/lib/burnticker/rules";
import { PLACEHOLDER_PROGRAM_ID, programExpressible, type BurnProgramClient, type SerializedIx } from "@/lib/burnticker/program";

/**
 * THE LAUNCH BUNDLE (LAUNCHPAD-PATH §1 step 6; 2026-10-09). One wallet approval signs: (a) burn_receipts.initialize_token (TokenConfig
 * + fee PDA), (b) the Raydium LaunchLab create under OUR platform config with the token's fee PDA as the creator-fee recipient
 * (100%: the owner's fee decision — creators earn no cash from fees), (c) optionally the creator's first buy. The creator pays
 * LaunchLab's creation cost and gas; nothing to us up front.
 *
 * STUBBED ON PURPOSE. The Receipts program is being built separately and the Raydium SDK + src/lib/burnKeeper/launch.ts are being
 * added by another agent, so this module codes against two small interfaces (BurnProgramClient, LaunchLabClient) with fakes, and the
 * bundle it returns says `ready: false` with the list of what is pending. The API route and the wizard run end to end on the fakes;
 * nothing is ever sent from here. Mainnet is refused outright until both pieces land.
 *
 * ALLOCATION. Buyback mode: 100% on the curve (LaunchLab's default split: 793.1M sold, the rest the migration reserve). Vault mode:
 * `share` of supply locked as a LaunchLab vesting allocation to the program's vault PDA, 12-month linear; the curve share is reduced
 * so the migration reserve stays at LaunchLab's 15% minimum (docs/burnkeeper/launchlab-devnet.md).
 */

export interface LaunchLabCreateInput {
  cluster: "devnet" | "mainnet" | "localnet";
  platformId: string; creator: string; mint: string; name: string; symbol: string; uri: string; decimals: 6;
  supply: bigint; totalSellA: bigint; totalFundRaisingB: bigint; totalLockedAmount: bigint; cliffPeriod: number; unlockPeriod: number;
  /** Always the token's fee PDA (the burn pool). */
  creatorFeeRecipient: string;
  firstBuyLamports: bigint;
}

export interface LaunchLabClient {
  platformId: string;
  createLaunchIxs(i: LaunchLabCreateInput): Promise<{ instructions: SerializedIx[]; poolId: string; configId: string; notes: string[] }>;
}

/** Until src/lib/burnKeeper/launch.ts (Raydium SDK) lands: deterministic PDAs from the keeper's launchlab helpers, placeholder instruction bodies. */
export class FakeLaunchLab implements LaunchLabClient {
  readonly platformId: string;
  constructor(platformId = "P1atformConfig11111111111111111111111111111") { this.platformId = platformId; }
  async createLaunchIxs(i: LaunchLabCreateInput) {
    const program = i.cluster === "mainnet" ? LAUNCHLAB_PROGRAM.mainnet : LAUNCHLAB_PROGRAM.devnet;
    const poolId = launchLabPoolId(program, new PublicKey(i.mint), WSOL_MINT).toBase58();
    return {
      poolId, configId: i.cluster === "mainnet" ? "6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX" : "7ZR4zD7PYfY2XxoG1Gxcy2EgEeGYrpxrwzPuwdUBssEt",
      instructions: [{ programId: program.toBase58(), label: "launchpad.initializeV2 (placeholder — Raydium SDK pending)", keys: [{ pubkey: i.creator, isSigner: true, isWritable: true }, { pubkey: i.mint, isSigner: true, isWritable: true }, { pubkey: poolId, isSigner: false, isWritable: true }, { pubkey: i.platformId, isSigner: false, isWritable: false }],
        dataBase64: Buffer.from(JSON.stringify({ ix: "initializeV2", symbol: i.symbol, supply: i.supply.toString(), totalSellA: i.totalSellA.toString(), totalFundRaisingB: i.totalFundRaisingB.toString(), totalLockedAmount: i.totalLockedAmount.toString(), cliffPeriod: i.cliffPeriod, unlockPeriod: i.unlockPeriod, migrateType: "cpmm", creatorFeeRecipient: i.creatorFeeRecipient }), "utf8").toString("base64") }],
      notes: ["placeholder: the real instruction comes from raydium.launchpad.createLaunchpad via src/lib/burnKeeper/launch.ts", "vesting (if any) must be assigned to the vault PDA with createVesting BEFORE graduation"],
    };
  }
}

/**
 * The REAL LaunchLab leg, over the merged builder (src/lib/burnKeeper/launch.ts: the SDK's own low-level initialize_v2 / buy_exact_in).
 * Needs the decoded GlobalConfig and PlatformConfig (read from chain by the caller — the route builds this only when an RPC is
 * configured). The human creator is the PAYER and signs; LaunchLab's recorded `creator` (the fee recipient) is the burn program's fee
 * PDA for the mint (blind review H-2; src/lib/burnKeeper/burnPool.ts) — a recorded account, not a signer, which is what makes a PDA
 * creator possible.
 */
export class SdkLaunchLab implements LaunchLabClient {
  readonly platformId: string;
  private readonly o: { cluster: "mainnet" | "devnet"; programId: PublicKey; platformId: PublicKey; configId: PublicKey; global: GlobalConfigView; platform: PlatformView; slippageBps?: number };
  constructor(o: { cluster: "mainnet" | "devnet"; programId: PublicKey; platformId: PublicKey; configId: PublicKey; global: GlobalConfigView; platform: PlatformView; slippageBps?: number }) { this.o = o; this.platformId = o.platformId.toBase58(); }
  async createLaunchIxs(i: LaunchLabCreateInput) {
    const supplyTokens = i.supply / BigInt(10) ** BigInt(6);
    const lockedPercent = Number((i.totalLockedAmount * BigInt(100)) / i.supply);
    const input: SdkLaunchInput = { cluster: this.o.cluster, programId: this.o.programId, platformId: this.o.platformId, configId: this.o.configId, global: this.o.global, platform: this.o.platform,
      payer: new PublicKey(i.creator), creator: new PublicKey(i.creatorFeeRecipient), mint: new PublicKey(i.mint), name: i.name, symbol: i.symbol, uri: i.uri, decimals: 6, supplyTokens, raiseLamports: i.totalFundRaisingB,
      lockedPercent, cliffSeconds: BigInt(i.cliffPeriod), unlockSeconds: BigInt(i.unlockPeriod), firstBuyLamports: i.firstBuyLamports, slippageBps: this.o.slippageBps ?? 300, creatorFeeOn: "quote-only" };
    const plan = planLaunch(input);
    if (plan.problems.length) throw new Error(`launchlab: ${plan.problems.join("; ")}`);
    const tx = buildCreateTx(input, plan);
    const vest = buildVestingTx(input, plan, new PublicKey(i.creatorFeeRecipient));
    const ser = (d: DescribedIx): SerializedIx => ({ programId: d.ix.programId.toBase58(), label: `${d.program}: ${d.name}`, keys: d.ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), dataBase64: Buffer.from(d.ix.data).toString("base64") });
    return { poolId: plan.poolId.toBase58(), configId: this.o.configId.toBase58(), instructions: [...tx.instructions.map(ser), ...(vest ? vest.instructions.map(ser) : [])],
      notes: [`LaunchLab ${this.o.cluster}: initialize_v2 from the SDK's builder; sell ${plan.totalSellRaw} raw, locked ${plan.totalLockedRaw} raw, reserve ${plan.migrateReserveRaw} raw`, ...(vest ? ["vault mode: create_vesting_account assigns the whole locked share to the burn-pool authority before graduation"] : []), ...(plan.firstBuy ? [`first buy quoted ${plan.firstBuy.quotedTokensRaw} raw for ${plan.firstBuy.lamports} lamports`] : [])] };
  }
}

export interface LaunchInput {
  creator: string; ticker: string; name: string; description: string; imageUrl: string | null; links: { label: string; url: string }[];
  rule: unknown;
  firstBuySol: string;
  acknowledgements: { ruleLocked: boolean; noReturns: boolean };
  cluster: "devnet" | "mainnet" | "localnet";
}

export interface LaunchBundle {
  version: "burnticker.launch/v1";
  cluster: string;
  ready: boolean;
  pending: string[];
  creator: string;
  mint: string;
  /**
   * The fresh mint keypair's secret (base58) — ephemeral, generated for this bundle only, needed to co-sign the create. Never stored.
   * NULL when the caller supplied its own mint public key (`deps.mint`: the public API and the SDK) — then the secret never leaves
   * the caller's machine and the caller co-signs with its own mint keypair.
   */
  mintSecretKey: string | null;
  ticker: string; name: string; description: string;
  rules: { text: string; sha256: string; sha12: string; statement: string; mode: string };
  /** feePda = the burn pool = LaunchLab's recorded creator; feeWsol = its WSOL ATA, where the program's claim of curve fees lands. */
  addresses: { tokenConfig: string; feePda: string; feeWsol: string; vault: string | null; poolId: string; platformId: string; configId: string };
  allocation: { supply: string; curve: string; locked: string; reserve: string; vestDays: number | null; cliffDays: number | null; lpBurnedPct: number; teamAllocationPct: 0 };
  fees: { curve: FeeSplit; postGraduation: FeeSplit; creatorSliceBps: 0; sentence: string; devFeeWallet: string | null };
  /** LaunchLab's recorded creator = the burn program's fee PDA for the mint (review finding H-2). The human creator pays and signs; the keeper only pays gas. */
  burnPoolAuthority: string;
  transactions: { label: string; signers: ("creator" | "mint")[]; instructions: SerializedIx[] }[];
  notes: string[];
}

const TICKER_RE = /^[A-Z0-9]{2,10}$/;
const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** What the review step must have right before a bundle is built. Lists every problem. */
export function launchProblems(i: LaunchInput): string[] {
  const p: string[] = [];
  if (!PUBKEY_RE.test(i.creator)) p.push("creator must be a Solana public key");
  if (!TICKER_RE.test(i.ticker)) p.push("ticker must be 2–10 capitals/digits");
  if (typeof i.name !== "string" || i.name.trim().length < 2 || i.name.length > 32) p.push("name must be 2–32 characters");
  if (typeof i.description !== "string" || i.description.length > 400) p.push("description must be ≤ 400 characters");
  if (i.imageUrl !== null && !/^https:\/\/\S{1,200}$/.test(i.imageUrl)) p.push("imageUrl must be an https URL or null");
  if (!Array.isArray(i.links) || i.links.length > 4 || i.links.some((l) => !/^https:\/\/\S{1,200}$/.test(l.url) || typeof l.label !== "string" || l.label.length > 24)) p.push("links: up to 4 https URLs with short labels");
  if (!/^\d+(\.\d{1,9})?$/.test(i.firstBuySol) || Number(i.firstBuySol) > 50) p.push("firstBuySol must be a SOL amount ≤ 50");
  if (!i.acknowledgements?.ruleLocked) p.push("you must acknowledge that the rule cannot be changed");
  if (!i.acknowledgements?.noReturns) p.push("you must acknowledge that you are not promising anyone anything");
  if (i.cluster !== "devnet" && i.cluster !== "localnet" && i.cluster !== "mainnet") p.push("cluster must be devnet, localnet or mainnet");
  return p;
}

const toRaw = (tokens: bigint) => tokens * BigInt(10) ** BigInt(DECIMALS);

/** LaunchLab's split for a mode: buyback = defaults (all on the curve); vault = `share` locked, reserve 15%, the rest sold. Whole tokens. */
export function allocationFor(locked: LockedRule): { supply: bigint; curve: bigint; locked: bigint; reserve: bigint; vestDays: number | null; cliffDays: number | null } {
  const supply = BigInt(TOTAL_SUPPLY);
  if (locked.mode === "buyback") return { supply, curve: BigInt(793_100_000), locked: BigInt(0), reserve: supply - BigInt(793_100_000), vestDays: null, cliffDays: null };
  const v = locked.rule.vault!;
  const lockedTokens = (supply * BigInt(Math.round(v.share * 100))) / BigInt(100);
  const reserve = (supply * BigInt(15)) / BigInt(100);
  const curve = supply - lockedTokens - reserve;
  if (curve < (supply * BigInt(20)) / BigInt(100)) throw new Error("vault share leaves less than LaunchLab's 20% minimum on the curve");
  return { supply, curve, locked: lockedTokens, reserve, vestDays: v.vestDays, cliffDays: v.cliffDays };
}

export interface LaunchDeps {
  program: BurnProgramClient; launchLab: LaunchLabClient; devFeeWallet: string | null; attesters: string[]; quorum: number; metadataUri: (mint: string) => string;
  mintKeypair?: Keypair;
  /** The caller's own mint PUBLIC key (base58); the bundle then carries no secret (mintSecretKey: null). Exclusive with mintKeypair. */
  mint?: string;
  /**
   * @deprecated ignored for the creator since the blind review's H-2 (2026-10-09): LaunchLab's recorded creator is ALWAYS the burn
   * program's fee PDA for the mint (src/lib/burnKeeper/burnPool.ts). Kept so older callers compile; the keeper is an attester only.
   */
  keeperPubkey?: string | null;
  /** Mainnet is refused unless this is true (the SDK's explicit opt-in). The platform's own routes never set it. */
  allowMainnet?: boolean;
}

/** Composes the bundle. Pure apart from the mint keypair (fresh unless injected) and the two clients (fakes until the real ones land). */
export async function buildLaunchBundle(input: LaunchInput, deps: LaunchDeps): Promise<LaunchBundle> {
  const problems = launchProblems(input);
  if (problems.length) throw new Error(`launch: ${problems.join("; ")}`);
  if (input.cluster === "mainnet" && !deps.allowMainnet) throw new Error("launch: mainnet is refused until the Receipts program and the LaunchLab adapter are live (and audited)");
  if (deps.mint !== undefined && deps.mintKeypair) throw new Error("launch: pass a mint keypair or a mint public key, not both");
  if (deps.mint !== undefined && !PUBKEY_RE.test(deps.mint)) throw new Error("launch: mint must be a Solana public key");
  const locked = lockRule(input.rule);
  const kp = deps.mint !== undefined ? null : deps.mintKeypair ?? Keypair.generate();
  const mint = kp ? kp.publicKey.toBase58() : new PublicKey(deps.mint!).toBase58();
  const vault = locked.mode === "vault" ? deps.program.vaultFor(mint) : null;
  // THE BURN POOL IS A PDA, NOT THE KEEPER (H-2): LaunchLab's creator = burn_receipts' ["fee", mint] under the program id, derived
  // here from the program id (burnPoolFor, via fees.burnPoolAddresses) and cross-checked against the program client so a client with
  // other seeds cannot slip by. A keeper key as creator would strand every fee (no withdraw path) — never again.
  const pool = burnPoolAddresses(deps.program.programId, mint);
  const feePda = pool.feePda;
  if (deps.program.feePdaFor(mint) !== feePda) throw new Error(`launch: the program client's fee PDA ${deps.program.feePdaFor(mint)} ≠ burn_receipts ["fee", mint] ${feePda}`);
  const selectorKey = locked.rule.oracle === "catalogue" ? `catalogue:${locked.rule.series}` : locked.rule.market ? `kalshi:market:${locked.rule.market}` : `kalshi:${locked.rule.series}`;
  const init = await deps.program.initializeToken({ mint, creator: input.creator, ticker: input.ticker, rulesSha256: locked.sha256, selectorKey, mode: locked.mode, attesters: deps.attesters, quorum: deps.quorum, vault, rule: locked.rule });
  const alloc = allocationFor(locked);
  const burnPoolAuthority = feePda;
  const create = await deps.launchLab.createLaunchIxs({
    cluster: input.cluster, platformId: deps.launchLab.platformId, creator: input.creator, mint, name: input.name.trim(), symbol: input.ticker, uri: deps.metadataUri(mint), decimals: 6,
    supply: toRaw(alloc.supply), totalSellA: toRaw(alloc.curve), totalFundRaisingB: BigInt(85) * BigInt(1_000_000_000), totalLockedAmount: toRaw(alloc.locked),
    cliffPeriod: (alloc.cliffDays ?? 0) * 86_400, unlockPeriod: (alloc.vestDays ?? 0) * 86_400, creatorFeeRecipient: burnPoolAuthority, firstBuyLamports: BigInt(Math.round(Number(input.firstBuySol) * 1e9)),
  });
  const description = `${input.description.trim()}${input.description.trim() ? " " : ""}${descriptionFooter(locked)}`;
  const pending = [...(deps.program.programId === PLACEHOLDER_PROGRAM_ID.toBase58() ? ["burn_receipts program (initialize_token is a placeholder instruction)"] : []), "Raydium LaunchLab adapter src/lib/burnKeeper/launch.ts (initializeV2 is a placeholder instruction)"];
  const expressible = programExpressible(locked.rule, input.ticker);
  if (expressible) pending.push(`this rule cannot run on the current burn_receipts program: ${expressible}`);
  if (!deps.devFeeWallet) pending.push("BURNTICKER_FEE_WALLET (the developer fee wallet pubkey) is not set");
  return {
    version: "burnticker.launch/v1", cluster: input.cluster, ready: false, pending,
    creator: input.creator, mint, mintSecretKey: kp ? base58Encode(kp.secretKey) : null, ticker: input.ticker, name: input.name.trim(), description,
    rules: { text: locked.text, sha256: locked.sha256, sha12: locked.sha12, statement: ruleStatement(locked.rule), mode: locked.mode },
    addresses: { tokenConfig: init.tokenConfig, feePda, feeWsol: pool.feeWsol, vault, poolId: create.poolId, platformId: deps.launchLab.platformId, configId: create.configId },
    allocation: { supply: alloc.supply.toString(), curve: alloc.curve.toString(), locked: alloc.locked.toString(), reserve: alloc.reserve.toString(), vestDays: alloc.vestDays, cliffDays: alloc.cliffDays, lpBurnedPct: LP_BURNED_PCT, teamAllocationPct: 0 },
    fees: { curve: CURVE_FEES, postGraduation: POST_GRADUATION_FEES, creatorSliceBps: CREATOR_FEE_SLICE_BPS, sentence: feeSplitSentence(), devFeeWallet: deps.devFeeWallet },
    burnPoolAuthority,
    transactions: [{ label: "initialize_token + LaunchLab create" + (Number(input.firstBuySol) > 0 ? " + first buy" : ""), signers: ["creator", "mint"], instructions: [...init.instructions, ...create.instructions] }],
    notes: [...create.notes, `LaunchLab's recorded creator is the burn program's fee PDA ${burnPoolAuthority} (its WSOL ATA ${pool.feeWsol} receives the claimed curve fees), not the human creator and not the keeper — the keeper only pays gas; the creator-fee slot pays the burn pool 100% (owner, 2026-10-09; review finding H-2)`, `LP burned at graduation: ${LP_BURNED_PCT}% (platform config, not creator-configurable); team allocation 0%`, "the first burn needs fee income or a seed deposit into the burn pool; anyone can deposit, nobody can withdraw", "no referral code, fee discount or hidden parameter exists: every parameter is in rules.json"],
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// RIVALRY PAIRS (the owner, 2026-10-09 night): two coins on one selector with inverted mappings, launched together, signed in sequence.
// ---------------------------------------------------------------------------------------------------------------------------------

export interface PairLaunchInput {
  /** Side A: the full launch input; its rule's `pair` field is set here (pairId, side A, counterpart null) whatever the caller sent. */
  a: LaunchInput;
  /** Side B: its own name/ticker/image/links; creator, first buy, acknowledgements and cluster are side A's. Its rule is derived. */
  b: { ticker: string; name: string; description: string; imageUrl: string | null; links: { label: string; url: string }[] };
  /** Optional; derived from the tickers and the selector when absent (deterministic). */
  pairId?: string;
}

export interface PairBundles { pairId: string; a: LaunchBundle; b: LaunchBundle; selector: string; notes: string[] }

/**
 * Two bundles, built in order: A first (its fresh mint), then B whose rule is `invertMapping(A.rule, A.mint)` — same selector, the
 * mapping inverted, the same pairId in both canonical rules, B naming A's mint as counterpart. Each side is hashed on its own. The
 * wallet signs A's bundle, then B's. SEAM FOR THE PROGRAM BUILDER: if burn_receipts' TokenConfig has no counterpart field, the link
 * lives in each side's rules.json (pairId; B's counterpartMint) and in the registry's pairs table — nothing else needs it.
 */
export async function buildPairBundles(input: PairLaunchInput, deps: LaunchDeps): Promise<PairBundles> {
  if (input.a.ticker === input.b.ticker) throw new Error("pair: the two sides need different tickers");
  const probe = validateRule({ ...(input.a.rule as object), pair: null });
  if (probe.oracle !== "kalshi") throw new Error("pair: v1 pairs must use a tier-1 adjudicated market source (kalshi)");
  const selector = probe.market ?? `${probe.series}${probe.filter.tickerIncludes ? `:${probe.filter.tickerIncludes}` : ""}`;
  const pairId = input.pairId ?? pairIdFor(input.a.ticker, input.b.ticker, selector);
  const ruleA = validateRule({ ...probe, pair: { pairId, side: "A", counterpartMint: null } });
  const a = await buildLaunchBundle({ ...input.a, rule: ruleA }, deps);
  const ruleB = invertMapping(ruleA, a.mint, pairId);
  const b = await buildLaunchBundle({ ...input.a, ticker: input.b.ticker, name: input.b.name, description: input.b.description, imageUrl: input.b.imageUrl, links: input.b.links, rule: ruleB }, { ...deps, mintKeypair: undefined });
  return { pairId, a, b, selector, notes: [
    `rivalry pair ${pairId}: ${input.a.ticker} (side A) and ${input.b.ticker} (side B) on selector ${selector}; each settlement burns exactly one side`,
    "sign A's bundle first, then B's: B's rule names A's mint as counterpart; A's counterpart is recorded in the registry (A is created before B's mint exists)",
    "program seam: burn_receipts TokenConfig may carry no counterpart field; the link is in both rules.json files (pairId) and the registry's pairs table",
  ] };
}
