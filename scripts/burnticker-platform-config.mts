// BURNTICKER PLATFORM CONFIG — a DRY RUN that prints the LaunchLab create_platform_config transaction with the owner's dials
// (2026-10-09): developer fee 25 bps (BURNTICKER_PLATFORM_FEE_BPS, env), creator-fee slot = the burn pool at the 50 bps cap, CPMM tier 9 on mainnet (2026-10-12; devnet index 0),
// platformCpCreator left default so the launch creator (the burn-pool authority) is the CPMM creator-fee beneficiary. LP LOCKED FOREVER
// (owner decision 2026-10-10, supersedes "LP 100% burned"): --lp-platform-pct 100 (the default; platform 1,000,000 / creator 0 / burn 0 ppm,
// not creator-configurable) and the lock-NFT wallet = the burn program's fee-keys PDA (--program / BURNTICKER_PROGRAM_ID), so the Fee
// Key is owned by the program and claim_lock_fees splits the LP fees 80 % burn pool / 20 % operator (compiled constants). Built with the merged launch builder
// (src/lib/burnKeeper/launch.ts → the Raydium SDK's own instruction). NEVER SENDS. No key is read. No environment file is printed.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-platform-config.mts \
//     --admin <pubkey> [--fee-wallet <pubkey> | BURNTICKER_FEE_WALLET] [--cluster devnet|mainnet] [--lp-platform-pct 100] [--program <burn_receipts id>]
//     [--web <https url> --img <https url>] [--json]
// --web / --img are written ON CHAIN by create_platform_config; there is no default. Without them this dry run shows a placeholder and
// says so, and burnkeeper-launch.mts platform --send refuses (platformSiteRefusal in src/lib/burnKeeper/launch.ts).
import { PublicKey } from "@solana/web3.js";
import { buildPlatformTx, platformProblems, platformViewOf, feeSplit, platformSiteRefusal, PLATFORM_SITE_UNSET, LAUNCHLAB_PROGRAM_SDK, PPM, type GlobalConfigView, type AmmConfigView } from "../src/lib/burnKeeper/launch.ts";
import { WSOL_MINT } from "../src/lib/burnKeeper/launchlab.ts";
import { BURNTICKER_DEV_FEE_BPS, BURN_POOL_CURVE_BPS, devFeeWallet } from "../src/lib/burnticker/fees.ts";
import { LP_LOCKED_PCT, feeKeysPda, operatorTreasuryFor } from "../src/lib/burnticker/lockFees.ts";
import { BURN_RECEIPTS_LOCALNET_PROGRAM_ID } from "../src/lib/burnReceipts/constants.ts";
import { CPMM_TIER } from "../src/lib/burnticker/cpmmTier.ts";
import { lpLockProblems } from "../src/lib/burnKeeper/launch.ts";

const args = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const cluster = opt("cluster", "devnet") === "mainnet" ? "mainnet" : "devnet";
const adminS = opt("admin"), feeWalletS = opt("fee-wallet") ?? devFeeWallet() ?? null;
const feeBps = Number(process.env.BURNTICKER_PLATFORM_FEE_BPS?.trim() || BURNTICKER_DEV_FEE_BPS);
const lpPlatformPct = Number(opt("lp-platform-pct", String(LP_LOCKED_PCT)));
if (!adminS) { console.error("usage: --admin <platform admin pubkey> [--fee-wallet <pubkey>] [--cluster devnet|mainnet] [--lp-platform-pct 100] [--program <burn_receipts id>] [--web <https url> --img <https url>] [--json]"); process.exit(2); }
if (lpPlatformPct !== LP_LOCKED_PCT) console.error(`WARNING: --lp-platform-pct ${lpPlatformPct} departs from the owner's decision (LP ${LP_LOCKED_PCT}% locked, Fee Key held by the program). Printing anyway; this is a dry run.`);
const burnProgram = new PublicKey(opt("program") ?? process.env.BURNTICKER_PROGRAM_ID?.trim() ?? BURN_RECEIPTS_LOCALNET_PROGRAM_ID.toBase58());
const feeKeys = feeKeysPda(burnProgram);
const treasury = operatorTreasuryFor(cluster);

// The CPMM AmmConfig the platform points at, per cluster (cpmmTier.ts): mainnet tier 14 (owner decision 2026-10-19; was tier 9 from 2026-10-12), devnet index 0.
const TIER = CPMM_TIER[cluster];
const CP_CONFIG = new PublicKey(TIER.id);
const admin = new PublicKey(adminS);
const claimFeeWallet = feeWalletS ? new PublicKey(feeWalletS) : PublicKey.default;
const input = {
  programId: LAUNCHLAB_PROGRAM_SDK[cluster], admin, claimFeeWallet, lockNftWallet: feeKeys, vestingWallet: claimFeeWallet, cpConfigId: CP_CONFIG,
  feeRatePpm: BigInt(Math.round(feeBps * 100)), creatorFeeRatePpm: BigInt(BURN_POOL_CURVE_BPS * 100), platformScalePpm: BigInt(Math.round(lpPlatformPct * 10_000)),
  name: "Burnticker", web: opt("web") ?? PLATFORM_SITE_UNSET, img: opt("img") ?? PLATFORM_SITE_UNSET,
};
const problems = [...platformProblems(input), ...lpLockProblems(input, feeKeys)];
if (!treasury) problems.push(`the operator treasury is not pinned in the ${cluster} program build: claim_lock_fees refuses (TreasuryNotPinned) and the LP fees stay in the lock until the owner compiles the Squads vault in (TODO-OWNER)`);
{ const r = platformSiteRefusal({ web: opt("web"), img: opt("img"), send: true }); if (r) problems.push(`${r.replace("--send needs", "a send would need")} — this dry run shows ${PLATFORM_SITE_UNSET}`); }
const { platformId, tx } = buildPlatformTx(input);

