import { WSOL_MINT } from "@/lib/burnKeeper/launchlab";
import { DECIMALS, TOTAL_SUPPLY } from "@/lib/burnticker/rules";
import type { ExpectedLaunchCreate, SerializedIx } from "@/lib/burnticker/program";

/**
 * THE LAUNCHLAB CREATE'S ARGUMENTS ARE CHECKED AT CONFIRM (B-1, third audit 2026-10-19). The confirm step compared the TokenConfig, the
 * end sink and the burn target field by field, but read only four account slots of LaunchLab's initialize_v2, never its data. A creator
 * who edited the unsigned create went live with another on-chain name, symbol or metadata URI (a server they control instead of the
 * Arweave pin), another supply or decimals, or a 1 SOL raise instead of 85, while the site listed the coin under the reviewed ticker. The
 * mainnet platform has restrictCurveParam = 0, so LaunchLab does not pin the curve either.
 *
 *   PREPARE   the bundle's own initialize_v2 is decoded (expectedCreateFromBundle) and stored with the draft's expectation
 *             (program.ts ExpectedTokenConfig.launchCreate, status key launch.expect.<mint>): exactly what the site built.
 *   CONFIRM   launchVerify.ts decodes the create that landed (decodeInitializeV2, the layout of the Raydium SDK's instrument.ts
 *             initializeV2) and compares every argument and the venue accounts (createArgsMismatch). Whatever the expectation, the values
 *             every Burnticker coin shares are compared too (decimals 6, one billion tokens, the constant curve, the CPMM migration, the
 *             creator fee on the SOL side, SOL as the quote, a raise from 0.1 to 85 SOL).
 *   FALLBACK  a draft prepared before this change has no stored arguments: admission.ts fallbackExpectedCreate rebuilds what the rule
 *             and the bundle recipe fix (name and symbol from the draft row, supply and decimals from the recipe, the curve split and the
 *             lock from the rule's mode, the URI from the registry's token_meta, the platform and pool from the row, the raise as one of
 *             the raises the site could build on that network).
 *
 * On-chain text is never echoed in a refusal (only numbers, keys and this draft's own values).
 */

/** Raydium LaunchLab initialize_v2: sha256("global:initialize_v2")[0..8] (the SDK's anchorDataBuf.initializeV2). */
export const LAUNCHLAB_INITIALIZE_V2 = Buffer.from([67, 153, 175, 39, 218, 16, 38, 32]);
/** initialize_v2's account order (SDK instrument.ts; src/lib/burnKeeper/launch.ts INIT_V2_ROLES). */
export const LL_SLOTS = { payer: 0, creator: 1, globalConfig: 2, platform: 3, pool: 5, mint: 6, quoteMint: 7 } as const;

/** The supply every coin is built with (rules.ts TOTAL_SUPPLY whole tokens at DECIMALS). */
export const SITE_SUPPLY_RAW = (BigInt(TOTAL_SUPPLY) * BigInt(10) ** BigInt(DECIMALS)).toString();
/** The raises launchBundle.ts raiseProblem can let through on any network: 0.1 to 85 SOL. */
export const SITE_RAISE_MIN_LAMPORTS = "100000000";
export const SITE_RAISE_MAX_LAMPORTS = "85000000000";

export interface DecodedInitializeV2 {
  decimals: number; name: string; symbol: string; uri: string;
  curveIndex: number; supply: bigint; totalSellA: bigint | null; totalFundRaisingB: bigint; migrateType: number;
  totalLockedAmount: bigint; cliffPeriod: bigint; unlockPeriod: bigint; cpmmCreatorFeeOn: number;
}

/**
 * initialize_v2's data, borsh as the SDK writes it: the discriminator, then u8 decimals, string name, string symbol, string uri (each a
 * u32 length and UTF-8 bytes), the curve (u8 index; index 0, the constant curve: u64 supply, u64 totalSellA, u64 totalFundRaisingB,
 * u8 migrateType; index 1 or 2: u64 supply, u64 totalFundRaisingB, u8 migrateType), then u64 totalLockedAmount, u64 cliffPeriod,
 * u64 unlockPeriod and u8 cpmmCreatorFeeOn. Throws on another discriminator, short data or bytes left over.
 */
