import fs from "node:fs";
import path from "node:path";
import { readStatusFile } from "@/lib/burnticker/deficitPrelaunch";
import { groupDigits, longDay } from "@/lib/burnticker/cardView";

/**
 * WATCH HOW A BURN WORKS (website-14, ChatGPT product idea 2). The existing devnet receipt (config/burnticker/current-status.json `demo`,
 * the confirmed row of its evidence file) walked through in four steps and the receipt: the result published, the budget computed,
 * the tokens bought, the tokens burned. Every number is read from the evidence row and the devnet rule file it ran under; nothing is
 * typed here and nothing new is computed except the arithmetic the receipt itself states (rule spend minus what was spent = carried).
 * Labelled devnet throughout: a practice network where tokens have no money value.
 */
export interface WalkStep { n: number; title: string; body: string[]; link: { href: string; label: string } | null }
export interface Walkthrough { network: "devnet"; ticker: string; recordDate: string; steps: WalkStep[]; receipt: { signature: string; memo: string; checkHref: string; explorerUrl: string }; note: string }

interface EvidenceRow { recordDate: string; prevDate: string; prev: string; now: string; delta: string; units: number; status: string; memo: string; signature: string; txUrl: string; sourceUrl: string; pool: string; spent: string; got: string; burned: string; verify: { expected: string; curl: string } }

const trillions = (v: string) => `$${(Number(v) / 1e12).toFixed(3)} trillion`;
const billions = (v: string) => `$${(Number(v) / 1e9).toFixed(2)} billion`;
const sol = (v: string | number, dp = 4) => `${Number(v).toFixed(dp)} SOL`;
const pctOf = (f: number) => `${Math.round(f * 1000) / 10}%`;

export function burnWalkthrough(root = process.cwd()): Walkthrough {
  const st = readStatusFile(root);
  const rows = JSON.parse(fs.readFileSync(path.join(root, st.demo.evidence), "utf8")) as EvidenceRow[];
  const r = rows.find((x) => x.recordDate === st.demo.recordDate && x.status === "confirmed");
  if (!r) throw new Error(`${st.demo.evidence}: no confirmed receipt for ${st.demo.recordDate}`);
  const rules = JSON.parse(fs.readFileSync(path.join(root, "config", "burnkeeper", "deficit.devnet.rules.json"), "utf8")) as { buyback: { fractionPerUnit: string } };
  const f = Number(rules.buyback.fractionPerUnit);
  const mainF = Number((JSON.parse(fs.readFileSync(path.join(root, st.deficit.rulesFile), "utf8")) as { buyback: { fractionPerUnit: string } }).buyback.fractionPerUnit);
  const ruleSpendLamports = Number(/rule spend (\d+) lamports/.exec(r.verify.expected)?.[1] ?? NaN);
  const spentLamports = Math.round(Number(r.spent) * 1e9);
  const carried = Number.isFinite(ruleSpendLamports) ? (ruleSpendLamports - spentLamports) / 1e9 : null;
  const t = `$${st.demo.ticker}`;
  const day = longDay(r.recordDate) ?? r.recordDate, prevDay = longDay(r.prevDate) ?? r.prevDate;
  return {
    network: "devnet", ticker: st.demo.ticker, recordDate: r.recordDate,
    steps: [
      { n: 1, title: "The result is published", link: { href: r.sourceUrl, label: "The Treasury's row for that day" },
        body: [`The U.S. Treasury published the national debt for ${day}: ${trillions(r.now)}. On ${prevDay} it was ${trillions(r.prev)}, so it rose ${billions(r.delta)}.`, `The rule counts one unit for each full $1 billion, so this day counted ${r.units} units.`] },
      { n: 2, title: "The budget is worked out", link: null,
        body: [`On devnet this coin's rule spends ${pctOf(f)} of its burn pool for each unit. For ${r.units} units that is 1 − ${Math.round((1 - f) * 10000) / 10000}^${r.units} of the pool.`, `The burn pool held ${sol(r.pool)}, so the rule asked for ${Number.isFinite(ruleSpendLamports) ? sol(ruleSpendLamports / 1e9) : "an amount the receipt does not state"}.`, `One burn run spends at most 2% of the trading pool's SOL. This run spent ${sol(r.spent)}${carried !== null ? `, and ${sol(carried)} carried over to the next run` : ""}.`] },
      { n: 3, title: "Tokens are bought", link: null,
        body: [`The program spent ${sol(r.spent)} from the burn pool and bought ${groupDigits(r.got)} ${t} on the coin's own trading pool.`, "The SOL came from the coin's burn pool. No holder's wallet was touched."] },
      { n: 4, title: "The tokens are burned", link: null,
        body: [`Every token bought, ${groupDigits(r.burned)} ${t}, was burned in the same transaction. Those tokens no longer exist.`] },
    ],
    receipt: { signature: r.signature, memo: r.memo, checkHref: "/burnticker/check?demo=1#verify", explorerUrl: r.txUrl },
    note: `This all happened on devnet, a practice network where tokens have no money value. The devnet rule spent ${pctOf(f)} per unit. The mainnet ${t} rule spends ${pctOf(mainF)} per unit.`,
  };
}
