import { plainPower, UPGRADE_CAVEAT } from "@/lib/burnticker/powerPlain";
import fs from "node:fs";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { decodePlatformConfig } from "@/lib/burnReceipts/accounts";
import { platformPda } from "@/lib/burnReceipts/pda";
import { CAP_ENFORCED_SENTENCE, capSentence, effectiveCap, type EffectiveCap } from "@/lib/burnticker/capInForce";
import { loadVerifiedBuild } from "@/lib/burnticker/trustpack/verifiedBuild";
import { programHashFact } from "@/lib/burnticker/programHash";
import { publicChangelogMarkdown } from "@/lib/burnticker/changelogPublic";
import { loadOperator, type OperatorWallet } from "@/lib/burnticker/trustpack/operator";
import { decodePlatform, type PlatformView } from "@/lib/burnKeeper/launch";
import { upgradeDelaySummary } from "@/lib/burnticker/currentStatusText";
import { EARLIER_COINS_LINE, postGraduationShareLine } from "@/lib/burnticker/feeShareLine";
import { lpLockPolicyJson, operatorTreasuryRecord, type LpLockPolicyJson } from "@/lib/burnticker/lockFees";
import { compareLivePlatform, liveNewCoinTier, CURVE_FEES, POST_GRADUATION_FEES, postGraduationFeesFor, LP_BURNED_PCT, LP_LOCKED_PCT, LP_FEES_TO_BURN_POOL_BPS, LP_FEES_TO_OPERATOR_BPS, BURNTICKER_DEV_FEE_BPS, PRE_AUDIT_POOL_CAP_SOL, OPERATOR_LINE, OPERATOR_CONTACT_TODO, USE_OF_FEES, attesterStatusLine, devFeeWallet, type LiveVsDesigned } from "@/lib/burnticker/fees";
import { budgetedRpcConfig } from "@/lib/burnticker/apiBudget";

/**
 * THE TRUST PAGE'S DATA (the owner, 2026-10-09: the platform must leave no room for suspicion that the operator is corrupt). Facts, no
 * marketing copy. Each section names its source and says when it is a placeholder.
 *
 *   powers register   every key that can do anything, with holder / timelock / sunset — rendered from docs/burn-receipts/
 *                     powers-register.json once the program lands; until then a TYPED PLACEHOLDER filled from the environment's pubkeys
 *   live platform     the LaunchLab PlatformConfig decoded FROM CHAIN (fee bps, LP split, claim wallet), compared with the design
 *   fee ledger        every lamport the developer wallet received or spent, read from chain (append-only; the reader is an interface
 *                     so the page renders from a fake until the RPC path is wired — it says so)
 *   team wallets      the operator's own wallets, and the rule that our bots refuse platform coins (config/own-tokens.json)
 *   attesters         second-attester / quorum status per token
 *   program           the deployed program's hash and how to verify it
 *   incidents         docs/burnticker/incidents/LOG.md (policy: docs/burnticker/INCIDENTS.md), append-only, rendered as written
 *   audit             the last run of scripts/burnticker-audit.mts (data/burnticker-site/audit.json): the public alarm
 *   transparency      config/burnticker/transparency.json (the owner, 2026-10-09: "i dont want to hide anything"): who runs this and
 *                     that the operator's trading bots refuse platform coins, how it was built (AI-assisted, AI-reviewed, no firm
 *                     audit), every wallet (TODO until set), the decision log, the changelog, known limitations, policies
 */

export interface Power { id: string; power: string; holder: string | null; holderKind: "key" | "multisig" | "program" | "none"; timelock: string | null; sunset: string | null; canDo: string[]; cannotDo: string[]; source: string }
export interface PowersRegister { schema: "burnticker.powers/v1"; placeholder: boolean; generatedAt: string; powers: Power[] }

export const POWERS_REGISTER_FILE = path.join("docs", "burn-receipts", "powers-register.json");

