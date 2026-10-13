import { STANDARD_RAISE_LAMPORTS } from "@/lib/burnKeeper/launch";
import { Keypair, PublicKey } from "@solana/web3.js";
import { LAUNCHLAB_PROGRAM, launchLabPoolId, WSOL_MINT } from "@/lib/burnKeeper/launchlab";
import { base58Encode } from "@/lib/burnKeeper/solana";
import { buildCreateTx, buildVestingTx, planLaunch, type DescribedIx, type GlobalConfigView, type LaunchInput as SdkLaunchInput, type PlatformView } from "@/lib/burnKeeper/launch";
import { CURVE_FEES, postGraduationFeesFor, CREATOR_FEE_SLICE_BPS, LP_BURNED_PCT, LP_LOCKED_PCT, burnPoolAddresses, feeSplitSentence, type FeeSplit } from "@/lib/burnticker/fees";
import { LP_POLICY_LINE } from "@/lib/burnticker/lockFees";
import { DECIMALS, descriptionFooter, invertMapping, lockRule, DEFAULT_ON_END, PAIR_CLAUSE, withFullFraction, isOneShot, PAIR_ORACLES, pairIdFor, ruleStatement, TOTAL_SUPPLY, validateRule, type LockedRule } from "@/lib/burnticker/rules";
import { isRaisePreset, RAISE_PRESETS_SOL } from "@/lib/burnticker/raisePresets";
import { nameProblem } from "@/lib/burnticker/launchFields";
import { isWebLink, linksProblems } from "@/lib/burnticker/creatorProfile";
import { PLACEHOLDER_PROGRAM_ID, programExpressible, type BurnProgramClient, type SerializedIx } from "@/lib/burnticker/program";

/**
 * THE LAUNCH BUNDLE (LAUNCHPAD-PATH §1 step 6; 2026-10-09). One wallet approval signs: (a) burn_receipts.initialize_token (TokenConfig
 * + fee PDA), (b) the Raydium LaunchLab create under OUR platform config with the token's fee PDA as the creator-fee recipient
 * (100%: the owner's fee decision — creators earn no cash from fees), (c) optionally the creator's first buy. The creator pays
 * LaunchLab's creation cost and gas; nothing to us up front.
 *
 * TWO SMALL INTERFACES (BurnProgramClient, LaunchLabClient). The fakes stay for tests and for hosts without an RPC; there the bundle
 * says `ready: false` with the list of what is pending. Since launch-10 (2026-10-12) a host with an RPC, the program id and the platform
 * id gets the real clients (server.ts: ProgramBurnClient, launchLabChain.ts ChainLaunchLab) and a ready bundle. Nothing is ever sent
 * from here. Mainnet is refused unless the caller passes `allowMainnet` (the site: the host's BURNTICKER_ALLOW_MAINNET_LAUNCHES).
 *
 * ALLOCATION. Buyback mode: 100% on the curve (LaunchLab's default split: 793.1M sold, the rest the migration reserve). Vault mode:
 * `share` of supply locked as a LaunchLab vesting allocation to the program's vault PDA, 12-month linear; the curve share is reduced
 * so the migration reserve stays at LaunchLab's 15% minimum (docs/burnkeeper/launchlab-devnet.md).
 */

/** LaunchLab's standard raise (85 SOL), the DEFAULT of the creator's graduation preset. A coin's own raise is `raiseSol` (below). */
export const LAUNCHLAB_RAISE_LAMPORTS: bigint = STANDARD_RAISE_LAMPORTS; // one source: src/lib/burnKeeper/launch.ts

/**
 * THE GRADUATION RAISE (website-14, LAUNCHPAD-PATH §75): the coin's own totalFundRaisingB. On mainnet only the presets 40, 60 and 85 SOL
 * (launchPresets.ts RAISE_PRESETS_SOL); elsewhere any amount from 0.1 to 85 SOL (devnet rehearsals use small raises, as the CLI's
 * --raise-sol does). Absent = 85. The review and the bundle read the same function, so they cannot disagree.
 */
