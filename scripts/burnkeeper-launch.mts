// THE $DEFICIT LAUNCH CLI (2026-10-09) — creates the token on Raydium LaunchLab, dry-run first. THIS FILE PRINTS NO KEY. Every instruction
// comes from the SDK's own builders through src/lib/burnKeeper/launch.ts; the dry run prints each one decoded and the cluster's
// simulation of the whole transaction, and signs nothing.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnkeeper-launch.mts launch   [flags]
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnkeeper-launch.mts platform [flags]
//
// launch — the token (buyback mode by default; --vault-share for the vesting-vault alternative):
//   --cluster devnet|mainnet      required; checked against the RPC's genesis hash (--rpc overrides the default endpoint)
//   --mint-keypair <path>         the PRE-GENERATED mint keypair (solana-keygen JSON, mode 600, outside the repo). Read, never printed.
//                                 Its address must end in burn or BURN (owner, 2026-10-14): grind it with scripts/burnticker-grind-mint.mts
//                                 (or solana-keygen grind --ends-with burn:1 --ends-with BURN:1). A plain one is warned in a dry run and
//                                 refused for --send unless --allow-plain-mint says the owner means it.
//   --program <pubkey>            the deployed burn_receipts program (default env BURNTICKER_PROGRAM_ID; else the IDL's address,
//                                 warned, refused for --send; the retired localnet test key GV9CMj… is always refused). The creator is derived from it:
//   --creator <pubkey|file>       DEFAULT = THE BURN PROGRAM'S FEE PDA FOR THE MINT (["fee", mint]; review H-2). Recorded, not a signer.
//                                 Curve creator fees and the CPMM pool_creator both follow it, and register_pool requires it. Anything
//                                 else is warned loudly and refused for --send without --allow-foreign-creator.
//   --payer <keypath>             the funded wallet that pays rent and the first buy (JSON array or .enc.json). Required to --send;
//                                 a dry run may use --simulate-as <pubkey> instead (no key: the cluster simulates with that payer).
//   --name --symbol --uri         metadata (symbol ≤ 10 chars; uri = the metadata JSON PINNED ON ARWEAVE — https://arweave.net/<id>, or
//                                 Irys devnet's gateway on devnet; a server-hosted URI only with BURNTICKER_ALLOW_HOSTED_METADATA=1)
//   After --send the LAUNCH GATE reads the created accounts (src/lib/burnticker/launchGate.ts): is_mutable false, mint and freeze
//   authority null, the URI on Arweave — recorded under "launchGate" in the output; a failed check exits 1.
//   --raise-sol 85                the curve's raise target (LaunchLab's standard; devnet accepts 1)
//   --first-buy-sol 0             the payer's buy in the same transaction (0 = none); --slippage-bps 300
//   --vault-share 0               vault mode: percent of supply locked for the keeper (20–30 on mainnet lowers totalSellA to fit),
//                                 --vest-days 365 --cliff-days 0; --vesting-signer <keypath> = the creator's key for transaction 2
//   --platform <pubkey>           default BURNTICKER_PLATFORM_ID, else Raydium's own platform for the cluster; --config <pubkey> likewise
//   --creator-fee-on quote|both   CPMM creator fee after graduation on the SOL side only (default) or both sides
//   --rules <file>                default config/burnkeeper/deficit.rules.json; its sha256 is printed to publish (and must name this mint)
//   --dry-run (default) | --send  --send on mainnet also needs --i-understand-this-spends-real-sol AND BURNKEEPER_MAINNET=1
//
// platform — the Burnticker platform config (one per admin key; the fee dials, see docs/burnkeeper/fees.md):
//   --admin <keypath> | --simulate-as <pubkey>     --fee-wallet <pubkey> (default env BURNTICKER_FEE_WALLET — a pubkey, never a key)
//   --platform-fee-bps 25 (the developer slice; 0–500)  --burn-pool-fee-bps 50 (the creator slot = the burn pool; 0–50)
//   --lp-platform-pct 100 (share of the graduation LP locked to the platform's Fee Key; owner decision 2026-10-10: 100 — LP locked forever)
//   --lock-nft-wallet <pubkey> (default: the burn program's fee-keys PDA under --program / BURNTICKER_PROGRAM_ID — the Fee Key owner;
//                                anything else, or a pct other than 100, is a PROBLEM and --send refuses)  --cp-config <pubkey>
//   --name Burnticker --web <https url> --img <https url>   (both REQUIRED for --send: create_platform_config writes them on chain; no default)
//
// Output: one JSON document on stdout (mint, pool id, creator-fee vault, platform fee vault, the predicted CPMM pool, the rules hash,
// the fee split in bps per 1 SOL before and after graduation, every instruction decoded, the simulation, and the signatures if sent).
// Progress lines go to stderr.