/** The register from docs/burn-receipts/powers-register.json when it exists; else the typed placeholder from env pubkeys. */
export function loadPowersRegister(env: Readonly<Record<string, string | undefined>> = process.env, root = process.cwd(), now = Date.now(), upgradeTimeLockSecs: number | null = null): PowersRegister {
  const file = path.join(root, POWERS_REGISTER_FILE);
  if (fs.existsSync(file)) {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PowersRegister>;
    if (j.schema === "burnticker.powers/v1" && Array.isArray(j.powers)) return { schema: "burnticker.powers/v1", placeholder: false, generatedAt: String(j.generatedAt ?? ""), powers: j.powers as Power[] };
    // Review 2 §2 (2026-10-11): the register the program ships (programs/burn-receipts/scripts/powers-register.mjs) has its own schema;
    // it was never recognised here, so the trust page showed the env placeholder with "placeholder until … ships" although it ships.
    const shipped = registerPowersFromShipped(j as unknown as ShippedRegister, upgradeTimeLockSecs);
    if (shipped) return { schema: "burnticker.powers/v1", placeholder: false, generatedAt: String((j as { generatedAt?: string }).generatedAt ?? ""), powers: shipped };
  }
  const key = (name: string): string | null => { const v = (env[name] ?? "").trim(); return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) ? v : null; };
  return {
    schema: "burnticker.powers/v1", placeholder: true, generatedAt: new Date(now).toISOString(),
    powers: [
      { id: "keeper-data-key", power: "sign feed readings (attester, quorum 1) and crank burns", holder: key("BURNTICKER_KEEPER_PUBKEY"), holderKind: "key", timelock: null, sunset: "quorum 2 with an independent attester (v2)", canDo: ["submit a settled reading it read from the public source", "crank a burn the rule computes from that reading"], cannotDo: ["change a rule", "burn more than the rule says", "withdraw from any fee PDA or vault", "touch a holder's balance"], source: "placeholder: BURNTICKER_KEEPER_PUBKEY" },
      { id: "platform-admin", power: "LaunchLab PlatformConfig admin: may change the platform fee bps, the claim wallet and the LP split for FUTURE launches", holder: key("BURNTICKER_PLATFORM_ADMIN"), holderKind: "key", timelock: "none on chain (LaunchLab has no timelock); changes are visible on this page within one cycle", sunset: "transfer to a multisig before P3", canDo: ["raise or lower the developer fee within 0..500 bps for new trades", "change the developer wallet", "change the LP split for future graduations"], cannotDo: ["change any token's rule or burn", "take from a burn pool", "change the creator fee above 50 bps (program cap)", "redirect a coin's Fee Key or LP fees (initialize_token and every buyback crank refuse a platform whose lock-NFT wallet is not the burn program's fee-keys PDA or whose LP is not 100 % locked; the 80/20 claim split is compiled)"], source: "placeholder: BURNTICKER_PLATFORM_ADMIN" },
      { id: "dev-fee-wallet", power: "receives the developer's platform fee", holder: devFeeWallet(env), holderKind: "key", timelock: null, sunset: null, canDo: ["claim the platform fee vault"], cannotDo: ["anything to a token"], source: "BURNTICKER_FEE_WALLET" },
      { id: "program-upgrade-authority", power: "upgrade the burn program (burn_receipts)", holder: key("BURNTICKER_UPGRADE_AUTHORITY"), holderKind: key("BURNTICKER_UPGRADE_AUTHORITY") ? "multisig" : "none", timelock: "Squads multisig (planned), then renounced after audit", sunset: "renounce after audit (LAUNCHPAD-PATH §2)", canDo: [upgradeDelaySummary(upgradeTimeLockSecs)], cannotDo: ["anything without a new deployment, which is public"], source: key("BURNTICKER_UPGRADE_AUTHORITY") ? "BURNTICKER_UPGRADE_AUTHORITY on this host" : "BURNTICKER_UPGRADE_AUTHORITY (not set on this host)" },
    ],
  };
}

/** docs/burn-receipts/powers-register.json as the program's generator writes it (schema burn-receipts.powers-register/v1). */
interface ShippedRegister {
  schema: string;
  roles?: Record<string, string>;
  instructions?: { name: string; class: string; signers?: { role: string }[]; can?: string; cannot?: string; timelock?: string | null; sunset?: string | null }[];
  upgrade_authority?: { power?: string; holder_at_launch?: string; sunset?: string };
  external_powers?: { power?: string; holder?: string; timelock?: string; can?: string }[];
}
/** The shipped register as Power rows: every privileged instruction, the upgrade authority and the external powers; null if not that schema. */
/** `upgradeTimeLockSecs`: the mainnet Squads time lock read from chain (null = not read) — the upgrade row's "can do" says what it allows (R04). */
export function registerPowersFromShipped(j: ShippedRegister, upgradeTimeLockSecs: number | null = null): Power[] | null {
  if (j?.schema !== "burn-receipts.powers-register/v1" || !Array.isArray(j.instructions)) return null;
  const src = "docs/burn-receipts/powers-register.json";
  const kind = (role: string): Power["holderKind"] => (/squads|multisig|vault/i.test(j.roles?.[role] ?? "") ? "multisig" : role === "anyone" ? "none" : "key");
  const rows: Power[] = j.instructions.filter((i) => i.class === "privileged").map((i) => {
    const role = (i.signers ?? []).map((x) => x.role).find((r) => r !== "anyone") ?? "anyone";
    return { id: i.name, power: i.name.replace(/_/g, " "), holder: role, holderKind: kind(role), timelock: i.timelock ?? null, sunset: i.sunset ?? null, canDo: i.can ? [i.can] : [], cannotDo: i.cannot ? [i.cannot] : [], source: `${src}, instructions.${i.name}` };
  });
  if (j.upgrade_authority) rows.push({ id: "program-upgrade-authority", power: j.upgrade_authority.power ?? "program upgrade authority", holder: "upgrade_authority", holderKind: "multisig", timelock: j.upgrade_authority.holder_at_launch ?? null, sunset: j.upgrade_authority.sunset ?? null, canDo: [upgradeDelaySummary(upgradeTimeLockSecs)], cannotDo: [], source: `${src}, upgrade_authority` });
  for (const [k, e] of (j.external_powers ?? []).entries()) rows.push({ id: `external-${k}`, power: e.power ?? "external power", holder: e.holder ?? null, holderKind: "key", timelock: e.timelock ?? null, sunset: null, canDo: e.can ? [e.can] : [], cannotDo: [], source: `${src}, external_powers[${k}]` });
  return rows.length ? rows : null;
}

/** What the operator can and cannot do — the block on every token page. Derived from the register, not free text. */
export function operatorPowersSummary(reg: PowersRegister): { can: string[]; cannot: string[]; placeholder: boolean } {
  const can = new Set<string>(), cannot = new Set<string>();
  // prelaunch audit 2026-10-16 (M11): the lists a holder reads are in plain words (powerPlain.ts); the register stays as written
  for (const p of reg.powers) { p.canDo.forEach((x) => can.add(plainPower(x))); p.cannotDo.forEach((x) => cannot.add(plainPower(x))); }
  cannot.add("change a token's rule, readings or receipts after the fact, because the registry is append-only and database triggers enforce that");
  cannot.add("earn from a burn pool, because nothing is ever taken from one");
  return { can: [...can], cannot: [...cannot], placeholder: reg.placeholder };
}

// ---- the live platform config ----

