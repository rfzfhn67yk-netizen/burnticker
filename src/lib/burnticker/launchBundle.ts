import { STANDARD_RAISE_LAMPORTS } from "@/lib/burnKeeper/launch";
import { Keypair, PublicKey } from "@solana/web3.js";
import { LAUNCHLAB_PROGRAM, launchLabPoolId, WSOL_MINT } from "@/lib/burnKeeper/launchlab";
import { base58Encode } from "@/lib/burnKeeper/solana";
import { buildCreateTx, buildVestingTx, planLaunch, type DescribedIx, type GlobalConfigView, type LaunchInput as SdkLaunchInput, type PlatformView } from "@/lib/burnKeeper/launch";
import { CURVE_FEES, postGraduationFeesFor, CREATOR_FEE_SLICE_BPS, LP_BURNED_PCT, LP_LOCKED_PCT, burnPoolAddresses, feeSplitSentence, type FeeSplit } from "@/lib/burnticker/fees";
import { LP_POLICY_LINE } from "@/lib/burnticker/lockFees";
import { DECIMALS, descriptionFooter, endSinkOf, invertMapping, lockRule, DEFAULT_ON_END, defaultOnEndFor, PAIR_CLAUSE, isOneShot, type BurnRule, PAIR_ORACLES, pairIdFor, isMeetingsRule, meetingsMirrorId, gameMirrorId, GAME_WIN_SERIES_RE, ruleStatement, TOTAL_SUPPLY, validateRule, type LockedRule } from "@/lib/burnticker/rules";
import { isRaisePreset, RAISE_PRESETS_SOL } from "@/lib/burnticker/raisePresets";
import { LINKED_ONE_SHOT_REFUSAL as LINKED_ONE_SHOT_REFUSAL_TEXT } from "@/lib/burnticker/linkedShare";
import { isoDate, seasonEndMs } from "@/lib/burnticker/derby/spec";
import { nameProblem } from "@/lib/burnticker/launchFields";
import { DESCRIPTION_TOTAL_LIMIT, isWebLink, linksProblems } from "@/lib/burnticker/creatorProfile";
import { PLACEHOLDER_PROGRAM_ID, bundleSelectorKey, programExpressible, type BurnProgramClient, type ExpectedTokenConfig, type SerializedIx } from "@/lib/burnticker/program";
import { PIN_IX_LABEL_PREFIX, createAfterPinText, incineratorStepText, lockRuleStepText, pinStepText, type BurnTargetField } from "@/lib/burnticker/burnTarget";

/**
 * THE LAUNCH BUNDLE (LAUNCHPAD-PATH §1 step 6; 2026-10-09). The wallet signs, in two transactions since 2026-10-15 (launchTransactions):
 * (a) burn_receipts.initialize_token (TokenConfig + fee PDA), then (b) the Raydium LaunchLab create under OUR platform config with the token's fee PDA as the creator-fee recipient
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
 * THE GRADUATION RAISE (website-14, LAUNCHPAD-PATH §75): the coin's own totalFundRaisingB. On mainnet only the presets 10, 40, 60 and 85 SOL
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
  /** imageUrl: the address the registry row shows. The launch handler only ever sets it to the creator's uploaded image's own pinned
   *  copy (or null for the generated art); a caller's web address is refused there (imagePin.ts IMAGE_URL_REFUSED, 2026-10-19). */
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
   * The mint keypair's secret (base58), needed to co-sign the create: a fresh keypair made for this bundle (the public API without a
   * mint), or one the launch route took from the host's mint key bank (mintBank.ts, 2026-10-14 night; sealed there until handed out
   * once, wiped once the mint is live). The bundle itself is never stored with it.
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
  /** Audit F01: the TokenConfig initialize_token encodes (program.ts ExpectedTokenConfig); the host stores it with the draft and the confirm step compares the chain against it. */
  expectedConfig?: ExpectedTokenConfig | null;
}

