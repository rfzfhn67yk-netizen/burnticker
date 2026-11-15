import { PublicKey } from "@solana/web3.js";
import { FakeLaunchLab, SdkLaunchLab, type LaunchLabClient, type LaunchLabCreateInput } from "@/lib/burnticker/launchBundle";
import { decodeGlobalConfig, decodePlatform, DEFAULT_SOL_CONFIG, type GlobalConfigView, type PlatformView } from "@/lib/burnKeeper/launch";
import { LAUNCHLAB_PROGRAM_ID, NATIVE_MINT } from "@/lib/burnReceipts/constants";
import { checkLpLockPins } from "@/lib/burnticker/lpLockPins";

/**
 * THE REAL LAUNCHLAB CLIENT FOR THE SITE (launch-10, 2026-10-12; PLATFORM-NEXT-BRIEF item 1a). Until now server.ts wired FakeLaunchLab on
 * every host, so a browser launch could never land. ChainLaunchLab reads the two accounts the SDK builder needs (LaunchLab's SOL global
 * config and the Burnticker platform config) over the host's read-only RPC, decodes them with the CLI's own decoders
 * (src/lib/burnKeeper/launch.ts), and hands them to SdkLaunchLab, the same initialize_v2 builder the $DEFICIT CLI uses. No key is read
 * and nothing is sent: the result is unsigned instructions for the creator's wallet.
 *
 * Before building it refuses (throws, so the launch route answers 400 and nothing is registered) when:
 *  - either account is missing or not owned by the LaunchLab program for the cluster;
 *  - the global config's quote mint is not wrapped SOL;
 *  - the platform fails the LP-lock pins (100 % of the graduation LP locked, the Fee Key to the burn program's fee-keys PDA, and the
 *    platform the burn program compiled in; on mainnet also the operator treasury): the same gate the CLI applies before its create.
 * The accounts are read on every launch (two reads), so a change the platform admin makes is seen at once.
 *
 * Selection (launchLabFromEnv): the real client on a devnet or mainnet host with BURNTICKER_RPC_URL, BURNTICKER_PROGRAM_ID and
 * BURNTICKER_PLATFORM_ID; BURNTICKER_LAUNCHLAB_CLIENT=fake forces the fake. Otherwise the fake, and the pages say why.
 */

export interface LaunchLabAccountReader {
  getAccountInfo(key: PublicKey, commitment?: "confirmed"): Promise<{ data: Uint8Array | Buffer; owner: PublicKey } | null>;
}

export interface ChainLaunchLabOpts {
  reader: LaunchLabAccountReader;
  cluster: "devnet" | "mainnet";
  platformId: PublicKey;
  /** The deployed burn_receipts program: the LP-lock pins are checked against its fee-keys PDA. */
  burnProgramId: PublicKey;
  /** LaunchLab's SOL global config (default: the cluster's standard one). */
  configId?: PublicKey;
  slippageBps?: number;
}

export interface LaunchLabViews { global: GlobalConfigView; platform: PlatformView; configId: PublicKey }

export class ChainLaunchLab implements LaunchLabClient {
  readonly platformId: string;
  readonly placeholder = false;
  private readonly o: ChainLaunchLabOpts;
  constructor(o: ChainLaunchLabOpts) { this.o = o; this.platformId = o.platformId.toBase58(); }

