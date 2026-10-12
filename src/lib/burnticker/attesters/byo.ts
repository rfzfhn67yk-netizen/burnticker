import fs from "node:fs";
import path from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { attestationMessage, signAttestation, sourceUrlHash, verifyAttestation, ZERO_HASH } from "@/lib/burnReceipts/attestation";
import { ATTESTER_SENIORITY_SECS, ATTESTER_TIMELOCK_SECS } from "@/lib/burnReceipts/constants";
import { formatDate } from "@/lib/burnReceipts/math";
import type { TokenConfigAccount, ReadingAccount } from "@/lib/burnReceipts/accounts";
import { encryptSecretKey, keyFileObjections } from "@/lib/burnKeeper/keyfile";
import { openRegistry } from "@/lib/burnticker/registry";
import { lockRule, type BurnRule } from "@/lib/burnticker/rules";
import { COUNTER_BASE, counterRule, counterSourceUrl } from "@/lib/burnticker/program";
import { planToken, receiptDay, END_KINDS } from "@/lib/burnticker/multiKeeper";
import type { SettledEvent } from "@/lib/burnticker/units";

/**
 * BRING YOUR OWN ATTESTER (owner-approved 2026-10-10 night, trust-ops item 3; docs/burnticker/ATTESTERS.md). The pieces a community
 * runs on its own machine, from the public tree, to become (or simply act as a watchdog beside) an attester of a coin:
 *
 *   keygen          a fresh ed25519 key, written outside any repository (mode 600; encrypted with a passphrase when given)
 *   counterAt       the coin's unit counter for a day, computed with the keeper's OWN engine (multiKeeper.planToken in a scratch
 *                   registry) from the coin's published rules.json and readings you fetched yourself — so your number is independent
 *   readingMessage  the exact bytes the burn_receipts program verifies (BURNRECEIPTS-v3|genesis|program|mint|feed|prev=|date|value|
 *                   src=sha256(source url)|proof=), and your signature over them
 *   compareChain    your value / prev date / source hash against the Reading account on chain (a watchdog check anyone can run)
 *   checkProposal   the program's own rules for changing an attester set (propose_attesters), so a proposal is checked BEFORE the
 *                   config authority (the Squads vault) is asked to sign it
 *
 * No program change: the program already takes up to 5 attesters and a quorum up to 3, every change waits 48 hours in public, and a
 * key may vouch for a new key only after 7 days in the set. The keeper's intake for a second signature is built (signer-2,
 * 2026-10-12: cosign.ts / cosignSigner.ts / scripts/burnticker-signer.mts); no second signer is running yet (ATTESTERS.md).
 */

// ---- keys ----

export function keygen(o: { out: string; passphrase?: string | null; repoRoot?: string; overwrite?: boolean }): { publicKey: string; file: string; encrypted: boolean } {
  const file = path.resolve(o.out);
  const root = path.resolve(o.repoRoot ?? process.cwd());
  if (file.startsWith(`${root}${path.sep}`)) throw new Error(`refusing to write a key inside the repository (${root}); put it under ~/.config/… instead`);
  if (fs.existsSync(file) && !o.overwrite) throw new Error(`${file} exists — refusing to overwrite a key`);
  const kp = Keypair.generate();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const body = o.passphrase ? JSON.stringify(encryptSecretKey(kp.secretKey, o.passphrase)) : JSON.stringify(Array.from(kp.secretKey));
  fs.writeFileSync(file, `${body}\n`, { mode: 0o600 });
  fs.writeFileSync(`${file}.address`, `${kp.publicKey.toBase58()}\n`, { mode: 0o644 });
  const objections = keyFileObjections(file, fs.statSync(file), root);
  if (objections.length) throw new Error(`the key file was written but fails the keeper's own checks: ${objections.join("; ")}`);
  return { publicKey: kp.publicKey.toBase58(), file, encrypted: !!o.passphrase };
}

// ---- the counter ----

export interface CounterResult {
  date: string; recordDate: number; value: bigint; prevDate: number; units: number;
  /** The receipts counted INTO this reading (its source URL names them), and every unit-carrying receipt through the date. */
  eventIds: string[]; throughDate: { eventId: string; day: number; units: number }[];
  sourceUrl: string; feedId: string; notes: string[];
}