/**
 * The coin description's ceiling: the generated rule paragraph (describe.ts; a fade-side team coin's runs to about 850 characters) plus
 * the separator and the creator's own 280 (creatorProfile.ts DESCRIPTION_MAX). It was 800 until ChatGPT audit 6 (2026-10-12): every
 * fade-side team coin, and any team coin with a creator description, was refused by the bundle after a clean review. The description
 * lives in the pinned metadata JSON, not on chain, so nothing upstream limits it.
 */
export const DESCRIPTION_LIMIT = DESCRIPTION_TOTAL_LIMIT;
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
   * 2026-10-14 night (the mint key bank, mintBank.ts): a pair's side B mint keypair taken from the host's bank, with `mintKeypair` for
   * side A (buildPairBundles only). Both addresses end in burn; both secrets ride in the bundles, as a fresh keypair's always did.
   */
  mintKeypairB?: Keypair;
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
   * 2026-10-14: a pair's side B mint PUBLIC key (buildPairBundles only), with `mint` for side A. The launch page grinds both in the
   * browser so their addresses end in burn; with both given, A's initialize_token names B's mint as before and no secret is made here.
   */
  mintB?: string;
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

/**
 * The bundle's transactions. Every LaunchLab coin is at least TWO transactions, each signed by the creator and the mint key.
 * A coin with a pinned token (rules.ts burnTarget; WIRING-ROUND5 item 2): pin_burn_target must run after initialize_token (it reads the
 * TokenConfig) and before the coin's mint exists (the program refuses MintAlreadyCreated), and initialize_token + pin + create is over
 * the packet limit, so it is TWO: [initialize_token, pin_burn_target], then [LaunchLab create (+ first buy)]. Measured as v0 against the
 * lookup table (test/burntickerPinSteps.test.ts): the first is at most about 1,020 bytes, the second is the create alone. Both are signed
 * by the creator and the mint. The recovery records keep their meaning: step i is transaction i of this list, as before.
 * A rule with a pinned token whose program client emitted no pin is refused: the coin would launch burning itself.
 * A coin of a LaunchLab PAIR (`paired`; buildPairBundles) is also TWO (2026-10-14, Phantom review ticket 438485): its initialize_token
 * carries the partner's accounts, which pushed initialize_token + create to 1,191 and 1,223 bytes as v0 + the table, too close to the
 * limit for a wallet that appends its own checks (Phantom's Lighthouse assertions). So it is [initialize_token], then [LaunchLab create]:
 * at most 829 and 694 bytes (test/burntickerLookupTable.test.ts). The create is the confirming step (signPlan.ts launchlabPlan), and
 * launchVerify.ts takes a create alone for a coin whose TokenConfig on chain is paired.
 * A SINGLE coin that burns itself is split the same way (2026-10-15): initialize_token + create in one v0 transaction with the table
 * measured 1,031 to 1,095 bytes, and the wallet's own appended checks (two Lighthouse assertions plus a compute-budget instruction)
 * took a synthetic launch to 1,234 bytes, over the 1,232 limit. So it is [initialize_token] ("Lock in $X's rule"), then [LaunchLab
 * create (+ first buy)] ("Create $X"), each well under 900 bytes (test/burntickerLookupTable.test.ts pins ≥ 330 bytes of headroom).
 * initialize_token does not need the mint account to exist (the pair split and the pin split already send it first). `paired` now only
 * names side B's lock step as the link; the shape is the same for every coin that burns itself.
 */
