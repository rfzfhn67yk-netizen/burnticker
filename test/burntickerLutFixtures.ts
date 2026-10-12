// THE REAL LAUNCH BUNDLES, BUILT OFFLINE, FOR THE LOOKUP-TABLE AND WIRE-SIZE TESTS (re-check 2026-10-11, "known oversized single launch").
// The same construction as the F3 (review 2) fixture in test/burntickerCodexReview.test.ts — the real initialize_token encoding (the
// program's IDL) plus the SDK's own LaunchLab initialize_v2 — but with the network's REAL ids (burn_receipts, the Burnticker LaunchLab
// platform, LaunchLab's global config, the CPMM config), so the static accounts the bundles reference are the ones a real launch on that
// network references. Nothing here reads a network or a key file.
import { Keypair, PublicKey } from "@solana/web3.js";
import { buildLaunchBundle, buildPairBundles, SdkLaunchLab, type LaunchBundle } from "@/lib/burnticker/launchBundle";
import { buildPairCurveLaunch, type PairCurveLaunchBundle } from "@/lib/burnticker/pairCurveLaunch";
import { counterRule, endSinkPin, FakeBurnProgram } from "@/lib/burnticker/program";
import { END_SINK_FLAGSHIP, END_SINK_PAIR_WINNER } from "@/lib/burnReceipts/endSink";
import { DEFAULT_ON_END } from "@/lib/burnticker/rules";
import { initializeTokenIx, operatorAttester } from "@/lib/burnReceipts/instructions";
import { burnPoolFor } from "@/lib/burnKeeper/burnPool";
import { configPda, vaultAddress } from "@/lib/burnReceipts/pda";
import { BURNTICKER_PLATFORM, LAUNCHLAB_PROGRAM_ID } from "@/lib/burnReceipts/constants";
import { DEFAULT_SOL_CONFIG } from "@/lib/burnKeeper/launch";
import { DEFAULT_CP_CONFIG } from "@/lib/burnticker/pairCurveLaunch";
import { PROGRAM_IDS, type Network } from "@/lib/burnticker/networks";
import { BRONCOS } from "./burntickerHelpers.ts";

const ADMIN = new PublicKey("A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD");

/** A burn program client with the network's real program id and the real initialize_token encoding (the production ProgramBurnClient's shape: launchlab_platform passed). */
export class RealIdProgram extends FakeBurnProgram {
  override readonly programId: string;
  private readonly network: Network;
  constructor(network: Network) { super(network); this.network = network; this.programId = PROGRAM_IDS[network].burn_receipts; }
  override feePdaFor(mint: string) { return burnPoolFor(new PublicKey(this.programId), new PublicKey(mint)).feePda.toBase58(); }
  override vaultFor(mint: string) { return vaultAddress(new PublicKey(this.programId), new PublicKey(mint)).toBase58(); }
  override async initializeToken(i: Parameters<FakeBurnProgram["initializeToken"]>[0]) {
    const c = counterRule(i.rule!, i.ticker, i.selectorKey, { floorLamports: this.floorLamports });
    const programId = new PublicKey(this.programId), mint = new PublicKey(i.mint), creator = new PublicKey(i.creator);
    // §45: the EndSink exactly as ProgramBurnClient pins it (a real account + the Option-encoded args)
    const pin = endSinkPin(i.rule, i.pairMint);
    const endSink = pin ? { kind: pin.kind === "pair-winner" ? END_SINK_PAIR_WINNER : END_SINK_FLAGSHIP, minForwardLamports: pin.minForwardLamports } : undefined;
    const ix = initializeTokenIx({ ...(endSink ? { endSink } : {}), programId, payer: creator, creator, mint, launchlabPlatform: BURNTICKER_PLATFORM[this.network], args: {
      feed_id: c.feedId, memo_prefix: c.memoPrefix, memo_source: c.memoSource, rules_sha256: Buffer.from(i.rulesSha256, "hex"), rule: c.rule,
      attesters: [operatorAttester(ADMIN)], quorum: 1, fixed_pool: PublicKey.default, admin: ADMIN,
    }, ...(i.pairMint ? { pairMint: new PublicKey(i.pairMint), partnerFirst: !!i.partnerFirst, pairVoidBy: i.pairVoidBy } : {}) });
    return { tokenConfig: configPda(programId, mint).toBase58(), instructions: [{ programId: this.programId, label: "burn_receipts.initialize_token (real encoding; test)", keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), dataBase64: Buffer.from(ix.data).toString("base64") }] };
  }
}

const GLOBAL = { curveType: 0, index: 0, migrateFee: BigInt(0), tradeFeeRate: BigInt(2500), maxShareFeeRate: BigInt(10000), minSupplyA: BigInt(10_000_000), maxLockRate: BigInt(999_999), minSellRateA: BigInt(1), minMigrateRateA: BigInt(1), minFundRaisingB: BigInt(1), mintB: new PublicKey("So11111111111111111111111111111111111111112") };
const platformView = (network: Network) => ({ feeRate: BigInt(7500), creatorFeeRate: BigInt(500), platformScale: BigInt(1_000_000), creatorScale: BigInt(0), burnScale: BigInt(0), cpConfigId: new PublicKey(DEFAULT_CP_CONFIG[network]), platformCpCreator: PublicKey.default, platformClaimFeeWallet: Keypair.generate().publicKey, platformLockNftWallet: Keypair.generate().publicKey, platformVestingScale: BigInt(0), restrictCurveParam: 0, name: "Burnticker" });
/** The SDK's LaunchLab leg under the network's real program, global config and Burnticker platform. */
export const realLaunchLab = (network: Network) => new SdkLaunchLab({ cluster: network, programId: LAUNCHLAB_PROGRAM_ID[network], platformId: BURNTICKER_PLATFORM[network], configId: DEFAULT_SOL_CONFIG[network], global: GLOBAL, platform: platformView(network) });

