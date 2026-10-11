import crypto from "node:crypto";
import { PublicKey, type Connection } from "@solana/web3.js";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { decodeType } from "@/lib/burnReceipts/idlCoder";
import { configPda } from "@/lib/burnReceipts/pda";
import type { ApiTransport } from "./http.ts";
import type { BurntickerEvent, ProgramEvent, ReceiptJson, Receipts } from "./types.ts";

/**
 * EVENTS. burn_receipts emits an Anchor event for every state change through `emit_cpi!` — a self-CPI whose instruction data is the
 * 8-byte event tag, the event's discriminator and the borsh fields (inner-instruction data, which logs cannot truncate): TokenInitialized,
 * PoolRegistered, ReadingSubmitted, ReadingProcessed (a burn, a below-floor skip, a vault burn…), BurnPoolCapBound, the attester and
 * cap governance events. subscribe() watches one mint's TokenConfig address:
 *
 *   chain mode   (a connection + the program id) — every new confirmed transaction touching the config is fetched and its events decoded
 *                from the inner instructions; with `websocket: true` a logs subscription triggers the fetch at once, and polling stays on
 *                as the fallback (a dropped websocket loses nothing, the cursor is the last signature seen);
 *   API mode     (no connection) — polls the public API's receipts for the token and emits ReceiptNew / ReceiptUpdated.
 *
 * Polls never overlap; errors go to onError and the next poll retries.
 */

/**
 * The first 8 bytes of every emit_cpi event instruction: Anchor's EVENT_IX_TAG (0x1d9acb512ea545e4) in little-endian, e4 45 a5 2e 51 cb
 * 9a 1d. Anchor reads sha256("anchor:event")[0..8] as a big-endian u64 and writes it little-endian, so the wire bytes are that hash
 * prefix REVERSED (the same prefix every Anchor program's CPI events carry, e.g. pump.fun's TradeEvent: e445a52e51cb9a1d bddb7fd3…).
 */
const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

export const EVENT_IX_TAG = Buffer.from(crypto.createHash("sha256").update("anchor:event").digest().subarray(0, 8)).reverse();

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** base58 → bytes (instruction data in getTransaction's JSON is base58). */
export function base58Decode(s: string): Uint8Array {
  let x = BigInt(0);
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error("not base58"); x = x * BigInt(58) + BigInt(i); }
  let hex = x.toString(16); if (hex.length % 2) hex = `0${hex}`;
  const body = x === BigInt(0) ? Buffer.alloc(0) : Buffer.from(hex, "hex");
  let zeros = 0; for (const c of s) { if (c !== "1") break; zeros++; }
  return new Uint8Array(Buffer.concat([Buffer.alloc(zeros), body]));
}

/** Decodes one emit_cpi instruction's data into { name, data }; null when it is not a burn_receipts event. */
export function decodeEventData(data: Uint8Array): { name: string; data: Record<string, unknown> } | null {
  const b = Buffer.from(data);
  if (b.length < 16 || !b.subarray(0, 8).equals(EVENT_IX_TAG)) return null;
  const disc = b.subarray(8, 16);
  const ev = BURN_RECEIPTS_IDL.events.find((e) => Buffer.from(e.discriminator).equals(disc));
  if (!ev) return null;
  try { return { name: ev.name, data: decodeType(BURN_RECEIPTS_IDL, { defined: { name: ev.name } }, b, 16).value as Record<string, unknown> }; } catch { return { name: ev.name, data: { undecoded: b.subarray(16).toString("base64") } }; }
}

interface TxLike {
  slot: number; blockTime?: number | null;
  meta: { err: unknown; logMessages?: string[] | null; innerInstructions?: { index: number; instructions: { programIdIndex: number; data: string }[] }[] | null; loadedAddresses?: unknown } | null;
  transaction: { message: { getAccountKeys(o?: unknown): { get(i: number): PublicKey | undefined } } };
}

/** Every burn_receipts event in a confirmed transaction (inner instructions to the program carrying the event tag). */
export function eventsFromTransaction(tx: TxLike, programId: PublicKey, signature: string): ProgramEvent[] {
  if (!tx.meta || tx.meta.err) return [];
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses ?? undefined });
  const out: ProgramEvent[] = [];
  for (const group of tx.meta.innerInstructions ?? []) {
    // Review N3: the memo is the Memo CPI made inside the same instruction as the event (the program's own), never the first memo
    // line in the logs — any Memo instruction elsewhere in the transaction logs the same line.
    let memo: string | null = null;
    for (const ix of group.instructions) {
      if (keys.get(ix.programIdIndex)?.toBase58() !== MEMO_PROGRAM_ID) continue;
      try { memo = Buffer.from(base58Decode(ix.data)).toString("utf8"); } catch { memo = null; }
      break;
    }
    for (const ix of group.instructions) {
      if (!keys.get(ix.programIdIndex)?.equals(programId)) continue;
      let bytes: Uint8Array; try { bytes = base58Decode(ix.data); } catch { continue; }
      const ev = decodeEventData(bytes);
      if (ev) out.push({ kind: "program", name: ev.name, data: ev.data, signature, slot: tx.slot, blockTime: tx.blockTime ?? null, memo });
    }
  }
  return out;
}