export function launchTransactions(input: Pick<LaunchInput, "ticker" | "firstBuySol">, locked: LockedRule, initIxs: SerializedIx[], createIxs: SerializedIx[], link = false, paired = false): LaunchBundle["transactions"] {
  const isPin = (ix: SerializedIx) => ix.label.startsWith(PIN_IX_LABEL_PREFIX);
  const pins = initIxs.filter(isPin), init = initIxs.filter((ix) => !isPin(ix));
  const bt = locked.rule.burnTarget;
  const firstBuy = Number(input.firstBuySol) > 0 ? " + first buy" : "";
  if (!bt) {
    if (pins.length) throw new Error("launch: the program client pinned a burn pool for a rule that burns its own coin");
    return [
      // owner decision 2026-10-19: a single coin on the incinerator end says the EndSink pin in its lock step (initialize_token pins it)
      { label: !paired && endSinkOf(locked.rule) === "incinerator" ? incineratorStepText(input.ticker) : lockRuleStepText(input.ticker, { link: link && paired }), signers: ["creator", "mint"], instructions: initIxs },
      { label: `${createAfterPinText(input.ticker)} (LaunchLab create${firstBuy})`, signers: ["creator", "mint"], instructions: createIxs },
    ];
  }
  if (pins.length !== 1) throw new Error(`launch: this rule burns ${bt.symbol}, and the burn program client did not pin ${bt.symbol}'s pool, so the coin would burn itself instead. Nothing was built.`);
  return [
    { label: pinStepText(input.ticker, bt.symbol, { link }), signers: ["creator", "mint"], instructions: [...init, pins[0]] },
    { label: `${createAfterPinText(input.ticker)} (LaunchLab create${firstBuy})`, signers: ["creator", "mint"], instructions: createIxs },
  ];
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
  const selectorKey = bundleSelectorKey(locked.rule);
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
    transactions: launchTransactions(input, locked, init.instructions, create.instructions, !!deps.partnerFirst, !!deps.pairMint),
    expectedConfig: init.expected ?? null,
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
  b: { ticker: string; name: string; description: string; imageUrl: string | null; links: { label: string; url: string }[]; /** side B's own pinned token (round 5); side A's is never inherited */ burnTarget?: BurnTargetField | null };
  /** Optional; derived from the tickers and the selector when absent (deterministic). */
  pairId?: string;
  pairIdPick?: (base: string) => string;
  /**
   * BOTH OR NEITHER (2026-10-10): the date (YYYY-MM-DD, UTC) by whose end both coins must have a registered pool, else the pair voids.
   * The caller passes a one-shot's first settlement date; absent = 30 days after `now` (default Date.now()).
   */
  voidBy?: string;
  now?: number;
  /**
   * TWO CANDIDATES IN ONE RACE (owner 2026-10-13: the linked form is the only form for candidates): side A's rule reads candidate A's
   * Polymarket outcome market, side B reads `marketB` (candidate B's market of the same race `slug`). Both rules carry pair.race, both
   * burn on their own YES at 100 %, both end on the pair-winner sink naming each other, and voidBy is the 30-day both-or-neither date.
   * The caller (handlers.ts prepareLaunch) checks that both markets are named outcomes of that race.
   */
  race?: { slug: string; marketB: string };
  /**
   * TWO TEAMS IN ONE GAME (2026-10-13: a one-game rivalry pair is linked by default): side A's rule is its team's win series of the game
   * (sources/espn.ts gameSeries, outcome `win`); side B reads the same game's win series of `opp` (rules.ts gameMirrorId). Both rules carry
   * pair.game, both burn their whole budget on their own team's win, both end on the pair-winner sink naming each other.
   */
  game?: { opp: string };
}

/** The default voidBy for a pair: 30 days after launch (UTC date). */
export const defaultVoidBy = (now = Date.now()): string => new Date(now + 30 * 86_400_000).toISOString().slice(0, 10);
/**
 * Audit 12 item 2: the void date the bundle route gives a pair (handlers.ts prepareLaunch), when it is known without a network read: the
 * 30-day date for a settled-event pair and for a pair that repeats, the day before the season ends for the flippening. Null for a
 * one-market pair, whose date is the market's own end date (the route reads it; the review route passes it in).
 */
export function pairVoidByOffline(rule: Pick<BurnRule, "oracle" | "market" | "derby">, o: { settled: boolean; now?: number }): string | null {
  if (o.settled) return defaultVoidBy(o.now);
  if (rule.oracle === "derby" && rule.derby?.selector === "coinvs" && rule.derby.flip) return isoDate(seasonEndMs(rule.derby) - 86_400_000);
  if ((rule.oracle === "kalshi" || rule.oracle === "polymarket") && rule.market) return null;
  return defaultVoidBy(o.now);
}

