import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { b58decode, isPubkey, isSignature } from "@/lib/burnticker/trustpack/base58";

/**
 * THE OPERATOR (trust pack, 2026-10-10): config/burnticker/operator.json — who runs the platform, every operator wallet per cluster
 * (devnet copied from the rehearsal records, mainnet TODO until created), the signed-statement slot and the never-buys rule. A value
 * starting with TODO_ is a placeholder; `placeholders()` lists them all (docs/burnticker/TODO-OWNER.md names each one with its file
 * and line, and the test holds the two lists together).
 */

export const OPERATOR_FILE = path.join("config", "burnticker", "operator.json");
export const TODO_RE = /^TODO_[A-Z0-9_]+$/;
export type Cluster = "devnet" | "mainnet";

export interface OperatorWallet { role: string; label: string; pubkey: string; source: string | null; name?: string }
export interface ClusterConfig {
  status: string; programs: { burn_receipts: string; pair_curve: string }; launchlabPlatform: string;
  squads: { vault: string; multisig: string; threshold: string; timeLock: string; source: string };
  wallets: OperatorWallet[]; platformMints: { symbol: string; mint: string; source: string }[];
}
export interface OperatorConfig {
  schema: "burnticker.operator/v1"; updatedAt: string; note: string;
  operator: { name: string; state: string; country: string; contact: string; security: string; entity: string; entityPending: string };
  links: { site: string; app: string; deficitSite: string; github: string; githubOrg: string; x: string[] };
  clusters: Record<Cluster, ClusterConfig>;
  signedMessage: { status: string; signerRole: string; cluster: Cluster; message: string; signature: string | null; how: string };
  neverBuys: { rule: string; rehearsalNote: string };
}

const isKeyOrTodo = (v: unknown) => typeof v === "string" && (isPubkey(v) || TODO_RE.test(v));

export function operatorProblems(j: Partial<OperatorConfig> | null): string[] {
  const out: string[] = [];
  if (!j || j.schema !== "burnticker.operator/v1") return ["schema must be burnticker.operator/v1"];
  if (!j.operator?.name || !j.operator.state || !/@burnticker\.com$/.test(j.operator.contact ?? "")) out.push("operator.name / state / contact (an @burnticker.com address) required");
  if (!isKeyOrTodo(j.operator?.entity) && !/LLC/.test(String(j.operator?.entity))) out.push("operator.entity is TODO_ENTITY or the entity's name");
  for (const c of ["devnet", "mainnet"] as Cluster[]) {
    const cl = j.clusters?.[c];
    if (!cl) { out.push(`clusters.${c} missing`); continue; }
    for (const [k, v] of Object.entries(cl.programs ?? {})) if (!isPubkey(v)) out.push(`${c}.programs.${k} is not a public key`);
    if (!isKeyOrTodo(cl.launchlabPlatform)) out.push(`${c}.launchlabPlatform: public key or TODO_`);
    for (const k of ["vault", "multisig"] as const) if (!isKeyOrTodo(cl.squads?.[k])) out.push(`${c}.squads.${k}: public key or TODO_`);
    const roles = new Set<string>();
    for (const w of cl.wallets ?? []) {
      if (roles.has(w.role)) out.push(`${c}: duplicate wallet role ${w.role}`);
      roles.add(w.role);
      if (!isKeyOrTodo(w.pubkey)) out.push(`${c}.${w.role}: pubkey must be a public key or TODO_…`);
      if (c === "devnet" && (!isPubkey(w.pubkey) || !w.source)) out.push(`devnet.${w.role}: a real public key with its source file`);
    }
    for (const must of ["dev-fee", "keeper", "deployer", "platform-admin", "squads-vault"]) if (!roles.has(must)) out.push(`${c}: wallet role ${must} missing`);
    for (const m of cl.platformMints ?? []) if (!isPubkey(m.mint)) out.push(`${c}.platformMints ${m.symbol}: not a public key`);
  }
  const s = j.signedMessage;
  if (!s || typeof s.message !== "string" || !s.message.includes("{PUBKEY}")) out.push("signedMessage.message must contain {PUBKEY}");
  if (s && s.signature !== null && !isSignature(s.signature)) out.push("signedMessage.signature must be null or a base58 64-byte signature");
  return out;
}

