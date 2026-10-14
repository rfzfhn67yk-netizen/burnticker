import { Keypair } from "@solana/web3.js";

/**
 * MINT ADDRESSES THAT END IN burn (owner, 2026-10-14). Every coin launched from the site gets a mint whose last four base58 characters
 * are `burn` or `BURN`. The key is ground IN THE BROWSER, in Web Workers (src/app/burnticker/launch/vanity.worker.ts), and only its
 * PUBLIC key is sent to the launch route; the secret goes from the worker to the page and from the page into the wallet's transaction,
 * never to a server. Coins created before 2026-10-14 ($DEFICIT, REHEARSAL, $PHINFLWIN) have plain addresses and are never described
 * as ending in burn: the coin page's line is shown only when the coin's own mint matches.
 *
 * Cost: a suffix of four base58 characters is one hit in 58^4 ≈ 11.3M keys; accepting both spellings halves that to ≈ 5.66M. A key is a
 * seed → SHA-512 → scalar × G, so nothing cheaper than a full key generation per try exists for keys a normal wallet can sign with.
 * The worker uses the browser's own Ed25519 (WebCrypto, native code) when it has it and @solana/web3.js's JS otherwise.
 *
 * This file is pure apart from the default key generator: the matcher, the residue check, the deterministic grinder (injected RNG), the
 * worker's loop over an injected scope, and the pool that runs N workers and keeps a small bank of found keys.
 */

// relative with its extension so scripts/burnticker-grind-mint.mts loads this file without the alias hook
import { MINT_SUFFIXES, matchesSuffix } from "./mintSuffix.ts";
export { MINT_SUFFIXES, MINT_SUFFIX_RE, SKIP_AFTER_MS, matchesSuffix } from "./mintSuffix.ts";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58(bytes: Uint8Array): string {
  let zeros = 0; while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  return "1".repeat(zeros) + digits.reverse().map((d) => B58[d]).join("");
}

/** The value of a base58 suffix as a number (its digits, most significant first). */
export function suffixResidue(suffix: string): number {
  let v = 0;
  for (const ch of suffix) { const d = B58.indexOf(ch); if (d < 0) throw new Error(`"${ch}" is not a base58 character`); v = v * 58 + d; }
  return v;
}

/** The public key read as a big-endian integer, mod 58^k: its last k base58 digits, without encoding the whole key. */
export function tailResidue(pub: Uint8Array, k = 4): number {
  const m = 58 ** k;
  let r = 0;
  for (let i = 0; i < pub.length; i++) r = (r * 256 + pub[i]) % m;
  return r;
}

/** The residues a key's tail must equal for one of the suffixes (all suffixes the same length). */
export function suffixTargets(suffixes: readonly string[] = MINT_SUFFIXES): { k: number; residues: Set<number> } {
  const k = suffixes[0]?.length ?? 0;
  if (!k || suffixes.some((s) => s.length !== k)) throw new Error("the suffixes must be non-empty and the same length");
  return { k, residues: new Set(suffixes.map(suffixResidue)) };
}

/** Expected tries per hit: 58^k over the number of distinct suffixes (≈ 5.66M for burn / BURN). */
export function expectedTries(suffixes: readonly string[] = MINT_SUFFIXES): number {
  const t = suffixTargets(suffixes);
  return 58 ** t.k / t.residues.size;
}

export type Rng = (n: number) => Uint8Array;
export interface GroundMint { publicKey: string; secretKey: Uint8Array; plain?: boolean }
export type Keygen = (seed: Uint8Array) => { publicKey: Uint8Array; secretKey: Uint8Array };

/** The standard Solana keypair for a 32-byte seed (secretKey = seed ‖ public key), as every wallet and web3.js sign with it. */
export const seedKeypair: Keygen = (seed) => { const kp = Keypair.fromSeed(seed); return { publicKey: kp.publicKey.toBytes(), secretKey: kp.secretKey }; };

/**
 * Up to `batch` tries; the first key whose address ends in one of the suffixes, or null. Deterministic under an injected `rng` (each try
 * takes rng(32) as its seed). The cheap residue check runs first; a candidate is confirmed on its real base58 string.
 */