export interface SubscribeOptions {
  /** Chain mode: a Solana connection and the deployed burn_receipts program id. */
  connection?: Connection; programId?: PublicKey | string;
  /** API mode (no connection): the transport and the token's ticker (or mint). */
  api?: ApiTransport; ticker?: string;
  /** Poll interval, ms (default 15 s; with websocket the poll runs at 4× this as the fallback). */
  pollMs?: number;
  /** Chain mode: trigger fetches from a logs subscription as well (default false: polling only). */
  websocket?: boolean;
  /** "now" (default): only events after subscribing. "recent": replay the last `replay` transactions / the current receipts first. */
  since?: "now" | "recent"; replay?: number;
  onError?: (e: Error) => void;
}

export interface Subscription { stop(): void; /** Resolves after the first poll (the cursor is set). */ ready: Promise<void>; /** Run one poll now. */ poll(): Promise<void> }

export function subscribe(mint: PublicKey | string, onEvent: (e: BurntickerEvent) => void, o: SubscribeOptions): Subscription {
  const pollMs = o.pollMs ?? 15_000;
  const onError = o.onError ?? (() => {});
  let stopped = false, running: Promise<void> | null = null, timer: ReturnType<typeof setInterval> | null = null, wsId: number | null = null;
  let tick: () => Promise<void>;
  if (o.connection && o.programId) {
    const connection = o.connection, programId = new PublicKey(o.programId);
    const address = configPda(programId, new PublicKey(mint));
    let cursor: string | null | undefined;   // undefined = not initialised
    tick = async () => {
      if (cursor === undefined) {
        const recent = await connection.getSignaturesForAddress(address, { limit: o.since === "recent" ? o.replay ?? 20 : 1 }, "confirmed");
        if (o.since !== "recent") { cursor = recent[0]?.signature ?? null; return; }
        cursor = null;
      }
      const sigs = await connection.getSignaturesForAddress(address, { limit: 100, ...(cursor ? { until: cursor } : {}) }, "confirmed");
      for (const s of [...sigs].reverse()) {
        if (stopped) return;
        if (!s.err) {
          const tx = await connection.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
          if (tx) for (const ev of eventsFromTransaction(tx as unknown as TxLike, programId, s.signature)) onEvent(ev);
        }
        cursor = s.signature;
      }
    };
    if (o.websocket) { try { wsId = connection.onLogs(address, () => { void run(); }, "confirmed"); } catch (e) { onError(e as Error); } }
  } else if (o.api) {
    const api = o.api, id = o.ticker ?? (typeof mint === "string" ? mint : mint.toBase58());
    let seen: Map<string, string> | null = null;
    const keyOf = (r: ReceiptJson) => `${r.status}|${r.signature ?? ""}`;
    tick = async () => {
      const res = await api.get<Receipts>(`/tokens/${encodeURIComponent(id)}/receipts`);
      if (seen === null && o.since !== "recent") { seen = new Map(res.receipts.map((r) => [r.eventId, keyOf(r)])); return; }
      seen ??= new Map();
      for (const r of res.receipts) {
        const prev = seen.get(r.eventId);
        if (prev === keyOf(r)) continue;
        seen.set(r.eventId, keyOf(r));
        onEvent({ kind: "receipt", name: prev === undefined ? "ReceiptNew" : "ReceiptUpdated", receipt: r, ticker: res.ticker });
      }
    };
  } else throw new Error("burnticker.subscribe: pass { connection, programId } (chain events) or { api, ticker } (receipts polling)");
  const run = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running) return running;
    running = tick().catch((e: Error) => onError(e)).finally(() => { running = null; });
    return running;
  };
  const ready = run();
  timer = setInterval(() => { void run(); }, o.websocket ? pollMs * 4 : pollMs);
  return {
    ready, poll: run,
    stop() { stopped = true; if (timer) clearInterval(timer); if (wsId !== null && o.connection) void o.connection.removeOnLogsListener(wsId).catch(() => {}); },
  };
}