const DAY_MS = 86_400_000;
const ymdToMs = (d: number) => Date.UTC(Math.floor(d / 10_000), (Math.floor(d / 100) % 100) - 1, d % 100);
const msToYmd = (ms: number) => { const x = new Date(ms); return x.getUTCFullYear() * 10_000 + (x.getUTCMonth() + 1) * 100 + x.getUTCDate(); };
export const parseDay = (s: string): number => { const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s.trim()); if (!m) throw new Error(`not a date (YYYY-MM-DD): ${s}`); return Number(`${m[1]}${m[2]}${m[3]}`); };

/**
 * The unit counter the keeper attests for `recordDate`: COUNTER_BASE + every unit of every receipt through that day, the receipts
 * counted into THIS reading (those after the previous reading day), the previous reading day (the last earlier day with a counted
 * receipt, else the baseline day the keeper attests first), and the counter source URL. Pure apart from a scratch in-memory registry.
 * Matches the keeper exactly in the normal case (each day with units is attested once it is over); a late settlement the keeper
 * already folded into a later day shows up as a mismatch in compareChain — read the chain's prev date with --rpc and pass it.
 */
export function counterAt(o: { mint: string; ticker: string; rulesText: string; baselineAt: string; readings: readonly SettledEvent[]; recordDate: number; prevDate?: number | null }): CounterResult {
  const locked = lockRule(JSON.parse(o.rulesText));
  if (locked.text !== o.rulesText) throw new Error("rules.json is not canonical (re-lock it: the keeper's exact bytes are what the hash commits to)");
  const rule: BurnRule = locked.rule;
  if (rule.pair) throw new Error("rivalry-pair coins are not supported by `read` yet: their event burns wait on the pair's pool registration (pending-pair), which is chain state this tool does not replay");
  if (rule.oracle === "kalshi") throw new Error("Kalshi is not a settlement input (Developer Agreement and Data Terms, 2026-10-10): no attester reads it");
  if (rule.oracle === "derby") throw new Error("Burn Derby coins settle on boundary snapshots (Pyth updates, pool TWAPs) the keeper samples at each window; replaying them needs those samples, which `read` does not fetch yet");
  const reg = openRegistry(":memory:");
  const notes: string[] = [];
  try {
    const t = reg.register({ mint: o.mint, ticker: o.ticker, name: o.ticker, creator: "byo-attester", description: "", imageUrl: null, links: [], rulesText: o.rulesText, feePda: "byo", vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "scratch", platformId: null, baselineAt: o.baselineAt, status: "draft" });
    reg.markLaunched(t.mint, "byo", null, o.baselineAt);
    reg.putReadings(rule.oracle, t.selectorKey, o.readings, { settlementSourceUrl: null, attestedBy: ["byo"] });
    planToken({ registry: reg, log: () => {}, now: () => Date.now() } as unknown as Parameters<typeof planToken>[0], reg.token(o.mint)!, locked);
    const counted = reg.receipts(o.mint).filter((b) => b.status === "planned" && b.units > 0 && !END_KINDS.has(b.kind));
    const upto = counted.filter((b) => receiptDay(b.settledAt) <= o.recordDate);
    const days = [...new Set(upto.map((b) => receiptDay(b.settledAt)))].sort((a, b) => a - b);
    const baselineDay = msToYmd(ymdToMs(receiptDay(o.baselineAt)) - DAY_MS);
    const earlier = days.filter((d) => d < o.recordDate);
    const prevDate = o.prevDate ?? (earlier.length ? earlier[earlier.length - 1] : baselineDay);
    const inThis = upto.filter((b) => receiptDay(b.settledAt) > prevDate);
    if (!days.includes(o.recordDate)) notes.push(`no receipt with units settles on ${formatDate(o.recordDate)}: the keeper attests no reading for that day (the value below is the counter as it stands)`);
    if (reg.receipts(o.mint).some((b) => b.status === "pending-pair")) notes.push("pending-pair receipts are not counted");
    const units = upto.reduce((a, b) => a + b.units, 0);
    const feedId = counterRule(rule, o.ticker, t.selectorKey, { floorLamports: BigInt(0) }).feedId;
    const ids = inThis.map((b) => b.eventId);
    return {
      date: formatDate(o.recordDate), recordDate: o.recordDate, value: COUNTER_BASE + BigInt(units), prevDate, units: inThis.reduce((a, b) => a + b.units, 0),
      eventIds: ids, throughDate: upto.map((b) => ({ eventId: b.eventId, day: receiptDay(b.settledAt), units: b.units })),
      sourceUrl: counterSourceUrl(o.ticker, formatDate(o.recordDate), ids), feedId, notes,
    };
  } finally { reg.close(); }
}