export function grindMint(o: { suffix?: string | readonly string[]; batch: number; rng: Rng; keygen?: Keygen }): { found: GroundMint | null; tries: number } {
  const suffixes = o.suffix === undefined ? MINT_SUFFIXES : typeof o.suffix === "string" ? [o.suffix] : o.suffix;
  const { k, residues } = suffixTargets(suffixes);
  const keygen = o.keygen ?? seedKeypair;
  for (let i = 0; i < o.batch; i++) {
    const kp = keygen(o.rng(32));
    if (!residues.has(tailResidue(kp.publicKey, k))) continue;
    const pub = base58(kp.publicKey);
    if (suffixes.some((s) => pub.endsWith(s))) return { found: { publicKey: pub, secretKey: kp.secretKey }, tries: i + 1 };
  }
  return { found: null, tries: o.batch };
}

/** A plain fresh mint (the "Use a plain address instead" escape hatch), made in the page; it never leaves the browser either. */
export function plainMint(): GroundMint {
  const kp = Keypair.generate();
  return { publicKey: kp.publicKey.toBase58(), secretKey: kp.secretKey, plain: true };
}

/** The base58 64-byte secret the signing plan holds (signPlan.ts keys). */
export const secretBase58 = (m: GroundMint): string => base58(m.secretKey);

/**
 * Null when the key is sound: 64 bytes whose seed derives the public key it names, and (unless it is a plain escape-hatch key) an
 * address that ends in burn or BURN. Run on every key a worker hands back, before it is banked.
 */
export function groundMintProblem(m: { publicKey: string; secretKey: Uint8Array; plain?: boolean }, suffixes: readonly string[] = MINT_SUFFIXES): string | null {
  if (!(m.secretKey instanceof Uint8Array) || m.secretKey.length !== 64) return "the key is not 64 bytes";
  let derived: string;
  try { derived = Keypair.fromSeed(m.secretKey.slice(0, 32)).publicKey.toBase58(); } catch { return "the key could not be read"; }
  if (derived !== m.publicKey || base58(m.secretKey.slice(32)) !== m.publicKey) return "the key does not match its address";
  if (!m.plain && !(suffixes === MINT_SUFFIXES ? matchesSuffix(m.publicKey) : suffixes.some((x) => m.publicKey.endsWith(x)))) return "the address does not end in burn or BURN";
  return null;
}

// ---- WebCrypto Ed25519 (the fast engine) ------------------------------------------------------------------------------------------

/** RFC 8410 PKCS#8 for an Ed25519 private key: this 16-byte prefix, then the 32-byte seed. */
const PKCS8_PREFIX = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
export function seedFromPkcs8(der: ArrayBuffer | Uint8Array): Uint8Array {
  const b = der instanceof Uint8Array ? der : new Uint8Array(der);
  if (b.length !== 48 || PKCS8_PREFIX.some((x, i) => b[i] !== x)) throw new Error("not an Ed25519 PKCS#8 key");
  return b.slice(16);
}

export interface SubtleLike {
  generateKey(alg: { name: string }, extractable: boolean, usages: string[]): Promise<unknown>;
  exportKey(format: "raw" | "pkcs8", key: unknown): Promise<ArrayBuffer>;
}

// ---- the worker protocol ----------------------------------------------------------------------------------------------------------

export type ToWorker = { type: "start"; suffixes: string[]; engine?: "auto" | "js" } | { type: "stop" };
export type FromWorker =
  | { type: "engine"; engine: "webcrypto" | "js" }
  | { type: "progress"; tries: number }
  | { type: "found"; publicKey: string; secretKey: Uint8Array; tries: number }
  | { type: "error"; message: string };

/** What the worker loop needs from its global scope (a real DedicatedWorkerGlobalScope, or a fake in the tests). */
export interface WorkerScopeLike {
  postMessage(m: FromWorker): void;
  onmessage: ((e: { data: ToWorker }) => void) | null;
}
export interface WorkerLoopDeps {
  subtle?: SubtleLike | null;
  randomBytes: (n: number) => Uint8Array;
  now: () => number;
  /** lets the message queue run between batches (setTimeout 0 in a worker) */
  pause: () => Promise<void>;
  /** progress messages at most this often (ms) */
  progressMs?: number;
}

/** Can this scope make Ed25519 keys natively? (Chrome 137+, Safari 17+, Firefox 129+.) One real key, exported both ways. */
export async function webcryptoEd25519Works(subtle: SubtleLike | null | undefined): Promise<boolean> {
  if (!subtle) return false;
  try {
    const kp = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as { privateKey: unknown; publicKey: unknown };
    const [der, raw] = await Promise.all([subtle.exportKey("pkcs8", kp.privateKey), subtle.exportKey("raw", kp.publicKey)]);
    const seed = seedFromPkcs8(der);
    return base58(new Uint8Array(raw)) === Keypair.fromSeed(seed).publicKey.toBase58();
  } catch { return false; }
}

