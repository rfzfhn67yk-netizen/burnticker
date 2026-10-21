// HOSTED LAUNCHES (launch-10, 2026-10-12; PLATFORM-NEXT-BRIEF item 1). The code review found a browser launch could never complete:
// server.ts wired FakeLaunchLab unconditionally, prepareLaunch never passed allowMainnet, the lookup-table pin was compiled in (null), a
// create with the creator's opening purchase did not fit one transaction and vault-mode bundles needed a PDA signature. These tests pin
// the new truth: the real LaunchLab client on an RPC host (the fake elsewhere), mainnet refused unless the host allows it, no opening
// purchase and no vault mode on the hosted path, and the lookup-table pin read at runtime.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import { LaunchpadConfig, PlatformConfig } from "@raydium-io/raydium-sdk-v2";
import { buildLaunchBundle, FakeLaunchLab, SdkLaunchLab } from "@/lib/burnticker/launchBundle";
import { ChainLaunchLab, launchLabFromEnv, type LaunchLabAccountReader } from "@/lib/burnticker/launchLabChain";
import { hostedSigning, mainnetLaunchesAllowed, MAINNET_OFF_SENTENCE, NO_OPENING_PURCHASE_SENTENCE, VAULT_HIDDEN_SENTENCE, NO_LOOKUP_TABLE_SENTENCE } from "@/lib/burnticker/hostedLaunch";
import { LOOKUP_TABLES, lookupTablePin, lookupTablePins, PROGRAM_IDS, type Network } from "@/lib/burnticker/networks";
import { planSizeProblems, v0WireSize } from "@/lib/burnticker/lookupTable";
import { launchlabPlan } from "@/lib/burnticker/signPlan";
import { BURNTICKER_PLATFORM, LAUNCHLAB_PROGRAM_ID, NATIVE_MINT } from "@/lib/burnReceipts/constants";
import { feeKeysPda } from "@/lib/burnReceipts/pda";
import { DEFAULT_SOL_CONFIG, decodeGlobalConfig, decodePlatform } from "@/lib/burnKeeper/launch";
import { DEFAULT_CP_CONFIG } from "@/lib/burnticker/pairCurveLaunch";
import { burnPoolFor } from "@/lib/burnKeeper/burnPool";
import { prepareLaunch } from "@/lib/burnticker/api/handlers";
import { platform, setPlatformForTests } from "@/lib/burnticker/server";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { RealIdProgram } from "./burntickerLutFixtures.ts";
import { makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS, VAULT_RULE } from "./burntickerHelpers.ts";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const CREATOR = "Bfy67FZExj33ihNN9HDEH9KwLAPR6kW9tWAzvdXqssvx";
const FEE_WALLET = "3s97xfWwH5qwPjqrmjHwPobZ3Z6oxWMQm2CDVQoA5pZp";
const bn = (n: number | bigint) => new BN(n.toString());

// ---- the two LaunchLab accounts, encoded with the SDK's own layouts (what getAccountInfo returns on chain) ----

