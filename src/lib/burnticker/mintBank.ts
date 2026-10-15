import { DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
// relative with their extensions so scripts/burnticker-mint-bank.mts loads this file without the alias hook
import { MINT_SUFFIXES } from "./mintSuffix.ts";
import { base58, groundMintProblem, type GroundMint } from "./vanityMint.ts";

/**
 * THE MINT KEY BANK (owner, 2026-10-14 night: "the BURN vanity address is mandatory. Save them like pump.fun does so they launch
 * instantly."). Every coin made on the site gets a mint address that ends in burn or BURN. Finding one takes about 5.7 million tries, so
 * the host grinds them ahead of time (scripts/burnticker-mint-bank.mts, unit mct-burnticker-mintbank) and keeps a bank of them here; the
 * launch route takes one per coin (two for a pair) and hands its secret to the creator's page once, inside the launch bundle.
 *
 * Storage: one SQLite file (BURNTICKER_MINT_BANK_PATH, default data/burnticker-mintbank.db), mode 0600, never copied off the host. Each
 * secret is sealed with AES-256-GCM under BURNTICKER_MINT_BANK_KEY (32 bytes, base64), the row's public key bound in as associated data,
 * so a row cannot be moved to another address. A bank opened without the key, with a key that does not open its check value, or holding
 * a row that is not sealed (a plaintext file) is refused; there is no plaintext fallback.
 *
 * Rules: a key is handed out at most once (taken_at is set inside one write transaction, and a row with taken_at is never selected
 * again). A key taken but not created on chain within 24 hours is DELETED, never recycled, so no address is ever offered to two
 * creators. Once the mint is seen live (the launch route's "launched" call, or the bank service reading the registry) the row keeps its
 * public key and times and its sealed secret is wiped: the key is not needed after the create.
 */

export const MINT_BANK_DEFAULT_PATH = "data/burnticker-mintbank.db";
export const MINT_BANK_DEFAULT_SIZE = 300;
export const MINT_BANK_DEFAULT_LOW = 100;
/** A key taken and not seen created within this long is deleted (owner, 2026-10-14). */
export const MINT_BANK_TAKEN_TTL_MS = 24 * 60 * 60_000;
/** The push alert fires when the bank has been below LOW for longer than this. */
export const MINT_BANK_LOW_ALERT_MS = 60 * 60_000;
export const MINT_BANK_LOW_ALERT_KIND = "bt-mint-bank-low";
/** The code the launch route answers with when it has no key to give; the page then finds the address in the browser. */
export const MINT_BANK_EMPTY_CODE = "mint-bank-empty";
export const MINT_BANK_EMPTY_SENTENCE = "No prepared address is ready right now, so this browser finds one that ends in burn for this launch.";

const FORMAT = "aes-256-gcm/v1";
const CHECK_PLAINTEXT = "burnticker mint bank check v1";
const IV = 12, TAG = 16, SECRET = 64;
const SEALED_LEN = IV + TAG + SECRET;

/** Why the bank refuses to open: no key, a bad key, the wrong key, or a file that holds an unsealed secret. Each a plain sentence. */
export class MintBankRefusal extends Error {}

export const MINT_BANK_NO_KEY = "The mint key bank needs BURNTICKER_MINT_BANK_KEY (32 bytes, base64) to seal its keys, and it does not start without it. It never stores keys in plain text.";

/** The 32-byte sealing key from its base64 text, or a refusal sentence. */
export function parseBankKey(b64: string | undefined | null): Buffer {
  const t = (b64 ?? "").trim();
  if (!t) throw new MintBankRefusal(MINT_BANK_NO_KEY);
  const k = Buffer.from(t, "base64");
  if (k.length !== 32 || k.toString("base64").replace(/=+$/, "") !== t.replace(/=+$/, "")) throw new MintBankRefusal("BURNTICKER_MINT_BANK_KEY must be exactly 32 bytes written in base64 (openssl rand -base64 32 makes one).");
  return k;
}

export function seal(key: Buffer, pubkey: string, plain: Uint8Array): Buffer {
  const iv = randomBytes(IV);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(pubkey, "utf8"));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

export function unseal(key: Buffer, pubkey: string, sealed: Uint8Array): Uint8Array {
  const b = Buffer.from(sealed);
  if (b.length < IV + TAG + 1) throw new MintBankRefusal("A sealed key in the mint bank is too short to be one.");
  const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, IV));
  d.setAAD(Buffer.from(pubkey, "utf8"));
  d.setAuthTag(b.subarray(IV, IV + TAG));
  try { return new Uint8Array(Buffer.concat([d.update(b.subarray(IV + TAG)), d.final()])); }
  catch { throw new MintBankRefusal("A key in the mint bank could not be opened with BURNTICKER_MINT_BANK_KEY."); }
}