/** A head-to-head series pair always ends on the pair-winner sink (the rest goes to the series winner); a rule without the end sink is refused. */
export const MEETINGS_END_SINK_REFUSAL = "A head-to-head season pair sends whatever is left at the end to the coin of the team that won more of their games, so its rule must keep the end sink (onEnd.endSink).";
/** A candidates pair always ends on the pair-winner sink: the loser's pool goes to the winner's burn, or to $DEFICIT's when nobody won. */
export const CANDIDATES_END_SINK_REFUSAL = "Two candidates in one race send the losing coin's pool to the winning coin's burn, and both pools to $DEFICIT's burn when neither candidate wins, so both rules must keep the end sink (onEnd.endSink).";
/** A one-game pair always ends on the pair-winner sink: the losing team's coin's pool goes to the winning team's coin's burn. */
export const GAME_PAIR_END_SINK_REFUSAL = "Two teams in one game send the losing team's coin's pool to the winning team's coin's burn, and both pools to $DEFICIT's burn after a draw, so both rules must keep the end sink (onEnd.endSink).";
export interface PairBundles { pairId: string; a: LaunchBundle; b: LaunchBundle; selector: string; notes: string[] }

/**
 * Two bundles, built in order: A first (its fresh mint), then B whose rule is `invertMapping(A.rule, A.mint)` — same selector, the
 * mapping inverted, the same pairId in both canonical rules, B naming A's mint as counterpart. Each side is hashed on its own. The
 * wallet signs A's bundle, then B's. SEAM FOR THE PROGRAM BUILDER: if burn_receipts' TokenConfig has no counterpart field, the link
 * lives in each side's rules.json (pairId; B's counterpartMint) and in the registry's pairs table — nothing else needs it.
 */
/**
 * AUDIT 12 item 1: a linked pair on a rule that resolves once (one market, the flippening, two candidates, one game) moves the whole pool:
 * the winning coin burns all of its own pool and takes the other coin's. 100 % is the only share; any other is refused, never rewritten.
 */
export { LINKED_ONE_SHOT_REFUSAL } from "@/lib/burnticker/linkedShare";
/** True when every mapping of the rule spends the whole pool (the share a linked one-shot pair takes). */
export const linkedShareIsFull = (r: Pick<BurnRule, "kind" | "binary" | "scalar">): boolean => {
  const ms = r.kind === "binary" ? [r.binary?.onYes, r.binary?.onNo] : [r.scalar?.perUnit];
  return ms.every((m) => !m || m.fractionOfPool === undefined || m.fractionOfPool === 1);
};

/** What preparePairRules needs: side A's ticker and rule, side B's ticker and own pin, and the linking choices. */
/** A stand-in public key used only to validate side B's draft before side A's mint exists (never built, never shown). */
const PENDING_MINT = "11111111111111111111111111111111";
export interface PairRulesInput { a: { ticker: string; rule: unknown }; b: { ticker: string; burnTarget?: BurnTargetField | null }; pairId?: string; /** 2026-10-14: picks a free pair id from the derived base (registry.freePairId); identity by default */ pairIdPick?: (base: string) => string; voidBy?: string; now?: number; race?: PairLaunchInput["race"]; game?: PairLaunchInput["game"] }
export interface PreparedPairRules { pairId: string; selector: string; ruleA: BurnRule; sideB: (counterpartMintA: string | null) => BurnRule; race: { slug: string; markets: [string, string] } | null; game: { series: [string, string] } | null }
/**
 * THE ONE PREPARATION PATH FOR A PAIR'S TWO RULES (audit 12 item 2, 2026-10-13). The review and the bundle both call this, so the rules
 * the review shows are the rules the wallet signs: the pair clause, the void date, winner takes the burn, the race or the game, side B's
 * own pin. `sideB(mint)` takes side A's mint: the bundle passes the new mint; the review passes null, the one field not known before the
 * coins are made (preparedRulesCheck compares everything else).
 */
