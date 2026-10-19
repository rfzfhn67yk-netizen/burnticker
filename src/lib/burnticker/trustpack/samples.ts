import fs from "node:fs";
import path from "node:path";
import { demoSignature, readStatusFile } from "@/lib/burnticker/deficitPrelaunch";
import { PROGRAM_IDS, PUBLIC_RPC_URLS } from "@/lib/burnticker/networks";

/**
 * THE DEVNET RECEIPTS THE VERIFIER OFFERS (trust pack, 2026-10-10): every confirmed receipt of the 2026-10-10 rehearsals, read from the
 * evidence files (signatures checked against devnet by scripts/ops/verify-evidence-signatures.mjs), each with its token's published
 * rules file. The browser re-hashes the rules text and compares it with the on-chain TokenConfig, so serving it from here proves
 * nothing by itself — the chain decides.
 */

export const SAMPLE_SETS = [
  { ticker: "DEFICIT", evidence: "docs/burnkeeper/evidence/devnet-2026-10-10/burns.json", rules: "config/burnkeeper/deficit.devnet.rules.json" },
  { ticker: "PCA", evidence: "docs/burnkeeper/evidence/devnet-paircurve-2026-10-10/pca-burns.json", rules: "config/burnkeeper/paircurve-devnet-1a.rules.json" },
  { ticker: "PCB", evidence: "docs/burnkeeper/evidence/devnet-paircurve-2026-10-10/pcb-burns.json", rules: "config/burnkeeper/paircurve-devnet-1b.rules.json" },
] as const;

export interface SampleReceipt { ticker: string; recordDate: string; units: number; status: string; signature: string; memo: string; explorerUrl: string; evidence: string; rulesPath: string; rulesSha256: string | null }
/**
 * Continuous audit run 2, HB-26: what the public API serves. The receipts are labelled as devnet practice examples, and no repository path
 * leaves the server: each rules text is keyed by the coin's ticker ("DEFICIT.rules.json") and the evidence is named in words.
 */
export const DEVNET_EXAMPLE_NOTE = "These are practice receipts from the devnet rehearsal, offered as examples for the checker. They are not mainnet coins.";
export const DEVNET_EVIDENCE_WORDS = "the devnet rehearsal's published burn records";
export interface PublicSampleList extends Omit<SampleList, "receipts"> { example: true; note: string; receipts: SampleReceipt[] }
export const publicRulesKey = (ticker: string): string => `${ticker}.rules.json`;
export const publicSample = (r: SampleReceipt): SampleReceipt => ({ ...r, evidence: DEVNET_EVIDENCE_WORDS, rulesPath: publicRulesKey(r.ticker) });
export function publicSampleReceipts(l: SampleList): PublicSampleList {
  const rules: Record<string, string> = {};
  for (const r of l.receipts) if (l.rules[r.rulesPath] !== undefined) rules[publicRulesKey(r.ticker)] = l.rules[r.rulesPath];
  return { ...l, example: true, note: DEVNET_EXAMPLE_NOTE, receipts: l.receipts.map(publicSample), rules };
}

export interface SampleList { cluster: "devnet"; programId: string; rpc: string; receipts: SampleReceipt[]; rules: Record<string, string>; /** the featured receipt (config/burnticker/current-status.json `demo`), pre-selected by /burnticker/check?demo=1 */ featured: string | null }

/** The receipt verifier's program: the one per-network configuration (networks.ts, audit 4 BT-01) — the mint verifier reads the same. */
export const DEVNET_PROGRAM_ID = PROGRAM_IDS.devnet.burn_receipts;

export function sampleReceipts(root = process.cwd()): SampleList {
  const receipts: SampleReceipt[] = [], rules: Record<string, string> = {};
  for (const s of SAMPLE_SETS) {
    const file = path.join(root, s.evidence);
    if (!fs.existsSync(file)) continue;
    rules[s.rules] = fs.readFileSync(path.join(root, s.rules), "utf8");
    const rows = JSON.parse(fs.readFileSync(file, "utf8")) as { recordDate: string; units: number; status: string; signature: string | null; memo: string | null }[];
    for (const r of rows) {
      if (!r.signature || !r.memo) continue;
      const sha = /\|rules=sha256:([0-9a-f]{12})\|/.exec(r.memo)?.[1] ?? null;
      receipts.push({ ticker: s.ticker, recordDate: r.recordDate, units: r.units, status: r.status, signature: r.signature, memo: r.memo, explorerUrl: `https://explorer.solana.com/tx/${r.signature}?cluster=devnet`, evidence: s.evidence, rulesPath: s.rules, rulesSha256: sha });
    }
  }
  let featured: string | null = null;
  try { const f = demoSignature(readStatusFile(root), root); featured = receipts.some((r) => r.signature === f) ? f : null; } catch { featured = null; }
  return { cluster: "devnet", programId: DEVNET_PROGRAM_ID, rpc: PUBLIC_RPC_URLS.devnet, receipts, rules, featured };
}