/** What the launch route needs from the bank (the tests inject a real bank on :memory:, a host without one passes null). */
export interface MintBankPort {
  /** One key per ticker, marked taken in the same transaction; null when fewer than that many are ready (nothing is taken then). */
  take(forTickers: readonly string[], now?: number): GroundMint[] | null;
  /** Keys taken for a request that was then refused: deleted, never offered again. */
  discard(pubkeys: readonly string[]): void;
  /** The mint is live: its row keeps the times and loses its sealed secret. */
  markCreated(pubkey: string, now?: number): boolean;
}

export interface MintBankStatus { ready: number; taken: number; created: number; oldestReadyAt: number | null; lowSince: number | null }

export interface MintBankOptions {
  /** the sealing key's base64 text (BURNTICKER_MINT_BANK_KEY) */
  key: string | undefined | null;
  /** false (the web host): a missing file is not created, and the open fails */
  create?: boolean;
  /** the tests grind short suffixes; the real bank is always burn / BURN */
  suffixes?: readonly string[];
}

export class MintBank implements MintBankPort {
  private db: DatabaseSync;
  private key: Buffer;
  private suffixes: readonly string[];
  readonly file: string;

  constructor(file: string, o: MintBankOptions) {
    this.key = parseBankKey(o.key);   // first: no key, no file is touched
    this.suffixes = o.suffixes ?? MINT_SUFFIXES;
    this.file = file;
    const mem = file === ":memory:";
    if (!mem) {
      const exists = fs.existsSync(file);
      if (!exists && o.create === false) throw new MintBankRefusal(`The mint key bank ${file} does not exist on this host yet.`);
      if (!exists) { fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true }); fs.writeFileSync(file, "", { mode: 0o600, flag: "wx" }); }
      lockDown(file);
    }
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA busy_timeout = 5000");
    if (!mem) this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS keys (pubkey TEXT PRIMARY KEY, ciphertext BLOB NOT NULL, created_at INTEGER NOT NULL, taken_at INTEGER, taken_for TEXT, mint_created_at INTEGER);
      CREATE INDEX IF NOT EXISTS keys_ready ON keys (taken_at, created_at);`);
    if (!mem) for (const side of ["-wal", "-shm"]) if (fs.existsSync(file + side)) lockDown(file + side);
    this.checkKeyAndFormat();
  }

  /** The check value proves the key; every live row must be sealed (a plaintext secret is 64 bytes, a sealed one 92). */
  private checkKeyAndFormat() {
    const fmt = this.db.prepare("SELECT v FROM meta WHERE k='format'").get() as { v: string } | undefined;
    const check = this.db.prepare("SELECT v FROM meta WHERE k='check'").get() as { v: string } | undefined;
    const rows = (this.db.prepare("SELECT COUNT(*) AS n FROM keys").get() as { n: number }).n;
    if (!fmt || !check) {
      if (rows > 0 || fmt || check) throw new MintBankRefusal("The mint key bank file holds keys without its sealing record, so it is refused. A bank is never read in plain text.");
      this.db.prepare("INSERT INTO meta (k, v) VALUES ('format', ?), ('check', ?)").run(FORMAT, seal(this.key, "check", Buffer.from(CHECK_PLAINTEXT)).toString("base64"));
      return;
    }
    if (fmt.v !== FORMAT) throw new MintBankRefusal(`The mint key bank file is in an unknown format (${fmt.v.slice(0, 40)}).`);
    let opened: string;
    try { opened = Buffer.from(unseal(this.key, "check", Buffer.from(check.v, "base64"))).toString(); } catch { throw new MintBankRefusal("BURNTICKER_MINT_BANK_KEY is not the key this mint bank was sealed with, so it is refused."); }
    if (opened !== CHECK_PLAINTEXT) throw new MintBankRefusal("BURNTICKER_MINT_BANK_KEY is not the key this mint bank was sealed with, so it is refused.");
    const bad = (this.db.prepare("SELECT COUNT(*) AS n FROM keys WHERE mint_created_at IS NULL AND length(ciphertext) <> ?").get(SEALED_LEN) as { n: number }).n;
    if (bad > 0) throw new MintBankRefusal(`The mint key bank holds ${bad} key${bad === 1 ? "" : "s"} that ${bad === 1 ? "is" : "are"} not sealed, so it is refused. A bank is never read in plain text.`);
  }

  /** Adds a ground key after checking it derives its address and ends in burn or BURN. False when it was already there. */
  insert(k: GroundMint, now = Date.now()): boolean {
    const problem = groundMintProblem({ publicKey: k.publicKey, secretKey: k.secretKey }, this.suffixes);
    if (problem) throw new Error(`refusing a key for the bank: ${problem}`);
    const r = this.db.prepare("INSERT OR IGNORE INTO keys (pubkey, ciphertext, created_at) VALUES (?, ?, ?)").run(k.publicKey, seal(this.key, k.publicKey, k.secretKey), now);
    return Number(r.changes) === 1;
  }

  take(forTickers: readonly string[], now = Date.now()): GroundMint[] | null {
    const n = forTickers.length;
    if (n < 1) return [];
    this.db.exec("BEGIN IMMEDIATE");
    let rows: { pubkey: string; ciphertext: Uint8Array }[];
    try {
      rows = this.db.prepare("SELECT pubkey, ciphertext FROM keys WHERE taken_at IS NULL ORDER BY created_at, pubkey LIMIT ?").all(n) as typeof rows;
      if (rows.length < n) { this.db.exec("ROLLBACK"); return null; }
      const mark = this.db.prepare("UPDATE keys SET taken_at = ?, taken_for = ? WHERE pubkey = ? AND taken_at IS NULL");
      rows.forEach((r, i) => { if (Number(mark.run(now, String(forTickers[i]).slice(0, 32), r.pubkey).changes) !== 1) throw new Error("a bank key was taken twice"); });
      this.db.exec("COMMIT");
    } catch (e) { try { this.db.exec("ROLLBACK"); } catch { /* already closed */ } throw e; }
    return rows.map((r) => {
      const secretKey = unseal(this.key, r.pubkey, r.ciphertext);
      const k = { publicKey: r.pubkey, secretKey };
      // never hand out a key because the file said so: it must derive its address and end in burn
      const problem = groundMintProblem(k, this.suffixes);
      if (problem) { this.discard([r.pubkey]); throw new MintBankRefusal(`A key in the mint bank failed its check (${problem}), so it was deleted.`); }
      return k;
    });
  }

  discard(pubkeys: readonly string[]): void {
    const del = this.db.prepare("DELETE FROM keys WHERE pubkey = ? AND mint_created_at IS NULL");
    for (const p of pubkeys) del.run(p);
  }

  markCreated(pubkey: string, now = Date.now()): boolean {
    const r = this.db.prepare("UPDATE keys SET mint_created_at = ?, ciphertext = X'' WHERE pubkey = ? AND taken_at IS NOT NULL AND mint_created_at IS NULL").run(now, pubkey);
    return Number(r.changes) === 1;
  }

  /** Taken keys not seen created yet (the service asks the registry about each). */
  takenPending(): { pubkey: string; takenAt: number; takenFor: string | null }[] {
    return (this.db.prepare("SELECT pubkey, taken_at AS takenAt, taken_for AS takenFor FROM keys WHERE taken_at IS NOT NULL AND mint_created_at IS NULL ORDER BY taken_at").all() as { pubkey: string; takenAt: number; takenFor: string | null }[]);
  }

  /** Deletes every key taken more than 24 hours ago whose mint was never seen created. Returns how many. */
  sweep(now = Date.now()): number {
    return Number(this.db.prepare("DELETE FROM keys WHERE taken_at IS NOT NULL AND mint_created_at IS NULL AND taken_at < ?").run(now - MINT_BANK_TAKEN_TTL_MS).changes);
  }

  status(): MintBankStatus {
    const g = (sql: string) => (this.db.prepare(sql).get() as { n: number | null }).n;
    const low = this.db.prepare("SELECT v FROM meta WHERE k='low_since'").get() as { v: string } | undefined;
    return {
      ready: g("SELECT COUNT(*) AS n FROM keys WHERE taken_at IS NULL") ?? 0,
      taken: g("SELECT COUNT(*) AS n FROM keys WHERE taken_at IS NOT NULL AND mint_created_at IS NULL") ?? 0,
      created: g("SELECT COUNT(*) AS n FROM keys WHERE mint_created_at IS NOT NULL") ?? 0,
      oldestReadyAt: g("SELECT MIN(created_at) AS n FROM keys WHERE taken_at IS NULL"),
      lowSince: low ? Number(low.v) : null,
    };
  }

  /**
   * Records when the bank went below `low` (cleared once it is back at or above it). Returns the alert to record when it has stayed
   * below for more than an hour, at most once per low spell.
   */
  lowCheck(low: number, now = Date.now()): { kind: string; key: string; text: string } | null {
    const s = this.status();
    if (s.ready >= low) { this.db.prepare("DELETE FROM meta WHERE k IN ('low_since', 'low_alerted')").run(); return null; }
    const since = s.lowSince ?? now;
    if (s.lowSince === null) this.db.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('low_since', ?)").run(String(now));
    if (now - since <= MINT_BANK_LOW_ALERT_MS) return null;
    if (this.db.prepare("SELECT v FROM meta WHERE k='low_alerted'").get()) return null;
    this.db.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('low_alerted', ?)").run(String(now));
    const mins = Math.round((now - since) / 60_000);
    return { kind: MINT_BANK_LOW_ALERT_KIND, key: `mint-bank-low:${since}`, text: `The mint key bank has ${s.ready} prepared address${s.ready === 1 ? "" : "es"}, below its low mark of ${low}, and has been for ${mins} minutes. Launches still work: when it is empty each creator's browser finds the address instead, which takes about a minute.` };
  }

  close(): void { try { this.db.close(); } catch { /* closed */ } }
}