import { matchesSuffix } from "@/lib/burnticker/vanityMint";
import fs from "node:fs";
import { PINNED_URI_RE, decodeMetadataAccount, launchGate } from "../src/lib/burnticker/launchGate.ts";
import path from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import { ComputeBudgetProgram } from "@solana/web3.js";
import { loadRules } from "../src/lib/burnKeeper/rules.ts";
import { base58Encode, clusterOfGenesis, explorerUrl, type Cluster } from "../src/lib/burnKeeper/solana.ts";
import { LAUNCHLAB_PROGRAM, WSOL_MINT } from "../src/lib/burnKeeper/launchlab.ts";
import { buildCreateTx, buildPlatformTx, platformSiteRefusal, PLATFORM_SITE_UNSET, buildVestingTx, decodeAmmConfig, decodeGlobalConfig, decodePlatform, DEFAULT_PLATFORM, DEFAULT_SOL_CONFIG, feeSplit, launchRefusal, lpLockProblems, planLaunch, platformProblems, platformViewOf, type DescribedIx, type LaunchInput, type PlannedTx, type PlatformInput } from "../src/lib/burnKeeper/launch.ts";
import { getCpmmPdaAmmConfigId } from "@raydium-io/raydium-sdk-v2";
import { CPMM_TIER } from "../src/lib/burnticker/cpmmTier.ts";
import { CPMM_PROGRAM_ID } from "../src/lib/burnKeeper/launchlab.ts";
import { burnPoolFor, isLocalnetProgramId } from "../src/lib/burnKeeper/burnPool.ts";
import { BURN_RECEIPTS_LOCALNET_PROGRAM_ID } from "../src/lib/burnReceipts/constants.ts";
import { feeKeysPda } from "../src/lib/burnticker/lockFees.ts";
import { checkLpLockPins } from "../src/lib/burnticker/lpLockPins.ts";

const args = process.argv.slice(2);
const MODE = args[0] === "launch" || args[0] === "platform" ? args[0] : null;
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string): string | undefined => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? (args.includes(`--${n}`) && !args[args.indexOf(`--${n}`) + 1]?.startsWith("--") ? args[args.indexOf(`--${n}`) + 1] : undefined);
const say = (s: string) => console.error(s);
const die = (s: string, code = 2): never => { console.error(`refusing: ${s}`); process.exit(code); };

