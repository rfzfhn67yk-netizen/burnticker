import { SolanaSignTransaction, type SolanaSignTransactionFeature, type SolanaSignTransactionInput, type SolanaTransactionVersion } from "@solana/wallet-standard-features";

/**
 * WHICH TRANSACTION FORMAT A WALLET SIGNS (Phantom v1 scope step 2, docs/burnticker/phantom-v1-scope-2026-10-19.md §3). The signal is
 * the wallet-standard `solana:signTransaction` feature's `supportedTransactionVersions`: the feature the signing card actually calls.
 * The adapter's own `supportedTransactionVersions` set prefers the sign-and-send feature when the wallet has one, which is not the path
 * a launch takes, so it is read only for an adapter that is not a wallet-standard wallet (none is registered by WalletProviders.tsx;
 * the fallback keeps such a wallet on version 0). Membership is tested, never emptiness: a legacy-only wallet reports ['legacy'].
 *
 * The decision is made ONCE per plan, before anything is built, and pinned in the plan record (signPlan.ts SignPlan.format), so a
 * resumed run after a reload keeps the format it started with. Client-safe: no web3, no kit.
 */

/** 0 = a version-0 transaction against the network's lookup table (signPlan.ts); 1 = a version-1 transaction, no table (signPlanV1.ts). */
export type TxFormat = 0 | 1;

/** The slice of a wallet-standard wallet the card reads: its accounts and its feature record. */
export interface StandardWalletLike {
  /** the wallet-standard name ("Phantom", "Solflare", ...); read only for the Phantom readiness line */
  readonly name?: string;
  readonly accounts: readonly StandardAccountLike[];
  readonly features: Readonly<Record<string, unknown>>;
}
export interface StandardAccountLike { readonly address: string; readonly chains: readonly string[]; readonly features: readonly string[] }
type SignFeature = SolanaSignTransactionFeature[typeof SolanaSignTransaction];
/** The account type the feature's own method takes (a wallet-standard WalletAccount). */
export type SignAccount = SolanaSignTransactionInput["account"];

const isVersion = (x: unknown): x is SolanaTransactionVersion => x === "legacy" || x === 0 || x === 1;

/** The wallet-standard wallet behind an adapter (StandardWalletAdapter exposes it as `.wallet`), or null for any other adapter. */
export function standardWalletOf(adapter: unknown): StandardWalletLike | null {
  const w = (adapter as { wallet?: unknown } | null | undefined)?.wallet as StandardWalletLike | undefined;
  return w && typeof w === "object" && w.features && typeof w.features === "object" && Array.isArray(w.accounts) ? w : null;
}

/** The feature the card signs with, or null when the wallet does not expose it. */
export function signTransactionFeature(std: StandardWalletLike | null): SignFeature | null {
  const f = std?.features[SolanaSignTransaction] as SignFeature | undefined;
  return f && typeof f.signTransaction === "function" ? f : null;
}

/**
 * The versions the wallet's signTransaction feature advertises, as a set; for an adapter without a wallet-standard wallet, the adapter's
 * own set less version 1 (a version-1 step is signed through the feature with bytes, which such an adapter does not offer); null when
 * nothing is advertised (not connected, or a wallet with no signing feature).
 */
export function signTransactionVersions(adapter: unknown): ReadonlySet<SolanaTransactionVersion> | null {
  const feature = signTransactionFeature(standardWalletOf(adapter));
  if (feature) return new Set((Array.isArray(feature.supportedTransactionVersions) ? feature.supportedTransactionVersions : []).filter(isVersion));
  const own = (adapter as { supportedTransactionVersions?: unknown } | null | undefined)?.supportedTransactionVersions;
  if (own instanceof Set) return new Set([...own].filter(isVersion).filter((v) => v !== 1));
  return null;
}

/**
 * Phantom support, ticket 438485 (Rory, 2026-10-20): version 1 is chosen from the connected account's capability, never from the
 * extension's version string. True only when ALL hold: the connected account is found in the wallet (standardAccountFor), its own
 * `features` list names "solana:signTransaction", its `chains` include this launch's chain (solana:mainnet or solana:devnet), and the
 * wallet's signTransaction feature advertises version 1. A network that could not be read never signs version 1.
 */