function globalData(o: { mintB?: PublicKey } = {}): Buffer {
  const b = Buffer.alloc(LaunchpadConfig.span);
  LaunchpadConfig.encode({ epoch: bn(0), curveType: 0, index: 0, migrateFee: bn(0), tradeFeeRate: bn(10_000), maxShareFeeRate: bn(10_000), minSupplyA: bn(10_000_000), maxLockRate: bn(300_000), minSellRateA: bn(200_000), minMigrateRateA: bn(200_000), minFundRaisingB: bn(30_000_000_000),
    mintB: o.mintB ?? NATIVE_MINT, protocolFeeOwner: PublicKey.default, migrateFeeOwner: PublicKey.default, migrateToAmmWallet: PublicKey.default, migrateToCpmmWallet: PublicKey.default }, b);
  return b;
}
function platformData(network: Network, o: { lockWallet?: PublicKey; scales?: [number, number, number] } = {}): Buffer {
  const b = Buffer.alloc(PlatformConfig.span);
  const [ps, cs, bs] = o.scales ?? [1_000_000, 0, 0];
  const pad = (s: string, n: number) => { const x = Buffer.alloc(n); Buffer.from(s).copy(x); return x as unknown as number[]; };   // the layout types blobs as number[]; it encodes a Buffer
  PlatformConfig.encode({ epoch: bn(0), platformClaimFeeWallet: new PublicKey(FEE_WALLET), platformLockNftWallet: o.lockWallet ?? feeKeysPda(new PublicKey(PROGRAM_IDS[network].burn_receipts)),
    platformScale: bn(ps), creatorScale: bn(cs), burnScale: bn(bs), feeRate: bn(2_500), name: pad("Burnticker", 64), web: pad("https://burnticker.com", 256), img: pad("https://burnticker.com/icon.png", 256),
    cpConfigId: new PublicKey(DEFAULT_CP_CONFIG[network]), creatorFeeRate: bn(5_000), transferFeeExtensionAuth: PublicKey.default, platformVestingWallet: PublicKey.default, platformVestingScale: bn(0), platformCpCreator: PublicKey.default,
    restrictGlobalConfig: 0, restrictCurveParam: 0, curveRuleManager: PublicKey.default }, b);
  return b;
}
/** A read-only account reader over a fixed map (owner = LaunchLab unless overridden); counts reads. */
function reader(network: Network, accounts: Map<string, { data: Buffer; owner?: PublicKey } | null>): LaunchLabAccountReader & { reads: number } {
  const r = { reads: 0, async getAccountInfo(k: PublicKey) { r.reads++; const a = accounts.get(k.toBase58()); return a ? { data: a.data, owner: a.owner ?? LAUNCHLAB_PROGRAM_ID[network] } : null; } };
  return r;
}
const chainAccounts = (network: Network, over: { global?: { data: Buffer; owner?: PublicKey } | null; platform?: { data: Buffer; owner?: PublicKey } | null } = {}) =>
  new Map([[DEFAULT_SOL_CONFIG[network].toBase58(), over.global === undefined ? { data: globalData() } : over.global], [BURNTICKER_PLATFORM[network].toBase58(), over.platform === undefined ? { data: platformData(network) } : over.platform]]);
const chain = (network: Network, r: LaunchLabAccountReader) => new ChainLaunchLab({ reader: r, cluster: network, platformId: BURNTICKER_PLATFORM[network], burnProgramId: new PublicKey(PROGRAM_IDS[network].burn_receipts) });

