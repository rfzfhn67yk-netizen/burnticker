/**
 * PREVIEW A LAUNCH BUNDLE (never signs). Picks a rule from the public catalogue — a first-party source fixes the unit, the direction and
 * the baseline; you choose only the share of the burn pool each unit spends — hashes it locally, asks the API for the launch bundle
 * and prints what a wallet would be asked to sign: the unsigned transactions (base64 wire format, empty signature slots), the rule's
 * sha256 (which every receipt of the coin will cite), the receipt format and what is still pending on the platform side.
 *
 *   npm run launch                                                # list the catalogue sources you can launch on
 *   npm run launch -- --source treasury.debt --fraction 0.02 --ticker DEBTX --name "Debt Burn" --wallet <your public key>
 *   add --register to reserve the ticker as a 24-hour draft (default: review only, nothing is registered)
 *
 * WHERE A WALLET SIGNS. Nowhere here. This script holds no key: `--wallet` is a PUBLIC key, and the mint keypair the SDK generates for
 * the preview lives only in memory and is discarded. A real launch keeps that mint keypair, takes a fresh blockhash from its own RPC
 * (`launch.withBlockhash(blockhash)` co-signs with the mint), and then the CREATOR'S WALLET signs and sends — see
 * packages/burnticker-sdk/examples/launch-bot.ts and docs/burnticker/sdk.md §2. While the bundle says `ready: false`, send nothing.
 */
import { Burnticker, rules, type SourceCard } from "./sdk.ts";
import { config, isMain, parseArgs, type StarterConfig } from "./config.ts";

/** The catalogue sources a scalar first-party rule can be built from (launchable, with a unit). */
export const launchableSources = (sources: readonly SourceCard[]): SourceCard[] => sources.filter((s) => s.launchable.ok && s.unit && s.direction && s.baseline !== null);

/** The selector + mapping for a catalogue source at `fraction` of the burn pool per unit (0.01–0.10). */
export function ruleFor(src: SourceCard, fraction: number): { selector: { oracle: "catalogue"; series: string }; mapping: { kind: "scalar"; scalar: { unit: number; perUnit: { fractionOfPool: number }; baseline: "previousSettlement" | number; direction: "up" | "down" | "abs" } } } {
  if (!src.unit || !src.direction || src.baseline === null) throw new Error(`${src.id} has no unit / direction / baseline — pick one of the sources this script lists`);
  if (!(fraction >= 0.01 && fraction <= 0.1)) throw new Error("--fraction is the share of the burn pool per unit, 0.01–0.10");
  return { selector: { oracle: "catalogue", series: src.id }, mapping: { kind: "scalar", scalar: { unit: src.unit.size, perUnit: { fractionOfPool: fraction }, baseline: src.baseline, direction: src.direction as "up" | "down" | "abs" } } };
}

/** The end a rule without `onEnd` gets (the same default the server and the SDK add): 28 days, sweep above 0.05 SOL, and the rest to $DEFICIT's burn at a result (a coin never burns itself on its losing path). */
export const DEFAULT_ON_END = { windDownDays: 28, sweepThresholdLamports: 50_000_000, endSink: true } as const;

export interface LaunchPreview { lines: string[]; rulesSha256: string; localSha256: string; unsigned: { transaction: string; signers: string[] }[]; ready: boolean }

export async function preview(bt: Burnticker, o: { source: string; fraction: number; ticker: string; name: string; wallet: string; register: boolean }): Promise<LaunchPreview> {
  const cat = await bt.catalogue();
  const src = cat.sources.find((s) => s.id === o.source);
  if (!src) throw new Error(`no catalogue source ${o.source}`);
  const { selector, mapping } = ruleFor(src, o.fraction);
  // The full rule, with the wind-down every new coin carries (no burn pool is ever left behind; api.md "rules since 1.4.0"), hashed here
  // before any request — the hash every receipt of the coin will cite.
  const rule = { ...rules.compose(selector, mapping), onEnd: { ...DEFAULT_ON_END } };
  const local = rules.lock(rule);
  const launch = await bt.buildLaunchBundle({ wallet: o.wallet, rule, metadata: { ticker: o.ticker, name: o.name }, acknowledgements: { ruleLocked: true, noReturns: true }, register: o.register });
  // Print the SERVER'S unsigned wire transactions only (launch.unsigned). launch.transactions are the SDK's rebuilt copies, which the
  // mint keypair co-signs when a real blockhash is present; this preview never uses them.
  const unsigned = launch.unsigned.filter((t) => t.transaction !== null).map((t) => ({ transaction: t.transaction as string, signers: [...t.signers] as string[] }));
  const lines = [
    `rule      ${launch.review.rules.statement}`,
    `sha256    ${launch.rulesSha256}   (computed locally: ${local.sha256 === launch.rulesSha256 ? "matches" : `DIFFERS — ${local.sha256}`}; the SDK refuses a bundle whose rule bytes differ)`,
    `receipt   ${launch.receiptFormat}`,
    `mint      ${launch.mint.toBase58()}   (preview keypair, discarded when this script exits)`,
    `burn pool ${launch.feePda}   (LaunchLab's recorded creator: creator fees go to the burn pool; you earn no fee cash)`,
    `cluster   ${launch.cluster} · ready: ${launch.ready}${launch.pending.length ? ` · pending: ${launch.pending.join("; ")}` : ""}`,
    `draft     ${o.register ? "registered (the ticker is reserved for 24 hours)" : "not registered (review only)"}`,
    ...unsigned.map((t, k) => `tx ${k + 1}      signers: ${t.signers.join(" + ")} · ${t.transaction.length} base64 chars\n${t.transaction}`),
    "",
    "Nothing was signed. A wallet signs these only in a real launch: keep the mint keypair, rebuild with a fresh blockhash",
    "(launch.withBlockhash), let your wallet sign last, send through your own RPC, then bt.confirmLaunch(mint, signature).",
  ];
  return { lines, rulesSha256: launch.rulesSha256, localSha256: local.sha256, unsigned, ready: launch.ready };
}

export async function main(argv: readonly string[], cfg: StarterConfig = config(), bt = new Burnticker({ apiBase: cfg.api }), log: (s: string) => void = console.log): Promise<void> {
  const { opt } = parseArgs(argv);
  if (typeof opt.source !== "string") {
    const cat = await bt.catalogue();
    log("Sources a first-party rule can launch on (the source fixes unit, direction and baseline):");
    for (const s of launchableSources(cat.sources)) log(`  ${s.id.padEnd(28)} tier ${s.tier} · ${s.title} · 1 unit = ${s.unit!.size} ${s.unit!.label} ${s.direction}`);
    log("\nthen: npm run launch -- --source <id> --fraction 0.02 --ticker ABC --name \"Abc Burn\" --wallet <your public key>");
    return;
  }
  const ticker = String(opt.ticker ?? "").toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(ticker)) throw new Error("--ticker: 2–10 letters or digits");
  const wallet = typeof opt.wallet === "string" ? opt.wallet : null;
  if (!wallet) throw new Error("--wallet <public key>: the creator wallet that would pay and sign (only its PUBLIC key is used here)");
  const r = await preview(bt, { source: opt.source, fraction: Number(opt.fraction ?? 0.02), ticker, name: String(opt.name ?? `${ticker} Burn`), wallet, register: opt.register === true });
  for (const l of r.lines) log(l);
}

if (isMain(import.meta.url)) main(process.argv.slice(2)).catch((e) => { console.error((e as Error).message); process.exit(1); });