// The documented live values (fees.md §1), used here so the dry run prints the split without an RPC; the trust page reads the chain.
const global: GlobalConfigView = { curveType: 0, index: 0, migrateFee: BigInt(0), tradeFeeRate: BigInt(2500), maxShareFeeRate: BigInt(10_000), minSupplyA: BigInt(0), maxLockRate: BigInt(cluster === "mainnet" ? 800_000 : 999_999), minSellRateA: BigInt(cluster === "mainnet" ? 200_000 : 1), minMigrateRateA: BigInt(cluster === "mainnet" ? 150_000 : 1), minFundRaisingB: BigInt(cluster === "mainnet" ? 24_000_000_000 : 1), mintB: WSOL_MINT };
const amm: AmmConfigView = { index: TIER.index, tradeFeeRate: BigInt(TIER.tradeFeeRate), protocolFeeRate: BigInt(TIER.protocolFeeRate), fundFeeRate: BigInt(TIER.fundFeeRate), creatorFeeRate: BigInt(TIER.creatorFeeRate), creatorFeeShareRate: BigInt(TIER.creatorFeeShareRate), createPoolFee: BigInt(0) };
const split = feeSplit({ global, platform: platformViewOf(input), amm, creatorIsBurnPool: true, feeKeysPda: feeKeys, operatorTreasury: treasury ? new PublicKey(treasury) : null });

const out = {
  dryRun: true, sent: false, cluster, platformId: platformId.toBase58(), admin: admin.toBase58(), claimFeeWallet: feeWalletS ?? "UNSET (BURNTICKER_FEE_WALLET)",
  dials: { feeRatePpm: input.feeRatePpm.toString(), feeBps, creatorFeeRatePpm: input.creatorFeeRatePpm.toString(), creatorFeeBps: BURN_POOL_CURVE_BPS, platformScalePpm: input.platformScalePpm.toString(), creatorScalePpm: "0", burnScalePpm: (PPM - input.platformScalePpm).toString(), lpLockedPct: lpPlatformPct, lockNftWallet: feeKeys.toBase58(), lockNftWalletIs: "the burn_receipts fee-keys PDA [\"fee_keys\"] (the Fee Key owner)", operatorTreasury: treasury ?? "NOT PINNED (TreasuryNotPinned)", cpConfigId: CP_CONFIG.toBase58(), platformCpCreator: "default (launch creator = burn-pool authority)", platformVestingScale: "0" },
  decisions: ["creators earn no cash from fees: the creator-fee slot pays the burn pool 100%", `developer slice ${feeBps} bps of curve volume → BURNTICKER_FEE_WALLET`, `LP locked forever at graduation ${lpPlatformPct}% (Raydium LP lock; the Fee Key owned by the burn program's fee-keys PDA): claim_lock_fees splits the LP fees 80% → the coin's burn pool / 20% → the operator treasury, coin side burned (fixed in code); plus the burn pool's 4.75 bps/SOL from Raydium's fixed CPMM creator fee`, "no referral share, no discounts, no vesting slice"],
  problems, feeSplitPer1SolVolume: split,
  transaction: { label: tx.label, signers: tx.signers, instructions: tx.instructions.map((d) => ({ name: d.name, program: d.program, args: d.args, accounts: d.accounts, dataHex: d.dataHex })) },
  next: ["review the JSON above", "sign and send with the platform admin's wallet through scripts/burnkeeper-launch.mts --platform (the launch-flow CLI), never from here", "set BURNTICKER_PLATFORM_ID to the printed platformId; the trust page then reads the live config and compares it with these dials"],
};
if (args.includes("--json")) console.log(JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
else {
  console.log(`Burnticker platform config — DRY RUN (${cluster}), nothing sent`);
  console.log(`platform id      ${out.platformId}`);
  console.log(`admin            ${out.admin}`);
  console.log(`claim-fee wallet ${out.claimFeeWallet}`);
  console.log(`dials            feeRate ${out.dials.feeRatePpm} ppm (${feeBps} bps) · creatorFeeRate ${out.dials.creatorFeeRatePpm} ppm (${BURN_POOL_CURVE_BPS} bps → burn pool) · LP platform ${out.dials.platformScalePpm} / creator 0 / burned ${out.dials.burnScalePpm} ppm (${out.dials.lpLockedPct}% locked, Fee Key → ${out.dials.lockNftWallet}) · CPMM tier 0 ${out.dials.cpConfigId}`);
  for (const d of out.decisions) console.log(`  · ${d}`);
  if (problems.length) console.log(`PROBLEMS: ${problems.join("; ")}`);
  console.log(`\nfee split per 1 SOL of volume`);
  for (const l of split.preGraduation.legs) console.log(`  curve  ${String(l.bps).padStart(6)} bps  ${l.lamportsPer1Sol.padStart(9)} lamports → ${l.to}`);
  for (const l of split.postGraduation.legs) console.log(`  cpmm   ${String(l.bps).padStart(6)} bps  ${l.lamportsPer1Sol.padStart(9)} lamports → ${l.to}`);
  console.log(`\ninstruction: ${tx.instructions[0].name} (${tx.instructions[0].program}), ${tx.instructions[0].accounts.length} accounts, data ${tx.instructions[0].dataHex.length / 2} bytes`);
  for (const a of tx.instructions[0].accounts) console.log(`  ${a.signer ? "S" : " "}${a.writable ? "W" : " "} ${a.pubkey}  ${a.role}`);
  console.log(`\nnext: ${out.next.join(" → ")}`);
}