export function decodeInitializeV2(data: Uint8Array): DecodedInitializeV2 {
  const b = Buffer.from(data);
  if (b.length < 8 || !b.subarray(0, 8).equals(LAUNCHLAB_INITIALIZE_V2)) throw new Error("not initialize_v2");
  let o = 8;
  const need = (n: number) => { if (o + n > b.length) throw new Error("the data ends early"); };
  const u8 = () => { need(1); return b[o++]; };
  const u64 = () => { need(8); const v = b.readBigUInt64LE(o); o += 8; return v; };
  const str = () => { need(4); const n = b.readUInt32LE(o); o += 4; if (n > 1024) throw new Error("a text argument is too long"); need(n); const s = b.subarray(o, o + n).toString("utf8"); o += n; return s; };
  const decimals = u8(), name = str(), symbol = str(), uri = str();
  const curveIndex = u8();
  let supply: bigint, totalSellA: bigint | null = null, totalFundRaisingB: bigint;
  if (curveIndex === 0) { supply = u64(); totalSellA = u64(); totalFundRaisingB = u64(); }
  else if (curveIndex === 1 || curveIndex === 2) { supply = u64(); totalFundRaisingB = u64(); }
  else throw new Error(`unknown curve ${curveIndex}`);
  const migrateType = u8();
  const totalLockedAmount = u64(), cliffPeriod = u64(), unlockPeriod = u64();
  const cpmmCreatorFeeOn = u8();
  if (o !== b.length) throw new Error("bytes are left over after the arguments");
  return { decimals, name, symbol, uri, curveIndex, supply, totalSellA, totalFundRaisingB, migrateType, totalLockedAmount, cliffPeriod, unlockPeriod, cpmmCreatorFeeOn };
}

/** The bundle's own create instruction for `mint` (initialize_v2 with the mint at its slot), or null (a pair-curve side, a placeholder). */
export function bundleCreateIx(transactions: { instructions: SerializedIx[] }[], mint: string): SerializedIx | null {
  for (const t of transactions) for (const ix of t.instructions) {
    let data: Buffer;
    try { data = Buffer.from(ix.dataBase64, "base64"); } catch { continue; }
    if (data.length >= 8 && data.subarray(0, 8).equals(LAUNCHLAB_INITIALIZE_V2) && ix.keys[LL_SLOTS.mint]?.pubkey === mint) return ix;
  }
  return null;
}

/** What the bundle's create encodes, as the expectation stored at prepare; null when the bundle carries no decodable create. */
export function expectedCreateFromBundle(transactions: { instructions: SerializedIx[] }[], mint: string): ExpectedLaunchCreate | null {
  const ix = bundleCreateIx(transactions, mint);
  if (!ix) return null;
  let d: DecodedInitializeV2;
  try { d = decodeInitializeV2(Buffer.from(ix.dataBase64, "base64")); } catch { return null; }
  const key = (slot: number) => ix.keys[slot]?.pubkey ?? null;
  return {
    version: 1, decimals: d.decimals, name: d.name, symbol: d.symbol, uri: d.uri,
    curveIndex: d.curveIndex, supply: d.supply.toString(), totalSellA: d.totalSellA === null ? null : d.totalSellA.toString(), totalFundRaisingB: d.totalFundRaisingB.toString(), migrateType: d.migrateType,
    totalLockedAmount: d.totalLockedAmount.toString(), cliffPeriod: d.cliffPeriod.toString(), unlockPeriod: d.unlockPeriod.toString(), cpmmCreatorFeeOn: d.cpmmCreatorFeeOn,
    globalConfig: key(LL_SLOTS.globalConfig), platform: key(LL_SLOTS.platform), poolId: key(LL_SLOTS.pool), quoteMint: key(LL_SLOTS.quoteMint) ?? WSOL_MINT.toBase58(),
  };
}

const isStr = (x: unknown): x is string => typeof x === "string";
const strOrNull = (x: unknown) => x === null || isStr(x);
const digits = (x: unknown) => isStr(x) && /^\d{1,20}$/.test(x);
const digitsOrNull = (x: unknown) => x === null || digits(x);

/** A stored launchCreate that has every field in its type (anything else is treated as absent, so the fallback applies). */
export function validExpectedCreate(x: unknown): x is ExpectedLaunchCreate {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  return e.version === 1 && typeof e.decimals === "number" && strOrNull(e.name) && strOrNull(e.symbol) && strOrNull(e.uri) && typeof e.curveIndex === "number" && digits(e.supply)
    && digitsOrNull(e.totalSellA) && digitsOrNull(e.totalFundRaisingB) && typeof e.migrateType === "number" && digitsOrNull(e.totalLockedAmount) && digitsOrNull(e.cliffPeriod)
    && digitsOrNull(e.unlockPeriod) && typeof e.cpmmCreatorFeeOn === "number" && strOrNull(e.globalConfig) && strOrNull(e.platform) && strOrNull(e.poolId) && isStr(e.quoteMint);
}

