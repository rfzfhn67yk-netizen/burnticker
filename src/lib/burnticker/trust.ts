import fs from "node:fs";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { loadVerifiedBuild } from "@/lib/burnticker/trustpack/verifiedBuild";
import { decodePlatform, type PlatformView } from "@/lib/burnKeeper/launch";
import { lpLockPolicyJson, type LpLockPolicyJson } from "@/lib/burnticker/lockFees";
import { compareLivePlatform, CURVE_FEES, POST_GRADUATION_FEES, LP_BURNED_PCT, LP_LOCKED_PCT, LP_FEES_TO_BURN_POOL_BPS, LP_FEES_TO_OPERATOR_BPS, BURNTICKER_DEV_FEE_BPS, PRE_AUDIT_POOL_CAP_SOL, OPERATOR_LINE, OPERATOR_CONTACT_TODO, USE_OF_FEES, attesterStatusLine, devFeeWallet, type LiveVsDesigned } from "@/lib/burnticker/fees";

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
export function loadPowersRegister(env: Readonly<Record<string, string | undefined>> = process.env, root = process.cwd(), now = Date.now()): PowersRegister {
  const file = path.join(root, POWERS_REGISTER_FILE);
  if (fs.existsSync(file)) {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PowersRegister>;
    if (j.schema === "burnticker.powers/v1" && Array.isArray(j.powers)) return { schema: "burnticker.powers/v1", placeholder: false, generatedAt: String(j.generatedAt ?? ""), powers: j.powers as Power[] };
    // Review 2 §2 (2026-10-11): the register the program ships (programs/burn-receipts/scripts/powers-register.mjs) has its own schema;
    // it was never recognised here, so the trust page showed the env placeholder with "placeholder until … ships" although it ships.
    const shipped = registerPowersFromShipped(j as unknown as ShippedRegister);
    if (shipped) return { schema: "burnticker.powers/v1", placeholder: false, generatedAt: String((j as { generatedAt?: string }).generatedAt ?? ""), powers: shipped };
  }
  const key = (name: string): string | null => { const v = (env[name] ?? "").trim(); return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) ? v : null; };
  return {
    schema: "burnticker.powers/v1", placeholder: true, generatedAt: new Date(now).toISOString(),
    powers: [
      { id: "keeper-data-key", power: "sign feed readings (attester, quorum 1) and crank burns", holder: key("BURNTICKER_KEEPER_PUBKEY"), holderKind: "key", timelock: null, sunset: "quorum 2 with an independent attester (v2)", canDo: ["submit a settled reading it read from the public source", "crank a burn the rule computes from that reading"], cannotDo: ["change a rule", "burn more than the rule says", "withdraw from any fee PDA or vault", "touch a holder's balance"], source: "placeholder: BURNTICKER_KEEPER_PUBKEY" },
      { id: "platform-admin", power: "LaunchLab PlatformConfig admin: may change the platform fee bps, the claim wallet and the LP split for FUTURE launches", holder: key("BURNTICKER_PLATFORM_ADMIN"), holderKind: "key", timelock: "none on chain (LaunchLab has no timelock); changes are visible on this page within one cycle", sunset: "transfer to a multisig before P3", canDo: ["raise or lower the developer fee within 0..500 bps for new trades", "change the developer wallet", "change the LP split for future graduations"], cannotDo: ["change any token's rule or burn", "take from a burn pool", "change the creator fee above 50 bps (program cap)", "redirect a coin's Fee Key or LP fees (initialize_token and every buyback crank refuse a platform whose lock-NFT wallet is not the burn program's fee-keys PDA or whose LP is not 100 % locked; the 80/20 claim split is compiled)"], source: "placeholder: BURNTICKER_PLATFORM_ADMIN" },
      { id: "dev-fee-wallet", power: "receives the developer's platform fee", holder: devFeeWallet(env), holderKind: "key", timelock: null, sunset: null, canDo: ["claim the platform fee vault"], cannotDo: ["anything to a token"], source: "BURNTICKER_FEE_WALLET" },
      { id: "program-upgrade-authority", power: "upgrade the burn_receipts program", holder: key("BURNTICKER_UPGRADE_AUTHORITY"), holderKind: key("BURNTICKER_UPGRADE_AUTHORITY") ? "multisig" : "none", timelock: "Squads multisig (planned), then renounced after audit", sunset: "renounce after audit (LAUNCHPAD-PATH §2)", canDo: ["deploy new program code"], cannotDo: ["anything without a new deployment, which is public"], source: "placeholder: BURNTICKER_UPGRADE_AUTHORITY; the program is not deployed yet" },
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
export function registerPowersFromShipped(j: ShippedRegister): Power[] | null {
  if (j?.schema !== "burn-receipts.powers-register/v1" || !Array.isArray(j.instructions)) return null;
  const src = "docs/burn-receipts/powers-register.json";
  const kind = (role: string): Power["holderKind"] => (/squads|multisig|vault/i.test(j.roles?.[role] ?? "") ? "multisig" : role === "anyone" ? "none" : "key");
  const rows: Power[] = j.instructions.filter((i) => i.class === "privileged").map((i) => {
    const role = (i.signers ?? []).map((x) => x.role).find((r) => r !== "anyone") ?? "anyone";
    return { id: i.name, power: i.name.replace(/_/g, " "), holder: role, holderKind: kind(role), timelock: i.timelock ?? null, sunset: i.sunset ?? null, canDo: i.can ? [i.can] : [], cannotDo: i.cannot ? [i.cannot] : [], source: `${src} → instructions.${i.name}` };
  });
  if (j.upgrade_authority) rows.push({ id: "program-upgrade-authority", power: j.upgrade_authority.power ?? "program upgrade authority", holder: "upgrade_authority", holderKind: "multisig", timelock: j.upgrade_authority.holder_at_launch ?? null, sunset: j.upgrade_authority.sunset ?? null, canDo: ["deploy new program code (a public, time-locked proposal)"], cannotDo: [], source: `${src} → upgrade_authority` });
  for (const [k, e] of (j.external_powers ?? []).entries()) rows.push({ id: `external-${k}`, power: e.power ?? "external power", holder: e.holder ?? null, holderKind: "key", timelock: e.timelock ?? null, sunset: null, canDo: e.can ? [e.can] : [], cannotDo: [], source: `${src} → external_powers[${k}]` });
  return rows.length ? rows : null;
}

/** What the operator can and cannot do — the block on every token page. Derived from the register, not free text. */
export function operatorPowersSummary(reg: PowersRegister): { can: string[]; cannot: string[]; placeholder: boolean } {
  const can = new Set<string>(), cannot = new Set<string>();
  for (const p of reg.powers) { p.canDo.forEach((x) => can.add(x)); p.cannotDo.forEach((x) => cannot.add(x)); }
  cannot.add("change a token's rule, readings or receipts after the fact (the registry is append-only, enforced by SQL triggers)");
  cannot.add("earn from a burn pool (nothing is ever taken from one)");
  return { can: [...can], cannot: [...cannot], placeholder: reg.placeholder };
}

// ---- the live platform config ----

export interface ChainReader { accountData(pubkey: string): Promise<Uint8Array | null>; signaturesFor(address: string, limit: number): Promise<{ signature: string; slot: number; blockTime: number | null }[]>; lamportsDelta(signature: string, address: string): Promise<{ delta: bigint; counterparty: string | null; memo: string | null } | null> }

export interface LivePlatform { platformId: string; found: boolean; view: PlatformView | null; comparison: LiveVsDesigned[]; readAt: string; error: string | null }

export async function readLivePlatform(reader: ChainReader | null, platformId: string | null, env: Readonly<Record<string, string | undefined>> = process.env, now = Date.now()): Promise<LivePlatform> {
  const readAt = new Date(now).toISOString();
  if (!platformId) return { platformId: "", found: false, view: null, comparison: [], readAt, error: "BURNTICKER_PLATFORM_ID is not set: the platform config has not been created yet" };
  if (!reader) return { platformId, found: false, view: null, comparison: [], readAt, error: "no RPC configured on this host: the live config cannot be read here" };
  try {
    const data = await reader.accountData(platformId);
    if (!data) return { platformId, found: false, view: null, comparison: [], readAt, error: "the platform config account does not exist on this cluster" };
    const view = decodePlatform(data);
    return { platformId, found: true, view, comparison: compareLivePlatform(view, devFeeWallet(env), (env.BURNTICKER_PROGRAM_ID ?? "").trim() || null), readAt, error: null };
  } catch (e) { return { platformId, found: false, view: null, comparison: [], readAt, error: (e as Error).message.slice(0, 200) }; }
}

// ---- the developer fee ledger (from chain; append-only by construction) ----

export interface FeeLedgerEntry { signature: string; slot: number; blockTime: string | null; delta: string; direction: "in" | "out"; counterparty: string | null; memo: string | null }
export interface FeeLedger { wallet: string | null; entries: FeeLedgerEntry[]; totalIn: string; totalOut: string; source: "chain" | "unavailable"; note: string }

export async function readFeeLedger(reader: ChainReader | null, wallet: string | null, limit = 200): Promise<FeeLedger> {
  if (!wallet) return { wallet: null, entries: [], totalIn: "0", totalOut: "0", source: "unavailable", note: "BURNTICKER_FEE_WALLET is not set" };
  if (!reader) return { wallet, entries: [], totalIn: "0", totalOut: "0", source: "unavailable", note: "no RPC configured on this host; the ledger is read from chain, never from our records" };
  const sigs = await reader.signaturesFor(wallet, limit);
  const entries: FeeLedgerEntry[] = [];
  let tin = BigInt(0), tout = BigInt(0);
  for (const s of sigs) {
    const d = await reader.lamportsDelta(s.signature, wallet);
    if (!d || d.delta === BigInt(0)) continue;
    if (d.delta > BigInt(0)) tin += d.delta; else tout -= d.delta;
    entries.push({ signature: s.signature, slot: s.slot, blockTime: s.blockTime ? new Date(s.blockTime * 1000).toISOString() : null, delta: d.delta.toString(), direction: d.delta > BigInt(0) ? "in" : "out", counterparty: d.counterparty, memo: d.memo });
  }
  return { wallet, entries, totalIn: tin.toString(), totalOut: tout.toString(), source: "chain", note: `the last ${limit} signatures of the wallet, from the RPC` };
}

// ---- team wallets, own-token refusal ----

export interface TeamWallets { wallets: { label: string; pubkey: string }[]; ownTokensFile: string; ownTokensPresent: boolean; refusalRule: string }
export function teamWallets(env: Readonly<Record<string, string | undefined>> = process.env, root = process.cwd()): TeamWallets {
  const pick = (label: string, name: string) => { const v = (env[name] ?? "").trim(); return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) ? [{ label, pubkey: v }] : []; };
  const file = path.join("config", "own-tokens.json");
  return {
    wallets: [...pick("developer fee wallet", "BURNTICKER_FEE_WALLET"), ...pick("platform admin", "BURNTICKER_PLATFORM_ADMIN"), ...pick("keeper data key", "BURNTICKER_KEEPER_PUBKEY")],
    ownTokensFile: file, ownTokensPresent: fs.existsSync(path.join(root, file)),
    refusalRule: "Every trading arm the operator runs refuses to buy any token launched through this platform (the refuse list in config/own-tokens.json, enforced in the bots' entry filters). Holdings of any platform token by a team wallet are shown here when non-zero.",
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
export function readIncidents(root = process.cwd()): { markdown: string; entries: number } { const l = readMarkdownLog(root, INCIDENTS_FILE); return { markdown: l.markdown, entries: l.entries }; }

// ---- transparency (config/burnticker/transparency.json; the owner, 2026-10-09: "i dont want to hide anything") ----

export const TRANSPARENCY_FILE = path.join("config", "burnticker", "transparency.json");
export interface TransparencyWallet { role: string; label: string; pubkey: string | null; envVar: string | null; description: string }
export interface TransparencyReview { id: string; reviewer: string; status: string; reportPath: string | null }
export interface TransparencyRehearsal { symbol: string; date: string | null; mint: string | null; status: string; text: string }
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
  recordedFunding?: { sol: number; date: string; transaction: string | null; source: string } | null;
  reports?: { paid: { date: string; title: string; severity: string; sol: number; tx: string }[]; rejected: { date: string; title: string; reason: string }[]; note: string };
}
/** A wallet row as rendered: the pubkey from the file, else from the named environment variable, else TODO. */
export interface WalletRow extends TransparencyWallet { resolved: string | null; source: "file" | "env" | "todo" }

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
  if (bw !== undefined && bw !== null && !PUBKEY_RE.test(String(bw))) out.push("howBuilt.bounty.wallet must be a base58 public key or null (TODO_BOUNTY_WALLET until the vault exists)");
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

export function resolveWallets(cfg: TransparencyConfig, env: Readonly<Record<string, string | undefined>> = process.env): WalletRow[] {
  return cfg.wallets.map((w) => {
    if (w.pubkey) return { ...w, resolved: w.pubkey, source: "file" };
    const v = w.envVar ? (env[w.envVar] ?? "").trim() : "";
    return PUBKEY_RE.test(v) ? { ...w, resolved: v, source: "env" } : { ...w, resolved: null, source: "todo" };
  });
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
  const wallets = resolveWallets(cfg, env);
  return {
    updatedAt: cfg.updatedAt, file: TRANSPARENCY_FILE, publicRepo: cfg.publicRepo,
    whoRunsThis: { ...cfg.whoRunsThis, operatorLine: OPERATOR_LINE, refuseListPresent: fs.existsSync(path.join(root, cfg.whoRunsThis.refuseListCode)) && fs.existsSync(path.join(root, cfg.whoRunsThis.refuseListConfig)) },
    howBuilt: { ...cfg.howBuilt, reviewsReadmePresent: fs.existsSync(path.join(root, cfg.howBuilt.reviewsDir, "README.md")), reportsPresent: cfg.howBuilt.reviews.map((r) => ({ id: r.id, present: !!r.reportPath && fs.existsSync(path.join(root, r.reportPath)) })) },
    wallets, walletsTodo: wallets.filter((w) => w.source === "todo").length, rehearsals: cfg.rehearsals,
    limitations: cfg.limitations, policies: cfg.policies,
    decisions: readMarkdownLog(root, DECISIONS_FILE), changelog: readMarkdownLog(root, CHANGELOG_FILE),
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
    programId: deployed ? id : null, deployed, buildHash: (env.BURNTICKER_PROGRAM_HASH ?? "").trim() || null,
    hostWiring: deployed ? `this host reads burn_receipts ${id}` : "this host is not wired to a burn_receipts program (BURNTICKER_PROGRAM_ID unset): its pages use the in-memory stand-in and send nothing",
    chain: chainFacts(root),
    compiled: `burn_receipts ${BURN_RECEIPTS_IDL.address} (the id compiled into the program and its IDL)`,
    verify: deployed
      ? [`solana program dump ${id} program.so`, "sha256sum program.so   # compare with the build hash above", "anchor verify / solana-verify against the tagged source (repository link in the register when published)", `solana program show ${id}   # the upgrade authority must match the register`]
      : ["this host is not wired to the program; the chain deployment and its read-back hashes are listed above (config/burnticker/verified-build.json, docs/burnticker/VERIFIED-BUILD.md)"],
  };
  // every coin's metadata, whatever the program's state (pin.ts; verify.ts verifyPinnedMetadata does the same three checks)
  out.verify.push("metadata: curl -s <coin>/status.json | jq .pinned   # metadataUri (arweave), metadataSha256, expectedDescription", "curl -s <pinned.metadataUri> | sha256sum   # must equal pinned.metadataSha256", "curl -s <pinned.metadataUri> | jq -r .description   # must equal pinned.expectedDescription byte for byte (the generated text)");
  return out;
}

/** Where each program is deployed, from the verified-build read-back (never from this host's environment). */
function chainFacts(root: string): ProgramChainFact[] {
  try {
    return loadVerifiedBuild(root).programs.map((p) => ({ library: p.library, programId: p.programId,
      devnet: p.deployed.devnet ? `deployed (read ${p.deployed.devnet.readAt}${p.deployed.devnet.matchesBuild ? ", bytes match the recorded build" : ", bytes DO NOT match the recorded build"})` : "not deployed",
      mainnet: p.deployed.mainnet ? `deployed (read ${p.deployed.mainnet.readAt})` : "not deployed" }));
  } catch { return []; }
}

// ---- the audit (scripts/burnticker-audit.mts writes it) ----

export interface AuditSummary { schema: "burnticker.audit/v1"; ranAt: string; tokens: number; receipts: number; mismatches: { ticker: string; eventId: string; checks: string[] }[]; chainChecked: boolean; ok: boolean }
export function readAudit(siteDir: string): AuditSummary | null {
  const file = path.join(siteDir, "audit.json");
  if (!fs.existsSync(file)) return null;
  try { const j = JSON.parse(fs.readFileSync(file, "utf8")) as AuditSummary; return j.schema === "burnticker.audit/v1" ? j : null; } catch { return null; }
}

// ---- the whole page ----

export interface TrustPage {
  generatedAt: string;
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
}

export async function buildTrustPage(i: { reader: ChainReader | null; env?: Readonly<Record<string, string | undefined>>; root?: string; siteDir: string; attesters: TrustPage["attesters"]; firstLaunchAt?: number | null; now?: number; cluster?: string }): Promise<TrustPage> {
  const env = i.env ?? process.env, root = i.root ?? process.cwd(), now = i.now ?? Date.now();
  const powers = loadPowersRegister(env, root, now);
  const transparency = buildTransparency(root, env);
  const platformId = (env.BURNTICKER_PLATFORM_ID ?? "").trim() || null;
  return {
    generatedAt: new Date(now).toISOString(),
    operatorLine: OPERATOR_LINE, contactIsTodo: OPERATOR_LINE.includes(OPERATOR_CONTACT_TODO), useOfFees: USE_OF_FEES, attesterStatus: attesterStatusLine(i.firstLaunchAt ?? null), preAuditCapSol: PRE_AUDIT_POOL_CAP_SOL,
    powers, operator: operatorPowersSummary(powers),
    livePlatform: await readLivePlatform(i.reader, platformId, env, now),
    designedFees: { curve: CURVE_FEES, postGraduation: POST_GRADUATION_FEES, devFeeBps: BURNTICKER_DEV_FEE_BPS, lpBurnedPct: LP_BURNED_PCT, lpLockedPct: LP_LOCKED_PCT, lpFeeSplit: { burnPoolBps: LP_FEES_TO_BURN_POOL_BPS, operatorBps: LP_FEES_TO_OPERATOR_BPS, ofLpBps: { burnPool: 8000, operator: 2000 } }, creatorCashBps: 0, teamAllocationPct: 0 },
    lpLock: lpLockPolicyJson(i.cluster ?? ((env.BURNTICKER_CLUSTER ?? "").trim() || "devnet"), (env.BURNTICKER_PROGRAM_ID ?? "").trim() || null),
    feeLedger: await readFeeLedger(i.reader, devFeeWallet(env)),
    team: teamWallets(env, root), attesters: i.attesters, program: programFacts(env, root), incidents: readIncidents(root), audit: readAudit(i.siteDir),
    transparency,
    statements: [
      `LP locked forever at graduation: ${LP_LOCKED_PCT}% (platformScale 1,000,000, creatorScale 0, burnScale 0; Raydium's LP lock, never withdrawable) — not creator-configurable. The Fee Key is owned by the burn program's fee-keys PDA and the permissionless claim_lock_fees splits the LP fees 80% to the coin's burn pool and 20% to the operator treasury, fixed in code; the coin side is burned. The program's own LP floor for a burn pool: ≥ 50 % at registration (≥ 90 % for the fallback pool); our platform locks 100 % at graduation.`,
      `The operator earns 20% of post-graduation LP fees: ${LP_FEES_TO_OPERATOR_BPS} bps of every swap after graduation, paid to the operator treasury (the developer fee wallet, not the Squads vault, which holds no fee stream); ${LP_FEES_TO_BURN_POOL_BPS} bps goes to the coin's burn pool. On the curve the developer slice is ${BURNTICKER_DEV_FEE_BPS} bps. No admin key can change the 80/20 split.`,
      "Creator cash from fees: 0 bps. The creator-fee slot pays the token's burn pool, 100%.",
      "Team allocation: 0%. No presale, no private round, no airdrop to insiders; the platform holds no tokens at launch.",
      "Rules, readings and receipts are append-only: SQL triggers refuse updates and deletes; a rule change is a new token.",
      "No referral codes, fee discounts or hidden parameters exist in the launch wizard; every parameter is in the canonical rules.json.",
      "Settled results only: no price, market cap or odds for any Burnticker coin; another coin's market cap may be a rule input, shown only as the rule sentence (a Burn Derby rule reads two outside coins' settled moves; derby admission refuses a Burnticker coin as an input). No page shows a market-implied chance for any coin (removed 2026-10-10); a coin page names only its venue and the next market's ticker and close time.",
      "Settlement sources: first-party primaries with an independent cross-read (Treasury, BLS, FRED, NWS, EDGAR, on-chain data; sports games settle on the game's on-chain payout where a Polymarket moneyline market exists, else on a licensed final score (data: TheSportsDB, commercial licence), confirmed by the league's official feed (MLB's official feed, NHL's official scores, NBA's official feed) or a second licensed provider (API-Sports); see the coverage table below) or an on-chain Polymarket payout (the result read from the Conditional Tokens payout vector on Polygon, counted only once that payout is on chain; Gamma is used for discovery only, with no prices shown). Kalshi is not a settlement input: its Developer Agreement and Data Terms (reviewed 2026-10-10) do not permit settling products on or redistributing its data; the Kalshi adapter is discovery-only, off by default, and the launch preflight refuses any Kalshi rule.",
      `Pre-audit cap: each burn pool spends from at most ${PRE_AUDIT_POOL_CAP_SOL} SOL; fee income above it is queued and released after the audit (enforced by the keeper today, by the program once deployed — that seam is open until then).`,
      "Anonymous creators are allowed; the creator wallet is always displayed. One-shot markets are allowed; their pages say 'resolves once on <date>'. Elections are allowed; deaths, violence, terror, casualty counts and named private individuals are refused.",
      USE_OF_FEES,
      ...GATE_POLICY_IDS.map((id) => transparency.policies.find((p) => p.id === id)?.text).filter((t): t is string => !!t),
    ],
  };
}

/** A ChainReader over @solana/web3.js, built lazily by the route when an RPC URL is configured (never in tests). */
export async function web3ChainReader(rpcUrl: string): Promise<ChainReader> {
  const { Connection } = await import("@solana/web3.js");
  const c = new Connection(rpcUrl, "confirmed");
  return {
    accountData: async (pk) => (await c.getAccountInfo(new PublicKey(pk), "confirmed"))?.data ?? null,
    signaturesFor: async (addr, limit) => (await c.getSignaturesForAddress(new PublicKey(addr), { limit }, "confirmed")).map((s) => ({ signature: s.signature, slot: s.slot, blockTime: s.blockTime ?? null })),
    lamportsDelta: async (sig, addr) => {
      const tx = await c.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
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
