import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * THE $DEFICIT PRE-LAUNCH PAGE'S DATA (website brief 2026-10-11 §1: "/burnticker/t/DEFICIT displays 'no token $DEFICIT'"). Until the
 * coin is registered on this host, /burnticker/t/DEFICIT explains what it is, its rule in one sentence, the 2 % / $1B dial, the launch
 * date when one is set, and links to the whitepaper and the real devnet rehearsal receipts — with the served $DEFICIT site as the
 * canonical page. Everything is read from files, never typed here: the locked rules file (its fraction, unit and sha256) and
 * config/burnticker/current-status.json (`deficit`, `demo`). GET /api/burnticker/deficit-prelaunch serves it.
 */
export const CURRENT_STATUS_FILE = path.join("config", "burnticker", "current-status.json");

export interface DeficitPrelaunch {
  ticker: "DEFICIT"; servedAt: string; canonical: string;
  oneSentence: string; dial: { fractionPerUnit: string; percent: string; unitUsd: string; unitLabel: string };
  statement: string; rulesSha256: string; rulesFile: string;
  launch: { date: string | null; note: string; seedSol?: number | string | null };
  whitepaper: string;
  rehearsal: { cluster: string; date: string; note: string; demo: { signature: string; recordDate: string; checkHref: string; explorerUrl: string; summary: string } };
}

interface StatusFile { deficit: { servedAt: string; rulesFile: string; launch: { date: string | null; note: string; seedSol?: number | string | null }; whitepaper: string; rehearsal: { cluster: string; date: string; note: string } }; demo: { cluster: string; ticker: string; recordDate: string; evidence: string; summary: string } }

export function readStatusFile(root = process.cwd()): StatusFile & Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(root, CURRENT_STATUS_FILE), "utf8"));
}

/** The featured devnet receipt's signature, read from its evidence file (never typed into the status file): a confirmed row only. */
export function demoSignature(st: StatusFile, root = process.cwd()): string {
  const rows = JSON.parse(fs.readFileSync(path.join(root, st.demo.evidence), "utf8")) as { recordDate: string; status: string; signature: string | null }[];
  const r = rows.find((x) => x.recordDate === st.demo.recordDate && x.status === "confirmed" && x.signature);
  if (!r?.signature) throw new Error(`${st.demo.evidence}: no confirmed receipt for ${st.demo.recordDate}`);
  return r.signature;
}

export function deficitPrelaunch(root = process.cwd()): DeficitPrelaunch {
  const st = readStatusFile(root);
  const sig = demoSignature(st, root);
  const text = fs.readFileSync(path.join(root, st.deficit.rulesFile), "utf8");
  const rules = JSON.parse(text) as { ticker: string; statement: string; buyback: { fractionPerUnit: string }; rule: { unitUsd: string } };
  if (rules.ticker !== "DEFICIT") throw new Error(`${st.deficit.rulesFile} is not the $DEFICIT rules file`);
  const pct = `${Number(rules.buyback.fractionPerUnit) * 100}%`;
  const unitB = Number(rules.rule.unitUsd) / 1e9;
  const unitLabel = `$${unitB}B`;
  return {
    ticker: "DEFICIT", servedAt: st.deficit.servedAt, canonical: st.deficit.servedAt,
    oneSentence: `Each full ${unitLabel} that the U.S. national debt rises from one business day to the next is one unit. Each unit spends ${pct} of $DEFICIT's burn pool buying $DEFICIT at market, and everything bought is burned.`,
    dial: { fractionPerUnit: rules.buyback.fractionPerUnit, percent: pct, unitUsd: rules.rule.unitUsd, unitLabel },
    statement: rules.statement,
    rulesSha256: crypto.createHash("sha256").update(text).digest("hex"), rulesFile: st.deficit.rulesFile,
    launch: st.deficit.launch, whitepaper: st.deficit.whitepaper,
    rehearsal: { ...st.deficit.rehearsal, demo: { signature: sig, recordDate: st.demo.recordDate, checkHref: "/burnticker/check?demo=1#verify", explorerUrl: `https://explorer.solana.com/tx/${sig}?cluster=devnet`, summary: st.demo.summary } },
  };
}