// ---- the signed message ----

export function readingMessage(o: { genesis: string; programId: string; mint: string; c: Pick<CounterResult, "feedId" | "prevDate" | "recordDate" | "value" | "sourceUrl">; proofHash?: Uint8Array }): { message: string; sourceUrlHash: string } {
  const src = sourceUrlHash(o.c.sourceUrl);
  const msg = attestationMessage(o.genesis, new PublicKey(o.programId), new PublicKey(o.mint), o.c.feedId, o.c.prevDate, o.c.recordDate, o.c.value, 0, src, o.proofHash ?? ZERO_HASH);
  return { message: msg.toString("utf8"), sourceUrlHash: src.toString("hex") };
}
export function signReading(secretKey: Uint8Array, message: string): { signature: string; publicKey: string } {
  const kp = Keypair.fromSecretKey(secretKey);
  const sig = signAttestation(secretKey, Buffer.from(message, "utf8"));
  if (!verifyAttestation(kp.publicKey, Buffer.from(message, "utf8"), sig)) throw new Error("the signature does not verify against the key (bad key file?)");
  return { signature: Buffer.from(sig).toString("base64"), publicKey: kp.publicKey.toBase58() };
}

// ---- the chain ----

export interface ChainComparison { found: boolean; checks: { id: "value" | "prev" | "source" | "units"; ok: boolean; detail: string }[] }
/** Your computed reading against the program's Reading account for the same date (null = the keeper has not attested that day). */
export function compareChain(c: CounterResult, reading: Pick<ReadingAccount, "value" | "prev_date" | "source_url_hash" | "units"> | null): ChainComparison {
  if (!reading) return { found: false, checks: [] };
  const srcHex = Buffer.from(reading.source_url_hash).toString("hex");
  const mine = sourceUrlHash(c.sourceUrl).toString("hex");
  return { found: true, checks: [
    { id: "value", ok: reading.value === c.value, detail: `chain ${reading.value} · yours ${c.value}` },
    { id: "prev", ok: reading.prev_date === c.prevDate, detail: `chain prev ${reading.prev_date ? formatDate(reading.prev_date) : "none"} · yours ${c.prevDate ? formatDate(c.prevDate) : "none"}` },
    { id: "source", ok: srcHex === mine, detail: srcHex === mine ? "the source URL hash (the event ids counted) matches" : `chain src ${srcHex.slice(0, 16)}… · yours ${mine.slice(0, 16)}… (a different set of receipts was counted into this day)` },
    { id: "units", ok: Number(reading.units) === c.units, detail: `chain ${reading.units} unit(s) · yours ${c.units}` },
  ] };
}

// ---- attester-set changes: the program's rules, checked before anyone signs ----

export interface AttesterSlot { key: string; kind: number; addedAt: number /* unix seconds */ }
export const MAX_ATTESTERS = 5, MAX_QUORUM = 3, ATTESTER_KIND_MAX = 2;

/**
 * propose_attesters' checks, mirrored from programs/burn-receipts/programs/burn_receipts/src/instructions/admin.rs (and
 * validate_attesters): 1–5 distinct non-default keys, kind ≤ 2, quorum 1–3 and ≤ the set, the quorum never lowered, at least `quorum`
 * current keys kept, fewer NEW keys than the NEW quorum, and — when keys are added — at least `quorum` kept keys that have been in the
 * set ≥ 7 days. Returns every problem (empty = the program would accept it now).
 */