/** A metadata URI as long as a real Arweave pin (ar://<43 chars>). */
const URI = (m: string) => `https://arweave.net/${m.slice(0, 43).padEnd(43, "x")}`;
const VAULT_RULE = { ...BRONCOS, binary: { onYes: { tokens: 1000000 }, onNo: null }, vault: { share: 0.3, vestDays: 365, cliffDays: 0 } };

export interface Fixture { name: string; signers: Keypair[][]; steps: { label: string; signers: string[]; instructions: LaunchBundle["transactions"][number]["instructions"] }[]; keys: Record<string, string | null>; mints: Record<string, string> }

/** One LaunchLab coin (the F3 fixture: no first buy), with its creator and mint keypairs. */
/** The longest on-chain strings a creator can choose: a 32-character name, a 10-character ticker, the hosted metadata URI (longer than an Arweave pin). */
const WORST_URI = (m: string) => `https://burnticker.com/api/burnticker/metadata/${m}`;
export async function singleCoin(network: Network, o: { creator?: Keypair; firstBuySol?: string; vault?: boolean; worst?: boolean } = {}): Promise<{ bundle: LaunchBundle; creator: Keypair; mint: Keypair }> {
  const creator = o.creator ?? Keypair.generate(), mint = Keypair.generate();
  const bundle = await buildLaunchBundle({ creator: creator.publicKey.toBase58(), ticker: o.worst ? "ABCDEFGHIJ" : "REALL", name: o.worst ? "N".repeat(32) : "Real launch", description: "a test", imageUrl: null, links: [], rule: o.vault ? VAULT_RULE : { ...BRONCOS, onEnd: { ...DEFAULT_ON_END } }, firstBuySol: o.firstBuySol ?? "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: network },
    { program: new RealIdProgram(network), launchLab: realLaunchLab(network), devFeeWallet: null, attesters: [ADMIN.toBase58()], quorum: 1, metadataUri: o.worst ? WORST_URI : URI, mintKeypair: mint, allowMainnet: true });
  return { bundle, creator, mint };
}

/** Two LaunchLab coins linked through initialize_token's pair_mint (a matchup with the pair curve off). */
export async function launchlabPair(network: Network, creator = Keypair.generate(), worst = false) {
  const LOSE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } } };
  const input = { creator: creator.publicKey.toBase58(), ticker: worst ? "ABCDEFGHIJ" : "PAIRA", name: worst ? "A".repeat(32) : "Pair A", description: "", imageUrl: null, links: [], rule: LOSE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: network };
  const pair = await buildPairBundles({ a: input, b: { ticker: worst ? "BCDEFGHIJK" : "PAIRB", name: worst ? "B".repeat(32) : "Pair B", description: "", imageUrl: null, links: [] } }, { program: new RealIdProgram(network), launchLab: realLaunchLab(network), devFeeWallet: null, attesters: [ADMIN.toBase58()], quorum: 1, metadataUri: worst ? WORST_URI : URI, allowMainnet: true });
  return { pair, creator };
}

/** A pair-curve set (create mint A + initialize_token, create mint B + initialize_token, init_pair). */
export async function pairCurveSet(network: Network, creator = Keypair.generate()): Promise<{ pc: PairCurveLaunchBundle; creator: Keypair; keys: { a: string; b: string } }> {
  const { pair } = await launchlabPair(network, creator);
  const pc = await buildPairCurveLaunch(pair, creator.publicKey.toBase58(), { cluster: network, burnReceiptsProgramId: PROGRAM_IDS[network].burn_receipts });
  return { pc, creator, keys: { a: pair.a.mintSecretKey!, b: pair.b.mintSecretKey! } };
}

/** Every instruction set a creator launch can produce on `network`, built for `creator` (a fresh mint each time). */
export async function everyBundleKind(network: Network, creator = Keypair.generate()) {
  const single = await singleCoin(network, { creator });
  const buy = await singleCoin(network, { creator, firstBuySol: "0.5" });
  const vault = await singleCoin(network, { creator, vault: true, firstBuySol: "0.5" });
  const pair = await launchlabPair(network, creator);
  const pcs = await pairCurveSet(network, creator);
  return [
    ...[single, buy, vault].flatMap((s, n) => s.bundle.transactions.map((t) => ({ kind: ["single", "single + first buy", "vault + first buy"][n], label: t.label, instructions: t.instructions }))),
    ...[pair.pair.a, pair.pair.b].flatMap((b) => b.transactions.map((t) => ({ kind: "LaunchLab pair", label: t.label, instructions: t.instructions }))),
    ...pcs.pc.transactions.map((t) => ({ kind: "pair curve", label: t.label, instructions: t.instructions })),
  ];
}