export function loadOperator(root = process.cwd()): OperatorConfig {
  const j = JSON.parse(fs.readFileSync(path.join(root, OPERATOR_FILE), "utf8")) as OperatorConfig;
  const bad = operatorProblems(j);
  if (bad.length) throw new Error(`${OPERATOR_FILE}: ${bad.join("; ")}`);
  return j;
}

/** Every TODO_ placeholder in the file (deduplicated, in order of appearance), with its JSON path. */
export function placeholders(j: unknown, at = "$"): { path: string; value: string }[] {
  const out: { path: string; value: string }[] = [];
  const walk = (x: unknown, p: string) => {
    if (typeof x === "string") { for (const m of x.matchAll(/TODO_[A-Z0-9_]+/g)) out.push({ path: p, value: m[0] }); return; }
    if (Array.isArray(x)) { x.forEach((v, i) => walk(v, `${p}[${i}]`)); return; }
    if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) walk(v, `${p}.${k}`);
  };
  walk(j, at);
  return out;
}

/** The wallet a role resolves to on a cluster (null while it is a TODO). */
export function walletOf(cfg: OperatorConfig, cluster: Cluster, role: string): string | null {
  const w = cfg.clusters[cluster].wallets.find((x) => x.role === role);
  return w && isPubkey(w.pubkey) ? w.pubkey : null;
}

/** The developer fee wallet pinned in the platform config for the cluster the platform runs on. */
export const pinnedDevFeeWallet = (cfg: OperatorConfig, cluster: Cluster): string | null => walletOf(cfg, cluster, "dev-fee");

/**
 * Verifies an ed25519 signature over the exact UTF-8 bytes of `message` (what a wallet's signMessage signs) by the base58 public
 * key. Pure apart from node:crypto; returns false (never throws) on malformed input.
 */
export function verifySignedMessage(message: string, signatureB58: string, pubkeyB58: string): boolean {
  const sig = b58decode(signatureB58), pk = b58decode(pubkeyB58);
  if (!sig || sig.length !== 64 || !pk || pk.length !== 32) return false;
  try {
    const key = crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(pk).toString("base64url") }, format: "jwk" });
    return crypto.verify(null, Buffer.from(message, "utf8"), key, Buffer.from(sig));
  } catch { return false; }
}

export interface SignedMessageView { status: "todo" | "signed" | "invalid"; signer: string | null; message: string; signature: string | null; verified: boolean | null; how: string; detail: string }

/** The signed-statement slot as the page shows it: the message with {PUBKEY} filled when the signer exists, and the check. */
export function signedMessageView(cfg: OperatorConfig): SignedMessageView {
  const s = cfg.signedMessage;
  const signer = walletOf(cfg, s.cluster, s.signerRole);
  const message = s.message.replace("{PUBKEY}", signer ?? "{PUBKEY}");
  if (!s.signature || TODO_RE.test(s.status) || !signer) return { status: "todo", signer, message, signature: null, verified: null, how: s.how, detail: `${s.status}: not signed yet (${signer ? "signature missing" : `the ${s.cluster} ${s.signerRole} wallet does not exist yet`})` };
  const ok = /\{DATE\}/.test(message) ? false : verifySignedMessage(message, s.signature, signer);
  return { status: ok ? "signed" : "invalid", signer, message, signature: s.signature, verified: ok, how: s.how, detail: ok ? `ed25519 signature by ${signer} over the exact text above: valid` : "the signature does not verify against the text and the signer (or {DATE} is still unfilled)" };
}