export function raiseProblem(raiseSol: string | undefined, cluster: string): string | null {
  if (raiseSol === undefined) return null;
  if (cluster === "mainnet") return isRaisePreset(raiseSol) ? null : `The graduation raise must be ${RAISE_PRESETS_SOL.slice(0, -1).join(", ")} or ${RAISE_PRESETS_SOL[RAISE_PRESETS_SOL.length - 1]} SOL on mainnet.`;
  return /^\d+(\.\d{1,9})?$/.test(raiseSol) && Number(raiseSol) >= 0.1 && Number(raiseSol) <= 85 ? null : "The graduation raise must be an amount of SOL from 0.1 to 85.";
}
/** The raise in lamports for a launch input (85 SOL when it names none). Call raiseProblem first. */
export const raiseLamportsOf = (raiseSol: string | undefined): bigint => (raiseSol === undefined ? LAUNCHLAB_RAISE_LAMPORTS : BigInt(Math.round(Number(raiseSol) * 1e9)));

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
  /**
   * False only for a client whose instructions are the real LaunchLab ones (SdkLaunchLab, and ChainLaunchLab over it). Absent or true =
   * placeholder instructions: the bundle then lists the adapter as pending and says `ready: false`, and the browser will not sign it.
   */
  readonly placeholder?: boolean;
  createLaunchIxs(i: LaunchLabCreateInput): Promise<{ instructions: SerializedIx[]; poolId: string; configId: string; notes: string[] }>;
}

/** Until src/lib/burnKeeper/launch.ts (Raydium SDK) lands: deterministic PDAs from the keeper's launchlab helpers, placeholder instruction bodies. */
export class FakeLaunchLab implements LaunchLabClient {
  readonly platformId: string;
  readonly placeholder = true;
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
  readonly placeholder = false;
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
  /** website-14: the graduation raise in SOL ("40", "60" or "85" on mainnet); absent = 85 (LaunchLab's standard). */
  raiseSol?: string;
}

export interface LaunchBundle {
  version: "burnticker.launch/v1";
  cluster: string;
  /** The token metadata URI the create instruction writes (immutable on chain): the Arweave pin at launch; "ar://pending-upload-at-launch" in a preview. */
  metadataUri?: string;
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
  allocation: { supply: string; curve: string; locked: string; reserve: string; vestDays: number | null; cliffDays: number | null; /** 0 since 2026-10-10: the LP is locked, not burned */ lpBurnedPct: number; /** 100: LP locked forever (owner decision 2026-10-10) */ lpLockedPct: number; teamAllocationPct: 0 };
  fees: { curve: FeeSplit; postGraduation: FeeSplit; creatorSliceBps: 0; sentence: string; devFeeWallet: string | null };
  /** LaunchLab's recorded creator = the burn program's fee PDA for the mint (review finding H-2). The human creator pays and signs; the keeper only pays gas. */
  burnPoolAuthority: string;
  transactions: { label: string; signers: ("creator" | "mint")[]; instructions: SerializedIx[] }[];
  notes: string[];
}

/**
 * The coin description's ceiling: the generated rule paragraph (describe.ts; a fade-side team coin's runs to about 850 characters) plus
 * the separator and the creator's own 280 (creatorProfile.ts DESCRIPTION_MAX). It was 800 until ChatGPT audit 6 (2026-10-12): every
 * fade-side team coin, and any team coin with a creator description, was refused by the bundle after a clean review. The description
 * lives in the pinned metadata JSON, not on chain, so nothing upstream limits it.
 */
