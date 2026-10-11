import fs from "node:fs";
import path from "node:path";

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
export interface SampleList { cluster: "devnet"; programId: string; rpc: string; receipts: SampleReceipt[]; rules: Record<string, string> }

export const DEVNET_PROGRAM_ID = "AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM";

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
  return { cluster: "devnet", programId: DEVNET_PROGRAM_ID, rpc: "https://api.devnet.solana.com", receipts, rules };
}