/** What every Burnticker coin's create carries, whatever the draft (the check when no expectation is known at all). */
export function baselineExpectedCreate(): ExpectedLaunchCreate {
  return {
    version: 1, fallback: true, decimals: DECIMALS, name: null, symbol: null, uri: null, curveIndex: 0, supply: SITE_SUPPLY_RAW, totalSellA: null, totalFundRaisingB: null, migrateType: 1,
    raise: { minLamports: SITE_RAISE_MIN_LAMPORTS, maxLamports: SITE_RAISE_MAX_LAMPORTS, presetsLamports: null },
    totalLockedAmount: null, cliffPeriod: null, unlockPeriod: null, cpmmCreatorFeeOn: 0, globalConfig: null, platform: null, poolId: null, quoteMint: WSOL_MINT.toBase58(),
  };
}

const sets = (what: string, chain: string | number, ours: string | number, unit = ""): string => `the LaunchLab create sets ${what} to ${chain}${unit}; this draft builds ${ours}${unit}`;
const carries = (what: string, ours: string | null): string => `the LaunchLab create carries another ${what} than this draft's${ours ? ` (${ours})` : ""}`;
const shortKey = (k: string): string => `${k.slice(0, 8)}…`;

/**
 * The first argument or account where the create that landed differs from what this draft built, as a short sentence naming it, or null.
 * `accounts` are the create's resolved account keys. The baseline (what every coin shares) is compared before the draft's own values.
 */
export function createArgsMismatch(d: DecodedInitializeV2, accounts: string[], exp: ExpectedLaunchCreate | null): string | null {
  const base = baselineExpectedCreate();
  for (const e of exp ? [base, exp] : [base]) {
    if (d.decimals !== e.decimals) return sets("the decimals", d.decimals, e.decimals);
    if (d.curveIndex !== e.curveIndex) return sets("the curve type", d.curveIndex, e.curveIndex);
    if (d.supply.toString() !== e.supply) return sets("the supply", d.supply.toString(), e.supply, " raw units");
    if (d.migrateType !== e.migrateType) return sets("the graduation venue", d.migrateType, e.migrateType);
    if (d.cpmmCreatorFeeOn !== e.cpmmCreatorFeeOn) return sets("the side the creator fee is taken on", d.cpmmCreatorFeeOn, e.cpmmCreatorFeeOn);
    const quote = accounts[LL_SLOTS.quoteMint];
    if (quote !== e.quoteMint) return `the LaunchLab create quotes the coin in another token (${quote ? shortKey(quote) : "none"}) than SOL`;
    if (e.name !== null && d.name !== e.name) return carries("name", null);
    if (e.symbol !== null && d.symbol !== e.symbol) return carries("symbol", e.symbol);
    if (e.uri !== null && d.uri !== e.uri) return carries("metadata address", null);
    if (e.totalSellA !== null && (d.totalSellA === null ? "none" : d.totalSellA.toString()) !== e.totalSellA) return sets("the tokens sold on the curve", d.totalSellA === null ? "none" : d.totalSellA.toString(), e.totalSellA, " raw units");
    const raise = d.totalFundRaisingB.toString();
    if (e.totalFundRaisingB !== null && raise !== e.totalFundRaisingB) return sets("the graduation raise", raise, e.totalFundRaisingB, " lamports");
    if (e.raise) {
      const r = d.totalFundRaisingB;
      if (r < BigInt(e.raise.minLamports) || r > BigInt(e.raise.maxLamports)) return `the LaunchLab create sets the graduation raise to ${raise} lamports, outside the ${e.raise.minLamports} to ${e.raise.maxLamports} lamports this site builds`;
      if (e.raise.presetsLamports && !e.raise.presetsLamports.includes(raise)) return `the LaunchLab create sets the graduation raise to ${raise} lamports, which is not one of the raises this site builds on this network (${e.raise.presetsLamports.join(", ")} lamports)`;
    }
    if (e.totalLockedAmount !== null && d.totalLockedAmount.toString() !== e.totalLockedAmount) return sets("the locked amount", d.totalLockedAmount.toString(), e.totalLockedAmount, " raw units");
    if (e.cliffPeriod !== null && d.cliffPeriod.toString() !== e.cliffPeriod) return sets("the cliff", d.cliffPeriod.toString(), e.cliffPeriod, " seconds");
    if (e.unlockPeriod !== null && d.unlockPeriod.toString() !== e.unlockPeriod) return sets("the unlock period", d.unlockPeriod.toString(), e.unlockPeriod, " seconds");
    const acct = (slot: number, want: string | null, what: string): string | null => {
      if (want === null) return null;
      const got = accounts[slot];
      return got === want ? null : `the LaunchLab create names another ${what} (${got ? shortKey(got) : "none"}) than this draft's (${shortKey(want)})`;
    };
    const a = acct(LL_SLOTS.globalConfig, e.globalConfig, "LaunchLab config") ?? acct(LL_SLOTS.platform, e.platform, "LaunchLab platform") ?? acct(LL_SLOTS.pool, e.poolId, "curve pool");
    if (a) return a;
  }
  return null;
}