if (!MODE) { say(fs.readFileSync(new URL(import.meta.url)).toString().split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n")); process.exit(0); }

const CLUSTER = opt("cluster");
if (CLUSTER !== "devnet" && CLUSTER !== "mainnet") die("--cluster devnet|mainnet is required");
const flagCluster = CLUSTER as "devnet" | "mainnet";
const SEND = flag("send"), DRY = !SEND;
const rpc = opt("rpc")?.trim() || process.env.BURNKEEPER_RPC_URL?.trim() || (flagCluster === "devnet" ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com");
const connection = new Connection(rpc, "confirmed");
const genesis = await connection.getGenesisHash();
const cluster: Cluster = clusterOfGenesis(genesis);
{
  const r = launchRefusal({ cluster, flagCluster, dryRun: DRY, iUnderstand: flag("i-understand-this-spends-real-sol"), env: process.env });
  if (r) die(r);
}
const programId = LAUNCHLAB_PROGRAM[flagCluster];

// ---------------------------------------------------------------------------------------------------------------------------------
// Keys: read, never printed. The mint keypair is a plain solana-keygen file; the payer/admin may be an encrypted *.enc.json.
// ---------------------------------------------------------------------------------------------------------------------------------
async function loadKey(keyPath: string, what: string): Promise<Keypair> {
  if (["signer.enc.json", "signer.json"].includes(path.basename(keyPath))) die(`${what}: ${keyPath} is the treasury's key file — never the launch's`);
  if (process.env.BURNKEEPER_SIGNER_PASSPHRASE && !process.env.AUTONOMOUS_SIGNER_PASSPHRASE) process.env.AUTONOMOUS_SIGNER_PASSPHRASE = process.env.BURNKEEPER_SIGNER_PASSPHRASE;
  const { loadKeypair } = await import("@/lib/burnKeeper/keyfile");
  return loadKeypair({ keyPath });
}
function pubkeyArg(v: string | undefined, what: string): PublicKey | null {
  if (!v) return null;
  const s = fs.existsSync(v) && fs.statSync(v).isFile() ? fs.readFileSync(v, "utf8").trim() : v.trim();
  try { return new PublicKey(s); } catch { return die(`${what}: ${v} is not a pubkey or a .address file`); }
}
async function getAccount(k: PublicKey) { const a = await connection.getAccountInfo(k, "confirmed"); return a ? { data: new Uint8Array(a.data), owner: a.owner, lamports: a.lamports } : null; }

// ---------------------------------------------------------------------------------------------------------------------------------
// Simulate / send
// ---------------------------------------------------------------------------------------------------------------------------------
async function compile(payer: PublicKey, ixs: TransactionInstruction[], units = 400_000): Promise<VersionedTransaction> {
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units }), ...ixs] }).compileToV0Message();
  return new VersionedTransaction(msg);
}
async function simulate(tx: VersionedTransaction): Promise<{ err: string | null; logs: string[]; unitsConsumed: number | null }> {
  const r = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
  return { err: r.value.err ? JSON.stringify(r.value.err) : null, logs: r.value.logs ?? [], unitsConsumed: r.value.unitsConsumed ?? null };
}
async function sendAndConfirm(tx: VersionedTransaction, signers: Keypair[]): Promise<{ signature: string; status: string; slot: number | null }> {
  tx.sign(signers);
  const signature = base58Encode(tx.signatures[0]);
  const raw = tx.serialize();
  const { lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
  const started = Date.now(); let lastSend = Date.now();
  while (Date.now() - started < 120_000) {
    await new Promise((r) => setTimeout(r, 2_000));
    const st = (await connection.getSignatureStatuses([signature])).value[0];
    if (st?.err) return { signature, status: `failed: ${JSON.stringify(st.err)}`, slot: st.slot };
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return { signature, status: "confirmed", slot: st.slot };
    if ((await connection.getBlockHeight("confirmed")) > lastValidBlockHeight) return { signature, status: "expired (not landed)", slot: null };
    if (Date.now() - lastSend > 4_000) { lastSend = Date.now(); await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {}); }
  }
  return { signature, status: "unknown after 120 s — check the explorer before retrying", slot: null };
}
const printable = (tx: PlannedTx) => ({ label: tx.label, signers: tx.signers, instructions: tx.instructions.map((d: DescribedIx) => ({ name: d.name, program: d.program, args: d.args, accounts: d.accounts, dataHex: d.dataHex })) });