/** chmod 600 and refuse a file that belongs to someone else (the app user owns the bank). */
function lockDown(file: string) {
  const st = fs.statSync(file);
  if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw new MintBankRefusal(`The mint key bank ${file} belongs to another user, so it is refused.`);
  if ((st.mode & 0o777) !== 0o600) fs.chmodSync(file, 0o600);
}

/**
 * One housekeeping pass of the bank service: mark the taken keys whose mint the registry shows live, delete the ones past 24 hours,
 * check the low mark, and say how many keys to grind (to SIZE once the bank is below LOW, or still filling toward SIZE).
 */
export function bankHousekeeping(bank: MintBank, o: { size: number; low: number; now: number; isLive: (pubkey: string) => boolean; filling: boolean }): { created: number; swept: number; alert: { kind: string; key: string; text: string } | null; need: number; filling: boolean } {
  let created = 0;
  for (const t of bank.takenPending()) { let live = false; try { live = o.isLive(t.pubkey); } catch { live = false; } if (live && bank.markCreated(t.pubkey, o.now)) created++; }
  const swept = bank.sweep(o.now);
  const alert = bank.lowCheck(o.low, o.now);
  const ready = bank.status().ready;
  const filling = ready < o.low || (o.filling && ready < o.size);
  return { created, swept, alert, need: filling ? Math.max(0, o.size - ready) : 0, filling };
}