  /** The decoded accounts, checked; throws a plain sentence naming what is wrong. */
  async views(): Promise<LaunchLabViews> {
    const program = LAUNCHLAB_PROGRAM_ID[this.o.cluster], configId = this.o.configId ?? DEFAULT_SOL_CONFIG[this.o.cluster];
    let g: Awaited<ReturnType<LaunchLabAccountReader["getAccountInfo"]>>, p: Awaited<ReturnType<LaunchLabAccountReader["getAccountInfo"]>>;
    try { [g, p] = await Promise.all([this.o.reader.getAccountInfo(configId, "confirmed"), this.o.reader.getAccountInfo(this.o.platformId, "confirmed")]); }
    catch (e) { throw new Error(`launchlab: the LaunchLab settings could not be read from ${this.o.cluster} (${String((e as Error)?.message ?? e).slice(0, 80)})`); }
    if (!g) throw new Error(`launchlab: LaunchLab's global config ${configId.toBase58()} was not found on ${this.o.cluster}`);
    if (!p) throw new Error(`launchlab: the platform config ${this.platformId} was not found on ${this.o.cluster}`);
    if (!g.owner.equals(program)) throw new Error(`launchlab: the global config ${configId.toBase58()} is not owned by LaunchLab ${program.toBase58()}`);
    if (!p.owner.equals(program)) throw new Error(`launchlab: the platform config ${this.platformId} is not owned by LaunchLab ${program.toBase58()}`);
    let global: GlobalConfigView, platform: PlatformView;
    try { global = decodeGlobalConfig(g.data); platform = decodePlatform(p.data); } catch (e) { throw new Error(`launchlab: the LaunchLab settings could not be decoded (${String((e as Error)?.message ?? e).slice(0, 80)})`); }
    if (!global.mintB.equals(NATIVE_MINT)) throw new Error(`launchlab: the global config ${configId.toBase58()} does not raise in wrapped SOL`);
    const pins = checkLpLockPins(Uint8Array.from(p.data), { programId: this.o.burnProgramId, cluster: this.o.cluster, requireTreasury: this.o.cluster === "mainnet", platformId: this.o.platformId });
    if (pins.problems.length) throw new Error(`launchlab: the platform config fails the LP-lock pins: ${pins.problems.join("; ")}`);
    return { global, platform, configId };
  }

  async createLaunchIxs(i: LaunchLabCreateInput) {
    if (i.cluster !== this.o.cluster) throw new Error(`launchlab: this host's LaunchLab client is for ${this.o.cluster}, not ${i.cluster}`);
    if (i.platformId !== this.platformId) throw new Error(`launchlab: the launch names platform ${i.platformId}, but this host's is ${this.platformId}`);
    const v = await this.views();
    const sdk = new SdkLaunchLab({ cluster: this.o.cluster, programId: LAUNCHLAB_PROGRAM_ID[this.o.cluster], platformId: this.o.platformId, configId: v.configId, global: v.global, platform: v.platform, slippageBps: this.o.slippageBps });
    return sdk.createLaunchIxs(i);
  }
}

const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * The host's LaunchLab client and the one line the pages show about it (server.ts pushes it into `stubs`). `reader` is the host's
 * read-only connection (null without BURNTICKER_RPC_URL).
 */
export function launchLabFromEnv(env: Readonly<Record<string, string | undefined>>, o: { cluster: "devnet" | "mainnet" | "localnet"; reader: LaunchLabAccountReader | null }): { client: LaunchLabClient; real: boolean; stub: string } {
  const platformId = (env.BURNTICKER_PLATFORM_ID ?? "").trim(), programId = (env.BURNTICKER_PROGRAM_ID ?? "").trim(), configId = (env.BURNTICKER_LAUNCHLAB_CONFIG_ID ?? "").trim();
  const fake = (why: string) => ({ client: new FakeLaunchLab(PUBKEY_RE.test(platformId) ? platformId : undefined), real: false, stub: why });
  if ((env.BURNTICKER_LAUNCHLAB_CLIENT ?? "").trim() === "fake") return fake(`LaunchLab: this host is set to the practice client (BURNTICKER_LAUNCHLAB_CLIENT=fake), so launches built here cannot be signed`);
  if (!PUBKEY_RE.test(platformId)) return fake("LaunchLab platform config: not named on this host (BURNTICKER_PLATFORM_ID), so the practice client builds placeholder instructions");
  if (o.cluster === "localnet") return fake(`LaunchLab platform ${platformId}: localnet has no LaunchLab, so the practice client is in use`);
  if (!o.reader) return fake(`LaunchLab platform ${platformId}: no BURNTICKER_RPC_URL on this host to read its settings, so the practice client is in use`);
  if (!PUBKEY_RE.test(programId)) return fake(`LaunchLab platform ${platformId}: no BURNTICKER_PROGRAM_ID on this host to check its LP-lock pins against, so the practice client is in use`);
  if (configId && !PUBKEY_RE.test(configId)) return fake(`LaunchLab: BURNTICKER_LAUNCHLAB_CONFIG_ID is not a public key, so the practice client is in use`);
  const client = new ChainLaunchLab({ reader: o.reader, cluster: o.cluster, platformId: new PublicKey(platformId), burnProgramId: new PublicKey(programId), ...(configId ? { configId: new PublicKey(configId) } : {}) });
  return { client, real: true, stub: `LaunchLab platform ${platformId}: the real client reads its settings over this host's RPC on every launch and builds the creator's unsigned create` };
}