export function accountSignsV1(std: StandardWalletLike | null, address: string | null, network: "devnet" | "mainnet" | null | undefined): boolean {
  if (!network) return false;
  const account = std && address ? std.accounts.find((a) => a.address === address) : undefined;
  if (!account || !Array.isArray(account.features) || !account.features.includes(SolanaSignTransaction)) return false;
  if (!Array.isArray(account.chains) || !account.chains.includes(chainIdOf(network))) return false;
  const feature = signTransactionFeature(std);
  return !!feature && Array.isArray(feature.supportedTransactionVersions) && feature.supportedTransactionVersions.includes(1);
}

/**
 * The versions a launch may use with the connected account: the wallet's advertised set (signTransactionVersions) with version 1 kept
 * only when accountSignsV1 holds for this account and this launch's chain. decideStepFormat and formatProblems read this set, so a
 * wallet that advertises version 1 for a different account or chain gets the version-0 fallback (or, for a plan pinned to version 1,
 * PINNED_V1_SENTENCE).
 */
export function launchSignVersions(adapter: unknown, address: string | null, network: "devnet" | "mainnet" | null | undefined): ReadonlySet<SolanaTransactionVersion> | null {
  const versions = signTransactionVersions(adapter);
  if (!versions || !versions.has(1) || accountSignsV1(standardWalletOf(adapter), address, network)) return versions;
  return new Set([...versions].filter((v) => v !== 1));
}

/**
 * The format a plan uses. A format already pinned to the plan wins (the record decides; formatProblems refuses a wallet that cannot
 * honour it). Otherwise version 1 when the wallet advertises it, version 0 when it advertises that, null when neither (refused).
 */
export function decideStepFormat(pinned: TxFormat | null | undefined, versions: ReadonlySet<SolanaTransactionVersion> | null): TxFormat | null {
  if (pinned === 0 || pinned === 1) return pinned;
  if (versions?.has(1)) return 1;
  if (versions?.has(0)) return 0;
  return null;
}

export const NO_VERSION_SENTENCE = "this wallet cannot sign version-0 or version-1 transactions";
export const PINNED_V1_SENTENCE = "this launch was started as version-1 transactions, but this wallet does not sign those: connect the wallet it was started with";
export const PINNED_V0_SENTENCE = "this launch was started as version-0 transactions, but this wallet does not sign those: connect the wallet it was started with";

/** Why the connected wallet cannot sign this plan's format ([] when it can). `pinned` is the plan record's format, if any. */
export function formatProblems(pinned: TxFormat | null | undefined, versions: ReadonlySet<SolanaTransactionVersion> | null): string[] {
  if (pinned === 1) return versions?.has(1) ? [] : [PINNED_V1_SENTENCE];
  if (pinned === 0) return versions?.has(0) ? [] : [PINNED_V0_SENTENCE];
  return decideStepFormat(null, versions) === null ? [NO_VERSION_SENTENCE] : [];
}

/** The three-way readiness line beside the steps (null until a wallet is connected or when it signs neither). */
export function formatReadinessLine(format: TxFormat | null): string | null {
  if (format === 1) return "This wallet signs version-1 transactions, so each step is sent as one. No lookup table is needed.";
  if (format === 0) return "This wallet signs version-0 transactions, so each step is sent as one against this site's lookup table.";
  return null;
}

/** Phantom 26.33.1 reached full rollout with version-1 signing on 2026-10-15 (ticket 438485); said only, never used to decide. */
export const PHANTOM_V0_LINE = "Phantom 26.33.1 or later signs these launches as version-1 transactions; this wallet signs version 0, which works too.";
/**
 * The extra readiness line for a Phantom wallet that does not offer version 1 for this launch but does sign version 0. Phantom is
 * identified only by the wallet-standard name; any other or missing name gets no line.
 */
export function phantomVersionLine(std: StandardWalletLike | null, versions: ReadonlySet<SolanaTransactionVersion> | null): string | null {
  if (!std || typeof std.name !== "string" || std.name.trim().toLowerCase() !== "phantom") return null;
  return versions && !versions.has(1) && versions.has(0) ? PHANTOM_V0_LINE : null;
}