export function preparePairRules(input: PairRulesInput): PreparedPairRules {
  if (input.a.ticker === input.b.ticker) throw new Error("pair: the two sides need different tickers");
  const probe = validateRule({ ...(input.a.rule as object), pair: null });
  // the rivalry series (sources/espn.ts window `meetings`): the one catalogue source that pairs; side B reads the mirror series
  const meetings = isMeetingsRule(probe);
  // two teams in one game: each coin on its own team's win series of that game; side B reads the mirror (the opponent's)
  const gameB = input.game ? gameMirrorId(probe.series ?? "", input.game.opp) : null;
  if (input.game && (probe.oracle !== "catalogue" || !GAME_WIN_SERIES_RE.test(probe.series ?? "") || !gameB)) throw new Error("pair: two teams in one game read each team's win series of that game, one per coin, and the two teams differ");
  if (input.game && probe.onEnd && probe.onEnd.endSink !== true) throw new Error(GAME_PAIR_END_SINK_REFUSAL);
  const game = gameB ? { series: [probe.series!, gameB] as [string, string] } : null;
  if (!PAIR_ORACLES.includes(probe.oracle) && !meetings && !game) throw new Error("pair: v1 pairs must use a tier-1 adjudicated market source (kalshi or polymarket), a Burn Derby coin-vs-coin selector, or a head-to-head season series between two teams");
  const mirror = meetings ? meetingsMirrorId(probe.series!) : null;
  if (meetings && !mirror) throw new Error("pair: the head-to-head series names a team or an opponent this site does not know");
  if (meetings && probe.onEnd && probe.onEnd.endSink !== true) throw new Error(MEETINGS_END_SINK_REFUSAL);
  // two candidates in one race: two Polymarket outcome markets, each side on its own, YES only; never the pair curve (handlers.ts)
  const race = input.race ? { slug: input.race.slug, markets: [probe.market ?? "", input.race.marketB.toLowerCase()] as [string, string] } : null;
  if (race) {
    if (probe.oracle !== "polymarket" || !probe.market) throw new Error("pair: two candidates in one race read two Polymarket outcome markets, one per coin");
    if (probe.onEnd && probe.onEnd.endSink !== true) throw new Error(CANDIDATES_END_SINK_REFUSAL);
  }
  // Winner takes the burn (2026-10-11): a one-shot pair moves the whole pool, both sides at 100 %. Audit 12 item 1: a share other than
  // 100 % is refused here, never rewritten (the page offers 100 % only; launchPreflight.ts refuses it before anything is built).
  if (isOneShot(probe) && !linkedShareIsFull(probe)) throw new Error(LINKED_ONE_SHOT_REFUSAL_TEXT);
  const selector = probe.market ?? `${probe.series}${probe.filter.tickerIncludes ? `:${probe.filter.tickerIncludes}` : ""}`;
  const pairId = input.pairId ?? (input.pairIdPick ?? ((b: string) => b))(pairIdFor(input.a.ticker, input.b.ticker, race ? race.slug : selector));
  // Both or neither: the clause is part of BOTH sides' canonical rules (invertMapping carries it to side B), so each hash locks it.
  // …and the onEnd wind-down (no burn pool is ever left behind), unless the caller's rule already names its own.
  const ruleA = validateRule({ ...probe, onEnd: probe.onEnd ?? defaultOnEndFor(probe), pair: { pairId, side: "A", counterpartMint: null, clause: PAIR_CLAUSE, voidBy: input.voidBy ?? defaultVoidBy(input.now), winnerTakesBurn: true, ...(race ? { race } : {}), ...(game ? { game } : {}) } });
  // Round 5 (WIRING-ROUND5 item 1): each side carries its OWN pinned token. Side A's never reaches side B (every branch below starts
  // from ruleA, so it is stripped here); side B's comes from input.b.burnTarget and is part of side B's hashed rule.
  const { burnTarget: _sideATarget, ...ruleABase } = ruleA;
  void _sideATarget;
  const sideB = (mintA0: string | null): BurnRule => {
    // the review's draft of side B has no side A mint yet: it is validated with a stand-in (side B must name one), then shown with it empty
    const mintA = mintA0 ?? PENDING_MINT;
    // a head-to-head series: side B counts ITS team's results on the mirror series (direction up), so each coin reads its own team
    // two candidates: side B reads candidate B's own market with the same YES mapping (never the inverted one)
    const ruleB0 = mirror ? { ...ruleABase, series: mirror, pair: { ...ruleA.pair!, side: "B" as const, counterpartMint: mintA } }
      : race ? { ...ruleABase, market: race.markets[1], pair: { ...ruleA.pair!, side: "B" as const, counterpartMint: mintA } }
      : game ? { ...ruleABase, series: game.series[1], pair: { ...ruleA.pair!, side: "B" as const, counterpartMint: mintA } }
      : invertMapping(ruleA, mintA, pairId);
    const v = validateRule(input.b.burnTarget ? { ...ruleB0, burnTarget: input.b.burnTarget } : ruleB0);
    return mintA0 === null ? { ...v, pair: { ...v.pair!, counterpartMint: null } } : v;
  };
  return { pairId, selector, ruleA, sideB, race, game };
}

