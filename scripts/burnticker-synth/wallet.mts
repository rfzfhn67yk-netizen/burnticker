// THE SYNTHETIC CREATOR'S TEST WALLET (2026-10-15; scripts/burnticker-synthetic-creator.mts). Private ops: never in the public tree.
//
// The browser half (walletShimSource) is injected before any page script runs. It registers a Wallet Standard wallet named "Phantom"
// (the launch page's WalletProvider takes wallets={[]} and discovers wallets only through the Wallet Standard) and also sets
// window.phantom.solana / window.solana with the legacy connect / disconnect / signTransaction / signAllTransactions / signMessage
// methods, so either discovery path finds it. Every signature request crosses to Node (page.exposeFunction), where this module holds the
// devnet keypair and applies the wallet's MODE to the transaction before signing it:
//
//   plain       signs the transaction as handed
//   lighthouse  what Phantom does: appends one or two Lighthouse assertion instructions (program L2TExM…) with no new signer and, in
//               half the cases, puts a compute-budget instruction at the FRONT, then signs. The page must accept this.
//   slow        waits (default 50 s, past the page's 45 s stale-blockhash line) and then signs as handed
//   reject      refuses ("User rejected the request.")
//   tamper      changes one byte of an instruction's data, then signs. The page must refuse it with its integrity sentence.
import { ComputeBudgetProgram, Keypair, PublicKey, VersionedTransaction, type MessageV0 } from "@solana/web3.js";
import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from "node:crypto";

/** Ed25519 verification of `sig` over `msg` by a 32-byte public key. */
export function ed25519Verify(msg: Uint8Array, sig: Uint8Array, publicKey: Uint8Array): boolean {
  try { return edVerify(null, Buffer.from(msg), createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey)]), format: "der", type: "spki" }), Buffer.from(sig)); } catch { return false; }
}

/** Ed25519 over `msg` with a Solana secret key (seed = its first 32 bytes), through node:crypto. */
export function ed25519Sign(msg: Uint8Array, secretKey: Uint8Array): Uint8Array {
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(secretKey.subarray(0, 32))]);
  return new Uint8Array(edSign(null, Buffer.from(msg), createPrivateKey({ key: der, format: "der", type: "pkcs8" })));
}

export type WalletMode = "plain" | "lighthouse" | "slow" | "reject" | "tamper";
export const WALLET_MODES: readonly WalletMode[] = ["plain", "lighthouse", "slow", "reject", "tamper"];
export const LIGHTHOUSE_PROGRAM = new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");
export const COMPUTE_BUDGET_PROGRAM = ComputeBudgetProgram.programId;
export const REJECT_MESSAGE = "User rejected the request.";
export const SLOW_DEFAULT_MS = 50_000;

/**
 * One Lighthouse assertion in the exact shape Phantom's guard sends on mainnet (read from landed transactions on 2026-10-15: instruction 6
 * on the fee payer, `06 <log> 0300 <u64> 04 03 00 00 01 00…`), with its amount zeroed so it always holds. Simulated on devnet with this
 * encoding: success, ~1,700 compute units. `variant` only sets the log-level byte, so two guards are not byte-identical.
 */
export function lighthouseAssertData(variant = 0): Uint8Array { return Uint8Array.from(Buffer.from(`06${variant === 1 ? "05" : "00"}0300000000000000000004030000010000000000000000000000`.slice(0, 52), "hex")); }

/** Adds `key` to the message's static keys as a read-only, unsigned account (the end of the static list) and returns its index. */
function staticReadonlyIndex(m: MessageV0, key: PublicKey): number {
  const have = m.staticAccountKeys.findIndex((k) => k.equals(key));
  if (have >= 0) return have;
  const at = m.staticAccountKeys.length;
  m.staticAccountKeys.push(key);
  m.header.numReadonlyUnsignedAccounts += 1;
  // lookup-table accounts are indexed after the static keys: every index at or past the old end moves up by one
  for (const ix of m.compiledInstructions) {
    if (ix.programIdIndex >= at) ix.programIdIndex += 1;
    ix.accountKeyIndexes = ix.accountKeyIndexes.map((i) => (i >= at ? i + 1 : i));
  }
  return at;
}

export interface ModeOptions { /** lighthouse: how many assertions (1 or 2) */ guards?: 1 | 2; /** lighthouse: a compute-budget instruction at the front */ computeFront?: boolean }
export interface ModeResult { tx: VersionedTransaction; note: string }

