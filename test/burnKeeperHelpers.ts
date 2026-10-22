// Shared pieces for the burn keeper tests (2026-10-09): the rule file in each mode, and a fake chain + fake router that behave like
// Solana for the keeper's purposes (balances, landed transactions, dropped sends, simulation refusals). Not a test file itself.
import fs from "node:fs";
import path from "node:path";
import { rulesFromText, tokensToRaw, type LoadedRules } from "@/lib/burnKeeper/rules";
import type { BuybackPort, ChainPort, SignedTx } from "@/lib/burnKeeper/cycle";

export const RULES_FILE = path.resolve(import.meta.dirname, "../config/burnkeeper/deficit.rules.json");
export const RULES_TEXT = fs.readFileSync(RULES_FILE, "utf8");

/** The committed file is buyback mode (the primary mechanic). */
export const buybackRules = (): LoadedRules => rulesFromText(RULES_TEXT);
/** The same file switched to vault mode (the alternative): mode, source and memo version follow. */
export const vaultRulesText = (text = RULES_TEXT): string => text.replace('"mode": "buyback"', '"mode": "vault"').replace('"source": "fee-pool-buyback"', '"source": "vault-only"').replace('"version": "v2"', '"version": "v1"');
export const vaultRules = (): LoadedRules => rulesFromText(vaultRulesText());

export const raw = (tokens: string) => tokensToRaw(tokens, 6);

/** A chain in memory: a token-account balance, a block height, landed transactions; knobs to drop sends and refuse simulations. */
export class FakeChain implements ChainPort {
  vault = raw("250000000");
  height = 100;
  landed = new Map<string, { memo: string; burnRaw: bigint; slot: number; kind: "burn" | "swap" }>();
  signed: { sig: string; memo: string; burnRaw: bigint; lvbh: number; kind: "burn" | "swap"; lamports?: bigint }[] = [];
  dropSends = false;
  simErr: string | null = null;
  n = 0;
  /** What a landed swap does to the world (set by FakeRouter). */
  onSwapLand: ((lamports: bigint, sig: string) => void) | null = null;
  async vaultBalanceRaw() { return this.vault; }
  async findMemoOnChain(key: string) {
    for (const [signature, t] of this.landed) if (t.kind === "burn" && t.memo.includes(key)) return { signature, slot: t.slot, memo: `[${t.memo.length}] ${t.memo}` };
    return null;
  }
  async signatureStatuses(sigs: string[]) { return sigs.map((s) => (this.landed.has(s) ? { slot: this.landed.get(s)!.slot, err: null, confirmed: true } : null)); }
  async blockHeight() { return this.height; }
  async buildSigned(burnRaw: bigint, memo: string): Promise<SignedTx> {
    const sig = `sig${++this.n}`;
    this.signed.push({ sig, memo, burnRaw, lvbh: this.height + 150, kind: "burn" });
    return { signature: sig, raw: new TextEncoder().encode(sig), blockhash: `bh${this.n}`, lastValidBlockHeight: this.height + 150 };
  }
  async simulate() { return { err: this.simErr, logs: this.simErr ? ["Program log: refused"] : [] }; }
  async send(rawTx: Uint8Array) {
    if (this.dropSends) return;
    const sig = new TextDecoder().decode(rawTx);
    const t = this.signed.find((s) => s.sig === sig)!;
    if (t.kind === "burn") {
      if (t.burnRaw > this.vault) throw new Error("insufficient funds");
      this.vault -= t.burnRaw;
    } else this.onSwapLand?.(t.lamports!, sig);
    this.landed.set(sig, { memo: t.memo, burnRaw: t.burnRaw, slot: 1000 + this.n, kind: t.kind });
  }
  async confirm(tx: SignedTx) { return this.landed.has(tx.signature) ? { status: "confirmed" as const, slot: this.landed.get(tx.signature)!.slot } : { status: "expired" as const }; }
}

/** A router + fee wallet in memory: buying at a fixed price (tokens per lamport), the delivery landing in the chain's token account. */
export class FakeRouter implements BuybackPort {
  fee = BigInt(5_000_000_000);   // 5 SOL
  price = 150;                    // SOL/USD
  tokensPerSol = raw("1000000");  // 1,000,000 tokens per SOL
  received = new Map<string, bigint>();
  private chain: FakeChain;
  constructor(chain: FakeChain) {
    this.chain = chain;
    chain.onSwapLand = (lamports, sig) => {
      const got = (lamports * this.tokensPerSol) / BigInt(1_000_000_000);
      this.fee -= lamports; this.chain.vault += got; this.received.set(sig, got);
    };
  }
  async feeBalanceLamports() { return this.fee; }
  async solUsd() { return this.price; }
  async buildSwap(lamports: bigint) {
    const sig = `swap${++this.chain.n}`.padEnd(24, "Z");   // base58-shaped, so the memo's swap=<sig12> is well-formed
    this.chain.signed.push({ sig, memo: "swap", burnRaw: BigInt(0), lvbh: this.chain.height + 300, kind: "swap", lamports });
    return { signature: sig, raw: new TextEncoder().encode(sig), blockhash: `bh${this.chain.n}`, lastValidBlockHeight: this.chain.height + 300, quotedOutRaw: (lamports * this.tokensPerSol) / BigInt(1_000_000_000) };
  }
  async swapReceivedRaw(signature: string) { return this.received.get(signature) ?? null; }
}