export const DESCRIPTION_LIMIT = 1_500;
const TICKER_RE = /^[A-Z0-9]{2,10}$/;
const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** What the review step must have right before a bundle is built. Lists every problem. */
export function launchProblems(i: LaunchInput): string[] {
  const p: string[] = [];
  if (!PUBKEY_RE.test(i.creator)) p.push("creator must be a Solana public key");
  if (!TICKER_RE.test(i.ticker)) p.push("ticker must be 2–10 capitals/digits");
  // intent audit items 1 and 2: at least 2 visible characters and at most 32 bytes of UTF-8 (the metadata's limit), never truncated
  { const np = typeof i.name === "string" ? nameProblem(i.name) : "Enter a name for the coin."; if (np) p.push(np); }
  if (typeof i.description !== "string" || i.description.length > DESCRIPTION_LIMIT) p.push(`description must be ≤ ${DESCRIPTION_LIMIT.toLocaleString("en-US")} characters`);
  // intent audit item 13: a parsed https address with a real host name ("https://?" and "https://x" are not web addresses)
  if (i.imageUrl !== null && !isWebLink(i.imageUrl)) p.push("imageUrl must be an https URL or null");
  // audit 7 item 3: at most 4 links, each passing its field's own check (creatorProfile.ts linksProblems: https only, X = x.com /
  // twitter.com, Telegram = t.me, no burnticker.com or look-alike addresses); the review runs the same function
  p.push(...linksProblems(i.links));
  if (!/^\d+(\.\d{1,9})?$/.test(i.firstBuySol) || Number(i.firstBuySol) > 50) p.push("firstBuySol must be a SOL amount ≤ 50");
  if (!i.acknowledgements?.ruleLocked) p.push("you must acknowledge that the rule cannot be changed");
  if (!i.acknowledgements?.noReturns) p.push("you must acknowledge that you are not promising anyone anything");
  if (i.cluster !== "devnet" && i.cluster !== "localnet" && i.cluster !== "mainnet") p.push("cluster must be devnet, localnet or mainnet");
  const rp = raiseProblem(i.raiseSol, i.cluster);
  if (rp) p.push(rp);
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
  /** A pair's side B URI (each side's metadata is pinned on its own); defaults to metadataUri. */
  metadataUriB?: (mint: string) => string;
  mintKeypair?: Keypair;
  /**
   * Winner takes the burn (LAUNCHPAD-PATH §40), set only by buildPairBundles: the partner's mint for initialize_token's pair_mint, and
   * `partnerFirst` on the second coin (the partner's TokenConfig exists, so this coin's initialize_token completes the pairing). Absent
   * for every single coin — its initialize_token is byte-identical to before.
   */
  pairMint?: string;
  partnerFirst?: boolean;
  /** The caller's own mint PUBLIC key (base58); the bundle then carries no secret (mintSecretKey: null). Exclusive with mintKeypair. */
  mint?: string;
  /**
   * @deprecated ignored for the creator since the blind review's H-2 (2026-10-09): LaunchLab's recorded creator is ALWAYS the burn
   * program's fee PDA for the mint (src/lib/burnKeeper/burnPool.ts). Kept so older callers compile; the keeper is an attester only.
   */
  keeperPubkey?: string | null;
  /** Mainnet is refused unless this is true: the SDK's explicit opt-in, or the site host's BURNTICKER_ALLOW_MAINNET_LAUNCHES (prepareLaunch). */
  allowMainnet?: boolean;
}

/** r3 (RN-2): a paired coin's locked voidBy as the program's YYYYMMDD (the rules' pair.voidBy; both sides carry the same clause). */
function pairVoidByOf(rule: LockedRule["rule"]): number {
  const v = (rule.pair as { voidBy?: string } | null | undefined)?.voidBy;
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("pair: a paired coin's rule needs pair.voidBy (initialize_token's pair_void_by)");
  return Number(v.replace(/-/g, ""));
}