export function checkProposal(current: readonly AttesterSlot[], quorum: number, proposed: readonly { key: string; kind: number }[], newQuorum: number, nowSec: number): string[] {
  const out: string[] = [];
  if (proposed.length < 1 || proposed.length > MAX_ATTESTERS) out.push(`the set must have 1–${MAX_ATTESTERS} keys (has ${proposed.length})`);
  if (newQuorum < 1 || newQuorum > MAX_QUORUM || newQuorum > proposed.length) out.push(`the quorum must be 1–${MAX_QUORUM} and ≤ the set size (${newQuorum} of ${proposed.length})`);
  const seen = new Set<string>();
  for (const a of proposed) {
    if (a.key === PublicKey.default.toBase58()) out.push("the default key cannot be an attester");
    if (a.kind < 0 || a.kind > ATTESTER_KIND_MAX) out.push(`kind ${a.kind} is not 0 (operator), 1 (zkTLS relayer) or 2 (oracle)`);
    if (seen.has(a.key)) out.push(`${a.key} is listed twice`);
    seen.add(a.key);
  }
  if (newQuorum < quorum) out.push(`the quorum can never be lowered (${quorum} → ${newQuorum})`);
  const kept = proposed.filter((a) => current.some((b) => b.key === a.key));
  if (kept.length < quorum) out.push(`a proposal must keep at least ${quorum} current key(s) (keeps ${kept.length})`);
  const newKeys = proposed.length - kept.length;
  if (newKeys >= newQuorum) out.push(`it adds ${newKeys} new key(s): the program needs fewer new keys than the new quorum (${newQuorum}), so no quorum can be made of new keys alone — at quorum ${quorum} adding one key means raising the quorum to ${Math.max(newKeys + 1, quorum)}`);
  if (newKeys > 0) {
    const seniors = kept.filter((a) => { const c = current.find((b) => b.key === a.key)!; return nowSec - c.addedAt >= ATTESTER_SENIORITY_SECS; });
    if (seniors.length < quorum) {
      const soonest = kept.map((a) => current.find((b) => b.key === a.key)!.addedAt + ATTESTER_SENIORITY_SECS).sort((a, b) => a - b)[quorum - 1];
      out.push(`keys are added only on the strength of ${quorum} kept key(s) that have been in the set ≥ 7 days (has ${seniors.length})${soonest ? `; earliest: ${new Date(soonest * 1000).toISOString()}` : ""}`);
    }
  }
  return out;
}

export interface AttesterStatus { attesters: { key: string; kind: number; addedAt: string; seniorFrom: string; senior: boolean }[]; quorum: number; pending: { attesters: { key: string; kind: number }[]; quorum: number; eta: string; applicableNow: boolean } | null; adminRenounced: boolean; admin: string; timelockHours: number }
export function attesterStatus(c: Pick<TokenConfigAccount, "activeAttesters" | "attester_added_at" | "quorum" | "pending_attesters" | "pending_count" | "pending_quorum" | "pending_eta" | "adminRenounced" | "admin">, nowSec: number): AttesterStatus {
  return {
    attesters: c.activeAttesters.map((a, i) => { const at = Number(c.attester_added_at[i] ?? 0); return { key: a.key.toBase58(), kind: a.kind, addedAt: new Date(at * 1000).toISOString(), seniorFrom: new Date((at + ATTESTER_SENIORITY_SECS) * 1000).toISOString(), senior: nowSec - at >= ATTESTER_SENIORITY_SECS }; }),
    quorum: c.quorum,
    pending: c.pending_count > 0 && c.pending_eta > BigInt(0) ? { attesters: c.pending_attesters.slice(0, c.pending_count).map((a) => ({ key: a.key.toBase58(), kind: a.kind })), quorum: c.pending_quorum, eta: new Date(Number(c.pending_eta) * 1000).toISOString(), applicableNow: nowSec >= Number(c.pending_eta) } : null,
    adminRenounced: c.adminRenounced, admin: c.admin.toBase58(), timelockHours: ATTESTER_TIMELOCK_SECS / 3600,
  };
}