export interface ChainReader { accountData(pubkey: string): Promise<Uint8Array | null>; signaturesFor(address: string, limit: number): Promise<{ signature: string; slot: number; blockTime: number | null }[]>; lamportsDelta(signature: string, address: string): Promise<{ delta: bigint; counterparty: string | null; memo: string | null } | null> }

export interface LivePlatform { platformId: string; found: boolean; view: PlatformView | null; comparison: LiveVsDesigned[]; readAt: string; error: string | null }

/** Deep-converts a value for JSON: bigint → decimal string, PublicKey (anything with toBase58) → base58, Uint8Array → hex. */
export function jsonSafe<T>(v: T): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) return Buffer.from(v).toString("hex");
  if (v && typeof v === "object") {
    const b58 = (v as unknown as { toBase58?: () => string }).toBase58;
    if (typeof b58 === "function") return b58.call(v);
    if (Array.isArray(v)) return v.map(jsonSafe);
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, jsonSafe(x)]));
  }
  return v;
}

export async function readLivePlatform(reader: ChainReader | null, platformId: string | null, env: Readonly<Record<string, string | undefined>> = process.env, now = Date.now(), cluster = (env.BURNTICKER_CLUSTER ?? "").trim() || "devnet"): Promise<LivePlatform> {
  const readAt = new Date(now).toISOString();
  if (!platformId) return { platformId: "", found: false, view: null, comparison: [], readAt, error: "This site does not name a platform settings account, because it has not been created yet." };
  if (!reader) return { platformId, found: false, view: null, comparison: [], readAt, error: "This site has no connection to a Solana node, so it cannot read the live platform settings." };
  try {
    const data = await reader.accountData(platformId);
    if (!data) return { platformId, found: false, view: null, comparison: [], readAt, error: "The platform settings account does not exist on this network." };
    const view = decodePlatform(data);
    // The decoded view carries bigint fee rates / scales and PublicKeys; the page is served as JSON (NextResponse.json has no
    // replacer), so it is made JSON-safe here. First seen 2026-10-11 on the mainnet host: the route threw "Do not know how to
    // serialize a BigInt" and the Trust page read "data unavailable" (site audit R01).
    return { platformId, found: true, view: jsonSafe(view) as unknown as PlatformView, comparison: compareLivePlatform(view, devFeeWallet(env), (env.BURNTICKER_PROGRAM_ID ?? "").trim() || null, cluster), readAt, error: null };
  } catch (e) { return { platformId, found: false, view: null, comparison: [], readAt, error: (e as Error).message.slice(0, 200) }; }
}

// ---- the developer fee ledger (from chain; append-only by construction) ----

export interface FeeLedgerEntry { signature: string; slot: number; blockTime: string | null; delta: string; direction: "in" | "out"; counterparty: string | null; memo: string | null }
export interface FeeLedger { wallet: string | null; entries: FeeLedgerEntry[]; totalIn: string; totalOut: string; source: "chain" | "unavailable"; note: string }

/** One transaction's effect on the wallet (ChainReader.lamportsDelta's answer): a landed transaction never changes, so it may be kept. */
export type LamportsDelta = Awaited<ReturnType<ChainReader["lamportsDelta"]>>;
/**
 * `deltaCache` (2026-10-15 prelaunch audit C2): the per-transaction reads kept by "wallet:signature". Every trust page request used to
 * read up to 200 transactions one by one; with the cache only transactions not seen before are read. A null answer (not found yet) is
 * not kept.
 */
export async function readFeeLedger(reader: ChainReader | null, wallet: string | null, limit = 200, o: { deltaCache?: Map<string, LamportsDelta> } = {}): Promise<FeeLedger> {
  if (!wallet) return { wallet: null, entries: [], totalIn: "0", totalOut: "0", source: "unavailable", note: "No developer fee wallet is set on this site." };
  if (!reader) return { wallet, entries: [], totalIn: "0", totalOut: "0", source: "unavailable", note: "This site has no connection to a Solana node, so it cannot read the ledger. The ledger is only ever read from the chain, never from our own records." };
  const sigs = await reader.signaturesFor(wallet, limit);
  const entries: FeeLedgerEntry[] = [];
  let tin = BigInt(0), tout = BigInt(0);
  for (const s of sigs) {
    const ck = `${wallet}:${s.signature}`;
    let d = o.deltaCache?.get(ck) ?? null;
    if (!d) { d = await reader.lamportsDelta(s.signature, wallet); if (d) o.deltaCache?.set(ck, d); }
    if (!d || d.delta === BigInt(0)) continue;
    if (d.delta > BigInt(0)) tin += d.delta; else tout -= d.delta;
    entries.push({ signature: s.signature, slot: s.slot, blockTime: s.blockTime ? new Date(s.blockTime * 1000).toISOString() : null, delta: d.delta.toString(), direction: d.delta > BigInt(0) ? "in" : "out", counterparty: d.counterparty, memo: d.memo });
  }
  return { wallet, entries, totalIn: tin.toString(), totalOut: tout.toString(), source: "chain", note: `These are the wallet's last ${limit} transactions, read from a Solana node.` };
}

// ---- team wallets, own-token refusal ----

export interface TeamWallets { wallets: { label: string; pubkey: string }[]; ownTokensFile: string; ownTokensPresent: boolean; refusalRule: string }
export function teamWallets(env: Readonly<Record<string, string | undefined>> = process.env, root = process.cwd()): TeamWallets {
  const pick = (label: string, name: string) => { const v = (env[name] ?? "").trim(); return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) ? [{ label, pubkey: v }] : []; };
  const file = path.join("config", "own-tokens.json");
  return {
    wallets: [...pick("developer fee wallet", "BURNTICKER_FEE_WALLET"), ...pick("platform admin", "BURNTICKER_PLATFORM_ADMIN"), ...pick("keeper data key", "BURNTICKER_KEEPER_PUBKEY")],
    ownTokensFile: file, ownTokensPresent: fs.existsSync(path.join(root, file)),
    refusalRule: "Every trading bot the operator runs refuses any token launched on this platform. The bots check a refuse list before every trade. If a team wallet holds any platform token, this page shows it.",
  };
}