/** PURE (on a copy): the transaction as the wallet in `mode` would hand it back, before its signature. */
export function applyWalletMode(input: VersionedTransaction, mode: WalletMode, o: ModeOptions = {}): ModeResult {
  const tx = VersionedTransaction.deserialize(input.serialize());
  if (mode === "plain" || mode === "slow" || mode === "reject") return { tx, note: "unchanged" };
  if (tx.version !== 0) throw new Error("the synthetic wallet changes version-0 transactions only");
  const m = tx.message as MessageV0;
  if (mode === "tamper") {
    const target = m.compiledInstructions.findIndex((ix) => !m.staticAccountKeys[ix.programIdIndex]?.equals(COMPUTE_BUDGET_PROGRAM) && ix.data.length > 0);
    if (target < 0) throw new Error("no instruction with data to tamper with");
    const d = Uint8Array.from(m.compiledInstructions[target].data);
    d[d.length - 1] ^= 0x01;
    m.compiledInstructions[target] = { ...m.compiledInstructions[target], data: d };
    return { tx: new VersionedTransaction(m, tx.signatures), note: `flipped the last data byte of instruction ${target + 1}` };
  }
  // lighthouse: a wallet never hands back a transaction that cannot be sent, so what does not fit the 1,232-byte packet is left out (first
  // the compute-budget instruction, then the second assertion, then the first). On 2026-10-15 the launch step was ~1,100 bytes: one
  // assertion fits, two plus a compute-budget instruction (1,234 bytes) do not.
  for (const [g, cf] of [[o.guards ?? 1, !!o.computeFront], [o.guards ?? 1, false], [1, false]] as const) {
    let r: ModeResult | null = null, size = Infinity;
    try { r = lighthouseShape(input, g, cf); size = r.tx.serialize().length; } catch { size = Infinity; }   // web3 refuses to encode past the packet
    if (r && size <= PACKET_LIMIT) return r;
  }
  return { tx: VersionedTransaction.deserialize(input.serialize()), note: "no room for a Lighthouse assertion under the 1,232-byte limit, so the wallet left the transaction unchanged" };
}

export const PACKET_LIMIT = 1232;

function lighthouseShape(input: VersionedTransaction, guards: number, computeFront: boolean): ModeResult {
  const tx = VersionedTransaction.deserialize(input.serialize());
  const m = tx.message as MessageV0;
  const lh = staticReadonlyIndex(m, LIGHTHOUSE_PROGRAM);
  for (let g = 0; g < guards; g++) m.compiledInstructions.push({ programIdIndex: lh, accountKeyIndexes: [0], data: lighthouseAssertData(g) });
  let front = "no compute-budget instruction";
  if (computeFront) {
    const cb = staticReadonlyIndex(m, COMPUTE_BUDGET_PROGRAM);
    const kinds = new Set(m.compiledInstructions.filter((ix) => ix.programIdIndex === cb).map((ix) => ix.data[0]));
    // Phantom adds what the transaction lacks: a unit limit (2), else a unit price (3); a duplicate would fail on chain
    if (!kinds.has(2)) { const d = new Uint8Array(5); d[0] = 2; new DataView(d.buffer).setUint32(1, 400_000, true); m.compiledInstructions.unshift({ programIdIndex: cb, accountKeyIndexes: [], data: d }); front = "a compute-unit limit at the front"; }
    else if (!kinds.has(3)) { const d = new Uint8Array(9); d[0] = 3; new DataView(d.buffer).setBigUint64(1, BigInt(1_000), true); m.compiledInstructions.unshift({ programIdIndex: cb, accountKeyIndexes: [], data: d }); front = "a compute-unit price at the front"; }
  }
  // the message changed, so any signature already on it is void: the page signs its mint keys only after the wallet returns
  const sigs = tx.signatures.map(() => new Uint8Array(64));
  return { tx: new VersionedTransaction(m, sigs), note: `${guards} Lighthouse assertion${guards === 1 ? "" : "s"} appended, ${front}` };
}

/** Signs as the wallet: its own slot only (the fee payer's), leaving the mint slots for the page. */
export function walletSign(tx: VersionedTransaction, kp: Keypair): VersionedTransaction {
  const keys = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
  const at = keys.findIndex((k) => k.equals(kp.publicKey));
  if (at < 0) throw new Error("the transaction does not ask this wallet to sign");
  tx.signatures[at] = ed25519Sign(tx.message.serialize(), kp.secretKey);
  return tx;
}

export interface WalletCall { at: number; mode: WalletMode; note: string; blockhash: string | null; ok: boolean; error?: string }