const input = (network: Network, o: { firstBuySol?: string; rule?: unknown } = {}) => ({ creator: CREATOR, ticker: "HOSTED", name: "Hosted launch", description: "", imageUrl: null, links: [], rule: o.rule ?? BRONCOS, firstBuySol: o.firstBuySol ?? "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: network });
const URI = (m: string) => `https://arweave.net/${m.slice(0, 43).padEnd(43, "x")}`;

describe("(a) the real LaunchLab client, selected by env on an RPC host", () => {
  const someReader = reader("devnet", new Map());
  const full = { BURNTICKER_PLATFORM_ID: BURNTICKER_PLATFORM.devnet.toBase58(), BURNTICKER_PROGRAM_ID: PROGRAM_IDS.devnet.burn_receipts };
  test("the fake on every host that lacks a piece; the real client when the RPC, the program and the platform are all named", () => {
    const cases: [string, Record<string, string>, "devnet" | "mainnet" | "localnet", LaunchLabAccountReader | null, boolean, RegExp][] = [
      ["nothing set", {}, "devnet", null, false, /not named on this host/],
      ["no RPC", full, "devnet", null, false, /no BURNTICKER_RPC_URL/],
      ["no program id", { BURNTICKER_PLATFORM_ID: full.BURNTICKER_PLATFORM_ID }, "devnet", someReader, false, /no BURNTICKER_PROGRAM_ID/],
      ["localnet", full, "localnet", someReader, false, /localnet has no LaunchLab/],
      ["forced fake", { ...full, BURNTICKER_LAUNCHLAB_CLIENT: "fake" }, "devnet", someReader, false, /practice client/],
      ["everything", full, "devnet", someReader, true, /real client reads its settings/],
    ];
    for (const [name, env, cluster, r, real, stub] of cases) {
      const s = launchLabFromEnv(env, { cluster, reader: r });
      assert.equal(s.real, real, name); assert.match(s.stub, stub, name);
      assert.ok(real ? s.client instanceof ChainLaunchLab : s.client instanceof FakeLaunchLab, name);
      assert.equal(s.client.placeholder, !real, name);
    }
  });

  test("server.ts: platform() picks the real client from the host's environment (no network read at construction) and the fake without an RPC", () => {
    const base = { BURNTICKER_DB: ":memory:", BURNTICKER_CLUSTER: "devnet", ...full };
    try {
      setPlatformForTests(null);
      const real = platform({ ...base, BURNTICKER_RPC_URL: "http://127.0.0.1:9" });
      assert.ok(real.launchLab instanceof ChainLaunchLab); assert.equal(real.launchLab.platformId, full.BURNTICKER_PLATFORM_ID);
      setPlatformForTests(null);
      const fake = platform(base);
      assert.ok(fake.launchLab instanceof FakeLaunchLab);
      assert.ok(fake.stubs.some((s) => /no BURNTICKER_RPC_URL on this host to read its settings/.test(s)));
    } finally { setPlatformForTests(null); }
    assert.doesNotMatch(read("src/lib/burnticker/server.ts"), /new FakeLaunchLab\(/, "server.ts no longer constructs the fake unconditionally");
  });

  for (const network of ["devnet", "mainnet"] as const) {
    test(`${network}: the client decodes the two accounts and builds exactly what the SDK builder builds; the bundle is ready and fits with the table`, async () => {
      const r = reader(network, chainAccounts(network));
      const ll = chain(network, r);
      const v = await ll.views();
      assert.deepEqual([v.global.mintB.toBase58(), v.platform.platformScale, v.platform.platformLockNftWallet.toBase58()], [NATIVE_MINT.toBase58(), BigInt(1_000_000), feeKeysPda(new PublicKey(PROGRAM_IDS[network].burn_receipts)).toBase58()]);
      const mint = Keypair.generate();
      const deps = { program: new RealIdProgram(network), devFeeWallet: FEE_WALLET, attesters: [CREATOR], quorum: 1, metadataUri: URI, mintKeypair: mint, allowMainnet: network === "mainnet" };
      const b = await buildLaunchBundle(input(network), { ...deps, launchLab: ll });
      assert.equal(b.ready, true); assert.deepEqual(b.pending, []);
      const sdk = new SdkLaunchLab({ cluster: network, programId: LAUNCHLAB_PROGRAM_ID[network], platformId: BURNTICKER_PLATFORM[network], configId: DEFAULT_SOL_CONFIG[network], global: decodeGlobalConfig(globalData()), platform: decodePlatform(platformData(network)) });
      const ref = await buildLaunchBundle(input(network), { ...deps, launchLab: sdk });
      assert.deepEqual(b.transactions, ref.transactions, "byte-identical to the CLI's builder over the same accounts");
      const ll2 = b.transactions[1].instructions.find((ix) => ix.programId === LAUNCHLAB_PROGRAM_ID[network].toBase58())!;
      assert.ok(ll2.keys.some((k) => k.pubkey === BURNTICKER_PLATFORM[network].toBase58()), "the create names the Burnticker platform");
      assert.ok(ll2.keys.some((k) => k.pubkey === burnPoolFor(new PublicKey(PROGRAM_IDS[network].burn_receipts), mint.publicKey).feePda.toBase58()), "LaunchLab's creator is the fee PDA");
      // 2026-10-15: two steps, the rule locked then the coin created, each with room for a wallet's own appended checks
      assert.equal(b.transactions.length, 2); assert.doesNotMatch(b.transactions[1].label, /first buy/);
      for (const t of b.transactions) { const size = v0WireSize(t.instructions, CREATOR, network)!; assert.ok(size <= 900, `${size} bytes with the table`); }
      assert.deepEqual(planSizeProblems(launchlabPlan([b]).steps, CREATOR, network), []);
      assert.deepEqual(launchlabPlan([b]).pending, [], "nothing pending: the browser can sign it");
      await buildLaunchBundle(input(network), { ...deps, mintKeypair: Keypair.generate(), launchLab: ll });
      assert.equal(r.reads, 2 + 2 + 2, "the accounts are read again on every launch (views() + two builds)");
    });
  }

  test("refusals: a missing or foreign-owned account, a non-SOL raise, a platform that fails the LP-lock pins, another cluster or platform", async () => {
    const n: Network = "devnet";
    const bad: [string, ReturnType<typeof chainAccounts>, RegExp][] = [
      ["no global config", chainAccounts(n, { global: null }), /global config .* was not found/],
      ["no platform", chainAccounts(n, { platform: null }), /platform config .* was not found/],
      ["foreign global", chainAccounts(n, { global: { data: globalData(), owner: Keypair.generate().publicKey } }), /is not owned by LaunchLab/],
      ["foreign platform", chainAccounts(n, { platform: { data: platformData(n), owner: Keypair.generate().publicKey } }), /is not owned by LaunchLab/],
      ["USDC raise", chainAccounts(n, { global: { data: globalData({ mintB: Keypair.generate().publicKey }) } }), /does not raise in wrapped SOL/],
      ["LP not locked", chainAccounts(n, { platform: { data: platformData(n, { scales: [0, 0, 1_000_000] }) } }), /fails the LP-lock pins/],
      ["Fee Key elsewhere", chainAccounts(n, { platform: { data: platformData(n, { lockWallet: Keypair.generate().publicKey }) } }), /fails the LP-lock pins/],
    ];
    for (const [name, acc, re] of bad) await assert.rejects(chain(n, reader(n, acc)).createLaunchIxs({ cluster: n, platformId: BURNTICKER_PLATFORM[n].toBase58() } as never), re, name);
    const ok = chain(n, reader(n, chainAccounts(n)));
    await assert.rejects(ok.createLaunchIxs({ cluster: "mainnet", platformId: ok.platformId } as never), /is for devnet, not mainnet/);
    await assert.rejects(ok.createLaunchIxs({ cluster: n, platformId: Keypair.generate().publicKey.toBase58() } as never), /but this host's is/);
    const foreignPlatform = Keypair.generate().publicKey;
    const r = reader(n, new Map([[DEFAULT_SOL_CONFIG[n].toBase58(), { data: globalData() }], [foreignPlatform.toBase58(), { data: platformData(n) }]]));
    await assert.rejects(new ChainLaunchLab({ reader: r, cluster: n, platformId: foreignPlatform, burnProgramId: new PublicKey(PROGRAM_IDS[n].burn_receipts) }).views(), /not the one compiled into burn_receipts/);
  });
});

describe("(b) the mainnet allowance, (c) no opening purchase, (d) no vault mode: enforced by prepareLaunch", () => {
  afterEach(() => setPlatformForTests(null));
  const body = (o: Record<string, unknown> = {}) => ({ creator: CREATOR, ticker: "HOSTB", name: "Hosted coin", description: "", firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, rule: BRONCOS, ...o });

  test("a mainnet host refuses before anything is pinned or registered unless BURNTICKER_ALLOW_MAINNET_LAUNCHES is set; the allowance reaches the builder", async () => {
    assert.equal(mainnetLaunchesAllowed({}), false); assert.equal(mainnetLaunchesAllowed({ BURNTICKER_ALLOW_MAINNET_LAUNCHES: "0" }), false); assert.equal(mainnetLaunchesAllowed({ BURNTICKER_ALLOW_MAINNET_LAUNCHES: "1" }), true);
    const w = await makeWorld();
    w.p.cluster = "mainnet";
    let pins = 0; w.p.uploader = { upload: async () => { pins++; throw new Error("must not be called"); } } as never;
    const before = w.registry.tokens().length;
    const off = await prepareLaunch(w.p, body(), { register: true });
    assert.ok("error" in off); assert.equal(off.error.status, 403);
    assert.deepEqual(off.error.body, { error: MAINNET_OFF_SENTENCE, code: "mainnet-launches-off" });
    assert.equal(pins, 0); assert.equal(w.registry.tokens().length, before);
    w.p.allowMainnet = true;
    const on = await prepareLaunch(w.p, body({ ticker: "HOSTC" }), { register: false });
    assert.ok("ok" in on, JSON.stringify((on as { error?: unknown }).error)); assert.equal(on.ok.bundle.cluster, "mainnet");
    assert.match(read("src/lib/burnticker/api/handlers.ts"), /allowMainnet: p\.allowMainnet === true/);
    setPlatformForTests(null);
    const host = platform({ BURNTICKER_DB: ":memory:", BURNTICKER_CLUSTER: "mainnet" });
    assert.equal(host.allowMainnet, false); assert.ok(host.stubs.some((s) => /mainnet launches: refused on this host/.test(s)));
    setPlatformForTests(null);
    assert.equal(platform({ BURNTICKER_DB: ":memory:", BURNTICKER_CLUSTER: "mainnet", BURNTICKER_ALLOW_MAINNET_LAUNCHES: "1" }).allowMainnet, true);
  });

  test("an opening purchase is refused on the hosted path (the CLI flag and the SDK builder keep it); \"0\" and absent pass", async () => {
    const w = await makeWorld();
    for (const firstBuySol of ["0.5", "0.000000001"]) {
      const r = await prepareLaunch(w.p, body({ firstBuySol }), { register: true });
      assert.ok("error" in r); assert.equal(r.error.status, 400); assert.deepEqual(r.error.body, { error: NO_OPENING_PURCHASE_SENTENCE, code: "opening-purchase-off" });
    }
    for (const [i, firstBuySol] of ["0", "0.0", undefined].entries()) {
      const r = await prepareLaunch(w.p, body({ ticker: `HOSTZ${i}`, firstBuySol }), { register: false });
      assert.ok("ok" in r, JSON.stringify((r as { error?: unknown }).error)); assert.doesNotMatch(r.ok.bundle.transactions.map((t) => t.label).join(" | "), /first buy/);
    }
    assert.match(read("scripts/burnkeeper-launch.mts"), /--first-buy-sol/, "the CLI keeps the flag");
    const sdkBuild = await buildLaunchBundle(input("devnet", { firstBuySol: "0.5" }), { program: new RealIdProgram("devnet"), launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [CREATOR], quorum: 1, metadataUri: URI });
    assert.match(sdkBuild.transactions[1].label, /first buy/, "the offline builder still takes one (on the create step)");
    // the copy: the signing card names no purchase, and says once that there is none
    const card = read("src/app/burnticker/launch/SignCard.tsx");
    assert.doesNotMatch(card, /your opening purchase/); assert.match(card, /\{NO_OPENING_PURCHASE_SENTENCE\}/);
    assert.doesNotMatch(read("src/lib/burnticker/lookupTable.ts"), /launch without the opening purchase/);
    assert.match(read("src/lib/burnticker/api/spec.ts"), /opening-purchase-off/);
  });

  test("vault mode is refused on the hosted path and hidden in the wizard with one plain sentence", async () => {
    const w = await makeWorld();
    const r = await prepareLaunch(w.p, body({ rule: VAULT_RULE }), { register: true });
    assert.ok("error" in r); assert.equal(r.error.status, 400); assert.deepEqual(r.error.body, { error: VAULT_HIDDEN_SENTENCE, code: "vault-off", problems: [VAULT_HIDDEN_SENTENCE] });
    const page = read("src/app/burnticker/launch/page.tsx");
    assert.doesNotMatch(page, /set\("mode", setMode\)/, "a stored vault mode is never restored");
    assert.deepEqual([...page.matchAll(/setMode\(("[a-z]+")\)/g)].map((m) => m[1]), ['"buyback"'], "the wizard only ever sets buyback");
    // website-15 item 12: the vault dev note is gone from the review; the sentence stays as the API's refusal (above)
    assert.equal((page.match(/VAULT_HIDDEN_SENTENCE|data-vault-hidden/g) ?? []).length, 0, "no vault note on the review");
  });

  test("the three sentences are plain and pass the copy lint", () => {
    const cfg = loadCopyLintConfig();
    for (const s of [MAINNET_OFF_SENTENCE, NO_OPENING_PURCHASE_SENTENCE, VAULT_HIDDEN_SENTENCE]) {
      assert.ok(lintCopy(s, cfg).ok, s); assert.doesNotMatch(s, /→| \/ |\(s\)|\b(buy|will)\b/i, s);
    }
  });
});

describe("(e) the lookup-table pin is read from the host at runtime", () => {
  const T = "7qLhZqX5yS8pVJ4j1i9V4o3v2hLm1nBz6bFqJc9uZT8W", OPS = "D8seUoC1RZUs7918Atcc7TbFwRf1khqFvPdjkB4qktbn";
  test("the host's own network takes BURNTICKER_LOOKUP_TABLE (and the authority while not frozen); the other network and a typo keep networks.ts", () => {
    assert.deepEqual(lookupTablePin("devnet", { BURNTICKER_LOOKUP_TABLE: T }), { address: T, authority: null });
    assert.deepEqual(lookupTablePin("devnet", { BURNTICKER_LOOKUP_TABLE: T, BURNTICKER_LOOKUP_TABLE_AUTHORITY: OPS }), { address: T, authority: OPS });
    assert.deepEqual(lookupTablePin("mainnet", { BURNTICKER_LOOKUP_TABLE: T }), LOOKUP_TABLES.mainnet, "a devnet host does not pin mainnet");
    assert.deepEqual(lookupTablePin("mainnet", { BURNTICKER_CLUSTER: "mainnet", BURNTICKER_LOOKUP_TABLE: T }), { address: T, authority: null });
    assert.deepEqual(lookupTablePin("devnet", { BURNTICKER_LOOKUP_TABLE: "not-a-key" }), LOOKUP_TABLES.devnet);
    assert.deepEqual(lookupTablePins({ BURNTICKER_LOOKUP_TABLE: T }), { devnet: { address: T, authority: null }, mainnet: LOOKUP_TABLES.mainnet });
  });
  test("GET /api/burnticker/launch serves the pins; the signing card fetches them and verifies against the fetched pin, refusing while unread", async () => {
    const prev = process.env.BURNTICKER_LOOKUP_TABLE;
    process.env.BURNTICKER_LOOKUP_TABLE = T;
    try {
      const { GET } = await import("../src/app/api/burnticker/launch/route.ts");
      const j = await (await GET()).json() as { lookupTables: Record<Network, { address: string | null }> };
      assert.equal(j.lookupTables.devnet.address, T);
    } finally { if (prev === undefined) delete process.env.BURNTICKER_LOOKUP_TABLE; else process.env.BURNTICKER_LOOKUP_TABLE = prev; }
    const card = read("src/app/burnticker/launch/SignCard.tsx");
    assert.match(card, /fetch\("\/api\/burnticker\/launch"/);
    assert.match(card, /lookupTable: \(\) => verifiedLookupTable\(connection, network, pin\)/);
    // launch audit 231: the still-reading and read-failed sentences moved to signPlan.ts pinReadProblems (a failed read is retried in place)
    assert.match(card, /pins === undefined \|\| pins === null \? pinReadProblems\(pins\)/);
    assert.match(read("src/lib/burnticker/signPlan.ts"), /if \(pins === undefined\) return \["this page is still reading which lookup table this site uses"\]/);
    assert.doesNotMatch(card, /lookupTablePinProblems\(network\)\b/, "no compiled-in pin check left");
  });
  test("`verify` prints a paste-able record and the exact host lines", () => {
    const s = read("scripts/burnticker-lut.mts");
    assert.match(s, /---- paste this record ----/); assert.match(s, /BURNTICKER_LOOKUP_TABLE=\$\{address\}/); assert.match(s, /lookupTablePin\(cluster\)/);
  });
});

describe("hostedSigning: whether a browser launch could land, from the host's settings", () => {
  const all = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_RPC_URL: "https://rpc.invalid", BURNTICKER_PROGRAM_ID: PROGRAM_IDS.devnet.burn_receipts, BURNTICKER_PLATFORM_ID: BURNTICKER_PLATFORM.devnet.toBase58(), BURNTICKER_ADMIN: CREATOR, BURNTICKER_FEE_WALLET: FEE_WALLET, BURNTICKER_LOOKUP_TABLE: "7qLhZqX5yS8pVJ4j1i9V4o3v2hLm1nBz6bFqJc9uZT8W" };
  test("complete only with every piece; mainnet also needs the allowance; each blocker is one plain sentence", () => {
    assert.deepEqual(hostedSigning(all), { network: "devnet", canComplete: true, blockers: [], fallbackBlockers: [] });
    // Phantom v1 step 2: the lookup-table pin is needed only by a wallet that signs version 0, so it is a fallback blocker, never a
    // completion blocker (both networks are pinned in networks.ts, so the env alone cannot unpin one here: the sentence is checked as is)
    assert.ok(!hostedSigning({ ...all, BURNTICKER_LOOKUP_TABLE: "" }).blockers.some((b) => /lookup table/.test(b)));
    assert.match(NO_LOOKUP_TABLE_SENTENCE("devnet"), /^This site has no lookup table pinned for devnet, .*version-0 transactions\.$/); assert.ok(lintCopy(NO_LOOKUP_TABLE_SENTENCE("devnet"), loadCopyLintConfig()).ok);
    assert.equal(hostedSigning({}).canComplete, false);
    const main = hostedSigning({ ...all, BURNTICKER_CLUSTER: "mainnet" });
    assert.equal(main.canComplete, false); assert.ok(main.blockers.includes(MAINNET_OFF_SENTENCE));
    assert.equal(hostedSigning({ ...all, BURNTICKER_CLUSTER: "mainnet", BURNTICKER_ALLOW_MAINNET_LAUNCHES: "1" }).canComplete, false, "the wallet connection would still be devnet");
    assert.equal(hostedSigning({ ...all, BURNTICKER_CLUSTER: "mainnet", BURNTICKER_ALLOW_MAINNET_LAUNCHES: "1", NEXT_PUBLIC_BURNTICKER_RPC_URL: "https://rpc.invalid" }).canComplete, true);
    const cfg = loadCopyLintConfig();
    for (const s of hostedSigning({ BURNTICKER_CLUSTER: "mainnet", BURNTICKER_LAUNCHLAB_CLIENT: "fake" }).blockers) { assert.ok(lintCopy(s, cfg).ok, s); assert.match(s, /^This site\b.*\.$/, s); }
  });
});