/** The bank's settings from the environment (names only; values are never printed). */
export function mintBankSettings(env: Readonly<Record<string, string | undefined>>): { path: string; size: number; low: number; key: string | undefined } {
  const int = (v: string | undefined, d: number) => { const x = Number(v); return Number.isInteger(x) && x > 0 ? x : d; };
  const size = int(env.BURNTICKER_MINT_BANK_SIZE, MINT_BANK_DEFAULT_SIZE);
  return { path: (env.BURNTICKER_MINT_BANK_PATH ?? "").trim() || MINT_BANK_DEFAULT_PATH, size, low: Math.min(size, int(env.BURNTICKER_MINT_BANK_LOW, MINT_BANK_DEFAULT_LOW)), key: env.BURNTICKER_MINT_BANK_KEY };
}

let webBank: { bank: MintBank | null; at: number } | null = null;
/**
 * The web host's handle on the bank: opened lazily, never created here (the bank service creates it), and null when the host has no
 * key or no file yet, so the launch answers mint-bank-empty and the page finds the address itself. A failed open is tried again a
 * minute later.
 */
export function webMintBank(env: Readonly<Record<string, string | undefined>> = process.env, now = Date.now()): MintBankPort | null {
  if (webBank && (webBank.bank || now - webBank.at < 60_000)) return webBank.bank;
  const s = mintBankSettings(env);
  let bank: MintBank | null = null;
  try { if (s.key) bank = new MintBank(s.path, { key: s.key, create: false }); } catch { bank = null; }
  webBank = { bank, at: now };
  return bank;
}

/** The 64-byte secret as the bundle's base58 `mintSecretKey` (signPlan.ts reads it). */
export const bankSecretBase58 = (k: GroundMint): string => base58(k.secretKey);