// ---------------------------------------------------------------------------------------------------------------------------------
// platform
// ---------------------------------------------------------------------------------------------------------------------------------
if (MODE === "platform") {
  const simulateAs = pubkeyArg(opt("simulate-as"), "--simulate-as");
  const adminKey = opt("admin") ? await loadKey(opt("admin")!, "--admin") : null;
  if (SEND && !adminKey) die("--send needs --admin <keypath>");
  const admin = adminKey?.publicKey ?? simulateAs ?? die("platform: give --admin <keypath> or (dry run) --simulate-as <pubkey>");
  const feeWallet = pubkeyArg(opt("fee-wallet") ?? process.env.BURNTICKER_FEE_WALLET, "BURNTICKER_FEE_WALLET") ?? die("the developer fee wallet: --fee-wallet <pubkey> or env BURNTICKER_FEE_WALLET (a pubkey, never a key)");
  const siteRefusal = platformSiteRefusal({ web: opt("web"), img: opt("img"), send: SEND });
  if (siteRefusal) die(siteRefusal);
  const platformWarnings: string[] = [];
  if (!opt("web") || !opt("img")) platformWarnings.push(`--web / --img not given: this dry run shows ${PLATFORM_SITE_UNSET}; --send refuses until both are explicit https URLs (they are written on chain)`);
  const cpConfigId = pubkeyArg(opt("cp-config"), "--cp-config") ?? getCpmmPdaAmmConfigId(CPMM_PROGRAM_ID[flagCluster], CPMM_TIER[flagCluster].index).publicKey;   // the tier the platform points at (cpmmTier.ts)
  // LP LOCKED FOREVER (owner decision 2026-10-10): the Fee Key goes to the burn program's fee-keys PDA, 100 % of the LP locked.
  const feeKeysOwner = feeKeysPda(pubkeyArg(opt("program") ?? process.env.BURNTICKER_PROGRAM_ID, "--program") ?? BURN_RECEIPTS_LOCALNET_PROGRAM_ID);
  const p: PlatformInput = { programId, admin, claimFeeWallet: feeWallet, lockNftWallet: pubkeyArg(opt("lock-nft-wallet"), "--lock-nft-wallet") ?? feeKeysOwner, vestingWallet: feeWallet, cpConfigId,
    feeRatePpm: BigInt(Math.round(Number(opt("platform-fee-bps") ?? 25) * 100)), creatorFeeRatePpm: BigInt(Math.round(Number(opt("burn-pool-fee-bps") ?? 50) * 100)), platformScalePpm: BigInt(Math.round(Number(opt("lp-platform-pct") ?? 100) * 10_000)),
    name: opt("name") ?? "Burnticker", web: opt("web") ?? PLATFORM_SITE_UNSET, img: opt("img") ?? PLATFORM_SITE_UNSET };
  const problems = [...platformProblems(p), ...lpLockProblems(p, feeKeysOwner)];
  const ammAcc = await getAccount(cpConfigId);
  if (!ammAcc) problems.push(`CPMM AmmConfig ${cpConfigId.toBase58()} does not exist on ${cluster}`);
  const amm = ammAcc ? decodeAmmConfig(ammAcc.data) : null;
  const { platformId, tx } = buildPlatformTx(p);
  const existing = await getAccount(platformId);
  if (existing) problems.push(`platform config ${platformId.toBase58()} already exists for admin ${admin.toBase58()} (one per admin key; use updatePlatformConfig to change it)`);
  const globalAcc = await getAccount(DEFAULT_SOL_CONFIG[flagCluster]);
  const global = globalAcc ? decodeGlobalConfig(globalAcc.data) : null;
  const split = global && amm ? feeSplit({ global, platform: platformViewOf(p), amm, creatorIsBurnPool: true, feeKeysPda: feeKeysOwner }) : null;
  const out: Record<string, unknown> = { mode: "platform", cluster, dryRun: DRY, rpc, programId: programId.toBase58(), platformId: platformId.toBase58(), admin: admin.toBase58(), feeWallet: feeWallet.toBase58(),
    dials: { platformFeePpm: p.feeRatePpm.toString(), platformFeeBps: Number(p.feeRatePpm) / 100, burnPoolFeePpm: p.creatorFeeRatePpm.toString(), burnPoolFeeBps: Number(p.creatorFeeRatePpm) / 100, lpToPlatformPpm: p.platformScalePpm.toString(), lpLockedPct: Number(p.platformScalePpm) / 10_000, lockNftWallet: p.lockNftWallet.toBase58(), feeKeysPda: feeKeysOwner.toBase58(), cpConfigId: cpConfigId.toBase58(), cpConfig: amm ? { index: amm.index, tradeFeeBps: Number(amm.tradeFeeRate) / 100, creatorFeeBps: Number(amm.creatorFeeRate) / 100, creatorFeeShareToProtocolPct: Number(amm.creatorFeeShareRate) / 10_000 } : null },
    feeSplit: split, warnings: platformWarnings, problems, transactions: [printable(tx)] };
  if (!problems.length) {
    const vtx = await compile(admin, tx.instructions.map((d) => d.ix));
    out.simulation = await simulate(vtx);
    if (SEND && adminKey && !(out.simulation as { err: string | null }).err) { out.sent = await sendAndConfirm(vtx, [adminKey]); out.explorer = explorerUrl(cluster, (out.sent as { signature: string }).signature); }
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(problems.length ? 1 : 0);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// launch
// ---------------------------------------------------------------------------------------------------------------------------------
const mintPath = opt("mint-keypair") ?? die("--mint-keypair <path> is required (grind it so the address ends in burn: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/burnticker-grind-mint.mts --out <path>)");
const mintKp = await loadKey(mintPath, "--mint-keypair");
const simulateAs = pubkeyArg(opt("simulate-as"), "--simulate-as");
const payerKey = opt("payer") ? await loadKey(opt("payer")!, "--payer") : null;
if (SEND && !payerKey) die("--send needs --payer <keypath>");
const payer = payerKey?.publicKey ?? simulateAs ?? die("give --payer <keypath> or (dry run) --simulate-as <pubkey>");
const vestingSigner = opt("vesting-signer") ? await loadKey(opt("vesting-signer")!, "--vesting-signer") : null;
// THE CREATOR IS THE BURN PROGRAM'S FEE PDA FOR THIS MINT (burnPool.ts; review H-2): derived from the mint keypair's pubkey under the
// deployed burn_receipts id (--program / BURNTICKER_PROGRAM_ID). Anything else passed as --creator is a launch whose fees the program
// can never reach — warned loudly, and refused for --send unless --allow-foreign-creator says the owner means it.
const burnProgramArg = pubkeyArg(opt("program") ?? process.env.BURNTICKER_PROGRAM_ID, "--program");
const burnProgram = burnProgramArg ?? BURN_RECEIPTS_LOCALNET_PROGRAM_ID;
const burnPool = burnPoolFor(burnProgram, mintKp.publicKey);
const creator = pubkeyArg(opt("creator"), "--creator") ?? burnPool.feePda;
const creatorIsFeePda = creator.equals(burnPool.feePda);
const warnings: string[] = [];
const problems: string[] = [];
if (!burnProgramArg || isLocalnetProgramId(burnProgram)) {
  const m = !burnProgramArg
    ? `no --program / BURNTICKER_PROGRAM_ID: the fee PDA is derived under the IDL's address (${burnProgram.toBase58()}) — name the deployed program explicitly. Set BURNTICKER_PROGRAM_ID before any send.`
    : "the program id is the retired LOCALNET test key (GV9CMj…SuF8) — no deployed program; the fee PDA would be unreachable. Set BURNTICKER_PROGRAM_ID to the deployed id before any send.";
  if (SEND) problems.push(m); else warnings.push(m);
}
if (!creatorIsFeePda) {
  const m = `LOUD WARNING: --creator ${creator.toBase58()} is NOT the burn pool's fee PDA ${burnPool.feePda.toBase58()} for this mint. The program's register_pool requires pool_creator == fee PDA (PoolCreatorMismatch otherwise), so with this creator no buyback crank can ever run and every creator fee belongs to ${creator.toBase58()} instead of the burn pool.`;
  warnings.push(m);
  if (SEND && !flag("allow-foreign-creator")) problems.push("refusing to --send with a creator other than the fee PDA (pass --allow-foreign-creator only if you really mean it)");
}
if (vestingSigner && !vestingSigner.publicKey.equals(creator)) die("--vesting-signer is not the creator's key");
// 2026-10-14 (owner): every coin made on the platform has a mint address that ends in burn or BURN, the operator's launches included
if (!matchesSuffix(mintKp.publicKey.toBase58())) {
  const m = `the mint ${mintKp.publicKey.toBase58()} does not end in burn or BURN. Grind one with scripts/burnticker-grind-mint.mts (or solana-keygen grind --ends-with burn:1 --ends-with BURN:1).`;
  if (SEND && !flag("allow-plain-mint")) problems.push(`${m} Refusing to --send without --allow-plain-mint.`); else warnings.push(m);
}
if (creator.equals(payer)) warnings.push("the creator is the payer — creator fees would go to the payer, not the burn pool");
const rulesFile = opt("rules") ?? "config/burnkeeper/deficit.rules.json";
const rules = loadRules(rulesFile);
if (rules.rules.mint && rules.rules.mint !== mintKp.publicKey.toBase58()) die(`${rulesFile} names mint ${rules.rules.mint} but --mint-keypair is ${mintKp.publicKey.toBase58()}`);
const platformId = pubkeyArg(opt("platform") ?? process.env.BURNTICKER_PLATFORM_ID, "--platform") ?? DEFAULT_PLATFORM[flagCluster];
// owner question 2026-10-12 ("are we launching through the platform?"): a mainnet send must name the platform on purpose. With no
// --platform and no BURNTICKER_PLATFORM_ID the default is Raydium's own platform, whose fees never reach a burn pool — refused.
if (SEND && flagCluster === "mainnet" && !opt("platform") && !process.env.BURNTICKER_PLATFORM_ID) die("refusing to --send on mainnet without --platform (or BURNTICKER_PLATFORM_ID): the default is Raydium's own platform, not Burnticker's, so no fee would reach the burn pool");
const configId = pubkeyArg(opt("config"), "--config") ?? DEFAULT_SOL_CONFIG[flagCluster];
const [globalAcc, platformAcc, mintAcc] = await Promise.all([getAccount(configId), getAccount(platformId), getAccount(mintKp.publicKey)]);
const global = decodeGlobalConfig((globalAcc ?? die(`LaunchLab config ${configId.toBase58()} not found on ${cluster}`)).data);
const platform = decodePlatform((platformAcc ?? die(`platform config ${platformId.toBase58()} not found on ${cluster}`)).data);
const ammAcc = await getAccount(platform.cpConfigId);
const amm = ammAcc ? decodeAmmConfig(ammAcc.data) : null;
// LP LOCKED FOREVER (owner decision 2026-10-10) — the launch gate on the platform's LP pins: 100 % locked (1,000,000 / 0 / 0 ppm) and the
// Fee Key to the burn program's fee-keys PDA; on mainnet also the operator treasury compiled into the program (TreasuryNotPinned otherwise).
const lpPins = checkLpLockPins(platformAcc!.data, { programId: burnProgram, cluster: flagCluster, requireTreasury: flagCluster === "mainnet", platformId });
for (const m of lpPins.problems) (SEND ? problems : warnings).push(`LP lock pin: ${m}`);
const sol = (s: string | undefined, d: number) => BigInt(Math.round(Number(s ?? d) * LAMPORTS_PER_SOL));
const input: LaunchInput = { cluster: flagCluster, programId, platformId, configId, global, platform, payer, creator, mint: mintKp.publicKey,
  name: opt("name") ?? "DEFICIT", symbol: opt("symbol") ?? rules.rules.ticker, uri: opt("uri") ?? "", decimals: rules.rules.decimals, supplyTokens: BigInt(rules.rules.totalSupply),
  raiseLamports: sol(opt("raise-sol"), 85), lockedPercent: Number(opt("vault-share") ?? 0), cliffSeconds: BigInt(Math.round(Number(opt("cliff-days") ?? 0) * 86_400)), unlockSeconds: BigInt(Math.round(Number(opt("vest-days") ?? (Number(opt("vault-share") ?? 0) > 0 ? 365 : 0)) * 86_400)),
  firstBuyLamports: sol(opt("first-buy-sol"), 0), slippageBps: Number(opt("slippage-bps") ?? 300), creatorFeeOn: opt("creator-fee-on") === "both" ? "both" : "quote-only" };
const plan = planLaunch(input);
problems.push(...plan.problems);
if (mintAcc) problems.push(`the mint ${mintKp.publicKey.toBase58()} already exists on ${cluster} — a launch needs a fresh keypair`);
const allowHosted = /^(1|true|on|yes)$/i.test((process.env.BURNTICKER_ALLOW_HOSTED_METADATA ?? "").trim());
if (!PINNED_URI_RE.test(input.uri)) (allowHosted ? warnings : problems).push(`--uri ${input.uri || "(empty)"} is not an Arweave URL: pin the metadata JSON first (src/lib/burnticker/pin.ts)${allowHosted ? " — BURNTICKER_ALLOW_HOSTED_METADATA is on, so a hosted URI is allowed for this devnet script" : "; a hosted URI only with BURNTICKER_ALLOW_HOSTED_METADATA=1 (devnet scripts)"}`);
if (rules.rules.mode === "vault" && plan.totalLockedRaw === BigInt(0)) problems.push("the rule file is vault mode but --vault-share is 0");
if (rules.rules.mode === "buyback" && plan.totalLockedRaw > BigInt(0)) warnings.push("the rule file is buyback mode but a share is locked — the keeper will not claim vested tokens in buyback mode");
if (plan.totalLockedRaw > BigInt(0) && creatorIsFeePda) problems.push("vault mode needs the CREATOR to sign create_vesting_account, and the creator is the burn program's fee PDA, which cannot sign — the burn program has no vesting CPI yet; vault mode is not launchable under the fee-PDA creator");
if (plan.totalLockedRaw > BigInt(0) && SEND && !vestingSigner) problems.push("vault mode --send needs --vesting-signer <the creator's keypath> for transaction 2 (assign the locked share BEFORE graduation)");
if (!amm) problems.push(`the platform's CPMM AmmConfig ${platform.cpConfigId.toBase58()} was not found`);
const payerLamports = await connection.getBalance(payer, "confirmed");
const needLamports = plan.firstBuy ? plan.firstBuy.lamports + BigInt(60_000_000) : BigInt(60_000_000);
if (SEND && BigInt(payerLamports) < needLamports) problems.push(`payer ${payer.toBase58()} holds ${payerLamports / LAMPORTS_PER_SOL} SOL; the launch needs about ${Number(needLamports) / LAMPORTS_PER_SOL} (rent ≈ 0.03 + fees + the first buy)`);

const createTx = buildCreateTx(input, plan);
const vestingTx = buildVestingTx(input, plan, creator);
const out: Record<string, unknown> = {
  mode: "launch", cluster, dryRun: DRY, rpc, programId: programId.toBase58(), platformId: platformId.toBase58(), platformName: platform.name, configId: configId.toBase58(),
  mint: mintKp.publicKey.toBase58(), poolId: plan.poolId.toBase58(), creator: creator.toBase58(), payer: payer.toBase58(), payerSol: payerLamports / LAMPORTS_PER_SOL,
  burnPool: { programId: burnProgram.toBase58(), programIdIsLocalnetPlaceholder: !burnProgramArg || isLocalnetProgramId(burnProgram), feePda: burnPool.feePda.toBase58(), feeWsolAta: burnPool.feeWsol.toBase58(), feeTokenAta: burnPool.feeToken.toBase58(), configPda: burnPool.config.toBase58(), creatorIsFeePda,
    note: "the fee PDA is the LaunchLab creator: curve creator fees accrue in LaunchLab's [feePda, WSOL] vault and are moved into feeWsolAta by the program's permissionless claim_launchlab_creator_fee; after graduation pool_creator = feePda and Raydium's collect_creator_fee_permissionless pays feeWsolAta / feeTokenAta; register_pool then accepts the pool" },
  curve: { supplyRaw: plan.supplyRaw.toString(), totalSellRaw: plan.totalSellRaw.toString(), totalLockedRaw: plan.totalLockedRaw.toString(), migrateReserveRaw: plan.migrateReserveRaw.toString(), raiseLamports: plan.raiseLamports.toString(), decimals: input.decimals, migrateType: "cpmm", cliffSeconds: input.cliffSeconds.toString(), unlockSeconds: input.unlockSeconds.toString() },
  creatorFeeVault: { address: plan.creatorFeeVault.toBase58(), note: "bonding-curve creator fees (SOL, wrapped) accrue here; only the creator can claim (LaunchLab claim_creator_fee); created by the first trade" },
  creatorFeeVaultAuthority: null, platformFeeVault: plan.platformFeeVault.toBase58(), baseVault: plan.vaultA.toBase58(), quoteVault: plan.vaultB.toBase58(), metadata: plan.metadata.toBase58(), vestingRecord: plan.vestingRecord?.toBase58() ?? null,
  cpmmAfterGraduation: { programId: plan.cpmm.programId.toBase58(), ammConfig: plan.cpmm.ammConfig.toBase58(), expectedPoolId: plan.cpmm.expectedPoolId.toBase58(), token0: plan.cpmm.token0.toBase58(), token1: plan.cpmm.token1.toBase58(), expectedPoolCreator: plan.cpmm.expectedPoolCreator.toBase58(), note: "creator fees after graduation accrue in this pool's creator_fees_token_0/1 counters; pool_creator collects them (CPMM collect_creator_fee); the pool id assumes token0 < token1 as the CPMM program requires — the keeper checks both orders" },
  rules: { file: path.resolve(rulesFile), sha256: rules.sha256, memoField: `rules=sha256:${rules.sha12}`, mint: rules.rules.mint, mode: rules.rules.mode, fractionPerUnit: rules.rules.buyback.fractionPerUnit, publish: rules.rules.mint ? "publish rules.json and its sha256 beside the token metadata" : `WRITE "mint": "${mintKp.publicKey.toBase58()}" into ${rulesFile} BEFORE launch, then re-run: the hash changes and BURNKEEPER_RULES_SHA must equal the new one` },
  firstBuy: plan.firstBuy ? { lamports: plan.firstBuy.lamports.toString(), quotedTokensRaw: plan.firstBuy.quotedTokensRaw.toString(), minTokensRaw: plan.firstBuy.minTokensRaw.toString(), feeLamports: { protocol: plan.firstBuy.fee.protocol.toString(), platform: plan.firstBuy.fee.platform.toString(), creatorToBurnPool: plan.firstBuy.fee.creator.toString() } } : null,
  feeSplitPer1SolVolume: amm ? feeSplit({ global, platform, amm, creatorIsBurnPool: creatorIsFeePda }) : null,
  warnings, problems,
  transactions: [printable(createTx), ...(vestingTx ? [printable(vestingTx)] : [])],
};
if (!problems.length) {
  const vtx = await compile(payer, createTx.instructions.map((d) => d.ix));
  const sim = await simulate(vtx);
  out.simulation = { create: sim };
  if (SEND && payerKey) {
    if (sim.err) die(`the cluster refused the create transaction in simulation: ${sim.err}`);
    say(`sending the create transaction on ${cluster} (mint ${mintKp.publicKey.toBase58()})…`);
    const sent = await sendAndConfirm(vtx, [payerKey, mintKp]);
    out.sent = { create: { ...sent, explorer: explorerUrl(cluster, sent.signature) } };
    say(`create: ${sent.status} ${explorerUrl(cluster, sent.signature)}`);
    if (sent.status === "confirmed") {
      // THE LAUNCH GATE: what was created can never change (launchGate.ts).
      const [mintInfo, metaAcc] = await Promise.all([connection.getParsedAccountInfo(mintKp.publicKey, "confirmed"), getAccount(plan.metadata)]);
      const parsed = (mintInfo.value?.data as { parsed?: { info?: { mintAuthority?: string | null; freezeAuthority?: string | null } } } | undefined)?.parsed?.info;
      const gate = metaAcc ? launchGate({ metadata: decodeMetadataAccount(metaAcc.data), mintAuthority: parsed?.mintAuthority ?? null, freezeAuthority: parsed?.freezeAuthority ?? null, allowHosted }) : { ok: false, checks: [{ id: "is_mutable", ok: false, detail: "the metadata account was not found" }] };
      out.launchGate = gate;
      if (!gate.ok) { problems.push(`LAUNCH GATE FAILED: ${gate.checks.filter((c) => !c.ok).map((c) => c.detail).join("; ")}`); say("LAUNCH GATE FAILED — see launchGate in the output"); }
      else say("launch gate: is_mutable false · mint and freeze authority null · metadata on Arweave");
    }
    if (vestingTx && vestingSigner && sent.status === "confirmed") {
      const v = await compile(vestingSigner.publicKey, vestingTx.instructions.map((d) => d.ix), 100_000);
      const vsim = await simulate(v);
      (out.simulation as Record<string, unknown>).vesting = vsim;
      if (vsim.err) say(`the vesting transaction was refused in simulation: ${vsim.err} — assign the locked share BEFORE graduation or it is lost`);
      else { const vs = await sendAndConfirm(v, [vestingSigner]); (out.sent as Record<string, unknown>).vesting = { ...vs, explorer: explorerUrl(cluster, vs.signature) }; say(`vesting: ${vs.status} ${explorerUrl(cluster, vs.signature)}`); }
    }
  } else if (vestingTx) {
    const v = await compile(creator, vestingTx.instructions.map((d) => d.ix), 100_000);
    (out.simulation as Record<string, unknown>).vesting = { ...(await simulate(v)), note: "simulated against a pool that does not exist yet — expected to fail until the create transaction lands" };
  }
}
console.log(JSON.stringify(out, null, 2));
process.exit(problems.length ? 1 : 0);