/**
 * THE PREPARED RULES, RE-CHECKED BEFORE THE WALLET (audit 12 item 2). The review's `prepared` block holds each side's canonical text and
 * fingerprint as preparePairRules made them; side B's names side A's mint, which exists only once the bundle is built, so it is held with
 * that field empty. Given the bundle's own rules (and side A's new mint), this returns every difference in plain words; an empty list
 * means the wallet is asked to sign exactly what the review showed.
 */
export interface PreparedSide { side: "A" | "B"; text: string; sha256: string; final: boolean; pending: string[] }
export function preparedRulesCheck(prepared: { sides: readonly PreparedSide[] }, built: { a: { text: string; sha256: string; mint: string }; b?: { text: string; sha256: string } | null }): string[] {
  const out: string[] = [];
  const say = (side: "A" | "B") => `Coin ${side}'s rule changed after the review. Check the review again before signing.`;
  for (const p of prepared.sides) {
    const got = p.side === "A" ? built.a : built.b ?? null;
    if (!got) { out.push(`Coin ${p.side} is missing from the prepared launch. Check the review again before signing.`); continue; }
    let want = p.text;
    if (p.pending.includes("pair.counterpartMint")) {
      try { const r = JSON.parse(p.text) as BurnRule; want = lockRule({ ...r, pair: { ...r.pair!, counterpartMint: built.a.mint } }).text; } catch { out.push(say(p.side)); continue; }
    }
    if (p.pending.includes("pair.voidBy")) {
      // the void date was read by the bundle route; every other field must match
      try { const w = JSON.parse(want) as BurnRule, g = JSON.parse(got.text) as BurnRule; want = lockRule({ ...w, pair: { ...w.pair!, voidBy: g.pair?.voidBy ?? w.pair?.voidBy } }).text; } catch { out.push(say(p.side)); continue; }
    }
    if (want !== got.text || lockRule(JSON.parse(got.text)).sha256 !== got.sha256) out.push(say(p.side));
  }
  return out;
}