/**
 * The worker's whole life: wait for `start`, grind until `stop`, posting `progress` (cumulative tries) a few times a second and `found`
 * (the 64-byte secret and its address, checked) for every hit; it keeps going after a hit until told to stop (a pair needs two).
 */
export function runGrindWorker(scope: WorkerScopeLike, deps: WorkerLoopDeps): void {
  let running = false, gen = 0;
  const every = deps.progressMs ?? 200;
  scope.onmessage = (e) => {
    const m = e.data;
    if (m?.type === "stop") { running = false; gen++; return; }
    if (m?.type !== "start" || running) return;
    running = true;
    const my = ++gen;
    void loop(my, m.suffixes, m.engine ?? "auto").catch((err) => { running = false; scope.postMessage({ type: "error", message: String((err as Error)?.message ?? err).slice(0, 200) }); });
  };
  const live = (my: number) => running && gen === my;
  async function loop(my: number, suffixes: string[], want: "auto" | "js") {
    const { k, residues } = suffixTargets(suffixes);
    const engine = want === "auto" && await webcryptoEd25519Works(deps.subtle) ? "webcrypto" : "js";
    scope.postMessage({ type: "engine", engine });
    let tries = 0, lastPost = deps.now();
    const hit = (pub: Uint8Array, secret: Uint8Array) => {
      const m = { publicKey: base58(pub), secretKey: secret };
      if (!groundMintProblem(m, suffixes)) scope.postMessage({ type: "found", ...m, tries });
    };
    while (live(my)) {
      if (engine === "webcrypto") {
        const subtle = deps.subtle!;
        const batch = await Promise.all(Array.from({ length: 128 }, async () => {
          const kp = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as { privateKey: unknown; publicKey: unknown };
          const raw = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
          if (!residues.has(tailResidue(raw, k))) return null;
          return { raw, der: await subtle.exportKey("pkcs8", kp.privateKey) };
        }));
        if (!live(my)) break;   // stopped while the batch ran: nothing more is posted
        tries += batch.length;
        for (const b of batch) {
          if (!b) continue;
          const seed = seedFromPkcs8(b.der), secret = new Uint8Array(64);
          secret.set(seed, 0); secret.set(b.raw, 32);
          hit(b.raw, secret);
        }
      } else {
        const r = grindMint({ suffix: suffixes, batch: 500, rng: deps.randomBytes });
        tries += r.tries;
        if (r.found && !groundMintProblem(r.found, suffixes)) scope.postMessage({ type: "found", ...r.found, tries });
      }
      if (deps.now() - lastPost >= every) { lastPost = deps.now(); scope.postMessage({ type: "progress", tries }); }
      await deps.pause();
    }
    scope.postMessage({ type: "progress", tries });
  }
}

/** How many searches run at once: every core but one, so the page itself stays quick (at least one, at most 16). */
export function mintWorkerCount(cores: number | undefined): number {
  return Math.max(1, Math.min(16, (cores && cores > 0 ? cores : 4) - 1));
}

// ---- the pool (the page side) -----------------------------------------------------------------------------------------------------

