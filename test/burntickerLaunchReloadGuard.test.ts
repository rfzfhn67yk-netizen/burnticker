// PRELAUNCH AUDIT 2026-10-18 A-12: the "earlier version" notice checked on every window focus (a closing wallet popup triggers one) and
// invited a reload between the lock and the create, which drops the plan's mint keys and strands a locked rule. While a plan holds keys
// for unsent steps the notice says to finish first with no Reload button, and leaving the page asks first (beforeunload).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Keypair } from "@solana/web3.js";
import { launchlabPlan, type LaunchlabBundleLike } from "@/lib/burnticker/signPlan";
import { beforeUnloadGuard, holdPlan, planHoldsKeys, planIsHeld, STALE_WHILE_SIGNING_LINE, subscribePlanHold, versionNotice } from "@/lib/burnticker/planHold";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";

const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); assert.doesNotMatch(s, /→|\bbuy|\bprice\b|\bwill\b|coming soon|payout/i); };
const CREATOR = Keypair.generate().publicKey.toBase58();
const ix = (signer: string) => ({ programId: "11111111111111111111111111111111", label: "test", dataBase64: "", keys: [{ pubkey: CREATOR, isSigner: true, isWritable: true }, { pubkey: signer, isSigner: true, isWritable: true }] });
const bundle = (ticker: string): LaunchlabBundleLike => {
  const mint = Keypair.generate();
  return { mint: mint.publicKey.toBase58(), ticker, ready: true, pending: [], mintSecretKey: "secret", transactions: [{ label: "lock the rule", signers: ["creator", "mint"], instructions: [ix(mint.publicKey.toBase58())] }, { label: "create", signers: ["creator", "mint"], instructions: [ix(mint.publicKey.toBase58())] }] };
};

describe("A-12: no reload invited while a plan holds keys", () => {
  test("planHoldsKeys: unsent steps and a key in memory; not when finished, abandoned or sent", () => {
    const plan = launchlabPlan([bundle("HOLD")]);
    assert.equal(planHoldsKeys(plan, 0), true);
    assert.equal(planHoldsKeys(plan, 1), true, "between the lock and the create");
    assert.equal(planHoldsKeys(plan, 2), false);
    assert.equal(planHoldsKeys(plan, 1, { abandoned: true }), false);
    assert.equal(planHoldsKeys(plan, 1, { finished: true }), false);
    assert.equal(planHoldsKeys({ ...plan, keys: { mint: null } }, 1), false, "no key in memory: nothing to lose");
  });
  test("the version notice while held: the finish-first line, no Reload; otherwise the usual line with it", () => {
    assert.deepEqual(versionNotice(null, true), null);
    assert.deepEqual(versionNotice("A newer version is out.", false), { text: "A newer version is out.", reload: true });
    assert.deepEqual(versionNotice("A newer version is out.", true), { text: STALE_WHILE_SIGNING_LINE, reload: false });
    clean(STALE_WHILE_SIGNING_LINE);
  });
  test("holds are counted per plan and announced; beforeunload asks only while held", () => {
    let calls = 0;
    const off = subscribePlanHold(() => calls++);
    holdPlan("a", true); holdPlan("a", true); holdPlan("b", true);
    assert.equal(planIsHeld(), true); assert.equal(calls, 2);
    holdPlan("a", false); assert.equal(planIsHeld(), true);
    holdPlan("b", false); assert.equal(planIsHeld(), false); off();
    let held = true, prevented = 0;
    const ev = { preventDefault: () => { prevented++; }, returnValue: undefined as unknown };
    const guard = beforeUnloadGuard(() => held);
    guard(ev); assert.equal(prevented, 1); assert.equal(ev.returnValue, "");
    held = false; guard(ev); assert.equal(prevented, 1);
  });
  test("the wiring: the sign card holds its plan and guards unload; VersionCheck reads the hold", () => {
    const card = fs.readFileSync("src/app/burnticker/launch/SignCard.tsx", "utf8"), vc = fs.readFileSync("src/app/burnticker/_components/VersionCheck.tsx", "utf8");
    assert.match(card, /holdPlan\(key, holdsKeys\)/); assert.match(card, /window\.addEventListener\("beforeunload", guard\)/);
    assert.match(vc, /const shown = versionNotice\(line, held\)/); assert.match(vc, /\{shown\.reload && /);
  });
});

describe("review of block M: a plan stopped because launches closed does not trap the page", () => {
  test("the closed stop counts as not holding keys (no reload block, no leave prompt); a new press clears it", () => {
    const plan = launchlabPlan([bundle("SHUT")]);
    assert.equal(planHoldsKeys(plan, 1, { abandoned: true }), false, "what the card passes for a closed stop");
    const card = fs.readFileSync("src/app/burnticker/launch/SignCard.tsx", "utf8");
    assert.match(card, /planHoldsKeys\(plan, done\.length, \{ abandoned: stopped\?\.state === "abandoned" \|\| closedStop,/);
    assert.match(card, /setErr\(failureSentence\(r, n\)\); setClosedStop\(!!r\.closed\);/);
    assert.match(card, /setBusy\(true\); setErr\(null\); setNotice\(null\); setClosedStop\(false\);/);
  });
  test("side B's guard refusal is one sentence", async () => {
    const { sideBRefusal } = await import("@/lib/burnticker/api/handlers");
    const s = sideBRefusal("This launch is refused. $ABC is already the ticker of another Burnticker coin. Please pick another ticker.");
    assert.equal(s, "Side B is refused. $ABC is already the ticker of another Burnticker coin. Please pick another ticker.");
    assert.equal((s.match(/refused/g) ?? []).length, 1);
    assert.equal(sideBRefusal("this mint is already registered"), "Side B is refused. this mint is already registered");
    clean(s);
  });
});