/** Composes the bundle. Pure apart from the mint keypair (fresh unless injected) and the two clients (fakes until the real ones land). */
export async function buildLaunchBundle(input: LaunchInput, deps: LaunchDeps): Promise<LaunchBundle> {
  const problems = launchProblems(input);
  if (problems.length) throw new Error(`launch: ${problems.join("; ")}`);
  if (input.cluster === "mainnet" && !deps.allowMainnet) throw new Error("launch: mainnet is refused unless the caller allows it explicitly (allowMainnet; on the site, the host's BURNTICKER_ALLOW_MAINNET_LAUNCHES)");
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
  const selectorKey = locked.rule.oracle === "derby" ? `derby:${locked.rule.series}` : locked.rule.oracle === "catalogue" ? `catalogue:${locked.rule.series}`
    : locked.rule.oracle === "polymarket" ? (locked.rule.market ? `polymarket:market:${locked.rule.market}` : `polymarket:${locked.rule.series}:${locked.rule.kind}`)
    : locked.rule.market ? `kalshi:market:${locked.rule.market}` : `kalshi:${locked.rule.series}`;
  const init = await deps.program.initializeToken({ mint, creator: input.creator, ticker: input.ticker, rulesSha256: locked.sha256, selectorKey, mode: locked.mode, attesters: deps.attesters, quorum: deps.quorum, vault, rule: locked.rule, ...(deps.pairMint ? { pairMint: deps.pairMint, partnerFirst: !!deps.partnerFirst, pairVoidBy: pairVoidByOf(locked.rule) } : {}) });
  const alloc = allocationFor(locked);
  const burnPoolAuthority = feePda;
  const create = await deps.launchLab.createLaunchIxs({
    cluster: input.cluster, platformId: deps.launchLab.platformId, creator: input.creator, mint, name: input.name.trim(), symbol: input.ticker, uri: deps.metadataUri(mint), decimals: 6,
    supply: toRaw(alloc.supply), totalSellA: toRaw(alloc.curve), totalFundRaisingB: raiseLamportsOf(input.raiseSol), totalLockedAmount: toRaw(alloc.locked),
    cliffPeriod: (alloc.cliffDays ?? 0) * 86_400, unlockPeriod: (alloc.vestDays ?? 0) * 86_400, creatorFeeRecipient: burnPoolAuthority, firstBuyLamports: BigInt(Math.round(Number(input.firstBuySol) * 1e9)),
  });
  const description = `${input.description.trim()}${input.description.trim() ? " " : ""}${descriptionFooter(locked)}`;
  // launch-10 (2026-10-12): the LaunchLab leg is pending only when its client builds placeholder instructions (FakeLaunchLab); with the
  // real client (ChainLaunchLab over SdkLaunchLab) and the real program client nothing is pending and the bundle is ready to sign.
  const pending = [...(deps.program.programId === PLACEHOLDER_PROGRAM_ID.toBase58() ? ["burn_receipts program (initialize_token is a placeholder instruction)"] : []), ...(deps.launchLab.placeholder !== false ? ["Raydium LaunchLab adapter src/lib/burnKeeper/launch.ts (initializeV2 is a placeholder instruction)"] : [])];
  const expressible = programExpressible(locked.rule, input.ticker);
  if (expressible) pending.push(`this rule cannot run on the current burn_receipts program: ${expressible}`);
  if (!deps.devFeeWallet) pending.push("BURNTICKER_FEE_WALLET (the developer fee wallet pubkey) is not set");
  return {
    version: "burnticker.launch/v1", cluster: input.cluster, metadataUri: deps.metadataUri(mint), ready: pending.length === 0, pending,
    creator: input.creator, mint, mintSecretKey: kp ? base58Encode(kp.secretKey) : null, ticker: input.ticker, name: input.name.trim(), description,
    rules: { text: locked.text, sha256: locked.sha256, sha12: locked.sha12, statement: ruleStatement(locked.rule), mode: locked.mode },
    addresses: { tokenConfig: init.tokenConfig, feePda, feeWsol: pool.feeWsol, vault, poolId: create.poolId, platformId: deps.launchLab.platformId, configId: create.configId },
    allocation: { supply: alloc.supply.toString(), curve: alloc.curve.toString(), locked: alloc.locked.toString(), reserve: alloc.reserve.toString(), vestDays: alloc.vestDays, cliffDays: alloc.cliffDays, lpBurnedPct: LP_BURNED_PCT, lpLockedPct: LP_LOCKED_PCT, teamAllocationPct: 0 },
    fees: { curve: CURVE_FEES, postGraduation: postGraduationFeesFor(input.cluster), creatorSliceBps: CREATOR_FEE_SLICE_BPS, sentence: feeSplitSentence(input.cluster), devFeeWallet: deps.devFeeWallet },
    burnPoolAuthority,
    transactions: [{ label: "initialize_token + LaunchLab create" + (Number(input.firstBuySol) > 0 ? " + first buy" : ""), signers: ["creator", "mint"], instructions: [...init.instructions, ...create.instructions] }],
    notes: [...create.notes, `LaunchLab's recorded creator is the burn program's fee PDA ${burnPoolAuthority} (its WSOL ATA ${pool.feeWsol} receives the claimed curve fees), not the human creator and not the keeper — the keeper only pays gas; the creator-fee slot pays the burn pool 100% (owner, 2026-10-09; review finding H-2)`, `${LP_POLICY_LINE}: ${LP_LOCKED_PCT}% of the graduation LP locked with Raydium's LP lock and its Fee Key owned by the burn program (platform config, not creator-configurable); team allocation 0%`, "the first burn needs fee income or a seed deposit into the burn pool; anyone can deposit, nobody can withdraw", "no referral code, fee discount or hidden parameter exists: every parameter is in rules.json"],
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
  /**
   * BOTH OR NEITHER (2026-10-10): the date (YYYY-MM-DD, UTC) by whose end both coins must have a registered pool, else the pair voids.
   * The caller passes a one-shot's first settlement date; absent = 30 days after `now` (default Date.now()).
   */
  voidBy?: string;
  now?: number;
}

/** The default voidBy for a pair: 30 days after launch (UTC date). */
export const defaultVoidBy = (now = Date.now()): string => new Date(now + 30 * 86_400_000).toISOString().slice(0, 10);

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
  if (!PAIR_ORACLES.includes(probe.oracle)) throw new Error("pair: v1 pairs must use a tier-1 adjudicated market source (kalshi or polymarket) or a Burn Derby coin-vs-coin selector");
  const selector = probe.market ?? `${probe.series}${probe.filter.tickerIncludes ? `:${probe.filter.tickerIncludes}` : ""}`;
  const pairId = input.pairId ?? pairIdFor(input.a.ticker, input.b.ticker, selector);
  // Both or neither: the clause is part of BOTH sides' canonical rules (invertMapping carries it to side B), so each hash locks it.
  // …and the onEnd wind-down (no burn pool is ever left behind), unless the caller's rule already names its own.
  // Winner takes the burn (2026-10-11): a one-shot pair moves the whole pool — both sides at 100 % (the loser forwards all of it).
  const probeFull = isOneShot(probe) ? withFullFraction(probe) : probe;
  const ruleA = validateRule({ ...probeFull, onEnd: probe.onEnd ?? { ...DEFAULT_ON_END }, pair: { pairId, side: "A", counterpartMint: null, clause: PAIR_CLAUSE, voidBy: input.voidBy ?? defaultVoidBy(input.now), winnerTakesBurn: true } });
  // On chain the pair is linked through initialize_token (LaunchLab pairs): A names B's mint (A is PROVISIONAL), B names A back with
  // partnerFirst inside the 7-day pairing window. So side A is never built alone: B's draft — its rule and its mint — exists before A's
  // initialize_token is composed. A caller-supplied mint public key (deps.mint) cannot pre-name B: those bundles pair in the registry only.
  const kpB = deps.mint === undefined ? Keypair.generate() : null;
  // r3 (M-1): the program pairs two coins only with the SAME attester set and quorum (same keys, same order) — both sides are built from
  // the one deps.attesters / deps.quorum below; refuse a set the program would refuse anyway.
  if (new Set(deps.attesters).size !== deps.attesters.length) throw new Error("pair: both coins need one attester set of distinct keys (the program refuses PairAttestersDiffer otherwise)");
  const a = await buildLaunchBundle({ ...input.a, rule: ruleA }, { ...deps, ...(kpB ? { pairMint: kpB.publicKey.toBase58(), partnerFirst: false } : {}) });
  const ruleB = invertMapping(ruleA, a.mint, pairId);
  const b = await buildLaunchBundle({ ...input.a, ticker: input.b.ticker, name: input.b.name, description: input.b.description, imageUrl: input.b.imageUrl, links: input.b.links, rule: ruleB }, { ...deps, mintKeypair: kpB ?? undefined, ...(kpB ? { pairMint: a.mint, partnerFirst: true } : {}), metadataUri: deps.metadataUriB ?? deps.metadataUri });
  return { pairId, a, b, selector, notes: [
    `rivalry pair ${pairId}: ${input.a.ticker} (side A) and ${input.b.ticker} (side B) on selector ${selector}; each settlement burns exactly one side`,
    "sign A's bundle first, then B's: B's rule names A's mint as counterpart; A's counterpart is recorded in the registry (A is created before B's mint exists)",
    "program seam: burn_receipts TokenConfig may carry no counterpart field; the link is in both rules.json files (pairId) and the registry's pairs table",
    "winner takes the burn (owner decision 2026-10-11): fees from both coins burn the winner's supply — at each result the other coin's fuel for that result moves to the winner's burn pool (forward_to_winner); nobody is paid, the other coin's supply is untouched, a draw or void moves nothing",
    `both or neither: event burns on either side apply only once both coins have a registered pool; if either has none when ${ruleA.pair!.voidBy} ends (UTC) the pair voids — no event burns ever, and each coin's pool winds down over ${ruleA.onEnd!.windDownDays} days`,
  ] };
}