/** The Node side of the shim: one per page. `mode` can be switched between scenarios; `queue` overrides the next calls one by one. */
export class SyntheticWallet {
  mode: WalletMode = "plain";
  queue: WalletMode[] = [];
  slowMs = SLOW_DEFAULT_MS;
  calls: WalletCall[] = [];
  private flip = 0;
  readonly keypair: Keypair;
  private readonly sleep: (ms: number) => Promise<void>;
  constructor(keypair: Keypair, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) { this.keypair = keypair; this.sleep = sleep; }
  get publicKey(): string { return this.keypair.publicKey.toBase58(); }
  /** base64 transaction in, base64 signed transaction out (or a thrown rejection) */
  async signBase64(b64: string): Promise<string> {
    const mode = this.queue.length ? this.queue.shift()! : this.mode;
    let tx: VersionedTransaction;
    try { tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64")); }
    catch (e) { this.calls.push({ at: Date.now(), mode, note: "not a version-0 transaction", blockhash: null, ok: false, error: String(e) }); throw new Error("the synthetic wallet signs version-0 transactions only"); }
    const blockhash = tx.message.recentBlockhash;
    if (mode === "reject") { this.calls.push({ at: Date.now(), mode, note: "rejected", blockhash, ok: false, error: REJECT_MESSAGE }); throw new Error(REJECT_MESSAGE); }
    if (mode === "slow") await this.sleep(this.slowMs);
    const n = this.flip++;
    const r = applyWalletMode(tx, mode, { guards: (n % 2 === 0 ? 1 : 2), computeFront: n % 2 === 1 });
    walletSign(r.tx, this.keypair);
    this.calls.push({ at: Date.now(), mode, note: mode === "slow" ? `waited ${Math.round(this.slowMs / 1000)} s, then signed as handed` : r.note, blockhash, ok: true });
    return Buffer.from(r.tx.serialize()).toString("base64");
  }
  signMessageBase64(b64: string): string { return Buffer.from(ed25519Sign(Buffer.from(b64, "base64"), this.keypair.secretKey)).toString("base64"); }
}

/**
 * The script injected before any page script. `__btSynthSign(base64)` and `__btSynthSignMessage(base64)` are exposed by Playwright.
 * Plain JavaScript (it runs in the page): no imports, base58 for the public key computed here.
 */
export function walletShimSource(publicKeyBase58: string, publicKeyBytes: Uint8Array, name = "Phantom"): string {
  return `(() => {
  const PK = ${JSON.stringify(publicKeyBase58)}, PKB = new Uint8Array(${JSON.stringify(Array.from(publicKeyBytes))});
  const b64 = (u8) => { let s = ""; for (const x of u8) s += String.fromCharCode(x); return btoa(s); };
  const unb64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
  const CHAINS = ["solana:devnet", "solana:testnet", "solana:localnet", "solana:mainnet"];
  const account = { address: PK, publicKey: PKB, chains: CHAINS, features: ["solana:signTransaction", "solana:signMessage"], label: "synthetic creator" };
  const listeners = { change: new Set() };
  let connected = false;
  const sign = async (bytes) => unb64(await window.__btSynthSign(b64(bytes)));
  const icon = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#ab9ff2"/></svg>');
  const wallet = {
    version: "1.0.0", name: ${JSON.stringify(name)}, icon, chains: CHAINS,
    get accounts() { return connected ? [account] : []; },
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => { connected = true; for (const l of listeners.change) l({ accounts: [account] }); return { accounts: [account] }; } },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => { connected = false; for (const l of listeners.change) l({ accounts: [] }); } },
      "standard:events": { version: "1.0.0", on: (ev, l) => { (listeners[ev] ||= new Set()).add(l); return () => listeners[ev].delete(l); } },
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: async (...inputs) => { const out = []; for (const i of inputs) out.push({ signedTransaction: await sign(i.transaction) }); return out; } },
      "solana:signMessage": { version: "1.0.0", signMessage: async (...inputs) => { const out = []; for (const i of inputs) out.push({ signedMessage: i.message, signature: unb64(await window.__btSynthSignMessage(b64(i.message))) }); return out; } },
    },
  };
  // the Wallet Standard handshake, both directions (an app that is already listening, and one that announces itself later)
  const register = (api) => { try { api.register(wallet); } catch (e) { console.warn("[synthetic wallet] register failed", e); } };
  try { window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { bubbles: false, cancelable: false, composed: false, detail: register })); } catch {}
  try { window.addEventListener("wallet-standard:app-ready", ({ detail: api }) => register(api)); } catch {}
  // the legacy injection Phantom also makes (window.phantom.solana / window.solana)
  const pkObj = { toBase58: () => PK, toString: () => PK, toBytes: () => PKB, toBuffer: () => PKB, equals: (o) => o && o.toBase58 && o.toBase58() === PK };
  const legacy = {
    isPhantom: true, publicKey: null, isConnected: false,
    connect: async () => { legacy.publicKey = pkObj; legacy.isConnected = true; return { publicKey: pkObj }; },
    disconnect: async () => { legacy.publicKey = null; legacy.isConnected = false; },
    signTransaction: async (tx) => { const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false }); const signed = await sign(bytes); return tx.constructor.deserialize ? tx.constructor.deserialize(signed) : signed; },
    signAllTransactions: async (txs) => { const out = []; for (const t of txs) out.push(await legacy.signTransaction(t)); return out; },
    signMessage: async (msg) => ({ signature: unb64(await window.__btSynthSignMessage(b64(msg))), publicKey: pkObj }),
    on: () => {}, off: () => {}, removeListener: () => {},
  };
  window.phantom = { solana: legacy }; window.solana = legacy; window.isPhantomInstalled = true;
})();`;
}