export async function buildPairBundles(input: PairLaunchInput, deps: LaunchDeps): Promise<PairBundles> {
  const { pairId, selector, ruleA, sideB, race, game } = preparePairRules({ a: { ticker: input.a.ticker, rule: input.a.rule }, b: { ticker: input.b.ticker, burnTarget: input.b.burnTarget }, pairIdPick: input.pairIdPick, pairId: input.pairId, voidBy: input.voidBy, now: input.now, race: input.race, game: input.game });
  // On chain the pair is linked through initialize_token (LaunchLab pairs): A names B's mint (A is PROVISIONAL), B names A back with
  // partnerFirst inside the 7-day pairing window. So side A is never built alone: B's draft — its rule and its mint — exists before A's
  // initialize_token is composed. A caller-supplied mint public key (deps.mint) cannot pre-name B: those bundles pair in the registry only.
  if (deps.mintB !== undefined && (deps.mint === undefined || !PUBKEY_RE.test(deps.mintB))) throw new Error("pair: side B's mint public key needs side A's too, and both must be Solana public keys");
  if (deps.mintB !== undefined && deps.mintB === deps.mint) throw new Error("pair: the two coins need two different mints");
  if (deps.mintKeypairB && (deps.mint !== undefined || !deps.mintKeypair)) throw new Error("pair: side B's bank keypair needs side A's bank keypair, and no public key");
  if (deps.mintKeypairB && deps.mintKeypair && deps.mintKeypairB.publicKey.equals(deps.mintKeypair.publicKey)) throw new Error("pair: the two coins need two different mints");
  const kpB = deps.mint === undefined ? deps.mintKeypairB ?? Keypair.generate() : null;
  // the partner B's mint when it is known before A is built: a fresh keypair here, or the caller's own public key (mintB)
  const mintBKnown = kpB ? kpB.publicKey.toBase58() : deps.mintB !== undefined ? new PublicKey(deps.mintB).toBase58() : null;
  // r3 (M-1): the program pairs two coins only with the SAME attester set and quorum (same keys, same order) — both sides are built from
  // the one deps.attesters / deps.quorum below; refuse a set the program would refuse anyway.
  if (new Set(deps.attesters).size !== deps.attesters.length) throw new Error("pair: both coins need one attester set of distinct keys (the program refuses PairAttestersDiffer otherwise)");
  const { mintB: _ownB, mintKeypairB: _bankB, ...depsA } = deps;
  void _ownB; void _bankB;
  const a = await buildLaunchBundle({ ...input.a, rule: ruleA }, { ...depsA, ...(mintBKnown ? { pairMint: mintBKnown, partnerFirst: false } : {}) });
  const ruleB = sideB(a.mint);
  const b = await buildLaunchBundle({ ...input.a, ticker: input.b.ticker, name: input.b.name, description: input.b.description, imageUrl: input.b.imageUrl, links: input.b.links, rule: ruleB }, { ...depsA, ...(deps.mintB !== undefined ? { mint: deps.mintB } : {}), mintKeypair: kpB ?? undefined, ...(mintBKnown ? { pairMint: a.mint, partnerFirst: true } : {}), metadataUri: deps.metadataUriB ?? deps.metadataUri });
  return { pairId, a, b, selector, notes: [
    ...(race ? [`candidates pair ${pairId}: ${input.a.ticker} on market ${race.markets[0]} and ${input.b.ticker} on market ${race.markets[1]}, two outcomes of the race ${race.slug}; the race counts once both markets are final: exactly one YES → that coin burns its own pool and the other's pool forwards to it; otherwise both pools go to $DEFICIT's burn at the end`] : []),
    ...(game ? [`one-game pair ${pairId}: ${input.a.ticker} on ${game.series[0]} and ${input.b.ticker} on ${game.series[1]}; the game counts once both results are final: the winning team's coin burns its whole budget and the other coin's pool forwards to it; a draw sends both pools to $DEFICIT's burn at the end; a cancelled game ends void`] : []),
    ...(race || game ? [] : [`rivalry pair ${pairId}: ${input.a.ticker} (side A) and ${input.b.ticker} (side B) on selector ${selector}; each settlement burns exactly one side`]),
    "sign A's bundle first, then B's: B's rule names A's mint as counterpart; A's counterpart is recorded in the registry (A is created before B's mint exists)",
    "program seam: burn_receipts TokenConfig may carry no counterpart field; the link is in both rules.json files (pairId) and the registry's pairs table",
    "winner takes the burn (owner decision 2026-10-11): fees from both coins burn the winner's supply — at each result the other coin's fuel for that result moves to the winner's burn pool (forward_to_winner); nobody is paid, the other coin's supply is untouched, a draw or void moves nothing",
    `both or neither: event burns on either side apply only once both coins have a registered pool; if either has none when ${ruleA.pair!.voidBy} ends (UTC) the pair voids — no event burns ever, and each coin's pool winds down over ${ruleA.onEnd!.windDownDays} days`,
  ] };
}