/** The wallet-standard account for the connected address, or null. */
export function standardAccountFor(std: StandardWalletLike | null, address: string | null): SignAccount | null {
  if (!std || !address) return null;
  return (std.accounts.find((a) => a.address === address) as SignAccount | undefined) ?? null;
}

/** The wallet-standard chain id of a network ("solana:devnet", "solana:mainnet"). */
export const chainIdOf = (network: "devnet" | "mainnet"): `solana:${"devnet" | "mainnet"}` => `solana:${network}`;

/**
 * Signs raw transaction bytes through the wallet-standard feature itself (never the adapter's signTransaction, which round-trips the
 * bytes through web3.js 1.x and cannot carry a version-1 envelope). Returns the signed bytes the wallet hands back, unchanged.
 */
export async function signWithStandardWallet(std: StandardWalletLike | null, account: SignAccount | null, chain: string, bytes: Uint8Array): Promise<Uint8Array> {
  const feature = signTransactionFeature(std);
  if (!feature) throw new Error("this wallet has no signTransaction feature");
  if (!account) throw new Error("the connected account was not found in the wallet");
  if (!account.chains.includes(chain as (typeof account.chains)[number])) throw new Error(`the connected account is not on ${chain.replace(/^solana:/, "")}`);
  const [out] = await feature.signTransaction({ account, transaction: bytes, chain: chain as `${string}:${string}` });
  if (!out || !(out.signedTransaction instanceof Uint8Array)) throw new Error("the wallet returned no transaction");
  return out.signedTransaction;
}

// ---- the version-0 fallback (LA7 fix B, 2026-10-20) ---------------------------------------------------------------------------------

/**
 * The host switch BURNTICKER_WALLET_TX_V1 (docs/burnticker/runbook.md): "0" forces version 0 for every launch on this host, anything else
 * (or unset) leaves version 1 on for wallets that offer it. The server reads it and hands it to the card (GET /api/burnticker/launch
 * `walletTxV1`), so turning it off needs no rebuild.
 */
export const walletTxV1Enabled = (env: Readonly<Record<string, string | undefined>>): boolean => (env.BURNTICKER_WALLET_TX_V1 ?? "").trim() !== "0";

/** The versions with version 1 removed (the host switch is off); null stays null. */
export function withoutV1(versions: ReadonlySet<SolanaTransactionVersion> | null): ReadonlySet<SolanaTransactionVersion> | null {
  return versions ? new Set([...versions].filter((v) => v !== 1)) : null;
}

/**
 * Whether a dry-run failure of a version-1 step is about the transaction FORMAT rather than the step itself: the node cannot read a
 * version-1 transaction (an older cluster or RPC answers that it does not support the version, or that the bytes do not deserialize),
 * or the simulation's own error is UnsupportedVersion. Any other failure (an instruction error, insufficient funds, a blockhash) is
 * about the step, and the same step built as version 0 would fail the same way, so it never falls back.
 */
const VERSION_REFUSAL = /unsupported ?(transaction )?version|version\W{0,3}1?\W{0,3}(is )?not supported|transaction version|failed to deserialize|could not deserialize|unable to deserialize|invalid transaction version|maxSupportedTransactionVersion/i;
export function isVersionRefusal(x: unknown): boolean {
  if (x == null) return false;
  let text: string;
  if (typeof x === "string") text = x;
  else if (x instanceof Error) text = x.message;
  else { try { text = JSON.stringify(x); } catch { text = String(x); } }
  return VERSION_REFUSAL.test(text);
}

/** The card's notice when a launch falls back to version 0 before the wallet was asked (LA7 fix B). */
export const V0_FALLBACK_NOTICE = "This network did not accept a version-1 transaction, so this launch is being sent as version-0 transactions against this site's lookup table. Nothing was signed or sent before the switch.";
/** The card's line while it reads this site's format setting (GET /api/burnticker/launch). */
export const FORMAT_SETTING_READING = "this page is still reading which transaction format this site uses";
