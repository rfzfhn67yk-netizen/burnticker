import { hostNetwork, lookupTablePin, type Network } from "@/lib/burnticker/networks";

/**
 * WHAT A LAUNCH BUILT BY THIS SITE MAY CARRY (launch-10, 2026-10-12; LAUNCHPAD-PATH §61 E15 and the vault residual). Client-safe: no fs,
 * no web3 beyond networks.ts. The server enforces every rule here in prepareLaunch (api/handlers.ts); the pages read the sentences.
 *
 * 1. Mainnet is refused unless the host sets BURNTICKER_ALLOW_MAINNET_LAUNCHES=1 (the owner's explicit allowance). The builder
 *    (launchBundle.ts buildLaunchBundle) refuses mainnet without `allowMainnet`; prepareLaunch passes exactly this flag.
 * 2. No opening purchase. A create combined with the creator's purchase did not fit one transaction (1,281 bytes against 1,232).
 *    Since the single coin's split (2026-10-15) the create step with a purchase is 933 bytes (1,053 in vault mode): under the limit,
 *    but short of the 330 bytes kept for a wallet's own appended checks (test/burntickerLookupTable.test.ts), so
 *    the hosted bundle still never carries one: the creator trades on the curve after the create like anyone else. The CLI keeps
 *    `--first-buy-sol` (scripts/burnkeeper-launch.mts) and the offline SDK keeps `firstBuySol`.
 * 3. No vault mode. A vault-mode bundle needs a signature from the burn program's fee PDA (create_vesting_account), which no wallet can
 *    give, so it is hidden until a signable design exists.
 */

export const MAINNET_ALLOWANCE_ENV = "BURNTICKER_ALLOW_MAINNET_LAUNCHES";
const ON = /^(1|true|on|yes)$/i;

/** True only when the host's owner set BURNTICKER_ALLOW_MAINNET_LAUNCHES. Refused by default. */
export const mainnetLaunchesAllowed = (env: Readonly<Record<string, string | undefined>> = process.env): boolean => ON.test((env[MAINNET_ALLOWANCE_ENV] ?? "").trim());

export const MAINNET_OFF_SENTENCE = "This site does not create coins on Solana mainnet yet, so nothing is built or sent here.";
export const NO_OPENING_PURCHASE_SENTENCE = "A coin made on this site starts with no opening purchase. Once it exists, you can trade on its curve like anyone else.";
/** Phantom v1 step 2: the fallback blocker when no table is pinned (a wallet signing version 1 needs none). */
export const NO_LOOKUP_TABLE_SENTENCE = (network: Network): string => `This site has no lookup table pinned for ${network}, so a launch cannot be signed here by a wallet that signs version-0 transactions.`;
export const VAULT_HIDDEN_SENTENCE = "Coins made on this site burn from their own trading fees. Locking part of the supply in a vault is not offered, because no wallet can sign that step yet.";

/** The opening purchase a hosted request asked for, in SOL; 0 when none (or the field is "0"). */
export const requestedOpeningPurchase = (firstBuySol: unknown): number => { const n = Number(String(firstBuySol ?? "0").trim() || "0"); return Number.isFinite(n) ? n : NaN; };

export interface HostedSigning {
  network: Network;
  /** true only when every piece a browser launch needs is wired on this host (the launches-open switch is launchAvailability.ts's). */
  canComplete: boolean;
  /** each missing piece, one plain sentence; [] when canComplete */
  blockers: string[];
  /**
   * Phantom v1 scope step 2 (2026-10-19): pieces only the version-0 fallback needs (the lookup-table pin). A wallet that signs
   * version-1 transactions does without them, so they do not block `canComplete`; the signing card refuses a version-0 wallet on them.
   */
  fallbackBlockers: string[];
}

/**
 * Whether a launch built here could be signed and land, from the host's settings alone (no network read). website-12's availability
 * record can fold this in; the pieces are the ones the code review named (server.ts used a fake LaunchLab, no mainnet allowance, no
 * lookup table pinned).
 */
export function hostedSigning(env: Readonly<Record<string, string | undefined>> = process.env): HostedSigning {
  const network = hostNetwork(env), has = (k: string) => !!(env[k] ?? "").trim();
  const blockers: string[] = [];
  if (network === "mainnet" && !mainnetLaunchesAllowed(env)) blockers.push(MAINNET_OFF_SENTENCE);
  if (!has("BURNTICKER_RPC_URL")) blockers.push("This site has no connection to the network, so it cannot read the LaunchLab settings a launch needs.");
  if (!has("BURNTICKER_PROGRAM_ID")) blockers.push("This site does not name the burn program, so it cannot build the step that locks the rule.");
  if (!has("BURNTICKER_PLATFORM_ID")) blockers.push("This site does not name its LaunchLab platform, so it cannot build the step that creates the coin.");
  if (!has("BURNTICKER_ADMIN")) blockers.push("This site does not name the shared wallet that administers each coin, so it cannot build the step that locks the rule.");
  // the browser's wallet connection (WalletProviders.tsx) is NEXT_PUBLIC_BURNTICKER_RPC_URL, else the public devnet endpoint: on a mainnet
  // host without it the signing card would read the table from devnet and refuse (fail closed), so it is named here
  if (network === "mainnet" && !has("NEXT_PUBLIC_BURNTICKER_RPC_URL")) blockers.push("This site's wallet connection points at devnet, so a mainnet launch cannot be signed here.");
  if (!has("BURNTICKER_FEE_WALLET")) blockers.push("This site does not name its fee wallet, so the launch would not be complete.");
  if ((env.BURNTICKER_LAUNCHLAB_CLIENT ?? "").trim() === "fake") blockers.push("This site is set to build practice launches only, which cannot be signed.");
  // the table is needed only by a wallet that signs version 0 (SignCard.tsx reads the pin while that fallback is in play)
  const fallbackBlockers = lookupTablePin(network, env).address ? [] : [NO_LOOKUP_TABLE_SENTENCE(network)];
  return { network, canComplete: blockers.length === 0, blockers, fallbackBlockers };
}
