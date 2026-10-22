// CONTINUOUS AUDIT 2026-10-19 ACC-01: THE LAUNCH SCREEN PROMISED AN AUDIT-GATED CAP. The launch review's "Other conditions" said "Until
// the program is audited, each burn pool spends from at most 25 SOL", and the static token page held queued SOL "until the audit". The
// program's authority can raise the cap after a public 48-hour wait, and it ends at its sunset; no audit is needed for either. Every
// surface now takes its cap words from capInForce.ts, and they agree in every cap state: unread, the default, raised, a raise waiting,
// and ended.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { capHeldSentence, capSentence, capSentenceAway, effectiveCap, type EffectiveCap } from "@/lib/burnticker/capInForce";
import { PREREQUISITE_STATES } from "@/lib/burnticker/launchReview";
import { lintCopy } from "@/lib/launch/copyLint";

const now = Date.UTC(2026, 9, 19) / 1000;
const vault = new PublicKey(Buffer.alloc(32, 9));
const cfg = { burn_pool_cap_lamports: BigInt("1000000000000"), cap_sunset_ts: BigInt(now + 86_400 * 30), pending_cap_lamports: BigInt(0), pending_cap_eta: BigInt(0), authority: vault };
const STATES: [string, EffectiveCap | null][] = [
  ["unread", null],
  ["the default", effectiveCap(null, now)],
  ["raised", effectiveCap(cfg, now)],
  ["a raise waiting", effectiveCap({ ...cfg, pending_cap_lamports: BigInt("2000000000000"), pending_cap_eta: BigInt(now + 3_600) }, now)],
  ["ended", effectiveCap(cfg, now + 86_400 * 31)],
];
const AUDIT_GATED = /until the (program is )?audit|after the audit|before the audit|released after|audit decision/i;

describe("ACC-01: the cap reads the same on every surface, in every state", () => {
  for (const [name, e] of STATES) {
    test(`${name}: Trust, the launch review, the wallet summary and the token pages say it the same way`, () => {
      const trust = capSentence(e), away = capSentenceAway(e), held = capHeldSentence("3.5", e);
      for (const s of [trust, away, held]) { assert.doesNotMatch(s, AUDIT_GATED, s); assert.deepEqual(lintCopy(s).hits, [], s); }
      // a read cap is said identically everywhere; an unread one is the default, pointing to Trust for the cap in force
      if (e) assert.equal(away, trust); else assert.equal(away, `${trust} The Trust page shows the cap in force.`);
      if (!e || e.capLamports !== null) { assert.match(trust, /48-hour wait/); assert.match(trust, /An audit is not required for either change\./); }
      if (e && e.capLamports === null) assert.match(held, /has ended, so it can be spent now/);
      else { assert.match(held, /until the cap rises or ends\. The platform can raise the cap only after a public 48-hour wait, and the cap ends by .+ at the latest\. Neither change needs an audit\.$/); assert.doesNotMatch(held, /for either\./); }
    });
  }
  test("the unread sentence is the audit's suggested copy", () => {
    assert.match(capSentence(null), /^The default burn-pool cap is 25 SOL\. The platform authority can raise the cap after a public 48-hour wait, and it expires by October 1, 2027 at the latest\. An audit is not required for either change\./);
    assert.match(capHeldSentence("3.5", effectiveCap(cfg, now)), /the 1,000 SOL burn-pool cap/);
    assert.match(capHeldSentence("3.5", null), /the default 25 SOL burn-pool cap/);
  });
  test("the launch review and the token page take the helper's words; no surface keeps an audit-gated cap", () => {
    const review = fs.readFileSync("src/lib/burnticker/launchReview.ts", "utf8");
    assert.match(review, /^\s+capSentenceAway\(null\),/m, "the review's prerequisites (shown under Other conditions in the wallet summary)");
    assert.ok(PREREQUISITE_STATES.some((s) => /^Capped: .*public 48-hour wait.*Neither change needs an audit\.$/.test(s))); assert.ok(!PREREQUISITE_STATES.some((s) => /for either\./.test(s)), "AP7-7: no either without its antecedent");
    const page = fs.readFileSync("src/lib/burnticker/tokenPage.ts", "utf8");
    assert.match(page, /capHeldSentence\(s\.pool\.queuedSol, null\)/);
    assert.match(page, /queuedNote: `\$\{capSentenceAway\(null\)\}/);
    for (const f of ["src/lib/burnticker/launchReview.ts", "src/lib/burnticker/tokenPage.ts", "src/app/burnticker/launch/PreWalletSummary.tsx", "src/app/burnticker/_components/BurnMath.tsx", "src/app/burnticker/trust/page.tsx"]) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /Until the program is audited|until the audit|pre-audit cap of/i, f);
    const t = JSON.parse(fs.readFileSync("config/burnticker/transparency.json", "utf8")) as { limitations: { id: string; text: string }[] };
    const cap = t.limitations.find((l) => l.id === "cap-25")!;
    assert.doesNotMatch(cap.text, AUDIT_GATED); assert.match(cap.text, /An audit is not required/);
  });
});