export interface WorkerLike {
  postMessage(m: ToWorker): void;
  terminate(): void;
  onmessage: ((e: { data: FromWorker }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export interface GrindSnapshot {
  /** keys tried in this search, all workers together */
  tries: number;
  /** ms since this search started (0 when idle) */
  elapsedMs: number;
  workers: number;
  engine: "webcrypto" | "js" | null;
  /** addresses wanted / found and ready */
  wanted: number;
  found: number;
  running: boolean;
  /** the found addresses, in the order they will be used */
  addresses: string[];
  /** a plain address was chosen for the rest */
  plain: boolean;
  /** the workers could not run (no Worker support, a crash): the plain address is the way on */
  failed: string | null;
}


/**
 * Runs `workers` grinders and keeps a bank of found keys. `ensure(n)` resolves with the first n banked keys once there are n (starting
 * the workers when short); `consume(pub)` drops a key the server has registered a draft for (a refused request leaves its key banked, so
 * the next press does not search again); `skip()` fills the rest with plain keys. Keys live only in this object (page memory).
 */
export class MintGrindPool {
  private bank: GroundMint[] = [];
  private target = 0;
  private live: { w: WorkerLike; tries: number }[] = [];
  private triesDone = 0;
  private startedAt = 0;
  private engine: "webcrypto" | "js" | null = null;
  private failed: string | null = null;
  private plain = false;
  private waiters: { n: number; resolve: (k: GroundMint[]) => void }[] = [];
  private listeners = new Set<() => void>();
  private o: { makeWorker: () => WorkerLike; workers: number; now?: () => number; suffixes?: readonly string[] };
  constructor(o: { makeWorker: () => WorkerLike; workers: number; now?: () => number; suffixes?: readonly string[] }) { this.o = o; }

  private now() { return (this.o.now ?? Date.now)(); }
  get running(): boolean { return this.live.length > 0; }

  snapshot(): GrindSnapshot {
    return {
      tries: this.triesDone + this.live.reduce((s, x) => s + x.tries, 0), elapsedMs: this.startedAt ? this.now() - this.startedAt : 0,
      workers: this.live.length, engine: this.engine, wanted: this.target, found: this.bank.length, running: this.running,
      addresses: this.bank.map((k) => k.publicKey), plain: this.plain, failed: this.failed,
    };
  }
  subscribe(f: () => void): () => void { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
  private emit() { for (const f of this.listeners) f(); }

  ensure(n: number): Promise<GroundMint[]> {
    this.target = Math.max(this.target, n);
    const p = new Promise<GroundMint[]>((resolve) => this.waiters.push({ n, resolve }));
    this.settle();
    if (this.bank.length < this.target && !this.running && !this.failed) this.start();
    this.emit();
    return p;
  }

  /** The server registered a draft for this mint: the key is spoken for. */
  consume(publicKey: string): void {
    const before = this.bank.length;
    this.bank = this.bank.filter((k) => k.publicKey !== publicKey);
    if (this.bank.length !== before) this.target = Math.max(0, this.target - 1);
    this.emit();
  }

  /** "Use a plain address instead": stop searching and fill what is missing with fresh plain keys. */
  skip(): void {
    this.stop();
    while (this.bank.length < this.target) this.bank.push(plainMint());
    this.plain = true;
    this.settle(); this.emit();
  }

  dispose(): void { this.stop(); this.waiters = []; this.listeners.clear(); }

  private start() {
    this.triesDone = 0; this.startedAt = this.now(); this.plain = false;
    for (let i = 0; i < Math.max(1, this.o.workers); i++) {
      let w: WorkerLike;
      try { w = this.o.makeWorker(); } catch (e) { this.fail(String((e as Error)?.message ?? e)); return; }
      const slot = { w, tries: 0 };
      w.onmessage = (e) => this.onMessage(slot, e.data);
      w.onerror = () => this.fail("an address search stopped unexpectedly");
      this.live.push(slot);
      w.postMessage({ type: "start", suffixes: [...(this.o.suffixes ?? MINT_SUFFIXES)] });
    }
  }

  private stop() {
    for (const s of this.live) { this.triesDone += s.tries; try { s.w.postMessage({ type: "stop" }); s.w.terminate(); } catch { /* gone */ } }
    this.live = [];
  }

  private fail(why: string) { this.stop(); this.failed = why; this.emit(); }

  private onMessage(slot: { w: WorkerLike; tries: number }, m: FromWorker) {
    if (!this.live.includes(slot)) return;
    if (m.type === "engine") this.engine = m.engine;
    else if (m.type === "progress") slot.tries = m.tries;
    else if (m.type === "error") { this.fail(m.message); return; }
    else if (m.type === "found") {
      slot.tries = Math.max(slot.tries, m.tries);
      const k = { publicKey: m.publicKey, secretKey: new Uint8Array(m.secretKey) };
      // never trust a key because a worker said so: it must derive its address and end in burn
      if (!groundMintProblem(k, this.o.suffixes ?? MINT_SUFFIXES) && !this.bank.some((x) => x.publicKey === k.publicKey) && this.bank.length < this.target) this.bank.push(k);
      if (this.bank.length >= this.target) this.stop();
      this.settle();
    }
    this.emit();
  }

  private settle() {
    const still: typeof this.waiters = [];
    for (const w of this.waiters) { if (this.bank.length >= w.n) w.resolve(this.bank.slice(0, w.n)); else still.push(w); }
    this.waiters = still;
  }
}

/**
 * The prepared bundle must name the mint this page made. Returns the bundle with the page's own secret attached (the server never had
 * it), or throws a plain sentence when the server built for some other mint: nothing is signed then.
 */
export function withLocalKey<T extends { mint: string; mintSecretKey: string | null }>(bundle: T, key: GroundMint): T {
  if (bundle.mint !== key.publicKey) throw new Error(MINT_MISMATCH_LINE);
  return { ...bundle, mintSecretKey: secretBase58(key) };
}

export const MINT_MISMATCH_LINE = "The prepared launch did not use the address this page made, so nothing was signed. Please press Launch again.";