// ---- append-only markdown logs: incidents, decisions, changelog ----

export const INCIDENTS_FILE = path.join("docs", "burnticker", "incidents", "LOG.md");
export const DECISIONS_FILE = path.join("docs", "burnticker", "decisions.md");
export const CHANGELOG_FILE = path.join("docs", "burnticker", "CHANGELOG.md");
export interface MarkdownLog { markdown: string; entries: number; file: string; present: boolean }
export function readMarkdownLog(root: string, rel: string): MarkdownLog {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) return { markdown: "", entries: 0, file: rel, present: false };
  const md = fs.readFileSync(file, "utf8");
  return { markdown: md, entries: (md.match(/^## /gm) ?? []).length, file: rel, present: true };
}
/** A-6: the changelog as visitors read it, with no monorepo commit in it (changelogPublic.ts). */
const publicChangelog = (l: MarkdownLog): MarkdownLog => ({ ...l, markdown: publicChangelogMarkdown(l.markdown) });
export function readIncidents(root = process.cwd()): { markdown: string; entries: number } { const l = readMarkdownLog(root, INCIDENTS_FILE); return { markdown: l.markdown, entries: l.entries }; }

// ---- transparency (config/burnticker/transparency.json; the owner, 2026-10-09: "i dont want to hide anything") ----

export const TRANSPARENCY_FILE = path.join("config", "burnticker", "transparency.json");
export interface TransparencyWallet { role: string; label: string; pubkey: string | null; envVar: string | null; description: string }
export interface TransparencyReview { id: string; reviewer: string; status: string; reportPath: string | null }
/** `createdAt`: the exact time of the coin's create transaction (its block time), when recorded; cards count the age from it (audit 7 item 23) */
export interface TransparencyRehearsal { symbol: string; date: string | null; createdAt?: string | null; mint: string | null; status: string; text: string }
/** The two sentences the launch runbook's go/no-go gates look for on the page (policies by id; rendered among the standing facts too). */
export const GATE_POLICY_IDS = ["no-telegram-discord", "failure-definition"] as const;
export interface TransparencyConfig {
  schema: "burnticker.transparency/v1"; updatedAt: string;
  publicRepo: { url: string | null; todo?: string; whatIsPublished: string };
  whoRunsThis: { alsoRuns: string; refusal: string; refuseListCode: string; refuseListConfig: string; holdingsRule: string };
  howBuilt: { aiAssisted: boolean; statement: string; firmAudit: boolean; firmAuditStatement: string; reviews: TransparencyReview[]; tooling: string[]; toolingStatus: string; reviewsDir: string; reviewsRule: string; bounty: TransparencyBounty };
  wallets: TransparencyWallet[];
  /** Throwaway coins created under the REAL platform config to prove fee routing and burns (the owner's $REHEARSAL); each is also on the refuse list. */
  rehearsals: TransparencyRehearsal[];
  limitations: { id: string; status: string; text: string }[];
  policies: { id: string; text: string }[];
  /** The trust pack (2026-10-10): the sceptic's pages, the verified build, the owner's to-do (src/lib/burnticker/trustpack/). */
  trustPack?: { note: string; pages: { path: string; title: string; what: string; doc: string }[]; verifiedBuild: string; wellKnown: string; ownerTodo: string; metadataUri?: { status: string; text: string } };
}
/** The bounty block; `wallet` is null until the mainnet Squads vault exists (walletTodo says so), `reports` lists every decided report. */
export interface TransparencyBounty {
  status: string; rangeSol: [number, number]; fundedFrom: string; termsPath: string; contact: string | null;
  wallet?: string | null; walletTodo?: string; howReportsArePaid?: string;
  /** what the operator recorded funding the wallet with — shown beside, never instead of, the live balance (UX report 3 item 5) */
  recordedFunding?: { sol: number; date: string; transaction: string | null; source: string; evidence?: string } | null;
  reports?: { paid: { date: string; title: string; severity: string; sol: number; tx: string }[]; rejected: { date: string; title: string; reason: string }[]; note: string };
}
/**
 * A wallet row as rendered. ONE RECORD (prelaunch audit 2026-10-18 A-6: the trust page said "6 of 11 are not set" beside an operator
 * page that listed every wallet): the address comes from config/burnticker/operator.json for the cluster, the record the operator page
 * reads; then this file's own pubkey; then the named environment variable. A role the operator record does not list and nothing else
 * names is "unlisted" (said so on the page, not counted as unset); "todo" is left only on a host without the operator record.
 */
export interface WalletRow extends TransparencyWallet { resolved: string | null; source: "operator" | "file" | "env" | "todo" | "unlisted" }

const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const FORBIDDEN_PHRASES = [/coming soon/i, /stay tuned/i];

/** Loads and validates the file; throws on a malformed one (the page must not render a half-truth). */
export function loadTransparency(root = process.cwd()): TransparencyConfig {
  const file = path.join(root, TRANSPARENCY_FILE);
  const j = JSON.parse(fs.readFileSync(file, "utf8")) as TransparencyConfig;
  for (const p of transparencyProblems(j)) throw new Error(`${TRANSPARENCY_FILE}: ${p}`);
  return j;
}

/** Every reason the file is not fit to render — the tests and the loader share it. Empty when sound. */
export function transparencyProblems(j: Partial<TransparencyConfig> | null): string[] {
  const out: string[] = [];
  if (!j || typeof j !== "object") return ["not an object"];
  if (j.schema !== "burnticker.transparency/v1") out.push("schema must be burnticker.transparency/v1");
  if (!j.publicRepo || typeof j.publicRepo.whatIsPublished !== "string") out.push("publicRepo.whatIsPublished missing");
  if (!j.whoRunsThis || typeof j.whoRunsThis.refusal !== "string" || typeof j.whoRunsThis.refuseListCode !== "string") out.push("whoRunsThis.refusal / refuseListCode missing");
  if (!j.howBuilt || typeof j.howBuilt.aiAssisted !== "boolean" || typeof j.howBuilt.firmAudit !== "boolean" || !Array.isArray(j.howBuilt.reviews)) out.push("howBuilt.aiAssisted / firmAudit / reviews missing");
  const bw = j.howBuilt?.bounty?.wallet;
  if (bw !== undefined && bw !== null && !PUBKEY_RE.test(String(bw))) out.push("howBuilt.bounty.wallet must be a base58 public key, or null until the vault exists");
  if (!Array.isArray(j.wallets) || j.wallets.length === 0) out.push("wallets must be a non-empty array");
  else {
    const roles = new Set<string>();
    for (const w of j.wallets) {
      if (!w || typeof w.role !== "string" || typeof w.label !== "string" || typeof w.description !== "string") { out.push("every wallet needs role, label, description"); continue; }
      if (roles.has(w.role)) out.push(`duplicate wallet role ${w.role}`);
      roles.add(w.role);
      if (w.pubkey !== null && !PUBKEY_RE.test(String(w.pubkey))) out.push(`wallet ${w.role}: pubkey is not a base58 public key`);
      if (w.envVar !== null && typeof w.envVar !== "string") out.push(`wallet ${w.role}: envVar must be a string or null`);
    }
    for (const must of ["ops", "deployer", "keeper", "dev-fee", "squads-vault"]) if (!roles.has(must)) out.push(`wallet role ${must} missing`);
  }
  if (!Array.isArray(j.rehearsals)) out.push("rehearsals must be an array (empty until a rehearsal coin exists)");
  else for (const r of j.rehearsals) {
    if (!r || typeof r.symbol !== "string" || typeof r.status !== "string" || typeof r.text !== "string") { out.push("every rehearsal needs symbol, status, text"); continue; }
    if (r.mint !== null && !PUBKEY_RE.test(String(r.mint))) out.push(`rehearsal ${r.symbol}: mint is not a base58 public key`);
    if (r.date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(r.date))) out.push(`rehearsal ${r.symbol}: date must be YYYY-MM-DD or null`);
  }
  if (Array.isArray(j.policies)) for (const id of GATE_POLICY_IDS) if (!j.policies.some((p) => p && p.id === id)) out.push(`policy ${id} missing`);
  if (!Array.isArray(j.limitations) || j.limitations.length === 0) out.push("limitations must be a non-empty array");
  else for (const l of j.limitations) if (!l || typeof l.id !== "string" || typeof l.status !== "string" || typeof l.text !== "string") out.push("every limitation needs id, status, text");
  if (!Array.isArray(j.policies) || j.policies.length === 0) out.push("policies must be a non-empty array");
  else for (const p of j.policies) if (!p || typeof p.id !== "string" || typeof p.text !== "string") out.push("every policy needs id, text");
  const text = JSON.stringify(j);
  for (const re of FORBIDDEN_PHRASES) if (re.test(text)) out.push(`contains "${re.source}" — unbuilt things are listed as not built, never as coming`);
  return out;
}

export function resolveWallets(cfg: TransparencyConfig, env: Readonly<Record<string, string | undefined>> = process.env, operatorWallets: readonly { role: string; label: string; pubkey: string }[] | null = null): WalletRow[] {
  const op = new Map((operatorWallets ?? []).filter((w) => PUBKEY_RE.test(w.pubkey)).map((w) => [w.role, w]));
  const rows: WalletRow[] = cfg.wallets.map((w): WalletRow => {
    const o = op.get(w.role);
    if (o) return { ...w, label: o.label, resolved: o.pubkey, source: "operator" };
    if (w.pubkey) return { ...w, resolved: w.pubkey, source: "file" };
    const v = w.envVar ? (env[w.envVar] ?? "").trim() : "";
    if (PUBKEY_RE.test(v)) return { ...w, resolved: v, source: "env" };
    return { ...w, resolved: null, source: operatorWallets ? "unlisted" : "todo" };
  });
  // every role the operator record lists appears here too, under the record's own label (the two pages list the same keys)
  for (const o of op.values()) if (!cfg.wallets.some((w) => w.role === o.role)) rows.push({ role: o.role, label: o.label, pubkey: o.pubkey, envVar: null, description: o.label, resolved: o.pubkey, source: "operator" });
  return rows;
}
/** The operator record's wallets for the host's cluster (config/burnticker/operator.json); null when the file is absent or unreadable. */
export function operatorWalletsFor(root: string, env: Readonly<Record<string, string | undefined>>): OperatorWallet[] | null {
  try { return loadOperator(root).clusters[(env.BURNTICKER_CLUSTER ?? "").trim() === "mainnet" ? "mainnet" : "devnet"]?.wallets ?? null; } catch { return null; }
}

export interface TransparencySection {
  updatedAt: string; file: string;
  publicRepo: TransparencyConfig["publicRepo"];
  whoRunsThis: TransparencyConfig["whoRunsThis"] & { operatorLine: string; refuseListPresent: boolean };
  howBuilt: TransparencyConfig["howBuilt"] & { reviewsReadmePresent: boolean; reportsPresent: { id: string; present: boolean }[] };
  wallets: WalletRow[]; walletsTodo: number; rehearsals: TransparencyRehearsal[];
  limitations: TransparencyConfig["limitations"]; policies: TransparencyConfig["policies"];
  decisions: MarkdownLog; changelog: MarkdownLog;
}

/** The whole transparency block for the page. Pure given root + env (reads files, never the network). */
export function buildTransparency(root = process.cwd(), env: Readonly<Record<string, string | undefined>> = process.env): TransparencySection {
  const cfg = loadTransparency(root);
  const wallets = resolveWallets(cfg, env, operatorWalletsFor(root, env));
  return {
    updatedAt: cfg.updatedAt, file: TRANSPARENCY_FILE, publicRepo: cfg.publicRepo,
    whoRunsThis: { ...cfg.whoRunsThis, operatorLine: OPERATOR_LINE, refuseListPresent: fs.existsSync(path.join(root, cfg.whoRunsThis.refuseListCode)) && fs.existsSync(path.join(root, cfg.whoRunsThis.refuseListConfig)) },
    howBuilt: { ...cfg.howBuilt, reviewsReadmePresent: fs.existsSync(path.join(root, cfg.howBuilt.reviewsDir, "README.md")), reportsPresent: cfg.howBuilt.reviews.map((r) => ({ id: r.id, present: !!r.reportPath && fs.existsSync(path.join(root, r.reportPath)) })) },
    wallets, walletsTodo: wallets.filter((w) => w.source === "todo").length, rehearsals: cfg.rehearsals,
    limitations: cfg.limitations, policies: cfg.policies,
    decisions: readMarkdownLog(root, DECISIONS_FILE), changelog: publicChangelog(readMarkdownLog(root, CHANGELOG_FILE)),
  };
}

// ---- the program ----

/**
 * Review 2 §2 (2026-10-11): "Program id not deployed" on a host that is simply not wired to the program contradicted "deployed on devnet".
 * Three separate facts now: `hostWiring` (does THIS host's environment name a program — BURNTICKER_PROGRAM_ID), `chain` (where each
 * program is deployed, from config/burnticker/verified-build.json's read-back) and `compiled` (the id compiled into the IDL).
 */
export interface ProgramChainFact { library: string; programId: string; devnet: string; mainnet: string }
export interface ProgramFacts { programId: string | null; deployed: boolean; buildHash: string | null; verify: string[]; hostWiring: string; chain: ProgramChainFact[]; compiled: string }
export function programFacts(env: Readonly<Record<string, string | undefined>> = process.env, root = process.cwd()): ProgramFacts {
  const id = (env.BURNTICKER_PROGRAM_ID ?? "").trim();
  const deployed = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(id);
  const out: ProgramFacts = {
    // prelaunch audit 2026-10-18 A-4: the hash comes from config/burnticker/verified-build.json for the cluster (the read-back of the
    // deployed bytes); BURNTICKER_PROGRAM_HASH is shown only when it equals that record, otherwise ignored and logged once
    programId: deployed ? id : null, deployed, buildHash: programHashFact(env, root).hash,
    hostWiring: deployed ? `This site reads the burn program (burn_receipts) at ${id}.` : "This site is not connected to a burn program. Its pages use a stand-in that runs in memory and sends nothing to the chain.",
    chain: chainFacts(root),
    compiled: `The burn program's address, compiled into the program and its interface file (IDL), is ${BURN_RECEIPTS_IDL.address}.`,
    verify: deployed
      ? [`solana-verify get-program-hash ${id}   # must equal the build hash above (sha256 of the program bytes, trailing zero bytes removed)`, `solana program dump ${id} program.so && solana-verify get-executable-hash program.so   # the same number from a local copy`, "solana-verify verify-from-repo   # rebuilds the tagged public source and compares; docs/burnticker/VERIFIED-BUILD.md has the steps", `solana program show ${id}   # the upgrade authority must match the register`]
      : ["# This site is not connected to the program. Where it is deployed, and the hashes read back from the chain, are listed above. They come from config/burnticker/verified-build.json and docs/burnticker/VERIFIED-BUILD.md."],
  };
  // every coin's metadata, whatever the program's state (pin.ts; verify.ts verifyPinnedMetadata does the same three checks)
  out.verify.push("metadata: curl -s <coin>/status.json | jq .pinned   # metadataUri (arweave), metadataSha256, expectedDescription", "curl -s <pinned.metadataUri> | sha256sum   # must equal pinned.metadataSha256", "curl -s <pinned.metadataUri> | jq -r .description   # must equal pinned.expectedDescription byte for byte (the generated text)",
    "operator statement: node scripts/burnticker-verify-statement.mjs https://burnticker.com   # checks the signed statement on /burnticker/operator with ed25519, using no code from this site");
  return out;
}

/** Where each program is deployed, from the verified-build read-back (never from this host's environment). */
function chainFacts(root: string): ProgramChainFact[] {
  try {
    return loadVerifiedBuild(root).programs.map((p) => ({ library: p.library, programId: p.programId,
      devnet: p.deployed.devnet ? `deployed (read ${p.deployed.devnet.readAt}${p.deployed.devnet.matchesBuild ? ", and the bytes match the recorded build" : ", and the bytes DO NOT match the recorded build"})` : "not deployed",
      // I-1 (audit 2026-10-19): the mainnet read-back says whether the bytes match, like devnet's, and names mainnet's own authority
      mainnet: p.deployed.mainnet ? `deployed (read ${p.deployed.mainnet.readAt}${p.deployed.mainnet.matchesBuild ? ", and the bytes match the recorded build" : ", and the bytes DO NOT match the recorded build"}; upgrade authority ${p.deployed.mainnet.upgradeAuthority})` : "not deployed" }));
  } catch { return []; }
}

// ---- the audit (scripts/burnticker-audit.mts writes it) ----

/** `executed`: receipts that moved something on chain (burned or forwarded); `chainError`: why the chain leg did not finish (A-6). */
export interface AuditSummary { schema: "burnticker.audit/v1"; ranAt: string; tokens: number; receipts: number; executed?: number; /** review of A-6: confirmed receipts whose memo the chain showed and matched, and those it could not show */ chainVerified?: number; chainUnchecked?: number; mismatches: { ticker: string; eventId: string; checks: string[] }[]; chainChecked: boolean; chainError?: string | null; ok: boolean }
export function readAudit(siteDir: string): AuditSummary | null {
  const file = path.join(siteDir, "audit.json");
  if (!fs.existsSync(file)) return null;
  try { const j = JSON.parse(fs.readFileSync(file, "utf8")) as AuditSummary; return j.schema === "burnticker.audit/v1" ? j : null; } catch { return null; }
}

// ---- the whole page ----

export interface TrustPage {
  generatedAt: string;
  /** I-1 (audit 2026-10-19): the host's network, so the audit headline names it ("no mainnet burn has executed yet"). */
  cluster: string;
  powers: PowersRegister; operator: ReturnType<typeof operatorPowersSummary>;
  livePlatform: LivePlatform; designedFees: { curve: typeof CURVE_FEES; postGraduation: typeof POST_GRADUATION_FEES; devFeeBps: number; lpBurnedPct: number; lpLockedPct: number; lpFeeSplit: { burnPoolBps: number; operatorBps: number; ofLpBps: { burnPool: number; operator: number } }; creatorCashBps: 0; teamAllocationPct: 0 };
  /** LP locked forever (2026-10-10): the policy, the lock program, the fee-keys PDA (the Fee Key owner), the operator treasury, the split. */
  lpLock: LpLockPolicyJson;
  feeLedger: FeeLedger; team: TeamWallets;
  attesters: { ticker: string; attesters: number; independent: number; quorum: number }[];
  program: ProgramFacts; incidents: { markdown: string; entries: number }; audit: AuditSummary | null;
  transparency: TransparencySection;
  statements: string[];
  operatorLine: string; contactIsTodo: boolean; useOfFees: string; attesterStatus: { line: string; dueBy: string | null }; preAuditCapSol: number;
  /** website-20 item 162: the burn-pool cap the program applies, read from chain (null: not read on this host). */
  effectiveCap: EffectiveCap | null;
}

/** The PlatformConfig PDA read through the trust page's chain reader: the cap in force, or null when there is no reader or program id. */
export async function readEffectiveCap(reader: ChainReader | null, programId: string | null, nowMs: number): Promise<EffectiveCap | null> {
  if (!reader || !programId) return null;
  try {
    const data = await reader.accountData(platformPda(new PublicKey(programId)).toBase58());
    return effectiveCap(data ? decodePlatformConfig(data) : null, Math.floor(nowMs / 1000));
  } catch { return null; }
}

export async function buildTrustPage(i: { reader: ChainReader | null; env?: Readonly<Record<string, string | undefined>>; root?: string; siteDir: string; attesters: TrustPage["attesters"]; firstLaunchAt?: number | null; now?: number; cluster?: string; upgradeTimeLockSecs?: number | null; deltaCache?: Map<string, LamportsDelta>; skipFeeLedger?: boolean }): Promise<TrustPage> {
  const env = i.env ?? process.env, root = i.root ?? process.cwd(), now = i.now ?? Date.now();
  const powers = loadPowersRegister(env, root, now, i.upgradeTimeLockSecs ?? null);
  const transparency = buildTransparency(root, env);
  const platformId = (env.BURNTICKER_PLATFORM_ID ?? "").trim() || null;
  const cluster = i.cluster ?? ((env.BURNTICKER_CLUSTER ?? "").trim() || "devnet");
  const effective = await readEffectiveCap(i.reader, (env.BURNTICKER_PROGRAM_ID ?? "").trim() || null, now);
  const livePlatform = await readLivePlatform(i.reader, platformId, env, now, cluster);
  // owner decision 2026-10-19: the per-swap split this page states for NEW coins is the tier the LIVE platform names (when it is a listed
  // tier); without a read it is the code's new-coin tier. A coin created earlier keeps its own pin, stated on its own page.
  const liveCp = livePlatform.view ? String(livePlatform.view.cpConfigId) : null;
  const newCoinFees = postGraduationFeesFor(cluster, liveNewCoinTier(liveCp) ? liveCp : null);
  return {
    generatedAt: new Date(now).toISOString(), cluster,
    operatorLine: OPERATOR_LINE, contactIsTodo: OPERATOR_LINE.includes(OPERATOR_CONTACT_TODO), useOfFees: USE_OF_FEES, attesterStatus: attesterStatusLine(i.firstLaunchAt ?? null), preAuditCapSol: PRE_AUDIT_POOL_CAP_SOL, effectiveCap: effective,
    powers, operator: operatorPowersSummary(powers),
    livePlatform,
    designedFees: { curve: CURVE_FEES, postGraduation: newCoinFees, devFeeBps: BURNTICKER_DEV_FEE_BPS, lpBurnedPct: LP_BURNED_PCT, lpLockedPct: LP_LOCKED_PCT, lpFeeSplit: { burnPoolBps: newCoinFees.legs.find((l) => l.label === "burn pool (LP fees)")?.bps ?? LP_FEES_TO_BURN_POOL_BPS, operatorBps: newCoinFees.legs.find((l) => l.label === "Burnticker (operator, LP fees)")?.bps ?? LP_FEES_TO_OPERATOR_BPS, ofLpBps: { burnPool: 8000, operator: 2000 } }, creatorCashBps: 0, teamAllocationPct: 0 },
    lpLock: lpLockPolicyJson(cluster, (env.BURNTICKER_PROGRAM_ID ?? "").trim() || null),
    // skipFeeLedger: the public API's /v1/trust does not serve the ledger, so it does not read it (C2)
    feeLedger: i.skipFeeLedger ? { wallet: devFeeWallet(env), entries: [], totalIn: "0", totalOut: "0", source: "unavailable", note: "Not read for this answer." } : await readFeeLedger(i.reader, devFeeWallet(env), 200, { deltaCache: i.deltaCache }),
    team: teamWallets(env, root), attesters: i.attesters, program: programFacts(env, root), incidents: readIncidents(root), audit: readAudit(i.siteDir),
    transparency,
    statements: [
      `At graduation, ${LP_LOCKED_PCT}% of the LP is locked forever with Raydium's LP lock and can never be withdrawn. A creator cannot change this. The platform settings that do it are platformScale 1,000,000, creatorScale 0 and burnScale 0. The Fee Key belongs to the burn program's fee-keys account. Anyone can call the fee claim (claim_lock_fees), which splits the LP fees 80% to the coin's burn pool and 20% to the operator treasury. That split is fixed in code, and the coin side is burned. The program also sets a minimum share of locked LP for a burn pool: ≥ 50 % at registration (≥ 90 % for the fallback pool); our platform locks 100 % at graduation.`,
      `${postGraduationShareLine(newCoinFees)} ${EARLIER_COINS_LINE} The operator's share is paid to ${operatorTreasuryRecord(cluster).who}. On the launch curve, the developer's share is ${BURNTICKER_DEV_FEE_BPS / 100}%. No setting or admin key changes how the liquidity fees are split. ${UPGRADE_CAVEAT}`,
      "Creators get no cash from fees. The creator-fee slot pays 100% to the coin's burn pool.",
      "There is no team allocation. There is no presale, no private round and no airdrop to insiders. The platform holds no tokens at launch.",
      "Rules, readings and receipts are append-only. Database triggers refuse any update or delete. Changing a rule means launching a new token.",
      "The launch wizard has no referral codes, fee discounts or hidden settings. Every setting is in the coin's rules file (rules.json).",
      "Only settled results are shown. The site shows no price or odds for any Burnticker coin and no commentary on any number; a coin's card and page may show its market cap as a bare number read from its curve or pool (owner decision 2026-10-12); another coin's market cap may be a rule input, shown only as the rule sentence. For example, a Burn Derby rule reads the settled moves of two outside coins, and derby admission refuses a Burnticker coin as an input. No page shows a market-implied chance for any coin, since that was removed on 2026-10-10. A coin page names only its venue and the next market's ticker and close time.",
      "Coins settle on first-party primary sources, each with an independent cross-read. These include Treasury, BLS, FRED, NWS, EDGAR and on-chain data. A sports game settles on the game's on-chain payout when a Polymarket moneyline market exists. Otherwise it settles on a licensed final score from TheSportsDB, under a commercial license. The league's official feed confirms that score (MLB's official feed, the NHL's official scores or the NBA's official feed), or a second licensed provider, API-Sports, does. A coin on a single game, or two teams in one game, burns once two of these sources agree on the final, or once one source has shown the same final twice a few minutes apart. Every source that answers must agree, and the game's on-chain settlement counts as one source. The coverage table below has the details. A coin can also settle on an on-chain Polymarket payout. That result is read from the payout vector of the Conditional Tokens contract on Polygon, and it counts only once the payout is on chain. Polymarket's Gamma API is used only to find markets, and no prices are shown. Kalshi is not a settlement input. Its Developer Agreement and Data Terms, reviewed on 2026-10-10, do not allow settling products on its data or sharing that data. The Kalshi adapter is for discovery only and is off by default, and the launch check refuses any Kalshi rule.",
      // prelaunch audit 2026-10-18 A-6: the program is deployed and enforces the cap; the old "once the program is deployed" line is retired
      `${capSentence(effective)} ${CAP_ENFORCED_SENTENCE}`,
      "Anonymous creators are allowed, and the creator's wallet is always shown. One-shot markets are allowed, and their pages say 'resolves once on <date>'. Elections are allowed. Deaths, violence, terror, casualty counts and named private individuals are refused.",
      USE_OF_FEES,
      ...GATE_POLICY_IDS.map((id) => transparency.policies.find((p) => p.id === id)?.text).filter((t): t is string => !!t),
    ],
  };
}

/** A ChainReader over @solana/web3.js, built lazily by the route when an RPC URL is configured (never in tests). */
export async function web3ChainReader(rpcUrl: string): Promise<ChainReader> {
  const { Connection } = await import("@solana/web3.js");
  const c = new Connection(rpcUrl, budgetedRpcConfig({ commitment: "confirmed" }));
  return {
    accountData: async (pk) => (await c.getAccountInfo(new PublicKey(pk), "confirmed"))?.data ?? null,
    signaturesFor: async (addr, limit) => (await c.getSignaturesForAddress(new PublicKey(addr), { limit }, "confirmed")).map((s) => ({ signature: s.signature, slot: s.slot, blockTime: s.blockTime ?? null })),
    lamportsDelta: async (sig, addr) => {
      const tx = await c.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 1 });
      if (!tx?.meta) return null;
      const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses }).staticAccountKeys.map((k) => k.toBase58());
      const ix = keys.indexOf(addr);
      if (ix < 0) return null;
      const delta = BigInt(tx.meta.postBalances[ix]) - BigInt(tx.meta.preBalances[ix]);
      const memo = tx.meta.logMessages?.find((l) => l.startsWith('Program log: Memo'))?.replace(/^Program log: Memo \(len \d+\): /, "").replace(/^"|"$/g, "") ?? null;
      return { delta, counterparty: keys.find((k) => k !== addr) ?? null, memo };
    },
  };
}
